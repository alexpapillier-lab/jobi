/**
 * Klíčová čísla Statistik – a hlavně to, že se **shodují se serverem**.
 *
 * Čísla na stránce normálně počítá `public.statistiky_prehled` v databázi;
 * tenhle výpočet se použije, jen když RPC selže. Kdyby se ty dva rozešly,
 * majiteli by se změnily tržby podle toho, jestli zrovna odpověděl server.
 *
 * Sada zakázek dole je záměrně stejná jako kontrolní data, na kterých se
 * ověřovala databázová funkce (leden 2026, pražský čas). Očekávané hodnoty
 * jsou to, co vrací `statistiky_prehled` na týchž datech:
 *
 *   totalTickets 9, totalRevenue 7 300, totalCosts 1 100, totalDiscounts 1 100,
 *   profit 6 200, marginPct 84,9315, averageTicketPrice 1 216,67,
 *   averageTicketDurationDays 1,2, entriesWithoutCost 2.
 */
import { describe, it, expect } from "vitest";
import { computeKpis, computeKpisObdobi, datumVydani, rozdelPodleObdobi, spocitejRozpracovano, type JeKoncovy } from "./kpi";
import type { DateRange } from "./obdobi";
import { EMPTY_COST_SOURCES, type JeStorno } from "./margin";
import { jeStornoStav } from "../../lib/stornoStav";
import type { TicketEx } from "../Orders";

type Radek = {
  status: string;
  label: string;
  price: number;
  costs?: number;
  discountType?: "percentage" | "amount" | null;
  discountValue?: number;
  createdAt: string;
  completedAt?: string;
};

const STAVY: Record<string, string> = {
  received: "Přijato",
  completed: "Dokončeno",
  cancelled: "Zrušeno",
  nerealizovano: "Nerealizováno",
};

/** Stejné pravidlo jako na stránce: storno se pozná z klíče i názvu stavu. */
const jeStorno: JeStorno = (t) => jeStornoStav(t.status, STAVY[t.status ?? ""]);

const zakazka = (r: Radek): TicketEx =>
  ({
    id: `${r.status}-${r.price}`,
    status: r.status,
    createdAt: r.createdAt,
    completed_at: r.completedAt ?? null,
    discountType: r.discountType ?? null,
    discountValue: r.discountValue ?? null,
    performedRepairs: [{ name: "Oprava", price: r.price, ...(r.costs === undefined ? {} : { costs: r.costs }) }],
  }) as unknown as TicketEx;

/** Leden 2026 v kontrolním servisu – přesně to, co má v databázi. */
const LEDEN: TicketEx[] = [
  zakazka({ status: "received", label: "Přijato", price: 1000, createdAt: "2026-01-01T00:30:00+01:00" }),
  zakazka({ status: "received", label: "Přijato", price: 3000, createdAt: "2026-01-31T23:45:00+01:00" }),
  zakazka({ status: "cancelled", label: "Zrušeno", price: 5000, costs: 1000, createdAt: "2026-01-05T10:00:00+01:00" }),
  zakazka({ status: "nerealizovano", label: "Nerealizováno", price: 6000, costs: 2000, createdAt: "2026-01-05T11:00:00+01:00" }),
  zakazka({ status: "completed", label: "Dokončeno", price: 1000, costs: 100, discountType: "percentage", discountValue: 10, createdAt: "2026-01-06T10:00:00+01:00", completedAt: "2026-01-08T10:00:00+01:00" }),
  zakazka({ status: "completed", label: "Dokončeno", price: 1000, costs: 100, discountType: "amount", discountValue: 2000, createdAt: "2026-01-06T12:00:00+01:00", completedAt: "2026-01-07T12:00:00+01:00" }),
  zakazka({ status: "completed", label: "Dokončeno", price: 700, costs: 200, createdAt: "2026-01-10T09:00:00+01:00", completedAt: "2026-01-11T09:00:00+01:00" }),
  zakazka({ status: "completed", label: "Dokončeno", price: 800, costs: 300, createdAt: "2026-01-15T09:00:00+01:00", completedAt: "2026-01-16T09:00:00+01:00" }),
  zakazka({ status: "completed", label: "Dokončeno", price: 900, costs: 400, createdAt: "2026-01-20T09:00:00+01:00", completedAt: "2026-01-21T09:00:00+01:00" }),
];

describe("klíčová čísla se shodují s databázovou funkcí", () => {
  const kpi = computeKpis(LEDEN, EMPTY_COST_SOURCES, jeStorno);

  it("počet zakázek obsahuje i storna – ta práce se odvedla", () => {
    expect(kpi.totalTickets).toBe(9);
  });

  it("tržba neobsahuje stornované zakázky", () => {
    // Bez tohohle by v tržbě bylo 5 000 + 6 000 Kč, které nikdo nezaplatil.
    expect(kpi.totalRevenue).toBe(7300);
    expect(kpi.totalCosts).toBe(1100);
  });

  it("sleva se nikdy nestrhne víc, než kolik zakázka stála", () => {
    // Pevná sleva 2 000 Kč u zakázky za 1 000 Kč je sleva 1 000 Kč, ne 2 000.
    expect(kpi.totalDiscounts).toBe(1100);
  });

  it("marže je tržba mínus náklady, i když sleva cenu smázla na nulu", () => {
    expect(kpi.profit).toBe(6200);
    expect(kpi.marginPct).toBeCloseTo(84.9315, 4);
  });

  it("průměrná cena se počítá jen z placených zakázek", () => {
    // Šest zakázek s nenulovou tržbou (storna a nulová po slevě mezi ně nepatří).
    expect(kpi.averageTicketPrice).toBeCloseTo(1216.67, 2);
  });

  it("průměrná doba se počítá z dokončených", () => {
    expect(kpi.averageTicketDurationDays).toBeCloseTo(1.2, 4);
  });

  it("opravy bez nákladů se počítají jen u nestornovaných", () => {
    expect(kpi.entriesWithoutCost).toBe(2);
    expect(kpi.entriesMissingPurchasePrice).toBe(0);
  });
});

describe("mezní servisy", () => {
  it("prázdný servis nedá NaN ani Infinity", () => {
    const kpi = computeKpis([], EMPTY_COST_SOURCES, jeStorno);
    for (const [klic, hodnota] of Object.entries(kpi)) {
      expect(Number.isFinite(hodnota), `${klic} = ${hodnota}`).toBe(true);
    }
    expect(kpi.marginPct).toBe(0);
    expect(kpi.averageTicketPrice).toBe(0);
  });

  it("servis s jedinou nezaplacenou zakázkou nedělí nulou", () => {
    const jedina = [zakazka({ status: "received", label: "Přijato", price: 0, createdAt: "2026-01-10T09:00:00+01:00" })];
    const kpi = computeKpis(jedina, EMPTY_COST_SOURCES, jeStorno);
    expect(kpi.totalTickets).toBe(1);
    expect(kpi.averageTicketPrice).toBe(0);
    expect(kpi.marginPct).toBe(0);
  });

  it("servis, kde jsou všechny zakázky storno, nemá tržbu ani zápornou marži", () => {
    const samaStorna = [
      zakazka({ status: "cancelled", label: "Zrušeno", price: 5000, costs: 1000, createdAt: "2026-01-05T10:00:00+01:00" }),
      zakazka({ status: "cancelled", label: "Zrušeno", price: 2000, costs: 800, createdAt: "2026-01-06T10:00:00+01:00" }),
    ];
    const kpi = computeKpis(samaStorna, EMPTY_COST_SOURCES, jeStorno);
    expect(kpi.totalTickets).toBe(2);
    expect(kpi.totalRevenue).toBe(0);
    expect(kpi.totalCosts).toBe(0);
    expect(kpi.profit).toBe(0);
    expect(kpi.marginPct).toBe(0);
  });
});

/**
 * Pravidlo období: peníze z vydaných, počty z přijatých, rozpracované zvlášť.
 * Zrcadlí `statistiky_prehled` po migraci 20260926170000.
 */
describe("peníze podle vydání, počty podle přijetí", () => {
  const jeKoncovy: JeKoncovy = (t) => t.status === "completed" || t.status === "cancelled" || t.status === "nerealizovano";
  const zari: DateRange = { start: new Date("2026-09-01T00:00:00+02:00"), end: new Date("2026-09-30T23:59:59+02:00") };
  const zakazky: TicketEx[] = [
    // Přijatá v září, vydaná v září: počet i peníze.
    zakazka({ status: "completed", label: "Dokončeno", price: 1000, costs: 100, createdAt: "2026-09-05T10:00:00+02:00", completedAt: "2026-09-10T10:00:00+02:00" }),
    // Přijatá v srpnu, vydaná v září: jen peníze září.
    zakazka({ status: "completed", label: "Dokončeno", price: 2000, costs: 500, createdAt: "2026-08-20T10:00:00+02:00", completedAt: "2026-09-02T10:00:00+02:00" }),
    // Přijatá v září, vydaná v říjnu: jen počet září – peníze až v říjnu.
    zakazka({ status: "completed", label: "Dokončeno", price: 4000, costs: 900, createdAt: "2026-09-25T10:00:00+02:00", completedAt: "2026-10-03T10:00:00+02:00" }),
    // Přijatá v září, ještě otevřená a naceněná: počet září + rozpracováno, do peněz ne.
    zakazka({ status: "received", label: "Přijato", price: 3000, costs: 700, createdAt: "2026-09-12T10:00:00+02:00" }),
    // Otevřená z července bez ceny: jen rozpracováno.
    zakazka({ status: "received", label: "Přijato", price: 0, createdAt: "2026-07-01T10:00:00+02:00" }),
    // Storno uzavřené v září: do počtu přijatých i do doby, do peněz ne.
    zakazka({ status: "cancelled", label: "Zrušeno", price: 5000, costs: 1000, createdAt: "2026-09-03T10:00:00+02:00", completedAt: "2026-09-04T10:00:00+02:00" }),
  ];
  const skupiny = rozdelPodleObdobi(zakazky, zari, jeKoncovy, jeStorno);
  const kpi = computeKpisObdobi(skupiny, EMPTY_COST_SOURCES, jeKoncovy, jeStorno);

  it("přijaté v období jsou čtyři (včetně storna a otevřené)", () => {
    expect(kpi.totalTickets).toBe(4);
  });

  it("vydané v období jsou dvě – i ta přijatá v srpnu, ne ta vydaná v říjnu", () => {
    expect(kpi.issuedTickets).toBe(2);
    expect(kpi.totalRevenue).toBe(3000);
    expect(kpi.totalCosts).toBe(600);
    expect(kpi.profit).toBe(2400);
  });

  it("naceněná otevřená zakázka do obratu nepatří, je v rozpracovaném", () => {
    const r = spocitejRozpracovano(skupiny.rozpracovane, EMPTY_COST_SOURCES);
    expect(r.pocet).toBe(2);
    expect(r.nacenenych).toBe(1);
    expect(r.prijem).toBe(3000);
    expect(r.naklad).toBe(700);
  });

  it("průměrná doba je z uzavřených v období včetně storna", () => {
    // 5 dní + 13 dní + 1 den = 19 / 3
    expect(kpi.averageTicketDurationDays).toBeCloseTo(19 / 3, 4);
  });

  it("bez období („Vše“) je vydané všechno koncové mimo storno", () => {
    const vse = rozdelPodleObdobi(zakazky, null, jeKoncovy, jeStorno);
    expect(vse.prijate).toHaveLength(6);
    expect(vse.vydane).toHaveLength(3);
    expect(vse.uzavrene).toHaveLength(4);
    expect(vse.rozpracovane).toHaveLength(2);
  });

  it("koncová zakázka bez completed_at má datum vydání z poslední změny, ať z peněz nevypadne", () => {
    const bezData = { ...zakazka({ status: "completed", label: "Dokončeno", price: 100, createdAt: "2026-09-01T10:00:00+02:00" }), updatedAt: "2026-09-15T10:00:00+02:00" } as TicketEx;
    expect(datumVydani(bezData, jeKoncovy)).toBe("2026-09-15T10:00:00+02:00");
    expect(datumVydani(zakazky[3], jeKoncovy)).toBeNull();
  });
});
