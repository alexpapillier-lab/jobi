import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { escapeHtml } from "../_shared/html.ts";
import { cenaZakazky } from "../_shared/penize.ts";
import {
  castiVPasmu,
  hodnotniZakaznici,
  jeCasOdeslat,
  jeStornoStav,
  korunyCele,
  nastaveniReportuZConfigu,
  nazevSouboru,
  obdobiReportu,
  pravidelniZakaznici,
  procenta,
  procentniZmena,
  pulnocVPasmu,
  rozsahDatCesky,
  type NastaveniReportu,
  type ObdobiReportu,
  type ZakazkaProZebricek,
} from "../_shared/statistikyReport.ts";
import { vykresliReportPdf, type KpiReportu, type Pisma, type ReportData } from "./pdf.ts";

/**
 * Report statistik e-mailem (PDF v příloze).
 *
 * Dva vstupy:
 *   1) pg_cron každou hodinu: `{ secret, mode: "scheduled" }` – projde servisy
 *      se zapnutým reportem, a kde je 1. v měsíci / pondělí po nastavené
 *      hodině a za to období ještě nic neodešlo, pošle report za minulé
 *      období. Tajemství žije ve Vaultu (statistiky_report_cron_secret).
 *   2) aplikace (majitel/správce servisu, token v hlavičce):
 *      `{ service_id, mode: "test" | "now" | "preview", obdobi?: "predchozi" | "aktualni" }`
 *        test    – pošle report jen na e-mail volajícího,
 *        now     – pošle na nastavené příjemce,
 *        preview – vrátí PDF v base64 bez odeslání (ukázka v Nastavení).
 *
 * Čísla jsou z týchž databázových funkcí jako stránka Statistiky
 * (statistiky_prehled, statistiky_technici) – co je v e-mailu, sedí s tím,
 * co majitel vidí v aplikaci. Zákazníci se počítají tady ze zakázek
 * (funkce žebříček zákazníků nemá).
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Bez vygenerovaných typů databáze; klient pod service_role sahá na
// tabulky i RPC, které v typech stejně nejsou.
// deno-lint-ignore no-explicit-any
type Svc = SupabaseClient<any, any, any>;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const svc: Svc = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const ted = new Date();

    // --- plánovaný běh z cronu -------------------------------------------------
    if (typeof body.secret === "string" && body.secret) {
      if (!(await overitTajemstvi(svc, body.secret))) return json({ error: "Unauthorized" }, 401);
      const vysledek = await planovanyBeh(svc, ted, body.dryRun === true);
      return json({ ok: true, ...vysledek });
    }

    // --- ruční volání z aplikace ---------------------------------------------------
    const user = await prihlasenyUzivatel(req, supabaseUrl);
    if (!user) return json({ error: "Unauthorized" }, 401);
    const serviceId = typeof body.service_id === "string" ? body.service_id : "";
    const mode = body.mode === "test" || body.mode === "now" || body.mode === "preview" ? body.mode : null;
    if (!serviceId || !mode) return json({ error: "Chybí service_id nebo mode (test | now | preview)." }, 400);

    if (!(await jeSpravce(svc, serviceId, user.id))) {
      return json({ error: "Report statistik může posílat jen majitel nebo správce servisu." }, 403);
    }

    const { config, nazevServisu } = await nactiNastaveni(svc, serviceId);
    const nastaveni = nastaveniReportuZConfigu(config.statistiky_report);
    const ktere = body.obdobi === "aktualni" ? "aktualni" : "predchozi";
    const obdobi = obdobiReportu(nastaveni.frekvence, ted, ktere);

    const report = await sestavReport(svc, serviceId, obdobi, config, nazevServisu, ted);

    if (mode === "preview") {
      return json({ ok: true, filename: report.nazevSouboru, pdf_base64: doBase64(report.pdf), obdobi: obdobi.nazev });
    }

    const prijemci = mode === "test" ? [user.email ?? ""].filter((e) => e.includes("@")) : nastaveni.emaily;
    if (prijemci.length === 0) {
      return json({ error: mode === "test" ? "Váš účet nemá e-mail." : "Nejsou nastavení žádní příjemci." }, 400);
    }
    const odeslani = await odeslatEmail(prijemci, report, mode === "test");
    await zapsatOdeslani(svc, {
      serviceId,
      klic: `${obdobi.klic}-${mode}-${ted.getTime()}`,
      frekvence: nastaveni.frekvence,
      nazevObdobi: obdobi.nazev,
      prijemci,
      planovane: false,
      ok: odeslani.ok,
      chyba: odeslani.error ?? null,
    });
    if (!odeslani.ok) return json({ error: odeslani.error ?? "Odeslání selhalo." }, 502);
    return json({ ok: true, sent_to: prijemci, obdobi: obdobi.nazev, filename: report.nazevSouboru });
  } catch (e) {
    console.error("[statistics-report-send]", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }

  function json(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

// ---------------------------------------------------------------------------
// Přístup
// ---------------------------------------------------------------------------

async function overitTajemstvi(svc: Svc, secret: string): Promise<boolean> {
  const { data, error } = await svc.rpc("statistiky_report_cron_secret");
  if (error) console.error("[statistics-report-send] načtení tajemství selhalo:", error.message);
  const ocekavane = typeof data === "string" ? data : "";
  if (!ocekavane || secret.length !== ocekavane.length) return false;
  // Porovnání konstantní dobou – tajemství chodí zvenčí.
  let rozdil = 0;
  for (let i = 0; i < secret.length; i++) rozdil |= secret.charCodeAt(i) ^ ocekavane.charCodeAt(i);
  return rozdil === 0;
}

async function prihlasenyUzivatel(req: Request, supabaseUrl: string): Promise<{ id: string; email: string | null } | null> {
  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!authHeader) return null;
  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: { user } } = await userClient.auth.getUser();
  return user ? { id: user.id, email: user.email ?? null } : null;
}

async function jeSpravce(svc: Svc, serviceId: string, userId: string): Promise<boolean> {
  const rootOwnerId = Deno.env.get("ROOT_OWNER_ID")?.trim();
  if (rootOwnerId && rootOwnerId.toLowerCase() === userId.toLowerCase()) return true;
  const { data } = await svc.from("service_memberships").select("role").eq("service_id", serviceId).eq("user_id", userId).maybeSingle();
  const role = (data as { role?: string } | null)?.role;
  return role === "owner" || role === "admin";
}

// ---------------------------------------------------------------------------
// Plánovaný běh
// ---------------------------------------------------------------------------

async function planovanyBeh(svc: Svc, ted: Date, dryRun: boolean) {
  const { data, error } = await svc
    .from("service_settings")
    .select("service_id, config")
    .filter("config->statistiky_report->>zapnuto", "eq", "true");
  if (error) throw new Error(`service_settings: ${error.message}`);
  const radky = (data ?? []) as Array<{ service_id: string; config: Record<string, unknown> | null }>;

  const odeslano: Array<{ service_id: string; obdobi: string; prijemci: string[] }> = [];
  const preskoceno: Array<{ service_id: string; duvod: string }> = [];
  const chyby: Array<{ service_id: string; chyba: string }> = [];

  for (const r of radky) {
    const nastaveni = nastaveniReportuZConfigu(r.config?.statistiky_report);
    if (!jeCasOdeslat(nastaveni, ted)) {
      preskoceno.push({ service_id: r.service_id, duvod: "není čas" });
      continue;
    }
    const obdobi = obdobiReportu(nastaveni.frekvence, ted, "predchozi");
    if (await uzOdeslano(svc, r.service_id, obdobi.klic)) {
      preskoceno.push({ service_id: r.service_id, duvod: `už odesláno (${obdobi.klic})` });
      continue;
    }
    if (dryRun) {
      odeslano.push({ service_id: r.service_id, obdobi: obdobi.nazev, prijemci: nastaveni.emaily });
      continue;
    }
    try {
      const { config, nazevServisu } = await nactiNastaveni(svc, r.service_id);
      const report = await sestavReport(svc, r.service_id, obdobi, config, nazevServisu, ted);
      const vysledek = await odeslatEmail(nastaveni.emaily, report, false);
      await zapsatOdeslani(svc, {
        serviceId: r.service_id,
        klic: obdobi.klic,
        frekvence: nastaveni.frekvence,
        nazevObdobi: obdobi.nazev,
        prijemci: nastaveni.emaily,
        planovane: true,
        ok: vysledek.ok,
        chyba: vysledek.error ?? null,
      });
      if (vysledek.ok) odeslano.push({ service_id: r.service_id, obdobi: obdobi.nazev, prijemci: nastaveni.emaily });
      else chyby.push({ service_id: r.service_id, chyba: vysledek.error ?? "odeslání selhalo" });
    } catch (e) {
      const chyba = e instanceof Error ? e.message : String(e);
      console.error("[statistics-report-send] servis", r.service_id, chyba);
      chyby.push({ service_id: r.service_id, chyba });
      await zapsatOdeslani(svc, {
        serviceId: r.service_id, klic: obdobi.klic, frekvence: nastaveni.frekvence, nazevObdobi: obdobi.nazev,
        prijemci: nastaveni.emaily, planovane: true, ok: false, chyba,
      }).catch(() => {});
    }
  }
  return { checked: radky.length, dryRun, sent: odeslano, skipped: preskoceno, errors: chyby };
}

async function uzOdeslano(svc: Svc, serviceId: string, klic: string): Promise<boolean> {
  const { data } = await svc
    .from("statistiky_report_odeslani")
    .select("id")
    .eq("service_id", serviceId)
    .eq("klic", klic)
    .eq("planovane", true)
    .eq("ok", true)
    .limit(1);
  return (data ?? []).length > 0;
}

async function zapsatOdeslani(svc: Svc, z: { serviceId: string; klic: string; frekvence: string; nazevObdobi: string; prijemci: string[]; planovane: boolean; ok: boolean; chyba: string | null }) {
  const { error } = await svc.from("statistiky_report_odeslani").insert({
    service_id: z.serviceId,
    klic: z.klic,
    frekvence: z.frekvence,
    nazev_obdobi: z.nazevObdobi,
    prijemci: z.prijemci,
    planovane: z.planovane,
    ok: z.ok,
    chyba: z.chyba,
  });
  if (error) console.error("[statistics-report-send] záznam o odeslání:", error.message);
}

// ---------------------------------------------------------------------------
// Sestavení reportu
// ---------------------------------------------------------------------------

type ConfigServisu = { statistiky_report?: unknown; companyData?: Record<string, unknown>; abbreviation?: string } & Record<string, unknown>;

async function nactiNastaveni(svc: Svc, serviceId: string): Promise<{ config: ConfigServisu; nazevServisu: string }> {
  const [{ data: sluzba }, { data: nast }] = await Promise.all([
    svc.from("services").select("name").eq("id", serviceId).maybeSingle(),
    svc.from("service_settings").select("config").eq("service_id", serviceId).maybeSingle(),
  ]);
  return {
    config: ((nast as { config?: ConfigServisu } | null)?.config ?? {}) as ConfigServisu,
    nazevServisu: (sluzba as { name?: string } | null)?.name ?? "",
  };
}

type SestavenyReport = { data: ReportData; pdf: Uint8Array; nazevSouboru: string; nastaveni: NastaveniReportu };

function cislo(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function kpiZ(raw: unknown, reklamace: number, dokonceno: number): KpiReportu {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    obrat: cislo(o.totalRevenue),
    vydano: cislo(o.issuedTickets),
    zisk: cislo(o.profit),
    naklady: cislo(o.totalCosts),
    slevy: cislo(o.totalDiscounts),
    marzePct: cislo(o.marginPct),
    prumernaCena: cislo(o.averageTicketPrice),
    pocet: cislo(o.totalTickets),
    dokonceno,
    reklamace,
    prumernaDobaDny: cislo(o.averageTicketDurationDays),
    bezNakladu: cislo(o.entriesWithoutCost) + cislo(o.entriesMissingPurchasePrice),
  };
}

const MESICE_KRATCE = ["led", "úno", "bře", "dub", "kvě", "čvn", "čvc", "srp", "zář", "říj", "lis", "pro"];

async function sestavReport(svc: Svc, serviceId: string, obdobi: ObdobiReportu, config: ConfigServisu, nazevServisu: string, ted: Date): Promise<SestavenyReport> {
  const nastaveni = nastaveniReportuZConfigu(config.statistiky_report);
  const firma = (config.companyData ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  // `do` je výlučné; funkce statistik bere `<= p_do`.
  const doVcetne = new Date(obdobi.do.getTime() - 1);
  const predDoVcetne = new Date(obdobi.predchoziDo.getTime() - 1);
  const [prehled, technici, stavyServisu, pobocky, reklamace, reklamacePred, zakazky, graf] = await Promise.all([
    rpcPrehled(svc, serviceId, obdobi.od, doVcetne, obdobi.predchoziOd, predDoVcetne),
    svc.rpc("statistiky_technici", { p_service_ids: [serviceId], p_od: obdobi.od.toISOString(), p_do: doVcetne.toISOString(), p_branch_id: null }),
    svc.from("service_statuses").select("key,label,bg,is_final").eq("service_id", serviceId),
    svc.from("branches").select("id,name").eq("service_id", serviceId),
    pocetReklamaci(svc, serviceId, obdobi.od, obdobi.do),
    pocetReklamaci(svc, serviceId, obdobi.predchoziOd, obdobi.predchoziDo),
    nactiZakazkyProZebricky(svc, serviceId, obdobi),
    rpcPrehled(svc, serviceId, zacatekMesiceZpet(obdobi.od, 5), doVcetne, null, null),
  ]);

  const stavy = ((stavyServisu.data ?? []) as Array<{ key: string; label: string; bg: string | null; is_final: boolean }>);
  const stavPodleKlice = new Map(stavy.map((s) => [s.key, s]));
  const jeKoncovy = (klic: string | null) => stavPodleKlice.get(klic ?? "")?.is_final === true;
  const stavyVReportu = pole(prehled.stavy).map((r) => {
    const key = String(r.key ?? "");
    const s = stavPodleKlice.get(key);
    return { nazev: s?.label ?? (key === "received" ? "Přijato" : key || "Bez stavu"), pocet: cislo(r.count), barva: s?.bg ?? null, konecny: s?.is_final === true };
  });
  const dokonceno = stavyVReportu.filter((s) => s.konecny).reduce((a, s) => a + s.pocet, 0);

  // Obrat zákazníka v období podle data vydání (koncový stav) – stejně jako
  // KPI nahoře; „pravidelnost“ (počet za 12 měsíců) zůstává podle přijetí.
  const odIso = obdobi.od.toISOString();
  const doIso = obdobi.do.toISOString();
  const zebricek: ZakazkaProZebricek[] = zakazky.map((z) => {
    const storno = jeStornoStav(z.status, stavPodleKlice.get(z.status ?? "")?.label);
    const vydano = jeKoncovy(z.status) ? z.completed_at ?? z.updated_at : null;
    const vObdobi = !storno && !!vydano && vydano >= odIso && vydano < doIso;
    return {
      customerId: z.customer_id,
      customerName: z.customer_name,
      prijem: vObdobi ? cenaZakazky(Array.isArray(z.performed_repairs) ? z.performed_repairs : [], z.discount_type, z.discount_value) : 0,
      vObdobi,
      v12Mesicich: z.created_at >= od12Iso(obdobi) && z.created_at < doIso,
    };
  });

  const nazvyPobocek = new Map(((pobocky.data ?? []) as Array<{ id: string; name: string }>).map((b) => [b.id, b.name]));
  const pobockyVReportu = pole(prehled.marzePobocky).map((r) => ({
    nazev: nazvyPobocek.get(String(r.key ?? "")) ?? (typeof r.name === "string" ? r.name : "Bez pobočky"),
    pocet: cislo(r.count),
    obrat: cislo(r.revenue),
    marze: cislo(r.margin),
    marzePct: cislo(r.marginPct),
  }));

  const mesice = pole(graf.mesice)
    .map((m) => ({ rok: cislo(m.year), mesic: cislo(m.monthIndex), obrat: cislo(m.revenue), zisk: cislo(m.margin), pocet: cislo(m.count) }))
    .sort((a, b) => a.rok - b.rok || a.mesic - b.mesic)
    .slice(-6)
    .map((m) => ({ popisek: `${MESICE_KRATCE[m.mesic] ?? m.mesic + 1} ${String(m.rok).slice(2)}`, obrat: m.obrat, zisk: m.zisk, pocet: m.pocet }));

  const rozpr = (prehled.rozpracovano ?? {}) as Record<string, unknown>;
  const c = castiVPasmu(ted);
  const data: ReportData = {
    frekvence: obdobi.frekvence,
    nazevObdobi: obdobi.nazev,
    rozsah: rozsahDatCesky(obdobi.od, new Date(obdobi.do.getTime() - 1)),
    predchoziNazev: obdobi.predchoziNazev,
    servis: {
      nazev: str(firma.name) || nazevServisu || "Servis",
      ico: str(firma.ico),
      email: str(firma.email),
      telefon: str(firma.phone),
    },
    vygenerovano: `${c.den}. ${c.mesic}. ${c.rok} ${String(c.hodina).padStart(2, "0")}:${String(c.minuta).padStart(2, "0")}`,
    kpi: kpiZ(prehled.kpi, reklamace, dokonceno),
    kpiPredchozi: kpiZ(prehled.kpiPredchozi, reklamacePred, 0),
    rozpracovano: { pocet: cislo(rozpr.pocet), nacenenych: cislo(rozpr.nacenenych), prijem: cislo(rozpr.prijem) },
    mesice,
    stavy: stavyVReportu,
    topOpravy: pole(prehled.topOpravy).map((r) => ({ nazev: String(r.name ?? ""), pocet: cislo(r.count) })),
    topZarizeni: pole(prehled.topZarizeni).map((r) => ({ nazev: String(r.name ?? ""), pocet: cislo(r.count) })),
    hodnotni: hodnotniZakaznici(zebricek),
    pravidelni: pravidelniZakaznici(zebricek),
    technici: (Array.isArray(technici.data) ? (technici.data as Array<Record<string, unknown>>) : [])
      .map((t) => ({ jmeno: String(t.name ?? "—"), prijato: cislo(t.prijato), dokonceno: cislo(t.dokonceno), hodiny: cislo(t.odpracovanoHodin) }))
      .filter((t) => t.prijato > 0 || t.dokonceno > 0 || t.hodiny > 0)
      .sort((a, b) => b.dokonceno - a.dokonceno || b.prijato - a.prijato),
    pobocky: pobockyVReportu,
  };

  const pdf = await vykresliReportPdf(data, await nactiPisma());
  return { data, pdf, nazevSouboru: nazevSouboru(obdobi, str(config.abbreviation)), nastaveni };
}

function pole(raw: unknown): Record<string, unknown>[] {
  return Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
}

/** První den měsíce o `mesicu` zpět (v Praze) – začátek osy grafu. */
function zacatekMesiceZpet(od: Date, mesicu: number): Date {
  const c = castiVPasmu(od);
  const idx = c.rok * 12 + (c.mesic - 1) - mesicu;
  return pulnocVPasmu(Math.floor(idx / 12), (idx % 12) + 1, 1);
}

async function rpcPrehled(svc: Svc, serviceId: string, od: Date, doVcetne: Date, prevOd: Date | null, prevDo: Date | null): Promise<Record<string, unknown>> {
  const { data, error } = await svc.rpc("statistiky_prehled", {
    p_service_ids: [serviceId],
    p_od: od.toISOString(),
    p_do: doVcetne.toISOString(),
    p_branch_id: null,
    p_drill_typ: null,
    p_drill_hodnota: null,
    p_drill_rok: null,
    p_drill_mesic: null,
    p_prev_od: prevOd ? prevOd.toISOString() : null,
    p_prev_do: prevDo ? prevDo.toISOString() : null,
    p_tz: "Europe/Prague",
  });
  if (error) throw new Error(`statistiky_prehled: ${error.message}`);
  return (data && typeof data === "object" && !Array.isArray(data) ? data : {}) as Record<string, unknown>;
}

async function pocetReklamaci(svc: Svc, serviceId: string, od: Date, doVylucne: Date): Promise<number> {
  const { count, error } = await svc
    .from("warranty_claims")
    .select("id", { count: "exact", head: true })
    .eq("service_id", serviceId)
    .gte("created_at", od.toISOString())
    .lt("created_at", doVylucne.toISOString());
  if (error) {
    console.warn("[statistics-report-send] reklamace:", error.message);
    return 0;
  }
  return count ?? 0;
}

type ZakazkaRadek = {
  customer_id: string | null;
  customer_name: string | null;
  status: string | null;
  performed_repairs: unknown;
  discount_type: "percentage" | "amount" | null;
  discount_value: number | null;
  created_at: string;
  completed_at: string | null;
  updated_at: string | null;
};

/** Začátek okna „posledních 12 měsíců“ pro pravidelné zákazníky. */
function od12Iso(obdobi: ObdobiReportu): string {
  const od12 = new Date(obdobi.do.getTime());
  od12.setUTCMonth(od12.getUTCMonth() - 12);
  return od12.toISOString();
}

/**
 * Zakázky pro žebříčky zákazníků, po stránkách: přijaté za posledních
 * 12 měsíců (pravidelnost) a k tomu vydané v období, i když byly přijaté
 * dřív (obrat v období jde podle vydání). Obrat pro storno vyjde nulový.
 */
async function nactiZakazkyProZebricky(svc: Svc, serviceId: string, obdobi: ObdobiReportu): Promise<ZakazkaRadek[]> {
  const sloupce = "id,customer_id,customer_name,status,performed_repairs,discount_type,discount_value,created_at,completed_at,updated_at";
  const strana = 1000;
  const odIso = obdobi.od.toISOString();
  const doIso = obdobi.do.toISOString();
  const podleId = new Map<string, ZakazkaRadek>();
  for (const rezim of ["prijate", "vydane"] as const) {
    for (let i = 0; i < 50; i++) {
      let q = svc.from("tickets").select(sloupce).eq("service_id", serviceId).is("deleted_at", null);
      q = rezim === "prijate"
        ? q.gte("created_at", od12Iso(obdobi)).lt("created_at", doIso)
        : q.gte("completed_at", odIso).lt("completed_at", doIso);
      const { data, error } = await q.order("created_at", { ascending: true }).range(i * strana, (i + 1) * strana - 1);
      if (error) throw new Error(`tickets: ${error.message}`);
      const radky = (data ?? []) as unknown as Array<ZakazkaRadek & { id: string }>;
      for (const r of radky) podleId.set(r.id, r);
      if (radky.length < strana) break;
    }
  }
  return [...podleId.values()];
}

let pismaCache: Pisma | null = null;
async function nactiPisma(): Promise<Pisma> {
  if (pismaCache) return pismaCache;
  const nacti = async (soubor: string): Promise<Uint8Array | null> => {
    try {
      return await Deno.readFile(new URL(`./${soubor}`, import.meta.url));
    } catch (e) {
      console.warn(`[statistics-report-send] písmo ${soubor} se nepodařilo načíst:`, e);
      return null;
    }
  };
  pismaCache = { regular: await nacti("LiberationSans-Regular.ttf"), bold: await nacti("LiberationSans-Bold.ttf") };
  return pismaCache;
}

// ---------------------------------------------------------------------------
// E-mail
// ---------------------------------------------------------------------------

function doBase64(bytes: Uint8Array): string {
  let bin = "";
  const krok = 0x8000;
  for (let i = 0; i < bytes.length; i += krok) bin += String.fromCharCode(...bytes.subarray(i, i + krok));
  return btoa(bin);
}

function zmenaText(akt: number, pred: number): string {
  const z = procentniZmena(akt, pred);
  if (z === null) return "";
  const znak = z > 0 ? "▲" : z < 0 ? "▼" : "•";
  const barva = z > 0 ? "#15803d" : z < 0 ? "#b91c1c" : "#64748b";
  return `<span style="color:${barva};font-weight:700">${znak} ${escapeHtml(procenta(Math.abs(z), Math.abs(z) < 10 ? 1 : 0))}</span>`;
}

async function odeslatEmail(prijemci: string[], report: SestavenyReport, zkusebni: boolean): Promise<{ ok: boolean; error?: string }> {
  const key = Deno.env.get("RESEND_API_KEY")?.trim();
  if (!key) return { ok: false, error: "Chybí RESEND_API_KEY v secrets edge funkcí." };
  const from = Deno.env.get("RESEND_FROM_EMAIL")?.trim() || "Jobi <onboarding@resend.dev>";

  const d = report.data;
  const k = d.kpi;
  const kp = d.kpiPredchozi;
  const druh = d.frekvence === "tydne" ? "Týdenní" : "Měsíční";
  const predmet = `${zkusebni ? "[Zkušební] " : ""}${druh} report ${d.nazevObdobi} – ${d.servis.nazev}`;

  const radek = (n: string, v: string, z: string) =>
    `<tr><td style="padding:8px 0;color:#64748b;font-size:13px">${escapeHtml(n)}</td><td style="padding:8px 0;text-align:right;font-weight:700;font-size:15px;color:#0f172a">${escapeHtml(v)}</td><td style="padding:8px 0 8px 12px;text-align:right;font-size:12px">${z}</td></tr>`;

  const html = [
    '<!DOCTYPE html><html><head><meta charset="utf-8"></head>',
    '<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;background:#f1f5f9">',
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 16px"><tr><td align="center">',
    '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)">',
    `<tr><td style="background:#0f172a;padding:24px 28px"><div style="color:#93c5fd;font-size:11px;font-weight:700;letter-spacing:0.08em">${escapeHtml(druh.toUpperCase())} REPORT</div><div style="color:#fff;font-size:22px;font-weight:800;margin-top:4px">${escapeHtml(d.nazevObdobi)}</div><div style="color:#cbd5e1;font-size:12px;margin-top:4px">${escapeHtml(d.servis.nazev)} · ${escapeHtml(d.rozsah)}</div></td></tr>`,
    '<tr><td style="padding:20px 28px">',
    zkusebni ? '<p style="margin:0 0 12px;padding:8px 12px;background:#fef3c7;border-radius:8px;font-size:12px;color:#92400e">Zkušební odeslání z Nastavení – šlo jen na váš e-mail.</p>' : "",
    '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">',
    radek("Obrat", korunyCele(k.obrat), zmenaText(k.obrat, kp.obrat)),
    radek("Zisk", `${korunyCele(k.zisk)} (marže ${procenta(k.marzePct)})`, zmenaText(k.zisk, kp.zisk)),
    radek("Zakázky", `přijato ${k.pocet} · vydáno ${k.vydano}`, zmenaText(k.pocet, kp.pocet)),
    radek("Náklady", korunyCele(k.naklady), zmenaText(k.naklady, kp.naklady)),
    radek("Reklamace", String(k.reklamace), zmenaText(k.reklamace, kp.reklamace)),
    radek("Rozpracováno", `${d.rozpracovano.pocet} · naceněno ${korunyCele(d.rozpracovano.prijem)}`, ""),
    "</table>",
    '<p style="margin:12px 0 0;font-size:11px;color:#94a3b8">Obrat, zisk a náklady jsou ze zakázek vydaných v období; počet zakázek podle data přijetí. Rozpracované zakázky do obratu nepatří, dokud se nevydají.</p>',
    `<p style="margin:16px 0 0;font-size:12px;color:#64748b">Srovnání je s obdobím ${escapeHtml(d.predchoziNazev)}. Celý report – opravy, zařízení, zákazníci, technici a pobočky – je v PDF v příloze.</p>`,
    "</td></tr></table>",
    '<p style="text-align:center;margin-top:16px;font-size:11px;color:#94a3b8">Odesláno z Jobi · nastavení reportu najdete v Nastavení → Komunikace → Report statistik</p>',
    "</td></tr></table></body></html>",
  ].join("");

  const text = [
    `${druh} report ${d.nazevObdobi} – ${d.servis.nazev}`,
    `Obrat: ${korunyCele(k.obrat)}`,
    `Zisk: ${korunyCele(k.zisk)} (marže ${procenta(k.marzePct)})`,
    `Zakázky: přijato ${k.pocet}, vydáno ${k.vydano}, reklamace ${k.reklamace}`,
    `Rozpracováno: ${d.rozpracovano.pocet} (naceněno ${korunyCele(d.rozpracovano.prijem)})`,
    "",
    "Celý report je v PDF v příloze.",
  ].join("\n");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      from,
      to: prijemci,
      subject: predmet,
      text,
      html,
      attachments: [{ filename: report.nazevSouboru, content: doBase64(report.pdf) }],
    }),
  });
  if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${(await res.text()).slice(0, 300)}` };
  return { ok: true };
}
