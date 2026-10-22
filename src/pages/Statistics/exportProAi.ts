/**
 * Export Statistik pro vyhodnocení umělou inteligencí.
 *
 * Majitel chce celý obraz servisu v jednom souboru, který hodí do chatu
 * a zeptá se „co zlepšit“. Stránka ukazuje totéž po kartách, tady je to
 * pohromadě a anonymně: zákazníci jsou jen „zákazník #n“ (podle interního
 * id, ať jde poznat, kdo se vrací), bez jmen, telefonů, e-mailů, sériových
 * čísel a volných textů – do souboru, který poputuje cizí službě, nepatří.
 * Technici jsou jménem: to jsou lidé servisu a majitel je hodnotí.
 *
 * Dva tvary ze stejných dat: Markdown (čte se a lepí se do chatu) a JSON
 * (pro nástroje, které si čísla načtou samy). Čistý modul bez Reactu,
 * aby šel otestovat; stránka mu jen předá, co má v paměti.
 *
 * Pravidla čísel jsou stejná jako na stránce (a na serveru): peníze ze
 * zakázek vydaných v období, počty podle přijetí, storno do peněz nejde.
 */
import type { TicketEx } from "../Orders";
import type { Kpis, JeKoncovy, Rozpracovano, ZakazkyObdobi } from "./kpi";
import { datumVydani } from "./kpi";
import { ticketMargin, type CostSources, type JeStorno, type MarginRow } from "./margin";
import type { MonthStat } from "./MonthlyChart";
import type { ServerTechnik } from "../../lib/statistikyServer";
import type { PeriodType } from "./obdobi";
import { DNY_KRATCE, DNY_DLOUZE, rozlozeniHodin, shrnutiHodin, zpusobyPredani, type RozlozeniHodin } from "./hodiny";
import { technikPrace } from "../../lib/rootOwner";

export type VstupExportu = {
  /** Název servisu (konsolidovaně seznam servisů). */
  servis: string;
  servisy?: string[];
  obdobi: { typ: PeriodType; od: Date | null; do: Date | null };
  predchoziObdobi: { od: Date; do: Date } | null;
  /** Název pobočky z lišty; null = všechny. */
  pobocka: string | null;
  /** Popis zúžení výběru (klik na stav / měsíc / opravu / zařízení). */
  zuzeni: string | null;
  kpi: Kpis;
  kpiPredchozi: Kpis | null;
  rozpracovano: Rozpracovano;
  stavy: Array<{ key: string; label: string; count: number }>;
  topOpravy: Array<{ name: string; count: number }>;
  topZarizeni: Array<{ name: string; count: number }>;
  marzeOpravy: MarginRow[];
  marzeZarizeni: MarginRow[];
  marzePobocky: MarginRow[];
  marzeServisy: MarginRow[];
  mesice: MonthStat[];
  technici: ServerTechnik[];
  /** Zakázky období ve skupinách (přijaté, vydané, uzavřené, rozpracované). */
  skupiny: ZakazkyObdobi;
  costSources: CostSources;
  jeStorno: JeStorno;
  jeKoncovy: JeKoncovy;
  nazevStavu: (key: string) => string;
  nazevPobocky: (id: string) => string;
  /** Věta pod KPI o tom, co se do nákladů počítá a jak je to s DPH. */
  poznamkaKNakladum: string;
  /** Pásmo pro hodiny a data v souboru. */
  timeZone?: string;
  ted?: Date;
};

export type ZakazkaExportu = {
  kod: string | null;
  prijato: string;
  vydano: string | null;
  /** Doba od přijetí do vydání ve dnech (desetiny); null = nevydáno. */
  dobaDny: number | null;
  stav: string;
  storno: boolean;
  otevrena: boolean;
  prijataVObdobi: boolean;
  vydanaVObdobi: boolean;
  zarizeni: string;
  pobocka: string | null;
  zakaznik: string;
  zarucni: boolean | null;
  prevzeti: string | null;
  predani: string | null;
  opravy: Array<{ nazev: string; typ: string; cena: number; naklady: number | null; hodiny?: number; technik?: string }>;
  sleva: number;
  prijem: number;
  naklady: number;
  marze: number;
};

export type RozlozeniExportu = {
  celkem: number;
  shrnuti: string | null;
  podleDne: Array<{ den: string; pocet: number }>;
  podleHodiny: Array<{ hodina: number; pocet: number }>;
  /** Jen obsazené buňky – matice 7×24 by v JSONu byla samá nula. */
  bunky: Array<{ den: string; hodina: number; pocet: number }>;
  zpusoby: Array<{ zpusob: string; pocet: number }>;
};

export type ExportProAi = {
  format: "jobi-statistiky";
  verze: 1;
  vygenerovano: string;
  servis: string;
  servisy?: string[];
  obdobi: { typ: PeriodType; od: string | null; do: string | null };
  predchoziObdobi: { od: string; do: string } | null;
  pobocka: string | null;
  zuzeni: string | null;
  jakCist: string[];
  kpi: Kpis;
  kpiPredchozi: Kpis | null;
  rozpracovano: Rozpracovano;
  stavy: Array<{ stav: string; pocet: number }>;
  topOpravy: Array<{ nazev: string; pocet: number }>;
  topZarizeni: Array<{ nazev: string; pocet: number }>;
  marzeOpravy: MarzeExportu[];
  marzeZarizeni: MarzeExportu[];
  marzePobocky: MarzeExportu[];
  marzeServisy: MarzeExportu[];
  mesice: Array<{ mesic: string; prijato: number; prijem: number; marze: number }>;
  technici: Array<{ jmeno: string; prijal: number; dokoncil: number; naOpravachHodin: number; hodinPrace: number; trzbaZPrace: number }>;
  hodiny: { prijem: RozlozeniExportu; vydej: RozlozeniExportu };
  doby: DobyExportu;
  zakaznici: ZakazniciExportu;
  zakazky: ZakazkaExportu[];
};

export type MarzeExportu = { nazev: string; pocet: number; prijem: number; naklady: number; marze: number; marzePct: number; bezNakladu: boolean };

export type DobyExportu = {
  /** Vydané v období s dobou > 0. */
  pocet: number;
  prumerDny: number;
  medianDny: number;
  p90Dny: number;
  /** Kolik zakázek spadá do jednotlivých pásem doby. */
  pasma: Array<{ pasmo: string; pocet: number }>;
  /** Otevřené zakázky podle stáří. */
  otevrenePodleStari: Array<{ pasmo: string; pocet: number }>;
  nejstarsiOtevrenaDny: number | null;
};

export type ZakazniciExportu = {
  /** Různí zákazníci mezi zakázkami v souboru (podle interního id). */
  celkem: number;
  /** Zákazníci se dvěma a více zakázkami. */
  vracejiciSe: number;
  zakazekOdVracejicich: number;
  /** Zakázky bez vazby na kartu zákazníka – nejde poznat, jestli se vrací. */
  bezKarty: number;
  nejcastejsi: Array<{ zakaznik: string; zakazek: number; prijem: number }>;
};

const PASMA_DOBY: Array<{ pasmo: string; max: number }> = [
  { pasmo: "do 1 dne", max: 1 },
  { pasmo: "1–3 dny", max: 3 },
  { pasmo: "3–7 dní", max: 7 },
  { pasmo: "7–14 dní", max: 14 },
  { pasmo: "14–30 dní", max: 30 },
  { pasmo: "přes 30 dní", max: Infinity },
];

function zaokrouhli(n: number, desetinnych = 2): number {
  const k = 10 ** desetinnych;
  return Math.round(n * k) / k;
}

function pasmo(dny: number): string {
  return PASMA_DOBY.find((p) => dny <= p.max)?.pasmo ?? PASMA_DOBY[PASMA_DOBY.length - 1].pasmo;
}

function kvantil(serazene: number[], q: number): number {
  if (serazene.length === 0) return 0;
  const i = Math.min(serazene.length - 1, Math.max(0, Math.ceil(q * serazene.length) - 1));
  return serazene[i];
}

const formatovaceCasu = new Map<string, Intl.DateTimeFormat>();

/** „2026-03-04 14:05“ v daném pásmu – bez pásma by AI četla UTC a hodiny by neseděly s tabulkou hodin. */
export function formatujCas(iso: string | null | undefined, timeZone = "Europe/Prague"): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  let f = formatovaceCasu.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    formatovaceCasu.set(timeZone, f);
  }
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(d)) p[x.type] = x.value;
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

function formatujDatum(d: Date | null, timeZone: string): string | null {
  return d ? formatujCas(d.toISOString(), timeZone)?.slice(0, 10) ?? null : null;
}

function marzeRadek(r: MarginRow): MarzeExportu {
  return {
    nazev: r.name,
    pocet: r.count,
    prijem: zaokrouhli(r.revenue),
    naklady: zaokrouhli(r.cost),
    marze: zaokrouhli(r.margin),
    marzePct: zaokrouhli(r.marginPct, 1),
    bezNakladu: r.noCostData,
  };
}

function rozlozeni(r: RozlozeniHodin, udalost: "prijem" | "vydej", zpusoby: Array<{ zpusob: string; pocet: number }>): RozlozeniExportu {
  return {
    celkem: r.celkem,
    shrnuti: shrnutiHodin(r, udalost),
    podleDne: r.podleDne.map((pocet, i) => ({ den: DNY_DLOUZE[i], pocet })),
    podleHodiny: r.podleHodiny.map((pocet, hodina) => ({ hodina, pocet })).filter((x) => x.pocet > 0),
    bunky: r.spicky.map((s) => ({ den: DNY_KRATCE[s.den], hodina: s.hodina, pocet: s.pocet })),
    zpusoby,
  };
}

/** Klíč zákazníka pro číslování: karta zákazníka, jinak telefon, jinak jméno. Do souboru nejde. */
function klicZakaznika(t: TicketEx): string | null {
  if (t.customerId) return `id:${t.customerId}`;
  const tel = t.customerPhone?.replace(/\s+/g, "");
  if (tel) return `tel:${tel}`;
  const jmeno = t.customerName?.trim().toLowerCase();
  return jmeno && jmeno !== "cloud customer" ? `jm:${jmeno}` : null;
}

export function sestavExportProAi(v: VstupExportu): ExportProAi {
  const tz = v.timeZone ?? "Europe/Prague";
  const ted = v.ted ?? new Date();
  const { prijate, vydane, uzavrene, rozpracovane } = v.skupiny;
  const prijateIds = new Set(prijate.map((t) => t.id));
  const vydaneIds = new Set(vydane.map((t) => t.id));
  const uzavreneIds = new Set(uzavrene.map((t) => t.id));
  const otevreneIds = new Set(rozpracovane.map((t) => t.id));

  // Jedna řada zakázek: přijaté nebo vydané v období + otevřené (ty do
  // období nepatří, ale pro „co zlepšit“ je stáří fronty podstatné).
  const videno = new Set<string>();
  const vsechny: TicketEx[] = [];
  for (const t of [...prijate, ...vydane, ...uzavrene, ...rozpracovane]) {
    if (videno.has(t.id)) continue;
    videno.add(t.id);
    vsechny.push(t);
  }
  vsechny.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Číslování zákazníků v pořadí prvního výskytu – od nejnovější zakázky.
  const cislaZakazniku = new Map<string, number>();
  const zakaznikZakazky = new Map<string, { zakazek: number; prijem: number }>();
  let bezKarty = 0;
  const zakaznikPro = (t: TicketEx): string => {
    const klic = klicZakaznika(t);
    if (!klic) {
      bezKarty += 1;
      return "neznámý";
    }
    let n = cislaZakazniku.get(klic);
    if (!n) {
      n = cislaZakazniku.size + 1;
      cislaZakazniku.set(klic, n);
    }
    return `zákazník #${n}`;
  };

  const zakazky: ZakazkaExportu[] = [];
  const dobyVydanych: number[] = [];
  const pasmaDoby = new Map<string, number>(PASMA_DOBY.map((p) => [p.pasmo, 0]));
  const stariOtevrenych = new Map<string, number>(PASMA_DOBY.map((p) => [p.pasmo, 0]));
  let nejstarsiOtevrena: number | null = null;

  for (const t of vsechny) {
    const storno = v.jeStorno(t);
    const m = ticketMargin(t, v.costSources, storno);
    const vydano = datumVydani(t, v.jeKoncovy);
    const otevrena = otevreneIds.has(t.id);
    let dobaDny: number | null = null;
    if (vydano && t.createdAt) {
      const ms = new Date(vydano).getTime() - new Date(t.createdAt).getTime();
      if (ms > 0) dobaDny = zaokrouhli(ms / 86_400_000, 1);
    }
    if (dobaDny !== null && uzavreneIds.has(t.id)) {
      dobyVydanych.push(dobaDny);
      pasmaDoby.set(pasmo(dobaDny), (pasmaDoby.get(pasmo(dobaDny)) ?? 0) + 1);
    }
    if (otevrena && t.createdAt) {
      const stari = Math.max(0, (ted.getTime() - new Date(t.createdAt).getTime()) / 86_400_000);
      stariOtevrenych.set(pasmo(stari), (stariOtevrenych.get(pasmo(stari)) ?? 0) + 1);
      if (nejstarsiOtevrena === null || stari > nejstarsiOtevrena) nejstarsiOtevrena = stari;
    }
    const zakaznik = zakaznikPro(t);
    if (zakaznik !== "neznámý") {
      const z = zakaznikZakazky.get(zakaznik) ?? { zakazek: 0, prijem: 0 };
      z.zakazek += 1;
      if (vydaneIds.has(t.id)) z.prijem += m.revenue;
      zakaznikZakazky.set(zakaznik, z);
    }
    zakazky.push({
      kod: t.code ?? null,
      prijato: formatujCas(t.createdAt, tz) ?? t.createdAt,
      vydano: formatujCas(vydano, tz),
      dobaDny,
      stav: v.nazevStavu(t.status || "unknown"),
      storno,
      otevrena,
      prijataVObdobi: prijateIds.has(t.id),
      vydanaVObdobi: vydaneIds.has(t.id),
      zarizeni: t.deviceLabel || "",
      pobocka: t.branchId ? v.nazevPobocky(t.branchId) : null,
      zakaznik,
      zarucni: typeof t.warrantyClaim === "boolean" ? t.warrantyClaim : null,
      prevzeti: t.handoffMethod?.trim() || null,
      predani: t.handbackMethod?.trim() || null,
      opravy: (t.performedRepairs ?? []).map((r) => ({
        nazev: r.name,
        typ: r.type === "selected" ? "ceník" : r.type === "hourly" ? "hodinová" : "ruční",
        cena: zaokrouhli(r.price ?? 0),
        naklady: typeof r.costs === "number" ? zaokrouhli(r.costs) : null,
        ...(r.type === "hourly" && typeof r.hodiny === "number" ? { hodiny: r.hodiny } : {}),
        ...(technikPrace(r) ? { technik: technikPrace(r) ?? undefined } : {}),
      })),
      sleva: zaokrouhli(m.discount),
      prijem: zaokrouhli(m.revenue),
      naklady: zaokrouhli(m.cost),
      marze: zaokrouhli(m.margin),
    });
  }

  const serazeneDoby = [...dobyVydanych].sort((a, b) => a - b);
  const doby: DobyExportu = {
    pocet: serazeneDoby.length,
    prumerDny: zaokrouhli(serazeneDoby.reduce((a, b) => a + b, 0) / (serazeneDoby.length || 1), 1),
    medianDny: zaokrouhli(kvantil(serazeneDoby, 0.5), 1),
    p90Dny: zaokrouhli(kvantil(serazeneDoby, 0.9), 1),
    pasma: PASMA_DOBY.map((p) => ({ pasmo: p.pasmo, pocet: pasmaDoby.get(p.pasmo) ?? 0 })),
    otevrenePodleStari: PASMA_DOBY.map((p) => ({ pasmo: p.pasmo, pocet: stariOtevrenych.get(p.pasmo) ?? 0 })),
    nejstarsiOtevrenaDny: nejstarsiOtevrena === null ? null : Math.round(nejstarsiOtevrena),
  };

  const vracejici = [...zakaznikZakazky.entries()].filter(([, z]) => z.zakazek >= 2);
  const zakaznici: ZakazniciExportu = {
    celkem: cislaZakazniku.size,
    vracejiciSe: vracejici.length,
    zakazekOdVracejicich: vracejici.reduce((a, [, z]) => a + z.zakazek, 0),
    bezKarty,
    nejcastejsi: vracejici
      .sort((a, b) => b[1].zakazek - a[1].zakazek || b[1].prijem - a[1].prijem)
      .slice(0, 10)
      .map(([zakaznik, z]) => ({ zakaznik, zakazek: z.zakazek, prijem: zaokrouhli(z.prijem) })),
  };

  const proHodiny = (list: TicketEx[]) =>
    list.map((t) => ({
      createdAt: t.createdAt,
      completedAt: datumVydani(t, v.jeKoncovy),
      status: t.status,
      prevzeti: t.handoffMethod ?? null,
      predani: t.handbackMethod ?? null,
    }));
  // `vydane` už storno neobsahuje (rozdelPodleObdobi ho nechává jen
  // v uzavřených), takže výdej nepotřebuje vlastní filtr storna.
  const hodPrijem = proHodiny(prijate);
  const hodVydej = proHodiny(vydane);

  const jakCist = [
    "Soubor vygenerovala aplikace Jobi (servisní systém) ze stránky Statistiky. Je anonymní: zákazníci jsou označeni jen pořadovým číslem (stejné číslo = stejný zákazník), bez jmen, kontaktů, sériových čísel a volných textů.",
    "Počet přijatých zakázek je podle data přijetí, příjem, náklady, slevy a zisk jen ze zakázek vydaných v období (podle data vydání). Rozpracované zakázky do příjmu nepatří, dokud se nevydají.",
    v.poznamkaKNakladum,
    "Marže podle oprav nezohledňuje slevu zakázky (nejde rozdělit mezi opravy), proto se její součet může lišit od celkového zisku.",
    "Technici: přijetí a dokončení z historie zakázek, odpracovaný čas ze stopek, hodinová práce podle vzniku zakázky.",
    `Časy jsou v pásmu ${tz}. Částky jsou v Kč.`,
  ];

  const obdobiOd = formatujDatum(v.obdobi.od, tz);
  const obdobiDo = formatujDatum(v.obdobi.do, tz);

  return {
    format: "jobi-statistiky",
    verze: 1,
    vygenerovano: formatujCas(ted.toISOString(), tz) ?? ted.toISOString(),
    servis: v.servis,
    ...(v.servisy && v.servisy.length > 1 ? { servisy: v.servisy } : {}),
    obdobi: { typ: v.obdobi.typ, od: obdobiOd, do: obdobiDo },
    predchoziObdobi: v.predchoziObdobi ? { od: formatujDatum(v.predchoziObdobi.od, tz) ?? "", do: formatujDatum(v.predchoziObdobi.do, tz) ?? "" } : null,
    pobocka: v.pobocka,
    zuzeni: v.zuzeni,
    jakCist,
    kpi: v.kpi,
    kpiPredchozi: v.kpiPredchozi,
    rozpracovano: v.rozpracovano,
    stavy: v.stavy.map((s) => ({ stav: s.label, pocet: s.count })),
    topOpravy: v.topOpravy.map((r) => ({ nazev: r.name, pocet: r.count })),
    topZarizeni: v.topZarizeni.map((r) => ({ nazev: r.name, pocet: r.count })),
    marzeOpravy: v.marzeOpravy.map(marzeRadek),
    marzeZarizeni: v.marzeZarizeni.map(marzeRadek),
    marzePobocky: v.marzePobocky.map(marzeRadek),
    marzeServisy: v.marzeServisy.map(marzeRadek),
    mesice: v.mesice.map((m) => ({
      mesic: `${m.year}-${String(m.monthIndex + 1).padStart(2, "0")}`,
      prijato: m.count,
      prijem: zaokrouhli(m.revenue),
      marze: zaokrouhli(m.margin),
    })),
    technici: v.technici.map((t) => ({
      jmeno: t.name,
      prijal: t.prijato,
      dokoncil: t.dokonceno,
      naOpravachHodin: zaokrouhli(t.odpracovanoHodin, 1),
      hodinPrace: zaokrouhli(t.hodiny, 2),
      trzbaZPrace: zaokrouhli(t.trzbaHodin),
    })),
    hodiny: {
      prijem: rozlozeni(rozlozeniHodin(hodPrijem, "prijem", { timeZone: tz }), "prijem", zpusobyPredani(hodPrijem, "prijem")),
      vydej: rozlozeni(rozlozeniHodin(hodVydej, "vydej", { timeZone: tz }), "vydej", zpusobyPredani(hodVydej, "vydej")),
    },
    doby,
    zakaznici,
    zakazky,
  };
}

// ========================
// Markdown
// ========================

// cs-CZ odděluje tisíce nezlomitelnou (i úzkou) mezerou; v souboru pro AI
// je obyčejná mezera čitelnější a nepřekvapí při hledání.
const mezery = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");
const kc = (n: number) => `${mezery(Math.round(n).toLocaleString("cs-CZ"))} Kč`;
const pct = (n: number) => `${mezery(n.toLocaleString("cs-CZ", { maximumFractionDigits: 1 }))} %`;
const des = (n: number, d = 1) => mezery(n.toLocaleString("cs-CZ", { maximumFractionDigits: d }));

/** Hodnota do tabulky: svislítko by rozbilo řádek. */
function bunka(s: string | number | null | undefined): string {
  if (s === null || s === undefined) return "—";
  return String(s).replace(/\|/g, "／").replace(/\r?\n/g, " ");
}

function tabulka(hlavicka: string[], radky: Array<Array<string | number | null | undefined>>): string {
  if (radky.length === 0) return "_Žádná data._\n";
  const h = `| ${hlavicka.map(bunka).join(" | ")} |`;
  const oddelovac = `| ${hlavicka.map(() => "---").join(" | ")} |`;
  return [h, oddelovac, ...radky.map((r) => `| ${r.map(bunka).join(" | ")} |`)].join("\n") + "\n";
}

function marzeTabulka(radky: MarzeExportu[], pocetLabel: string): string {
  return tabulka(
    ["Název", pocetLabel, "Příjem", "Náklady", "Marže", "Marže %"],
    radky.map((r) => [r.nazev, r.pocet, kc(r.prijem), r.bezNakladu ? "bez nákladů" : kc(r.naklady), kc(r.marze), r.bezNakladu ? "—" : pct(r.marzePct)]),
  );
}

function kpiTabulka(k: Kpis, p: Kpis | null): string {
  const radek = (nazev: string, f: (x: Kpis) => string) => [nazev, f(k), ...(p ? [f(p)] : [])];
  return tabulka(
    ["Ukazatel", "Období", ...(p ? ["Předchozí období"] : [])],
    [
      radek("Přijato zakázek", (x) => String(x.totalTickets)),
      radek("Vydáno zakázek", (x) => String(x.issuedTickets)),
      radek("Celkový příjem", (x) => kc(x.totalRevenue)),
      radek("Celkové náklady", (x) => kc(x.totalCosts)),
      radek("Celkové slevy", (x) => kc(x.totalDiscounts)),
      radek("Zisk (marže v Kč)", (x) => kc(x.profit)),
      radek("Marže %", (x) => pct(x.marginPct)),
      radek("Průměrná cena vydané zakázky", (x) => kc(x.averageTicketPrice)),
      radek("Průměrná doba zakázky (dny)", (x) => des(x.averageTicketDurationDays)),
      radek("Opravy bez nákladů", (x) => String(x.entriesWithoutCost)),
      radek("Opravy s dílem bez nákupní ceny", (x) => String(x.entriesMissingPurchasePrice)),
    ],
  );
}

function hodinyMarkdown(r: RozlozeniExportu, nadpis: string): string {
  const out: string[] = [`### ${nadpis}`, ""];
  if (r.celkem === 0) {
    out.push("_Žádná data._", "");
    return out.join("\n");
  }
  if (r.shrnuti) out.push(r.shrnuti, "");
  // Matice den × hodina jen v obsazeném rozsahu – jako graf na stránce.
  const matice = new Map<string, number>();
  let od = 8;
  let doH = 18;
  for (const b of r.bunky) {
    matice.set(`${b.den}-${b.hodina}`, b.pocet);
    od = Math.min(od, b.hodina);
    doH = Math.max(doH, b.hodina);
  }
  const hodiny = Array.from({ length: doH - od + 1 }, (_, i) => od + i);
  out.push(
    tabulka(
      ["Den", ...hodiny.map((h) => `${h} h`), "Celkem"],
      DNY_KRATCE.map((den, i) => [den, ...hodiny.map((h) => matice.get(`${den}-${h}`) ?? 0), r.podleDne[i]?.pocet ?? 0]),
    ),
  );
  if (r.zpusoby.length > 0) {
    out.push("Podle způsobu: " + r.zpusoby.map((z) => `${z.zpusob} ${z.pocet}`).join(", "), "");
  }
  return out.join("\n");
}

export function exportDoMarkdownu(e: ExportProAi): string {
  const out: string[] = [];
  const obdobiText =
    e.obdobi.od && e.obdobi.do ? `${e.obdobi.od} až ${e.obdobi.do}` : "celá historie";
  out.push(`# Statistiky servisu ${e.servis}`, "");
  out.push(`- Období: ${obdobiText} (${e.obdobi.typ})`);
  if (e.predchoziObdobi) out.push(`- Předchozí období pro srovnání: ${e.predchoziObdobi.od} až ${e.predchoziObdobi.do}`);
  out.push(`- Pobočka: ${e.pobocka ?? "všechny"}`);
  if (e.servisy) out.push(`- Servisy dohromady: ${e.servisy.join(", ")}`);
  if (e.zuzeni) out.push(`- Zúžení výběru: ${e.zuzeni}`);
  out.push(`- Vygenerováno: ${e.vygenerovano}`, "");

  out.push("## Jak číst tento soubor", "");
  for (const v of e.jakCist) out.push(`- ${v}`);
  out.push("");

  out.push("## Klíčová čísla", "", kpiTabulka(e.kpi, e.kpiPredchozi));
  out.push(
    `Rozpracováno (otevřené zakázky bez ohledu na období): ${e.rozpracovano.pocet}, z toho naceněných ${e.rozpracovano.nacenenych} za ${kc(e.rozpracovano.prijem)} (náklady ${kc(e.rozpracovano.naklad)}).`,
    "",
  );

  out.push("## Měsíční přehled", "", tabulka(["Měsíc", "Přijato", "Příjem", "Marže"], e.mesice.map((m) => [m.mesic, m.prijato, kc(m.prijem), kc(m.marze)])));

  out.push("## Zakázky podle stavu", "", tabulka(["Stav", "Počet"], e.stavy.map((s) => [s.stav, s.pocet])));

  out.push("## Nejčastější opravy", "", tabulka(["Oprava", "Počet"], e.topOpravy.map((r) => [r.nazev, r.pocet])));
  out.push("## Nejčastější zařízení", "", tabulka(["Zařízení", "Počet"], e.topZarizeni.map((r) => [r.nazev, r.pocet])));

  out.push("## Marže podle oprav", "", marzeTabulka(e.marzeOpravy, "Provedeno"));
  out.push("## Marže podle zařízení", "", marzeTabulka(e.marzeZarizeni, "Zakázek"));
  if (e.marzePobocky.length > 0) out.push("## Pobočky vedle sebe", "", marzeTabulka(e.marzePobocky, "Zakázek"));
  if (e.marzeServisy.length > 0) out.push("## Servisy vedle sebe", "", marzeTabulka(e.marzeServisy, "Zakázek"));

  if (e.technici.length > 0) {
    out.push(
      "## Technici",
      "",
      tabulka(
        ["Technik", "Přijal", "Dokončil", "Na opravách (h)", "Hodin práce", "Tržba z práce"],
        e.technici.map((t) => [t.jmeno, t.prijal, t.dokoncil, des(t.naOpravachHodin), des(t.hodinPrace, 2), kc(t.trzbaZPrace)]),
      ),
    );
  }

  out.push("## Doba zakázky", "");
  if (e.doby.pocet === 0) out.push("_V období nebyla vydaná žádná zakázka._", "");
  else {
    out.push(`Z ${e.doby.pocet} vydaných zakázek: průměr ${des(e.doby.prumerDny)} dne, medián ${des(e.doby.medianDny)} dne, 90 % zakázek do ${des(e.doby.p90Dny)} dne.`, "");
    out.push(tabulka(["Doba od přijetí do vydání", "Zakázek"], e.doby.pasma.map((p) => [p.pasmo, p.pocet])));
  }
  if (e.rozpracovano.pocet > 0) {
    out.push(`Otevřené zakázky podle stáří (nejstarší ${e.doby.nejstarsiOtevrenaDny ?? 0} dní):`, "");
    out.push(tabulka(["Stáří", "Zakázek"], e.doby.otevrenePodleStari.map((p) => [p.pasmo, p.pocet])));
  }

  out.push("## Kdy lidé chodí", "");
  out.push(hodinyMarkdown(e.hodiny.prijem, "Příjem zakázek (den × hodina)"));
  out.push(hodinyMarkdown(e.hodiny.vydej, "Výdej zakázek (den × hodina)"));

  out.push("## Zákazníci (anonymně)", "");
  out.push(
    `Různých zákazníků: ${e.zakaznici.celkem}; vracejících se (2 a více zakázek): ${e.zakaznici.vracejiciSe}, zakázek od nich: ${e.zakaznici.zakazekOdVracejicich}. Zakázek bez karty zákazníka: ${e.zakaznici.bezKarty}.`,
    "",
  );
  if (e.zakaznici.nejcastejsi.length > 0) {
    out.push(tabulka(["Zákazník", "Zakázek", "Příjem"], e.zakaznici.nejcastejsi.map((z) => [z.zakaznik, z.zakazek, kc(z.prijem)])));
  }

  out.push(`## Zakázky (${e.zakazky.length})`, "");
  out.push("Přijaté nebo vydané v období a všechny otevřené. „V obratu“ = vydaná v období, jen z těch je příjem.", "");
  out.push(
    tabulka(
      ["Kód", "Přijato", "Vydáno", "Dny", "Stav", "V obratu", "Zařízení", "Pobočka", "Zákazník", "Záruční", "Převzetí", "Předání", "Opravy", "Sleva", "Příjem", "Náklady", "Marže"],
      e.zakazky.map((z) => [
        z.kod,
        z.prijato,
        z.vydano,
        z.dobaDny,
        z.stav + (z.storno ? " (storno)" : ""),
        z.vydanaVObdobi ? "ano" : "ne",
        z.zarizeni,
        z.pobocka,
        z.zakaznik,
        z.zarucni === null ? "—" : z.zarucni ? "ano" : "ne",
        z.prevzeti,
        z.predani,
        z.opravy.map((o) => `${o.nazev} ${Math.round(o.cena)}${o.naklady !== null ? `/${Math.round(o.naklady)}` : ""}`).join("; "),
        z.sleva > 0 ? Math.round(z.sleva) : "",
        Math.round(z.prijem),
        Math.round(z.naklady),
        Math.round(z.marze),
      ]),
    ),
  );
  out.push("Sloupec Opravy: název cena/náklady v Kč (náklady jen když jsou uložené u opravy).", "");

  return out.join("\n");
}

/** Název souboru: `statistiky-ai-2026-03-04.md` / `.json`. */
export function nazevSouboruExportu(pripona: "md" | "json", ted = new Date()): string {
  return `statistiky-ai-${ted.toISOString().slice(0, 10)}.${pripona}`;
}
