/**
 * Edge Function: billing-prices
 *
 * Ceník pro obrazovku Předplatné. Částky se čtou ze Stripe, aby se nikde
 * v aplikaci neopisovaly a nemohly se rozejít se skutečností.
 *
 * POST {} → { plans: [{ lookup_key, label, tier, interval, amount, currency, modules, branchesIncluded }], addons: […] }
 * Bez nastaveného Stripe vrací 503 a obrazovka ukáže tarify bez cen.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { stripe, stripeReady, ADDONS, PLANS } from "../_shared/stripe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!stripeReady()) return json({ error: "Platby zatím nejsou spuštěné." }, 503);

    // Jedním dotazem všechny aktivní ceny; lookup key je náš klíč.
    const res = await stripe<{ data?: Array<{ lookup_key?: string | null; unit_amount?: number | null; currency?: string }> }>(
      "GET",
      "/prices",
      { active: true, limit: 100 },
    );
    const podleKlice = new Map<string, { amount: number | null; currency: string }>();
    for (const c of res.data ?? []) {
      if (c.lookup_key) podleKlice.set(c.lookup_key, { amount: c.unit_amount ?? null, currency: c.currency ?? "czk" });
    }

    const plans = Object.entries(PLANS).map(([lookup_key, def]) => ({
      lookup_key,
      label: def.label,
      tier: def.tier,
      interval: def.interval,
      modules: def.modules,
      branchesIncluded: def.branchesIncluded,
      amount: podleKlice.get(lookup_key)?.amount ?? null,
      currency: podleKlice.get(lookup_key)?.currency ?? "czk",
    }));
    const addons = Object.keys(ADDONS).map((lookup_key) => ({
      lookup_key,
      amount: podleKlice.get(lookup_key)?.amount ?? null,
      currency: podleKlice.get(lookup_key)?.currency ?? "czk",
    }));

    return json({ ok: true, plans, addons });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
