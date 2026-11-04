/**
 * Kurz ČNB pro aplikaci: { mena: "USD" } → { mena, kurz, platnost }.
 *
 * Kurzovní lístek ČNB (api.cnb.cz) neposílá CORS hlavičky, prohlížeč ho
 * napřímo nenačte – proto tahle funkce. `kurz` je cena jedné jednotky měny
 * v Kč (ČNB u některých měn uvádí kurz za 100 jednotek, tady se přepočte).
 * Volá ji přihlášený uživatel (brána ověří JWT); nic nečte ani nezapisuje
 * v databázi.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = (await req.json().catch(() => ({}))) as { mena?: unknown };
    const mena = typeof body.mena === "string" ? body.mena.trim().toUpperCase() : "";
    if (!/^[A-Z]{3}$/.test(mena)) return json({ error: "Neplatná měna." }, 400);
    if (mena === "CZK") return json({ mena, kurz: 1, platnost: null });

    const res = await fetch("https://api.cnb.cz/cnbapi/exrates/daily?lang=EN", { headers: { Accept: "application/json" } });
    if (!res.ok) return json({ error: `ČNB odpověděla ${res.status}.` }, 502);
    const data = (await res.json()) as { rates?: Array<{ currencyCode?: string; rate?: number; amount?: number; validFor?: string }> };
    const r = (data.rates ?? []).find((x) => x.currencyCode === mena);
    if (!r || typeof r.rate !== "number" || !r.amount) return json({ error: `Kurz ${mena} v lístku ČNB není.` }, 404);
    return json({ mena, kurz: r.rate / r.amount, platnost: r.validFor ?? null });
  } catch (e) {
    console.error("[kurz-cnb]", e);
    return json({ error: "Kurz se nepodařilo načíst." }, 500);
  }
});
