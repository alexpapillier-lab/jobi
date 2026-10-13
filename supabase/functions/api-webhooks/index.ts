import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { zkontrolujWebhook } from "../_shared/webhook.ts";
import { maOdeslat, maSmyslOpakovat, naplanujOpakovani, podpisWebhooku } from "../_shared/objednavky.ts";

/**
 * Odesílání webhooků objednávek (order.converted, ticket.status_changed,
 * ticket.completed, order.cancelled) na adresu servisu.
 *
 *   { secret }                              – pg_cron (api_webhooky_tick) každou
 *                                             minutu, když ve frontě něco čeká
 *   { action: "kick", serviceId }           – aplikace hned po založení zakázky
 *                                             z objednávky (člen servisu), ať web
 *                                             nečeká na další minutu
 *   { action: "test", serviceId }           – „Poslat zkušební webhook“ (majitel/správce)
 *
 * Každý požadavek nese hlavičky
 *   X-Jobi-Event: <událost>
 *   X-Jobi-Delivery: <id doručení>     (stejné při opakování – příjemce podle něj pozná duplicitu)
 *   X-Jobi-Signature: sha256=<hex HMAC-SHA256 těla klíčem z Nastavení → API>
 *
 * Neúspěch (výpadek, 5xx, 408, 429) se zkusí znovu 3× s pauzou 1, 5 a 30 minut;
 * ostatní 4xx se neopakují. Adresa se před každým odesláním kontroluje znovu
 * (SSRF – do sloupce jde zapsat i mimo aplikaci) a přesměrování se nesleduje.
 *
 * Fronta a log: tabulka api_webhook_doruceni (migrace 20261013100000).
 */

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (telo: unknown, status = 200) =>
  new Response(JSON.stringify(telo), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });

type Svc = SupabaseClient<any, any, any>;
type Polozka = {
  id: string;
  service_id: string;
  udalost: string;
  payload: Record<string, unknown>;
  pokusy: number;
  url: string | null;
  tajemstvi: string | null;
  udalosti: string[] | null;
  aktivni: boolean | null;
};
type Vysledek = { ok: boolean; status: number | null; chyba: string | null };

const CASOVY_LIMIT_MS = 10_000;

/** Jedno odeslání. Nevyhazuje – chyba se vrací ve výsledku. */
async function odesli(url: string, tajemstvi: string, udalost: string, doruceniId: string, payload: unknown): Promise<Vysledek> {
  const kontrola = zkontrolujWebhook(url);
  if (!kontrola.ok) return { ok: false, status: null, chyba: kontrola.duvod };
  const telo = JSON.stringify(payload);
  try {
    const r = await fetch(kontrola.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "User-Agent": "Jobi-Webhook/1",
        "X-Jobi-Event": udalost,
        "X-Jobi-Delivery": doruceniId,
        "X-Jobi-Signature": await podpisWebhooku(tajemstvi, telo),
      },
      body: telo,
      signal: AbortSignal.timeout(CASOVY_LIMIT_MS),
      redirect: "error", // přesměrování by kontrolu adresy obešlo
    });
    // Tělo odpovědi nás nezajímá, jen ať se spojení uvolní.
    const ukazka = r.ok ? "" : (await r.text().catch(() => "")).slice(0, 200);
    await r.body?.cancel().catch(() => {});
    return { ok: r.ok, status: r.status, chyba: r.ok ? null : `HTTP ${r.status}${ukazka ? `: ${ukazka}` : ""}` };
  } catch (e) {
    const zprava = e instanceof Error ? e.message : String(e);
    return { ok: false, status: null, chyba: /timed? ?out|abort/i.test(zprava) ? "Server neodpověděl do 10 s" : zprava.slice(0, 200) };
  }
}

/** Projde frontu (volitelně jen jednoho servisu). Vrací počty. */
async function zpracujFrontu(svc: Svc, serviceId: string | null, limit: number, konec: number) {
  const pocty = { odeslano: 0, chyba: 0, opakovani: 0, zahozeno: 0 };
  const naroky = new Map<string, boolean>();
  const maNarok = async (sid: string) => {
    let ma = naroky.get(sid);
    if (ma === undefined) {
      const { data, error } = await svc.rpc("has_entitlement", { p_service_id: sid, p_module: "api_catalog" });
      ma = !error && data === true;
      naroky.set(sid, ma);
    }
    return ma;
  };

  while (Date.now() < konec) {
    const { data, error } = await svc.rpc("api_webhooky_k_odeslani", { p_limit: limit, p_service_id: serviceId });
    if (error) {
      console.error("[api-webhooks] fronta:", error.message);
      break;
    }
    const davka = (data ?? []) as Polozka[];
    if (davka.length === 0) break;

    // Po pěti souběžně – jeden pomalý server nezdrží ostatní servisy.
    for (let i = 0; i < davka.length; i += 5) {
      await Promise.all(davka.slice(i, i + 5).map(async (p) => {
        const zahodit = async (duvod: string) => {
          pocty.zahozeno += 1;
          await svc.rpc("api_webhook_vysledek", { p_id: p.id, p_ok: false, p_http_status: null, p_chyba: duvod, p_dalsi_pokus_at: null, p_zahodit: true });
        };
        if (!p.url || !p.tajemstvi) return zahodit("Webhook není nastavený");
        if (!maOdeslat(p.udalost, p.udalosti, p.aktivni)) return zahodit(p.aktivni ? "Událost se už neodebírá" : "Webhook je vypnutý");
        if (!(await maNarok(p.service_id))) return zahodit("Veřejné API není pro servis aktivní");

        const v = await odesli(p.url, p.tajemstvi, p.udalost, p.id, p.payload);
        const dalsi = v.ok || !maSmyslOpakovat(v.status) ? null : naplanujOpakovani(p.pokusy);
        if (v.ok) pocty.odeslano += 1;
        else if (dalsi) pocty.opakovani += 1;
        else pocty.chyba += 1;
        const { error: chybaZapisu } = await svc.rpc("api_webhook_vysledek", {
          p_id: p.id,
          p_ok: v.ok,
          p_http_status: v.status,
          p_chyba: v.chyba,
          p_dalsi_pokus_at: dalsi ? dalsi.toISOString() : null,
          p_zahodit: false,
        });
        if (chybaZapisu) console.error("[api-webhooks] výsledek:", p.id, chybaZapisu.message);
      }));
    }
    if (davka.length < limit) break;
  }
  return pocty;
}

async function overitTajemstvi(svc: Svc, secret: string): Promise<boolean> {
  const { data, error } = await svc.rpc("api_webhooky_cron_secret");
  if (error) console.error("[api-webhooks] tajemství:", error.message);
  const ocekavane = typeof data === "string" ? data : "";
  if (!ocekavane || secret.length !== ocekavane.length) return false;
  let rozdil = 0;
  for (let i = 0; i < secret.length; i++) rozdil |= secret.charCodeAt(i) ^ ocekavane.charCodeAt(i);
  return rozdil === 0;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Podporováno je jen POST" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const svc = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const telo = await req.json().catch(() => ({})) as Record<string, unknown>;

  // ── cron ──────────────────────────────────────────────────────────────────
  if (typeof telo.secret === "string") {
    if (!(await overitTajemstvi(svc, telo.secret))) return json({ error: "Neplatné tajemství" }, 401);
    // Edge funkce má na běh desítky sekund; nechá si rezervu.
    const pocty = await zpracujFrontu(svc, null, 50, Date.now() + 40_000);
    return json({ ok: true, ...pocty });
  }

  // ── aplikace (přihlášený uživatel) ────────────────────────────────────────
  const hlavicka = req.headers.get("Authorization") ?? "";
  if (!hlavicka) return json({ error: "Chybí přihlášení" }, 401);
  const uzivatel = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: hlavicka } } });
  const { data: kdo } = await uzivatel.auth.getUser();
  if (!kdo?.user) return json({ error: "Nepřihlášený" }, 401);

  const serviceId = typeof telo.serviceId === "string" ? telo.serviceId : "";
  if (!serviceId) return json({ error: "Chybí serviceId" }, 400);
  const { data: clenstvi } = await svc
    .from("service_memberships")
    .select("role")
    .eq("service_id", serviceId)
    .eq("user_id", kdo.user.id)
    .maybeSingle();
  if (!clenstvi) return json({ error: "Nejsi členem tohohle servisu" }, 403);

  if (telo.action === "kick") {
    const pocty = await zpracujFrontu(svc, serviceId, 20, Date.now() + 15_000);
    return json({ ok: true, ...pocty });
  }

  if (telo.action === "test") {
    if (clenstvi.role !== "owner" && clenstvi.role !== "admin") return json({ error: "Zkušební webhook posílá jen majitel nebo správce" }, 403);
    const { data: w } = await svc.from("api_webhooky").select("url, tajemstvi").eq("service_id", serviceId).maybeSingle();
    if (!w) return json({ error: "Webhook není nastavený" }, 400);
    const ted = new Date().toISOString();
    const payload = {
      event: "ping",
      test: true,
      external_id: "TEST-0000",
      source: "Jobi",
      order_status: "converted",
      ticket_code: "TEST-1",
      status: { key: "received", label: "Přijato", is_final: false },
      total: 0,
      updated_at: ted,
    };
    const { data: zaznam, error: chybaZaznamu } = await svc
      .from("api_webhook_doruceni")
      .insert({ service_id: serviceId, udalost: "ping", payload, stav: "odesila", pokusy: 1, zamceno_at: ted })
      .select("id")
      .single();
    if (chybaZaznamu) return json({ error: chybaZaznamu.message }, 500);
    const id = (zaznam as { id: string }).id;
    const v = await odesli(w.url as string, w.tajemstvi as string, "ping", id, payload);
    await svc.rpc("api_webhook_vysledek", { p_id: id, p_ok: v.ok, p_http_status: v.status, p_chyba: v.chyba, p_dalsi_pokus_at: null, p_zahodit: false });
    return json({ ok: v.ok, status: v.status, error: v.chyba });
  }

  return json({ error: `Neznámá akce "${String(telo.action)}"` }, 400);
});
