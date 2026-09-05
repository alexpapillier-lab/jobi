/**
 * Edge Function: billing-webhook
 *
 * Jediné místo, kde se ze zaplaceného předplatného stane přístup do aplikace.
 * Stripe pošle událost, funkce ověří podpis a přepíše `service_entitlements`
 * a `service_billing`. Aplikace se pak Stripe už neptá.
 *
 * Nastavit ve Stripe → Developers → Webhooks:
 *   URL:      https://<projekt>.supabase.co/functions/v1/billing-webhook
 *   Události: customer.subscription.created, .updated, .deleted,
 *             invoice.payment_failed
 *   Tajemství uložit jako STRIPE_WEBHOOK_SECRET.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { overitPodpis, stripe, ADDONS, GRACE_DAYS, PLANS } from "../_shared/stripe.ts";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, stripe-signature" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

type Subscription = {
  id: string;
  status: string;
  customer: string;
  current_period_end: number;
  cancel_at_period_end?: boolean;
  metadata?: Record<string, string>;
  items?: { data?: Array<{ quantity?: number; price?: { lookup_key?: string | null } }> };
};

/** Ke které dílně předplatné patří: metadata, jinak zákazník v naší tabulce. */
async function najitServis(svc: SupabaseClient, sub: Subscription): Promise<string | null> {
  const zMeta = sub.metadata?.service_id;
  if (zMeta) return zMeta;
  const { data } = await svc.from("service_billing").select("service_id").eq("stripe_customer_id", sub.customer).maybeSingle();
  if (data?.service_id) return data.service_id as string;
  // Poslední pokus: metadata u zákazníka (zakládá je billing-checkout).
  try {
    const zakaznik = await stripe<{ metadata?: Record<string, string> }>("GET", `/customers/${sub.customer}`);
    return zakaznik.metadata?.service_id ?? null;
  } catch {
    return null;
  }
}

/** Předplatné → nároky. Aktivní i po splatnosti (několik dní hájení), jinak nic. */
async function zapsatNaroky(svc: SupabaseClient, serviceId: string, sub: Subscription) {
  const polozky = sub.items?.data ?? [];
  const planKey = polozky.map((i) => i.price?.lookup_key).find((k): k is string => !!k && k in PLANS);
  const plan = planKey ? PLANS[planKey] : null;

  // Moduly = co dává tarif plus co přidávají příplatky (SMS u Starteru).
  const moduly = new Set<string>(plan?.modules ?? []);
  let pobocekNavic = 0;
  for (const i of polozky) {
    const key = i.price?.lookup_key;
    if (!key || !(key in ADDONS)) continue;
    const addon = ADDONS[key];
    for (const m of addon.modules ?? []) moduly.add(m);
    if (addon.branches) pobocekNavic += addon.branches * (i.quantity ?? 0);
  }
  const pobocekCelkem = (plan?.branchesIncluded ?? 0) + pobocekNavic;

  const plati = sub.status === "active" || sub.status === "trialing" || sub.status === "past_due";
  const konec = new Date((sub.current_period_end || 0) * 1000);
  const platiDo = plati && sub.current_period_end
    ? new Date(konec.getTime() + GRACE_DAYS * 86_400_000).toISOString()
    : new Date().toISOString();

  await svc.from("service_billing").upsert({
    service_id: serviceId,
    stripe_customer_id: sub.customer,
    stripe_subscription_id: sub.id,
    status: sub.status,
    plan: planKey ?? null,
    branches_quantity: pobocekNavic,
    current_period_end: sub.current_period_end ? konec.toISOString() : null,
    cancel_at_period_end: sub.cancel_at_period_end === true,
  }, { onConflict: "service_id" });

  if (moduly.size === 0) return;

  for (const modul of moduly) {
    const radek: Record<string, unknown> = {
      service_id: serviceId,
      module: modul,
      active: plati,
      valid_until: platiDo,
      note: `${plan?.label ?? "Předplatné"} (${sub.status})`,
      updated_at: new Date().toISOString(),
    };
    // Kolik poboček tarif zahrnuje plus kolik se jich dokoupilo.
    if (modul === "branches") radek.quota = Math.max(1, pobocekCelkem);
    await svc.from("service_entitlements").upsert(radek, { onConflict: "service_id,module" });
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET")?.trim();
    if (!secret) return json({ error: "Webhook zatím není nastavený (chybí STRIPE_WEBHOOK_SECRET)." }, 503);

    const payload = await req.text();
    const ok = await overitPodpis(payload, req.headers.get("stripe-signature"), secret);
    if (!ok) return json({ error: "Neplatný podpis." }, 400);

    const udalost = JSON.parse(payload) as { type: string; data: { object: Record<string, unknown> } };
    const svc: SupabaseClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    if (udalost.type.startsWith("customer.subscription.")) {
      const sub = udalost.data.object as unknown as Subscription;
      const serviceId = await najitServis(svc, sub);
      if (!serviceId) {
        console.error("[billing-webhook] předplatné bez servisu:", sub.id);
        return json({ ok: true, ignorovano: "neznámý servis" });
      }
      if (udalost.type === "customer.subscription.deleted") {
        // Zrušeno: přístup končí teď, data zůstávají.
        await svc.from("service_billing").upsert({ service_id: serviceId, status: "canceled", stripe_subscription_id: sub.id, stripe_customer_id: sub.customer }, { onConflict: "service_id" });
        await svc.from("service_entitlements")
          .update({ active: false, updated_at: new Date().toISOString() })
          .eq("service_id", serviceId)
          .neq("valid_until", null);
      } else {
        await zapsatNaroky(svc, serviceId, sub);
      }
      return json({ ok: true });
    }

    if (udalost.type === "invoice.payment_failed") {
      const faktura = udalost.data.object as { customer?: string };
      if (faktura.customer) {
        await svc.from("service_billing").update({ status: "past_due" }).eq("stripe_customer_id", faktura.customer);
      }
      return json({ ok: true });
    }

    return json({ ok: true, ignorovano: udalost.type });
  } catch (e) {
    console.error("[billing-webhook]", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
