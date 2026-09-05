/**
 * Edge Function: billing-portal
 *
 * Odkaz do zákaznického portálu Stripe: změna karty, faktury, zrušení.
 * Nic z toho nemusíme programovat ani zobrazovat sami.
 *
 * POST { service_id, return_url } → { url }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { stripe, stripeReady } from "../_shared/stripe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!stripeReady()) return json({ error: "Platby zatím nejsou spuštěné." }, 503);

    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "Chybí přihlášení." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const { data: userRes } = await userClient.auth.getUser();
    if (!userRes?.user) return json({ error: "Neplatné přihlášení." }, 401);

    const body = await req.json().catch(() => ({}));
    const serviceId = typeof body?.service_id === "string" ? body.service_id : "";
    const returnUrl = typeof body?.return_url === "string" && body.return_url.startsWith("http")
      ? body.return_url
      : "https://appjobi.com/servis/";
    if (!serviceId) return json({ error: "Chybí service_id." }, 400);

    const svc = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: clenstvi } = await svc
      .from("service_memberships")
      .select("role")
      .eq("service_id", serviceId)
      .eq("user_id", userRes.user.id)
      .maybeSingle();
    if (!clenstvi || (clenstvi.role !== "owner" && clenstvi.role !== "admin")) {
      return json({ error: "Předplatné může spravovat jen majitel nebo správce servisu." }, 403);
    }

    const { data: billing } = await svc
      .from("service_billing")
      .select("stripe_customer_id")
      .eq("service_id", serviceId)
      .maybeSingle();
    if (!billing?.stripe_customer_id) return json({ error: "Servis zatím nemá předplatné." }, 400);

    const sezeni = await stripe<{ url: string }>("POST", "/billing_portal/sessions", {
      customer: billing.stripe_customer_id,
      return_url: returnUrl,
    });
    return json({ ok: true, url: sezeni.url });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
