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

/**
 * Chyba zápisu do databáze. Vyhazuje se, aby webhook odpověděl 5xx – Stripe
 * pak událost pošle znovu. Kdyby se chyba spolkla, zůstal by nárok v tom
 * stavu, v jakém byl před platbou (nebo před zrušením), a nikdo by se to
 * nedozvěděl.
 */
class ZapisError extends Error {}

/** Předplatné → nároky. Aktivní i po splatnosti (několik dní hájení), jinak nic. */
async function zapsatNaroky(svc: SupabaseClient, serviceId: string, sub: Subscription) {
  const polozky = sub.items?.data ?? [];
  const planKey = polozky.map((i) => i.price?.lookup_key).find((k): k is string => !!k && k in PLANS);
  const plan = planKey ? PLANS[planKey] : null;

  // Moduly = co dává tarif plus co přidávají příplatky (SMS u Starteru).
  const moduly = new Set<string>(plan?.modules ?? []);
  let pobocekNavic = 0;
  let smsNavic = 0;
  for (const i of polozky) {
    const key = i.price?.lookup_key;
    if (!key || !(key in ADDONS)) continue;
    // Množství 0 znamená „příplatek na předplatném je, ale nic za něj neplatí“.
    // Kdyby se takový řádek započítal, přidal by modul s nulovou kvótou –
    // u SMS to dřív znamenalo odesílání bez stropu (viz níž). Chybějící
    // množství je u licencované ceny vždycky jeden kus.
    const mnozstvi = i.quantity ?? 1;
    if (mnozstvi <= 0) continue;
    const addon = ADDONS[key];
    for (const m of addon.modules ?? []) moduly.add(m);
    if (addon.branches) {
      pobocekNavic += addon.branches * mnozstvi;
      // Zaplacená pobočka navíc musí modul zapnout i tam, kde ho tarif nemá
      // (třeba když se příplatek přidal ručně v portálu Stripe). Jinak by se
      // za pobočku platilo a databáze by ji dál odmítala.
      moduly.add("branches");
    }
    if (addon.sms) smsNavic += addon.sms * mnozstvi;
  }
  const pobocekCelkem = (plan?.branchesIncluded ?? 0) + pobocekNavic;
  // Balíček SMS: co dává tarif plus dokoupené balíčky. Je to strop na měsíc,
  // nad něj se neodesílá (viz sms-send) – nic se nedoúčtovává.
  const smsCelkem = (plan?.smsIncluded ?? 0) + smsNavic;
  // Počet členů: Starter je pro jednoho člověka. Nárok `members` s kvótou
  // vzniká jen u tarifu, který počet omezuje – bez řádku vrací
  // members_allowed() „bez omezení“ a úklid níž případný starý řádek vypne
  // (přechod ze Starteru na Business limit zruší).
  if (plan?.membersIncluded != null) moduly.add("members");

  const plati = sub.status === "active" || sub.status === "trialing" || sub.status === "past_due";
  const konec = new Date((sub.current_period_end || 0) * 1000);
  const platiDo = plati && sub.current_period_end
    ? new Date(konec.getTime() + GRACE_DAYS * 86_400_000).toISOString()
    : new Date().toISOString();

  const { error: chybaBilling } = await svc.from("service_billing").upsert({
    service_id: serviceId,
    stripe_customer_id: sub.customer,
    stripe_subscription_id: sub.id,
    status: sub.status,
    plan: planKey ?? null,
    branches_quantity: pobocekNavic,
    current_period_end: sub.current_period_end ? konec.toISOString() : null,
    cancel_at_period_end: sub.cancel_at_period_end === true,
  }, { onConflict: "service_id" });
  if (chybaBilling) throw new ZapisError(`service_billing: ${chybaBilling.message}`);

  // Platící předplatné s neznámým tarifem: aspoň `access`, ať se dílna
  // nezamkne uprostřed zaplaceného období. Bez toho by přejmenovaný lookup key
  // ve Stripe znamenal, že se nárok neprodlouží a zákazník, který řádně platí,
  // v den původního konce platnosti přijde o zápis do aplikace.
  if (!plan && plati) moduly.add("access");

  if (!plan) {
    // Lookup key ve Stripe se přejmenoval nebo přibyla cena, o které tabulka
    // PLANS neví. Dřív se tady skončilo ještě před zápisem nároků, takže
    // přechod na `unpaid`/`canceled` přístup neodebral. Teď se pokračuje:
    // moduly z příplatků se zapíšou a neplatící předplatné se vypne.
    console.error("[billing-webhook] neznámý tarif u předplatného:", sub.id, polozky.map((i) => i.price?.lookup_key));
  }

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
    // Vždycky číslo, i kdyby vyšlo 0. `quota: null` čte sms-send jako
    // „bez omezení“ a takový nárok smí vzniknout jen ruční správou.
    if (modul === "sms") radek.quota = smsCelkem;
    // Kolik lidí smí být v servisu (viz members_allowed a triggery na
    // service_memberships / service_invites).
    if (modul === "members") radek.quota = plan?.membersIncluded ?? null;
    const { error } = await svc.from("service_entitlements").upsert(radek, { onConflict: "service_id,module" });
    if (error) throw new ZapisError(`service_entitlements (${modul}): ${error.message}`);
  }

  // Co předplatné nedává, nesmí zůstat zapnuté – přechod na nižší tarif jinak
  // nechal moduly vyššího tarifu běžet až do konce původního období. Ručně
  // udělené nároky (bez `valid_until`) se nevypínají, ty patří majiteli
  // aplikace. Při neznámém tarifu s platícím předplatným se nemaže nic:
  // nevíme, co má zůstat, a přístup zaplacené dílny nesmí zmizet kvůli
  // přejmenovanému lookup key.
  if (plan || !plati) {
    const nechat = plati ? [...moduly] : [];
    let dotaz = svc.from("service_entitlements")
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq("service_id", serviceId)
      .not("valid_until", "is", null);
    if (nechat.length > 0) dotaz = dotaz.not("module", "in", `(${nechat.join(",")})`);
    const { error } = await dotaz;
    if (error) throw new ZapisError(`service_entitlements (úklid): ${error.message}`);
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
        // Přepsat i tarif a počty: jinak obrazovka Předplatné dál ukazuje
        // „Business, 2 pobočky, obnoví se…“ u předplatného, které už neběží.
        const { error: chybaBilling } = await svc.from("service_billing").upsert({
          service_id: serviceId,
          status: "canceled",
          stripe_subscription_id: sub.id,
          stripe_customer_id: sub.customer,
          plan: null,
          branches_quantity: 0,
          cancel_at_period_end: false,
          current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
        }, { onConflict: "service_id" });
        if (chybaBilling) throw new ZapisError(`service_billing: ${chybaBilling.message}`);
        // Vypnout jen nároky z předplatného, tedy ty s koncem platnosti.
        // Řádky bez `valid_until` uděluje ručně majitel aplikace
        // (entitlements-manage) a zrušené předplatné jimi nehýbe.
        //
        // Pozor na `.neq("valid_until", null)`: PostgREST z toho udělá
        // porovnání s řetězcem „null“, které nesedne na žádný řádek –
        // zrušené předplatné by pak přístup neodebralo vůbec.
        const { error: chybaNaroku } = await svc.from("service_entitlements")
          .update({ active: false, updated_at: new Date().toISOString() })
          .eq("service_id", serviceId)
          .not("valid_until", "is", null);
        if (chybaNaroku) throw new ZapisError(`service_entitlements: ${chybaNaroku.message}`);
      } else {
        await zapsatNaroky(svc, serviceId, sub);
      }
      return json({ ok: true });
    }

    if (udalost.type === "invoice.payment_failed") {
      const faktura = udalost.data.object as { customer?: string };
      if (faktura.customer) {
        const { error } = await svc.from("service_billing").update({ status: "past_due" }).eq("stripe_customer_id", faktura.customer);
        if (error) throw new ZapisError(`service_billing: ${error.message}`);
      }
      return json({ ok: true });
    }

    if (udalost.type === "checkout.session.completed") {
      // Přístup vzniká výhradně z `customer.subscription.*`; Checkout event
      // přijde dřív a nemá položky předplatného. Návody u Stripe ale ukazují
      // hlavně jeho, takže se aspoň zaloguje – v opačném případě vypadá
      // špatně nastavený endpoint jako mrtvý webhook.
      const sezeni = udalost.data.object as { id?: string; subscription?: string };
      console.log("[billing-webhook] checkout dokončen (nároky přijdou s předplatným):", sezeni.id, sezeni.subscription);
      return json({ ok: true, ignorovano: udalost.type });
    }

    return json({ ok: true, ignorovano: udalost.type });
  } catch (e) {
    console.error("[billing-webhook]", e);
    // 5xx schválně: Stripe událost zopakuje. Kdyby se odpovědělo 200,
    // zůstal by nárok navždy v původním stavu – zaplaceno a nezapnuto,
    // nebo zrušeno a pořád zapnuto.
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
