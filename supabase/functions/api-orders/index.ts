import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { NAZEV_MODULU, modulProRozsah, otisk, PREFIX, type Rozsah } from "../_shared/tokeny.ts";
import {
  MAX_OBJEDNAVEK,
  MAX_TELO_BAJTU,
  STAV_API,
  lisiSe,
  objednavkaProApi,
  overObjednavku,
  povoleneZmeny,
  type StavDb,
  type ZakazkaApi,
} from "../_shared/objednavky.ts";

/**
 * Objednávky oprav z webu servisu (formulář „Zaslat zařízení“, e-shop).
 *
 *   POST https://api.appjobi.com/v1/orders
 *   Authorization: Bearer jobi_…            (token se scope `orders`)
 *   { "orders": [{ "external_id": "SRV-2026-0123", "customer": {…}, "device": {…}, … }] }
 *     → upsert podle external_id (PATCH: mění se jen poslaná pole),
 *       změna stavu `status: in_transit | arrived | cancelled`, sledovací čísla.
 *     → 200 vše prošlo, 207 některé položky mají chybu (`errors`), 400 tělo.
 *
 *   GET https://api.appjobi.com/v1/orders?external_id=SRV-2026-0123
 *     → stav objednávky včetně čísla a stavu zakázky v Jobi.
 *
 * Proč samostatná funkce a ne další sekce api-write: potřebuje GET (api-write
 * je jen POST a Worker GET cachuje – tady nesmí, odpověď závisí na tokenu),
 * má vlastní limit a vlastní tvar odpovědi po položkách s výsledkem
 * created/updated/unchanged. Ověření tokenu je stejné jako v api-write:
 * otisk tokenu, odvolaný = neplatný, vypnutý servis = neplatný, rozsah
 * a nárok na modul (orders → api_catalog).
 *
 * Idempotence: external_id je v servisu unikátní, takže opakované odeslání
 * téže objednávky ji jen aktualizuje (výsledek „unchanged“, když se nic
 * nezměnilo). Hlavička Idempotency-Key tu proto není potřeba.
 *
 * Limit 60 požadavků za minutu na token (GET i POST), nejvýš 50 objednávek
 * v jednom požadavku a 512 kB těla.
 *
 * Dokumentace: docs/API_OBJEDNAVKY.md, docs/api/openapi.yaml.
 * Logika položek: _shared/objednavky.ts (testy src/lib/objednavky.test.ts).
 */

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Expose-Headers": "retry-after",
};

const json = (telo: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(telo), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra },
  });

const LIMIT_ZA_MINUTU = 60;
const ROZSAH: Rozsah = "orders";

type Svc = ReturnType<typeof createClient>;

const SLOUPCE = "id, service_id, branch_id, externi_cislo, zdroj, stav, zakaznik_jmeno, zakaznik_telefon, zakaznik_email, zakaznik_firma, zakaznik_ico, zakaznik_dic, zakaznik_ulice, zakaznik_mesto, zakaznik_psc, zarizeni, model_id, sn_imei, heslo_zarizeni, prislusenstvi, popis_zavady, pozadovana_oprava, repair_id, doprava_tam, doprava_zpet, vydejni_misto, adresa_zpet, sledovaci_cisla, poznamka, data, ticket_id, created_at, updated_at, dorazilo_at, prevedeno_at";

async function zakazka(svc: Svc, ticketId: string | null): Promise<ZakazkaApi> {
  if (!ticketId) return null;
  const { data, error } = await svc.rpc("web_objednavka_zakazka_json", { p_ticket_id: ticketId });
  if (error) console.error("[api-orders] zakázka:", error.message);
  return (data as ZakazkaApi) ?? null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST" && req.method !== "GET") return json({ error: "Podporováno je GET a POST" }, 405);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token.startsWith(PREFIX)) {
    return json({ error: "Chybí token. Posílá se jako Authorization: Bearer jobi_…" }, 401);
  }

  const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: zaznam } = await svc
    .from("api_tokens")
    .select("id, service_id, name, scopes, revoked_at")
    .eq("token_hash", await otisk(token))
    .maybeSingle();
  // Neplatný, odvolaný i token vypnutého servisu vracejí totéž.
  if (!zaznam || zaznam.revoked_at) return json({ error: "Neplatný token" }, 401);
  const { data: servis } = await svc.from("services").select("active").eq("id", zaznam.service_id).maybeSingle();
  if (servis && (servis as { active?: boolean }).active === false) return json({ error: "Neplatný token" }, 401);

  if (!((zaznam.scopes ?? []) as string[]).includes(ROZSAH)) return json({ error: `Token nemá rozsah ${ROZSAH}` }, 403);
  const modul = modulProRozsah(ROZSAH);
  const { data: maNarok, error: chybaNaroku } = await svc.rpc("has_entitlement", { p_service_id: zaznam.service_id, p_module: modul });
  if (chybaNaroku || maNarok !== true) return json({ error: `${NAZEV_MODULU[modul]} není pro tento servis aktivní.` }, 403);

  // Limit i pro chybné požadavky – jinak by se dalo zkoušet donekonečna.
  const { data: pocet, error: chybaLimitu } = await svc.rpc("zapocitej_udalost", { p_kanal: "api-orders", p_klic: zaznam.id });
  if (chybaLimitu) console.error("[api-orders] počítadlo limitu:", chybaLimitu.message);
  if (typeof pocet === "number" && pocet > LIMIT_ZA_MINUTU) {
    return json({ error: `Překročen limit ${LIMIT_ZA_MINUTU} požadavků za minutu` }, 429, { "Retry-After": "60" });
  }

  const sid = zaznam.service_id as string;
  const { error: chybaTokenu } = await svc.from("api_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", zaznam.id);
  if (chybaTokenu) console.error("[api-orders] last_used_at:", chybaTokenu.message);

  // ── GET: stav jedné objednávky ────────────────────────────────────────────
  if (req.method === "GET") {
    const ext = (new URL(req.url).searchParams.get("external_id") ?? "").trim();
    if (!ext) return json({ error: "Chybí parametr external_id" }, 400);
    if (ext.length > 100) return json({ error: "external_id je delší než 100 znaků" }, 400);
    const { data: o, error } = await svc.from("web_objednavky").select(SLOUPCE).eq("service_id", sid).eq("externi_cislo", ext).maybeSingle();
    if (error) {
      console.error("[api-orders] GET:", error.message);
      return json({ error: "Objednávku se nepodařilo načíst" }, 500);
    }
    if (!o) return json({ error: "Objednávka neexistuje" }, 404);
    return json({ order: objednavkaProApi(o as never, await zakazka(svc, (o as { ticket_id: string | null }).ticket_id)) });
  }

  // ── POST: upsert objednávek ───────────────────────────────────────────────
  const delka = Number(req.headers.get("Content-Length") ?? "0");
  if (delka > MAX_TELO_BAJTU) return json({ error: `Tělo je větší než ${MAX_TELO_BAJTU / 1024} kB` }, 413);
  const surove = await req.text();
  if (new TextEncoder().encode(surove).length > MAX_TELO_BAJTU) return json({ error: `Tělo je větší než ${MAX_TELO_BAJTU / 1024} kB` }, 413);
  let telo: unknown;
  try {
    telo = JSON.parse(surove);
  } catch {
    return json({ error: "Tělo není platný JSON" }, 400);
  }
  const polozky = telo && typeof telo === "object" ? (telo as { orders?: unknown }).orders : undefined;
  if (!Array.isArray(polozky) || polozky.length === 0) return json({ error: "Tělo musí obsahovat neprázdné pole orders" }, 400);
  if (polozky.length > MAX_OBJEDNAVEK) return json({ error: `Nejvýš ${MAX_OBJEDNAVEK} objednávek v jednom požadavku` }, 400);

  // Vazby se přijmou jen na záznamy tohoto servisu – načtou se najednou.
  const idsZ = (klic: string, sekce?: string) =>
    polozky.flatMap((p) => {
      const o = (p && typeof p === "object" ? (sekce ? (p as Record<string, unknown>)[sekce] : p) : null) as Record<string, unknown> | null;
      const v = o && typeof o === "object" ? o[klic] : null;
      return typeof v === "string" ? [v.toLowerCase()] : [];
    });
  const vlastni = async (tabulka: string, ids: string[]) => {
    const unikatni = [...new Set(ids)].filter((x) => /^[0-9a-f-]{36}$/.test(x));
    if (unikatni.length === 0) return new Set<string>();
    const { data } = await svc.from(tabulka).select("id").eq("service_id", sid).in("id", unikatni);
    return new Set(((data ?? []) as { id: string }[]).map((x) => x.id));
  };
  const [pobocky, modely, opravy] = await Promise.all([
    vlastni("branches", idsZ("branch_id")),
    vlastni("device_models", idsZ("model_id", "device")),
    vlastni("repairs", idsZ("repair_id")),
  ]);

  const vysledky: { index: number; external_id: string; result: "created" | "updated" | "unchanged"; status: string; ticket_code: string | null }[] = [];
  const chyby: string[] = [];
  const videna = new Set<string>();

  for (const [i, vstup] of polozky.entries()) {
    const prefix = `orders[${i}]`;
    const ov = overObjednavku(vstup, prefix);
    if (!ov.ok) { chyby.push(ov.chyba); continue; }
    const p = ov.polozka;
    if (videna.has(p.externiCislo)) { chyby.push(`${prefix}: external_id ${p.externiCislo} je v požadavku dvakrát`); continue; }
    videna.add(p.externiCislo);

    for (const [klic, mnozina] of [["branch_id", pobocky], ["model_id", modely], ["repair_id", opravy]] as const) {
      const v = p.hodnoty[klic];
      if (typeof v === "string" && !mnozina.has(v)) {
        chyby.push(`${prefix}: ${klic} ${v} v tomhle servisu není – vynecháno`);
        delete p.hodnoty[klic];
      }
    }

    const { data: stavajici, error: chybaCteni } = await svc.from("web_objednavky").select(SLOUPCE).eq("service_id", sid).eq("externi_cislo", p.externiCislo).maybeSingle();
    if (chybaCteni) { chyby.push(`${prefix}: ${chybaCteni.message}`); continue; }

    if (!stavajici) {
      const stav: StavDb = p.stav ?? "nova";
      const radek = {
        ...p.hodnoty,
        service_id: sid,
        externi_cislo: p.externiCislo,
        zdroj: (p.hodnoty.zdroj as string | null) ?? zaznam.name ?? "api",
        stav,
        token_id: zaznam.id,
        ...(stav === "dorazilo" ? { dorazilo_at: new Date().toISOString() } : {}),
      };
      const { error } = await svc.from("web_objednavky").insert(radek);
      if (!error) {
        vysledky.push({ index: i, external_id: p.externiCislo, result: "created", status: STAV_API[stav], ticket_code: null });
        continue;
      }
      // Souběžné odeslání téže objednávky: druhý insert narazí na unikátní
      // klíč – pak je to obyčejná aktualizace, ne chyba.
      if (!/duplicate key|unique/i.test(error.message)) { chyby.push(`${prefix}: ${error.message}`); continue; }
    }

    const { data: aktualni } = stavajici
      ? { data: stavajici }
      : await svc.from("web_objednavky").select(SLOUPCE).eq("service_id", sid).eq("externi_cislo", p.externiCislo).maybeSingle();
    if (!aktualni) { chyby.push(`${prefix}: objednávku se nepodařilo uložit`); continue; }
    const a = aktualni as Record<string, unknown> & { id: string; stav: string; ticket_id: string | null };

    const z = povoleneZmeny(a.stav, p);
    if (z.chyba) { chyby.push(`${prefix}: ${z.chyba}`); continue; }
    const zmena: Record<string, unknown> = { ...z.hodnoty };
    if (z.stav && z.stav !== a.stav && a.stav !== "prevedeno") {
      zmena.stav = z.stav;
      if (z.stav === "dorazilo" && !a.dorazilo_at) zmena.dorazilo_at = new Date().toISOString();
    }
    const zt = await zakazka(svc, a.ticket_id);
    if (!lisiSe(a, zmena)) {
      vysledky.push({ index: i, external_id: p.externiCislo, result: "unchanged", status: STAV_API[a.stav as StavDb] ?? a.stav, ticket_code: zt?.code ?? null });
      continue;
    }
    // Stav se mění jen u objednávky, která je pořád v tom stavu, jak jsme ji
    // přečetli – servis ji mohl mezitím převést na zakázku.
    const { data: zmeneno, error } = await svc.from("web_objednavky").update(zmena).eq("id", a.id).eq("stav", a.stav).select("stav");
    if (error) { chyby.push(`${prefix}: ${error.message}`); continue; }
    if (!zmeneno || zmeneno.length === 0) { chyby.push(`${prefix}: objednávku mezitím změnil servis, pošlete ji znovu`); continue; }
    const novy = (zmeneno[0] as { stav: string }).stav as StavDb;
    vysledky.push({ index: i, external_id: p.externiCislo, result: "updated", status: STAV_API[novy] ?? novy, ticket_code: zt?.code ?? null });
  }

  const odpoved = { ok: chyby.length === 0, orders: vysledky, ...(chyby.length ? { errors: chyby } : {}) };
  return json(odpoved, chyby.length ? 207 : 200);
});
