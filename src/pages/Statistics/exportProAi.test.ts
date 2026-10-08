import { describe, it, expect } from "vitest";
import { exportDoMarkdownu, formatujCas, nazevSouboruExportu, sestavExportProAi, type VstupExportu } from "./exportProAi";
import { PRAZDNE_KPI, rozdelPodleObdobi } from "./kpi";
import { EMPTY_COST_SOURCES } from "./margin";
import type { TicketEx } from "../Orders";

type Radek = {
  id: string;
  code?: string;
  status: string;
  createdAt: string;
  completedAt?: string;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  deviceLabel?: string;
  price?: number;
  costs?: number;
  branchId?: string | null;
  handoffMethod?: string;
  handbackMethod?: string;
  warrantyClaim?: boolean | null;
};

const zakazka = (r: Radek): TicketEx =>
  ({
    id: r.id,
    code: r.code ?? `J-${r.id}`,
    status: r.status,
    createdAt: r.createdAt,
    completed_at: r.completedAt ?? null,
    customerId: r.customerId,
    customerName: r.customerName ?? "Jan Novák",
    customerPhone: r.customerPhone ?? "+420 777 123 456",
    customerEmail: r.customerEmail ?? "jan@example.com",
    serialOrImei: "SN123456",
    issueShort: "Rozbitý displej, volat na 777 123 456",
    deviceLabel: r.deviceLabel ?? "iPhone 13",
    branchId: r.branchId ?? null,
    handoffMethod: r.handoffMethod,
    handbackMethod: r.handbackMethod,
    warrantyClaim: r.warrantyClaim ?? null,
    discountType: null,
    performedRepairs: r.price === undefined ? [] : [{ id: "x", name: "Výměna displeje", type: "selected", price: r.price, ...(r.costs === undefined ? {} : { costs: r.costs }) }],
  }) as unknown as TicketEx;

const jeKoncovy = (t: TicketEx) => t.status === "completed" || t.status === "cancelled";
const jeStorno = (t: TicketEx) => t.status === "cancelled";

const TICKETS: TicketEx[] = [
  // Stejný zákazník dvakrát (podle id karty), vydáno v období.
  zakazka({ id: "1", status: "completed", createdAt: "2026-03-02T08:30:00.000Z", completedAt: "2026-03-04T14:00:00.000Z", customerId: "c1", price: 3000, costs: 1000, handoffMethod: "Osobně", handbackMethod: "Osobně", warrantyClaim: false, branchId: "b1" }),
  zakazka({ id: "2", status: "completed", createdAt: "2026-03-10T09:00:00.000Z", completedAt: "2026-03-10T15:00:00.000Z", customerId: "c1", price: 1500, costs: 500, deviceLabel: "iPad Air", handoffMethod: "Osobně" }),
  // Jiný zákazník, storno.
  zakazka({ id: "3", status: "cancelled", createdAt: "2026-03-11T10:00:00.000Z", completedAt: "2026-03-12T10:00:00.000Z", customerId: "c2", price: 2000 }),
  // Otevřená, bez karty zákazníka (jen jméno).
  zakazka({ id: "4", status: "received", createdAt: "2026-03-20T16:15:00.000Z", customerId: undefined, customerName: "Petr Svoboda", customerPhone: "", price: 800 }),
  // Mimo období (únor), ale otevřená – stáří fronty.
  zakazka({ id: "5", status: "received", createdAt: "2026-02-01T10:00:00.000Z", customerId: "c3" }),
];

const OBDOBI = { start: new Date("2026-03-01T00:00:00+01:00"), end: new Date("2026-03-31T23:59:59+02:00") };

function vstup(): VstupExportu {
  return {
    servis: "iSwap",
    obdobi: { typ: "month", od: OBDOBI.start, do: OBDOBI.end },
    predchoziObdobi: null,
    pobocka: null,
    zuzeni: null,
    kpi: { ...PRAZDNE_KPI, totalTickets: 4, issuedTickets: 2, totalRevenue: 4500, totalCosts: 1500, profit: 3000, marginPct: 66.67, averageTicketPrice: 2250, averageTicketDurationDays: 1.2 },
    kpiPredchozi: null,
    rozpracovano: { pocet: 2, nacenenych: 1, prijem: 800, naklad: 0 },
    stavy: [{ key: "completed", label: "Dokončeno", count: 2 }, { key: "received", label: "Přijato", count: 1 }, { key: "cancelled", label: "Zrušeno", count: 1 }],
    topOpravy: [{ name: "Výměna displeje", count: 2 }],
    topZarizeni: [{ name: "iPhone 13", count: 3 }, { name: "iPad Air", count: 1 }],
    marzeOpravy: [{ key: "id:x", name: "Výměna displeje", count: 2, revenue: 4500, cost: 1500, margin: 3000, marginPct: 66.67, noCostData: false }],
    marzeZarizeni: [],
    marzePobocky: [],
    marzeServisy: [],
    mesice: [{ year: 2026, monthIndex: 2, count: 4, revenue: 4500, margin: 3000 }],
    technici: [{ userId: "u1", name: "Alex", prijato: 4, dokonceno: 2, odpracovanoHodin: 3.5, bezicichUseku: 0, hodiny: 0, trzbaHodin: 0 }],
    skupiny: rozdelPodleObdobi(TICKETS, OBDOBI, jeKoncovy, jeStorno),
    costSources: EMPTY_COST_SOURCES,
    jeStorno,
    jeKoncovy,
    nazevStavu: (k) => ({ completed: "Dokončeno", received: "Přijato", cancelled: "Zrušeno" })[k] ?? k,
    nazevPobocky: (id) => (id === "b1" ? "Praha" : "?"),
    poznamkaKNakladum: "Náklady = náklady oprav + nákupní ceny dílů.",
    ted: new Date("2026-03-25T12:00:00.000Z"),
  };
}

describe("sestavExportProAi", () => {
  const e = sestavExportProAi(vstup());

  it("zakázky jsou anonymní: zákazník jen číslem, bez jmen, kontaktů a textů", () => {
    const json = JSON.stringify(e);
    expect(json).not.toContain("Novák");
    expect(json).not.toContain("Svoboda");
    expect(json).not.toContain("777");
    expect(json).not.toContain("example.com");
    expect(json).not.toContain("SN123456");
    expect(json).not.toContain("Rozbitý displej");
    expect(json).not.toContain("c1");
    // Technik je člověk servisu – ten jménem zůstává.
    expect(json).toContain("Alex");
  });

  it("stejný zákazník má stejné číslo a vracející se zákazníci jsou sečtení", () => {
    const z = (id: string) => e.zakazky.find((x) => x.kod === `J-${id}`)!;
    expect(z("1").zakaznik).toBe(z("2").zakaznik);
    expect(z("3").zakaznik).not.toBe(z("1").zakaznik);
    // Bez karty, ale se jménem – číslo dostane (podle jména), ať se dá poznat opakování.
    expect(z("4").zakaznik).toMatch(/^zákazník #\d+$/);
    expect(e.zakaznici.celkem).toBe(4);
    expect(e.zakaznici.vracejiciSe).toBe(1);
    expect(e.zakaznici.zakazekOdVracejicich).toBe(2);
    expect(e.zakaznici.nejcastejsi[0]).toEqual({ zakaznik: z("1").zakaznik, zakazek: 2, prijem: 4500 });
  });

  it("obsahuje přijaté i vydané v období a otevřené mimo období", () => {
    expect(e.zakazky.map((z) => z.kod)).toEqual(["J-4", "J-3", "J-2", "J-1", "J-5"]);
    const z5 = e.zakazky.find((x) => x.kod === "J-5")!;
    expect(z5.otevrena).toBe(true);
    expect(z5.prijataVObdobi).toBe(false);
    expect(z5.vydanaVObdobi).toBe(false);
    const z3 = e.zakazky.find((x) => x.kod === "J-3")!;
    expect(z3.storno).toBe(true);
    expect(z3.vydanaVObdobi).toBe(false);
    expect(z3.prijem).toBe(0);
  });

  it("peníze, doby a časy v pražském pásmu", () => {
    const z1 = e.zakazky.find((x) => x.kod === "J-1")!;
    expect(z1).toMatchObject({ prijato: "2026-03-02 09:30", vydano: "2026-03-04 15:00", dobaDny: 2.2, prijem: 3000, naklady: 1000, marze: 2000, pobocka: "Praha", zarucni: false, prevzeti: "Osobně", predani: "Osobně" });
    expect(z1.opravy).toEqual([{ nazev: "Výměna displeje", typ: "ceník", cena: 3000, naklady: 1000 }]);
    // Doby: 2,2 dne a 0,3 dne vydané + 1 den storno (uzavřené počítají i storno).
    expect(e.doby.pocet).toBe(3);
    expect(e.doby.pasma.find((p) => p.pasmo === "do 1 dne")?.pocet).toBe(2);
    expect(e.doby.pasma.find((p) => p.pasmo === "1–3 dny")?.pocet).toBe(1);
    // Otevřené: J-4 (5 dní) a J-5 (52 dní).
    expect(e.doby.otevrenePodleStari.find((p) => p.pasmo === "3–7 dní")?.pocet).toBe(1);
    expect(e.doby.otevrenePodleStari.find((p) => p.pasmo === "přes 30 dní")?.pocet).toBe(1);
    expect(e.doby.nejstarsiOtevrenaDny).toBe(52);
  });

  it("hodiny: příjem z přijatých, výdej z vydaných bez storna, způsoby sečtené", () => {
    expect(e.hodiny.prijem.celkem).toBe(4);
    expect(e.hodiny.vydej.celkem).toBe(2);
    expect(e.hodiny.prijem.zpusoby).toEqual([{ zpusob: "Osobně", pocet: 2 }, { zpusob: "—", pocet: 2 }]);
    // 2026-03-02 je pondělí, 08:30 UTC = 9:30 SEČ
    expect(e.hodiny.prijem.bunky).toContainEqual({ den: "Po", hodina: 9, pocet: 1 });
  });

  it("měsíce a hlavička", () => {
    expect(e.mesice).toEqual([{ mesic: "2026-03", prijato: 4, prijem: 4500, marze: 3000 }]);
    expect(e.obdobi).toEqual({ typ: "month", od: "2026-03-01", do: "2026-03-31" });
    expect(e.vygenerovano).toBe("2026-03-25 13:00");
    expect(e.jakCist.join(" ")).toContain("anonymní");
  });
});

describe("exportDoMarkdownu", () => {
  const md = exportDoMarkdownu(sestavExportProAi(vstup()));

  it("má všechny oddíly a tabulky", () => {
    for (const nadpis of ["# Statistiky servisu iSwap", "## Jak číst tento soubor", "## Klíčová čísla", "## Měsíční přehled", "## Zakázky podle stavu", "## Marže podle oprav", "## Technici", "## Doba zakázky", "## Kdy lidé chodí", "## Zákazníci (anonymně)", "## Zakázky (5)"]) {
      expect(md).toContain(nadpis);
    }
    expect(md).toContain("| Celkový příjem | 4 500 Kč |");
    expect(md).toContain("| 2026-03 | 4 | 4 500 Kč | 3 000 Kč |");
    expect(md).toContain("| Alex | 4 | 2 | 3,5 |");
    expect(md).toContain("Výměna displeje 3000/1000");
  });

  it("neprozradí jména ani kontakty", () => {
    expect(md).not.toContain("Novák");
    expect(md).not.toContain("777");
    expect(md).not.toContain("example.com");
  });

  it("prázdný servis nespadne", () => {
    const prazdny = sestavExportProAi({ ...vstup(), skupiny: { prijate: [], vydane: [], uzavrene: [], rozpracovane: [] }, kpi: PRAZDNE_KPI, rozpracovano: { pocet: 0, nacenenych: 0, prijem: 0, naklad: 0 }, stavy: [], topOpravy: [], topZarizeni: [], marzeOpravy: [], mesice: [], technici: [] });
    const text = exportDoMarkdownu(prazdny);
    expect(text).toContain("_Žádná data._");
    expect(text).toContain("## Zakázky (0)");
    expect(prazdny.doby.prumerDny).toBe(0);
  });
});

describe("pomocné", () => {
  it("formatujCas převádí do pásma a snese neplatné datum", () => {
    expect(formatujCas("2026-07-06T08:30:00.000Z")).toBe("2026-07-06 10:30");
    expect(formatujCas("nic")).toBeNull();
    expect(formatujCas(null)).toBeNull();
  });

  it("název souboru nese datum a příponu", () => {
    expect(nazevSouboruExportu("md", new Date("2026-03-25T12:00:00.000Z"))).toBe("statistiky-ai-2026-03-25.md");
    expect(nazevSouboruExportu("json", new Date("2026-03-25T12:00:00.000Z"))).toBe("statistiky-ai-2026-03-25.json");
  });
});
