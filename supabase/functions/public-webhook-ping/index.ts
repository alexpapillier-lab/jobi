import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { zkontrolujWebhook } from "../_shared/webhook.ts";

/**
 * Ping na webhook servisu po změně veřejného ceníku nebo skladu.
 *
 *   POST { serviceId }        – z aplikace, s přihlášením
 *
 * Statický web se sám nedozví, že servis zdražil; tímhle si spustí
 * přegenerování. Adresa se kontroluje znovu tady, ne jen při ukládání –
 * do sloupce se dá zapsat i přímo přes REST.
 *
 * Zároveň se obnoví cache Workeru na api.appjobi.com: ceník i sklad se
 * tam drží pět minut a bez tohohle by skrytý model nebo nová cena po
 * uložení dál chodily ven staré. Obnovení běží vždy, i bez webhooku.
 *
 * Zadání: docs/ZADANI_API.md, kapitola 6.
 */

const VEREJNE_API = "https://api.appjobi.com/v1";

/**
 * Obnoví uloženou odpověď ve Workeru: GET s Cache-Control: no-cache Worker
 * nečte z paměti, dojde k původu a novou odpověď uloží místo staré. Nejlepší
 * snaha – 404 (modul vypnutý) i výpadek jsou v pořádku, uložení tím nepadá.
 */
async function obnovCacheVerejnehoApi(slug: string): Promise<Record<string, number>> {
  const vysledek: Record<string, number> = {};
  await Promise.all((["catalog", "inventory"] as const).map(async (endpoint) => {
    try {
      const r = await fetch(`${VEREJNE_API}/${endpoint}?service=${encodeURIComponent(slug)}`, {
        headers: { "Cache-Control": "no-cache", "User-Agent": "Jobi-Webhook/1" },
        signal: AbortSignal.timeout(8000),
      });
      // Tělo se nečte – stačí, že Worker odpověď uložil.
      await r.body?.cancel();
      vysledek[endpoint] = r.status;
    } catch {
      vysledek[endpoint] = 0;
    }
  }));
  return vysledek;
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (telo: unknown, status = 200) =>
  new Response(JSON.stringify(telo), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Podporováno je jen POST" }, 405);

  const hlavicka = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!hlavicka) return json({ error: "Chybí přihlášení" }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const uzivatel = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: hlavicka } },
  });
  const { data: kdo } = await uzivatel.auth.getUser();
  if (!kdo?.user) return json({ error: "Nepřihlášený" }, 401);

  const telo = await req.json().catch(() => ({}));
  const serviceId = typeof telo?.serviceId === "string" ? telo.serviceId : "";
  if (!serviceId) return json({ error: "Chybí serviceId" }, 400);

  const svc = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: clenstvi } = await svc
    .from("service_memberships")
    .select("role")
    .eq("service_id", serviceId)
    .eq("user_id", kdo.user.id)
    .maybeSingle();
  if (!clenstvi) return json({ error: "Nejsi členem tohohle servisu" }, 403);

  const { data: servis } = await svc
    .from("services")
    .select("public_webhook_url, public_slug")
    .eq("id", serviceId)
    .maybeSingle();

  // Cache se obnovuje před webhookem: cizí build si pak stáhne už nový ceník.
  const obnoveno = servis?.public_slug ? await obnovCacheVerejnehoApi(servis.public_slug) : null;

  const kontrola = zkontrolujWebhook(servis?.public_webhook_url);
  if (!kontrola.ok) return json({ skipped: true, reason: kontrola.duvod, refreshed: obnoveno });

  let stav = 0;
  let chyba: string | null = null;
  try {
    // Krátký časový limit – čeká na to uživatel v aplikaci a cizí server
    // může mlčet libovolně dlouho.
    const odpoved = await fetch(kontrola.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "Jobi-Webhook/1" },
      body: JSON.stringify({
        event: "catalog.changed",
        service: servis?.public_slug ?? null,
        at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(8000),
      redirect: "error",   // přesměrování by kontrolu adresy obešlo
    });
    stav = odpoved.status;
  } catch (e) {
    chyba = String(e).slice(0, 200);
  }

  await svc
    .from("services")
    .update({
      public_webhook_last_at: new Date().toISOString(),
      public_webhook_last_status: stav || null,
    })
    .eq("id", serviceId);

  return json({ ok: stav >= 200 && stav < 300, status: stav, error: chyba, refreshed: obnoveno });
});
