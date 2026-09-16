import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { naplanujProvize, STATUS_PRIPRAVENO, STATUS_VYDANO, type RadekKOdeslani, type RadekTabulky, type ZakazkaProProvizi } from "../_shared/provize.ts";

/**
 * Provize do Google Sheets – náhrada bota zakazkovylist-bot.
 *
 * Bot projížděl Zakázkový list a zakázky ve stavu „Připraveno k převzetí“ /
 * „Vydáno“ posílal do Apps Scriptu nad tabulkou provizí. Zakázky jsou teď
 * v Jobi, takže totéž dělá tahle funkce nad `tickets`: stáhne z Apps Scriptu,
 * co v tabulce už je (list_orders), spočítá, co chybí (viz _shared/provize.ts),
 * a pošle to stejným endpointem ve stejném tvaru. Apps Script se nemění.
 *
 * Volání:
 *   1) pg_cron každé 2 hodiny: `{ secret, mode: "scheduled" }` – všechny
 *      servisy se zapnutým config.provize_sheets. Tajemství je ve Vaultu.
 *   2) ručně z aplikace (owner/admin): `{ serviceId, dryRun? }` – dryRun jen
 *      vrátí, co by se poslalo.
 *
 * Nastavení servisu (service_settings.config.provize_sheets):
 *   zapnuto, endpoint (URL Apps Scriptu), statusy [připraveno, vydáno] –
 *   názvy statusů v Jobi, od (volitelně: zakázky, které v tabulce nejsou, se
 *   přidají jen když se do sledovaného stavu dostaly v Jobi od tohoto data,
 *   nebo byly od té doby založené).
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// deno-lint-ignore no-explicit-any
type Svc = SupabaseClient<any, any, any>;

type Nastaveni = {
  zapnuto: boolean;
  endpoint: string;
  statusy: { pripraveno: string; vydano: string };
  od: string | null;
};

type VysledekServisu = {
  serviceId: string;
  ok: boolean;
  poslano: number;
  nove: number;
  doplatky: number;
  opraveno: number;
  uzavreno: number;
  chyba?: string;
  /** Jen zkušební běh: řádky, které by se poslaly. */
  radky?: RadekKOdeslani[];
};

/** Dávka jako u bota – Apps Script větší tělo zpracovává pomalu. */
const VELIKOST_DAVKY = 15;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const svc: Svc = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const dryRun = body.dryRun === true;

    if (typeof body.secret === "string" && body.secret) {
      if (!(await overitTajemstvi(svc, body.secret))) return json({ error: "Unauthorized" }, 401);
      const { data, error } = await svc
        .from("service_settings")
        .select("service_id, config")
        .filter("config->provize_sheets->>zapnuto", "eq", "true");
      if (error) throw new Error(`service_settings: ${error.message}`);
      const vysledky: VysledekServisu[] = [];
      for (const r of (data ?? []) as Array<{ service_id: string; config: Record<string, unknown> | null }>) {
        vysledky.push(await zpracujServis(svc, r.service_id, nastaveniZConfigu(r.config), dryRun, "scheduled"));
      }
      return json({ ok: true, dryRun, vysledky });
    }

    const user = await prihlasenyUzivatel(req, supabaseUrl);
    if (!user) return json({ error: "Unauthorized" }, 401);
    const serviceId = typeof body.serviceId === "string" ? body.serviceId : "";
    if (!serviceId) return json({ error: "Chybí serviceId." }, 400);
    if (!(await jeSpravce(svc, serviceId, user.id))) return json({ error: "Jen vlastník nebo správce servisu." }, 403);

    const { data: nast, error } = await svc.from("service_settings").select("config").eq("service_id", serviceId).maybeSingle();
    if (error) throw new Error(`service_settings: ${error.message}`);
    const nastaveni = nastaveniZConfigu((nast as { config?: Record<string, unknown> } | null)?.config ?? null);
    if (!nastaveni.zapnuto) return json({ error: "Provize do Sheets nejsou pro tento servis zapnuté." }, 400);
    const vysledek = await zpracujServis(svc, serviceId, nastaveni, dryRun, "manual");
    return json({ ok: vysledek.ok, dryRun, ...vysledek });
  } catch (e) {
    console.error("[provize-sheets]", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// ---------------------------------------------------------------------------
// Zpracování jednoho servisu
// ---------------------------------------------------------------------------

async function zpracujServis(svc: Svc, serviceId: string, nastaveni: Nastaveni, dryRun: boolean, rezim: string): Promise<VysledekServisu> {
  const zaklad = { serviceId, ok: false, poslano: 0, nove: 0, doplatky: 0, opraveno: 0, uzavreno: 0 };
  let radky: RadekKOdeslani[] = [];
  try {
    if (!nastaveni.endpoint) throw new Error("Chybí endpoint Apps Scriptu v nastavení.");

    const klice = await kliceStatusu(svc, serviceId, nastaveni.statusy);
    const vTabulce = await nactiTabulku(nastaveni.endpoint);
    const vse = await nactiZakazky(svc, serviceId, klice);
    // „od“: zakázky, které v tabulce ještě nejsou, se přidají jen tehdy, když
    // se do sledovaného stavu dostaly v Jobi od tohoto data (podle historie
    // zakázky) nebo byly od té doby založené. Importovaná historie ze ZL, kterou
    // bot nikdy nezapsal, se tak sama nezačne účtovat; co v tabulce už je, se
    // uzavírá a doplácí bez ohledu na datum.
    const vTabulceIds = new Set(vTabulce.map((r) => String(r.id ?? "").trim()));
    const prepnutoVJobi = nastaveni.od ? await prepnuteOd(svc, serviceId, klice, nastaveni.od) : null;
    const zakazky = vse
      .filter((z) => !prepnutoVJobi || vTabulceIds.has((z.code ?? "").trim()) || z.created_at >= nastaveni.od! || prepnutoVJobi.has(z.id))
      .map(({ id: _id, created_at: _c, ...z }) => z);
    const plan = naplanujProvize(zakazky, vTabulce, nastaveni.statusy);
    radky = plan.radky;

    if (!dryRun) {
      for (let i = 0; i < radky.length; i += VELIKOST_DAVKY) {
        await posliDavku(nastaveni.endpoint, radky.slice(i, i + VELIKOST_DAVKY));
      }
    }

    const vysledek: VysledekServisu = { ...zaklad, ok: true, poslano: radky.length, nove: plan.nove, doplatky: plan.doplatky, opraveno: plan.opraveno, uzavreno: plan.uzavreno };
    if (!dryRun) await zapisBeh(svc, vysledek, rezim, radky, null);
    // Ve zkušebním běhu se nic neposílá, tak ať jde vidět, co by šlo.
    return dryRun ? { ...vysledek, radky } : vysledek;
  } catch (e) {
    const chyba = e instanceof Error ? e.message : String(e);
    console.error(`[provize-sheets] servis ${serviceId}:`, chyba);
    if (!dryRun) await zapisBeh(svc, zaklad, rezim, radky, chyba);
    return { ...zaklad, chyba };
  }
}

function nastaveniZConfigu(config: Record<string, unknown> | null): Nastaveni {
  const p = (config?.provize_sheets ?? {}) as Record<string, unknown>;
  const statusy = Array.isArray(p.statusy) ? (p.statusy as unknown[]).map((s) => String(s ?? "").trim()) : [];
  return {
    zapnuto: p.zapnuto === true,
    endpoint: typeof p.endpoint === "string" ? p.endpoint.trim() : "",
    statusy: { pripraveno: statusy[0] || STATUS_PRIPRAVENO, vydano: statusy[1] || STATUS_VYDANO },
    od: typeof p.od === "string" && p.od.trim() ? p.od.trim() : null,
  };
}

/** Klíče statusů podle jejich názvů v Jobi (tickets.status drží klíč, ne název). */
async function kliceStatusu(svc: Svc, serviceId: string, statusy: Nastaveni["statusy"]): Promise<Map<string, string>> {
  const { data, error } = await svc.from("service_statuses").select("key, label").eq("service_id", serviceId);
  if (error) throw new Error(`service_statuses: ${error.message}`);
  const klice = new Map<string, string>();
  for (const s of (data ?? []) as Array<{ key: string; label: string }>) {
    const label = (s.label ?? "").trim();
    if (label === statusy.pripraveno || label === statusy.vydano) klice.set(s.key, label);
  }
  for (const nazev of [statusy.pripraveno, statusy.vydano]) {
    if (![...klice.values()].includes(nazev)) throw new Error(`Servis nemá status „${nazev}“.`);
  }
  return klice;
}

type ZakazkaSId = ZakazkaProProvizi & { id: string; created_at: string };

async function nactiZakazky(svc: Svc, serviceId: string, klice: Map<string, string>): Promise<ZakazkaSId[]> {
  const out: ZakazkaSId[] = [];
  const stranka = 1000;
  for (let from = 0; ; from += stranka) {
    const { data, error } = await svc
      .from("tickets")
      .select("id, code, status, created_at, performed_repairs, discount_type, discount_value")
      .eq("service_id", serviceId)
      .is("deleted_at", null)
      .in("status", [...klice.keys()])
      .not("code", "is", null)
      .order("created_at", { ascending: true })
      .range(from, from + stranka - 1);
    if (error) throw new Error(`tickets: ${error.message}`);
    const radky = (data ?? []) as Array<{ id: string; code: string | null; status: string; created_at: string; performed_repairs: unknown; discount_type: string | null; discount_value: number | null }>;
    for (const t of radky) {
      out.push({ id: t.id, created_at: t.created_at, code: t.code, statusLabel: klice.get(t.status) ?? "", performed_repairs: t.performed_repairs, discount_type: t.discount_type, discount_value: t.discount_value });
    }
    if (radky.length < stranka) break;
  }
  return out;
}

/** Zakázky, které se od data `od` v Jobi přepnuly do některého sledovaného stavu (ticket_history). */
async function prepnuteOd(svc: Svc, serviceId: string, klice: Map<string, string>, od: string): Promise<Set<string>> {
  const ids = new Set<string>();
  const stranka = 1000;
  for (let from = 0; ; from += stranka) {
    const { data, error } = await svc
      .from("ticket_history")
      .select("ticket_id")
      .eq("service_id", serviceId)
      .gte("created_at", od)
      .in("details->changes->status->>new", [...klice.keys()])
      .order("created_at", { ascending: true })
      .range(from, from + stranka - 1);
    if (error) throw new Error(`ticket_history: ${error.message}`);
    const radky = (data ?? []) as Array<{ ticket_id: string }>;
    for (const r of radky) ids.add(r.ticket_id);
    if (radky.length < stranka) break;
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Apps Script
// ---------------------------------------------------------------------------

/**
 * Apps Script občas odpovídá pomalu (studený start) – tři pokusy s rostoucím
 * limitem, jako u bota. Bez toho by jeden výkyv shodil celý běh.
 */
async function nactiTabulku(endpoint: string): Promise<RadekTabulky[]> {
  const pokusy = [15000, 20000, 25000];
  let posledni: unknown = null;
  for (let i = 0; i < pokusy.length; i++) {
    try {
      const data = await fetchJson(`${endpoint}?action=list_orders`, pokusy[i]);
      if (data?.ok === true && Array.isArray(data.orders)) return data.orders as RadekTabulky[];
      throw new Error(`list_orders: nečekaná odpověď ${JSON.stringify(data).slice(0, 200)}`);
    } catch (e) {
      posledni = e;
      if (i < pokusy.length - 1) await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
    }
  }
  throw new Error(`list_orders selhalo: ${posledni instanceof Error ? posledni.message : String(posledni)}`);
}

async function posliDavku(endpoint: string, rows: RadekKOdeslani[]): Promise<void> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 60000);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows }),
      redirect: "follow",
      signal: ac.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Sheets ${res.status}: ${text.slice(0, 200)}`);
    let data: { ok?: boolean; error?: string } = {};
    try {
      data = JSON.parse(text);
    } catch {
      // Starší Apps Script vrací prostý text – bez chyby HTTP to bereme jako úspěch.
    }
    if (data.ok === false) throw new Error(`Sheets: ${data.error ?? text.slice(0, 200)}`);
  } finally {
    clearTimeout(t);
  }
}

// deno-lint-ignore no-explicit-any
async function fetchJson(url: string, timeoutMs: number): Promise<any> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal, redirect: "follow" });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`není JSON (status ${res.status}): ${text.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------------------
// Záznam běhu, přístup
// ---------------------------------------------------------------------------

async function zapisBeh(svc: Svc, v: VysledekServisu, rezim: string, radky: RadekKOdeslani[], chyba: string | null): Promise<void> {
  const { error } = await svc.from("provize_sheets_behy").insert({
    service_id: v.serviceId,
    ok: chyba === null,
    rezim,
    poslano: chyba === null ? v.poslano : 0,
    doplatky: v.doplatky,
    opraveno: v.opraveno,
    chyba,
    detail: radky,
  });
  if (error) console.error("[provize-sheets] zápis běhu selhal:", error.message);
}

async function overitTajemstvi(svc: Svc, secret: string): Promise<boolean> {
  const { data, error } = await svc.rpc("provize_sheets_cron_secret");
  if (error) console.error("[provize-sheets] načtení tajemství selhalo:", error.message);
  const ocekavane = typeof data === "string" ? data : "";
  if (!ocekavane || secret.length !== ocekavane.length) return false;
  let rozdil = 0;
  for (let i = 0; i < secret.length; i++) rozdil |= secret.charCodeAt(i) ^ ocekavane.charCodeAt(i);
  return rozdil === 0;
}

async function prihlasenyUzivatel(req: Request, supabaseUrl: string): Promise<{ id: string } | null> {
  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!authHeader) return null;
  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id };
}

async function jeSpravce(svc: Svc, serviceId: string, userId: string): Promise<boolean> {
  const { data } = await svc.from("service_memberships").select("role").eq("service_id", serviceId).eq("user_id", userId).maybeSingle();
  const role = (data as { role?: string } | null)?.role;
  return role === "owner" || role === "admin";
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
