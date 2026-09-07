/**
 * Marže ve Statistikách.
 *
 * Podle tohohle čísla se majitel rozhoduje, které opravy dělat a za kolik.
 * Když se do nákladů nezapočítá díl, vypadá oprava výnosněji, než je, a
 * servis prodělává na každém kusu. Když se naopak sleva započítá dvakrát,
 * vypadá práce ztrátově a majitel ji zdraží zbytečně.
 *
 * Zvlášť záleží na tom, aby bylo poznat „nulová marže“ od „nevíme, kolik to
 * stálo“ – jinak by v žebříčku vedly opravy, u kterých jen nikdo nevyplnil
 * nákupní cenu.
 */
import { describe, it, expect } from "vitest";
import {
  EMPTY_COST_SOURCES,
  entryMargin,
  marginByBranch,
  marginByDevice,
  marginByRepair,
  marginColor,
  marginPercent,
  sortMarginRows,
  ticketDiscountOf,
  ticketMargin,
  type CostSources,
  type MarginRow,
} from "./margin";
import type { TicketEx } from "../Orders";

const zakazka = (o: Record<string, unknown>) => o as unknown as TicketEx;
const oprava = (o: Record<string, unknown>) => o as never;

const zdroje = (o: Partial<{ repairs: CostSources["repairs"]; purchasePrices: CostSources["purchasePrices"] }> = {}): CostSources => ({
  repairs: o.repairs ?? new Map(),
  purchasePrices: o.purchasePrices ?? new Map(),
});

describe("náklady jedné provedené opravy", () => {
  it("příjem je cena opravy; oprava zdarma je nula, ne chybějící údaj", () => {
    expect(entryMargin(oprava({ name: "Výměna displeje", price: 1200 }), EMPTY_COST_SOURCES).revenue).toBe(1200);
    expect(entryMargin(oprava({ name: "Reklamace" }), EMPTY_COST_SOURCES).revenue).toBe(0);
  });

  it("náklady vyplněné u zakázky mají přednost před ceníkem – technik ví, co díl stál dnes", () => {
    const s = zdroje({ repairs: new Map([["r1", { costs: 200 }]]) });
    const m = entryMargin(oprava({ name: "Displej", price: 1200, costs: 350, repairId: "r1" }), s);
    expect(m.cost).toBe(350);
    expect(m.hasCostSource).toBe(true);
  });

  it("bez vlastních nákladů se sáhne do ceníku, ať oprava nevypadá bezplatně", () => {
    const s = zdroje({ repairs: new Map([["r1", { costs: 200 }]]) });
    expect(entryMargin(oprava({ name: "Displej", price: 1200, repairId: "r1" }), s).cost).toBe(200);
  });

  it("nulové náklady jsou platný údaj, ne chybějící", () => {
    const m = entryMargin(oprava({ name: "Konzultace", price: 500, costs: 0 }), EMPTY_COST_SOURCES);
    expect(m.cost).toBe(0);
    expect(m.hasCostSource).toBe(true);
  });

  it("bez jakéhokoliv zdroje nákladů se to přizná místo předstírané stoprocentní marže", () => {
    const m = entryMargin(oprava({ name: "Něco", price: 1200 }), EMPTY_COST_SOURCES);
    expect(m.cost).toBe(0);
    expect(m.hasCostSource).toBe(false);
  });

  it("nákupní ceny navázaných dílů se přičtou k nákladům", () => {
    const s = zdroje({ purchasePrices: new Map([["p1", 400], ["p2", 50]]) });
    const m = entryMargin(oprava({ name: "Displej", price: 1200, productIds: ["p1", "p2"] }), s);
    expect(m.cost).toBe(450);
    expect(m.hasCostSource).toBe(true);
    expect(m.missingPurchasePrice).toBe(false);
  });

  it("díl bez nákupní ceny se počítá jako nula, ale je to vidět jako chybějící údaj", () => {
    const s = zdroje({ purchasePrices: new Map<string, number | null>([["p1", 400], ["p2", null]]) });
    const m = entryMargin(oprava({ name: "Displej", price: 1200, productIds: ["p1", "p2", "p3"] }), s);
    expect(m.cost).toBe(400);
    expect(m.missingPurchasePrice).toBe(true);
  });

  it("díly zapsané u zakázky mají přednost před díly z ceníku", () => {
    const s = zdroje({
      repairs: new Map([["r1", { productIds: ["cenikovy"] }]]),
      purchasePrices: new Map([["cenikovy", 999], ["skutecny", 100]]),
    });
    const m = entryMargin(oprava({ name: "Displej", price: 1200, repairId: "r1", productIds: ["skutecny"] }), s);
    expect(m.cost).toBe(100);
  });
});

describe("sleva zakázky", () => {
  it("procentní sleva se počítá z ceny všech oprav", () => {
    expect(ticketDiscountOf(2000, zakazka({ discountType: "percentage", discountValue: 10 }))).toBe(200);
  });

  it("sleva pevnou částkou je ta částka, ne procenta z ní", () => {
    expect(ticketDiscountOf(2000, zakazka({ discountType: "amount", discountValue: 300 }))).toBe(300);
  });

  it("zakázka bez slevy nemá slevu, i když v ní zůstala hodnota z rozmyšlené slevy", () => {
    expect(ticketDiscountOf(2000, zakazka({ discountType: null, discountValue: 500 }))).toBe(0);
    expect(ticketDiscountOf(2000, zakazka({}))).toBe(0);
    expect(ticketDiscountOf(2000, zakazka({ discountType: "percentage" }))).toBe(0);
  });
});

describe("marže zakázky", () => {
  const s = zdroje({ repairs: new Map([["r1", { costs: 200 }]]) });

  it("marže je příjem mínus náklady mínus sleva", () => {
    const t = zakazka({
      performedRepairs: [{ name: "Displej", price: 2000, costs: 500 }],
      discountType: "percentage",
      discountValue: 10,
    });
    const m = ticketMargin(t, s);
    expect(m.gross).toBe(2000);
    expect(m.discount).toBe(200);
    expect(m.revenue).toBe(1800);
    expect(m.cost).toBe(500);
    expect(m.margin).toBe(1300);
  });

  it("sleva vyšší než cena oprav neudělá záporný příjem", () => {
    const t = zakazka({
      performedRepairs: [{ name: "Displej", price: 1000 }],
      discountType: "amount",
      discountValue: 1500,
    });
    expect(ticketMargin(t, EMPTY_COST_SOURCES).revenue).toBe(0);
  });

  it("sleva vyšší než cena se ani nevykáže celá – strhnout jde nejvýš cena", () => {
    // Stane se pokaždé, když se po slíbené pevné slevě zlevní oprava. Databáze
    // to dřív neořezávala: „Slevy 2 000 Kč“ a marže −1 100 místo −100 Kč.
    const t = zakazka({
      performedRepairs: [{ name: "Displej", price: 1000, costs: 100 }],
      discountType: "amount",
      discountValue: 2000,
    });
    const m = ticketMargin(t, EMPTY_COST_SOURCES);
    expect(m.discount).toBe(1000);
    expect(m.revenue).toBe(0);
    expect(m.margin).toBe(-100);
  });

  it("stornovaná zakázka nepřinese ani korunu, ani náklad", () => {
    const t = zakazka({ performedRepairs: [{ name: "Displej", price: 5000, costs: 1000 }] });
    const m = ticketMargin(t, EMPTY_COST_SOURCES, true);
    expect(m).toMatchObject({ gross: 0, discount: 0, revenue: 0, cost: 0, margin: 0, entriesWithoutCost: 0 });
  });

  it("sečte všechny provedené opravy na zakázce, ne jen první", () => {
    const t = zakazka({
      performedRepairs: [
        { name: "Displej", price: 2000, costs: 800 },
        { name: "Baterie", price: 900, costs: 300 },
      ],
    });
    const m = ticketMargin(t, EMPTY_COST_SOURCES);
    expect(m.gross).toBe(2900);
    expect(m.cost).toBe(1100);
    expect(m.margin).toBe(1800);
  });

  it("spočítá, u kolika záznamů náklady chybí – bez toho by čísla vypadala hotová", () => {
    const t = zakazka({
      performedRepairs: [
        { name: "Displej", price: 2000, costs: 800 },
        { name: "Ruční oprava", price: 500 },
        { name: "Baterie", price: 900, productIds: ["neznamy"] },
      ],
    });
    const m = ticketMargin(t, EMPTY_COST_SOURCES);
    expect(m.entriesWithoutCost).toBe(2);
    expect(m.entriesMissingPurchasePrice).toBe(1);
  });

  it("zakázka bez provedených oprav nespadne na NaN", () => {
    const m = ticketMargin(zakazka({}), EMPTY_COST_SOURCES);
    expect(m).toMatchObject({ gross: 0, discount: 0, revenue: 0, cost: 0, margin: 0 });
  });

  it("prodělečná zakázka má zápornou marži, ne nulu", () => {
    const t = zakazka({ performedRepairs: [{ name: "Displej", price: 500, costs: 900 }] });
    expect(ticketMargin(t, EMPTY_COST_SOURCES).margin).toBe(-400);
  });
});

describe("marže v procentech", () => {
  it("procenta se počítají z příjmu po slevě", () => {
    expect(marginPercent(900, 1800)).toBe(50);
  });

  it("nulový příjem nedá nekonečno ani NaN", () => {
    expect(marginPercent(0, 0)).toBe(0);
    expect(marginPercent(-500, 0)).toBe(0);
  });

  it("záporná marže je i v procentech záporná", () => {
    expect(marginPercent(-450, 900)).toBe(-50);
  });
});

describe("barva marže", () => {
  it("hranice 50 % a 20 % patří ještě k lepší kategorii", () => {
    expect(marginColor(50)).toBe(marginColor(80));
    expect(marginColor(20)).toBe(marginColor(49.9));
    expect(marginColor(19.9)).toBe(marginColor(0));
  });

  it("tři pásma se od sebe liší, jinak by barva nic neříkala", () => {
    expect(new Set([marginColor(80), marginColor(30), marginColor(5)]).size).toBe(3);
  });

  it("záporná marže je v nejhorším pásmu", () => {
    expect(marginColor(-20)).toBe(marginColor(0));
  });
});

describe("žebříček oprav", () => {
  const s = zdroje({ repairs: new Map([["r1", { costs: 300 }]]) });

  it("stejná ceníková oprava z více zakázek je jeden řádek se součtem", () => {
    const rows = marginByRepair(
      [
        zakazka({ performedRepairs: [{ name: "Displej", price: 2000, costs: 800, repairId: "r1" }] }),
        zakazka({ performedRepairs: [{ name: "Displej iPhone", price: 1800, costs: 700, repairId: "r1" }] }),
      ],
      s,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(2);
    expect(rows[0].revenue).toBe(3800);
    expect(rows[0].cost).toBe(1500);
    expect(rows[0].margin).toBe(2300);
  });

  it("ruční opravy se stejným názvem spadnou k sobě, různé názvy zůstanou zvlášť", () => {
    const rows = marginByRepair(
      [
        zakazka({ performedRepairs: [{ name: "Čištění", price: 300 }, { name: "Čištění", price: 300 }] }),
        zakazka({ performedRepairs: [{ name: "Diagnostika", price: 200 }] }),
      ],
      EMPTY_COST_SOURCES,
    );
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.name === "Čištění")?.count).toBe(2);
  });

  it("řádek, kde nikdo nevyplnil náklady, je označený – 100% marže by byla lež", () => {
    const rows = marginByRepair([zakazka({ performedRepairs: [{ name: "Čištění", price: 300 }] })], EMPTY_COST_SOURCES);
    expect(rows[0].noCostData).toBe(true);
    expect(rows[0].marginPct).toBe(100);
  });

  it("stačí jeden záznam s náklady, aby řádek přestal být „bez dat“", () => {
    const rows = marginByRepair(
      [zakazka({ performedRepairs: [{ name: "Čištění", price: 300 }, { name: "Čištění", price: 300, costs: 50 }] })],
      EMPTY_COST_SOURCES,
    );
    expect(rows[0].noCostData).toBe(false);
  });

  it("sleva zakázky se do řádků oprav nerozpouští – nešlo by ji rozdělit", () => {
    const rows = marginByRepair(
      [zakazka({ performedRepairs: [{ name: "Displej", price: 2000, costs: 800 }], discountType: "amount", discountValue: 500 })],
      EMPTY_COST_SOURCES,
    );
    expect(rows[0].revenue).toBe(2000);
    expect(rows[0].margin).toBe(1200);
  });

  it("zakázky bez oprav do žebříčku nic nepřidají", () => {
    expect(marginByRepair([zakazka({}), zakazka({ performedRepairs: [] })], EMPTY_COST_SOURCES)).toEqual([]);
  });
});

describe("žebříčky se stornem", () => {
  const stornoVse = () => true;

  it("oprava ze stornované zakázky se počítá do „Provedeno“, ne do peněz", () => {
    const rows = marginByRepair(
      [zakazka({ status: "cancelled", performedRepairs: [{ name: "Displej", price: 2000, costs: 800 }] })],
      EMPTY_COST_SOURCES,
      stornoVse,
    );
    expect(rows[0].count).toBe(1);
    expect(rows[0].revenue).toBe(0);
    expect(rows[0].cost).toBe(0);
    // Žádný započítaný náklad neexistuje, takže řádek nesmí tvrdit, že data má.
    expect(rows[0].noCostData).toBe(true);
  });

  it("zařízení jen ze stornovaných zakázek zůstává označené jako bez nákladů", () => {
    const rows = marginByDevice(
      [zakazka({ deviceLabel: "iPhone 13", status: "cancelled", performedRepairs: [{ name: "Displej", price: 2000, costs: 800 }] })],
      EMPTY_COST_SOURCES,
      stornoVse,
    );
    expect(rows[0]).toMatchObject({ count: 1, revenue: 0, cost: 0, margin: 0, noCostData: true });
  });

  it("pobočka se stornem má zakázku v počtu, ale ne v tržbě", () => {
    const rows = marginByBranch(
      [
        zakazka({ branchId: "b1", status: "cancelled", performedRepairs: [{ name: "Displej", price: 2000, costs: 800 }] }),
        zakazka({ branchId: "b1", performedRepairs: [{ name: "Baterie", price: 500, costs: 100 }] }),
      ],
      EMPTY_COST_SOURCES,
      () => "Praha",
      (t) => t.status === "cancelled",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Praha", count: 2, revenue: 500, cost: 100, margin: 400, noCostData: false });
  });
});

describe("řazení žebříčku", () => {
  const radek = (o: Partial<MarginRow>): MarginRow => ({
    key: o.name ?? "k",
    name: "x",
    count: 1,
    revenue: 0,
    cost: 0,
    margin: 0,
    marginPct: 0,
    noCostData: false,
    ...o,
  });

  it("podle marže vede nejvýnosnější oprava", () => {
    const r = sortMarginRows([radek({ name: "a", margin: 100 }), radek({ name: "b", margin: 900 })], "margin");
    expect(r.map((x) => x.name)).toEqual(["b", "a"]);
  });

  it("podle procent jdou řádky bez nákladů až na konec, i když mají 100 %", () => {
    const r = sortMarginRows(
      [
        radek({ name: "neznama", marginPct: 100, noCostData: true }),
        radek({ name: "skutecna", marginPct: 60 }),
      ],
      "pct",
    );
    expect(r.map((x) => x.name)).toEqual(["skutecna", "neznama"]);
  });

  it("podle počtu vede nejčastější oprava", () => {
    const r = sortMarginRows([radek({ name: "a", count: 2 }), radek({ name: "b", count: 9 })], "count");
    expect(r[0].name).toBe("b");
  });

  it("řazení nepřepisuje původní seznam, na který se dívá jiná část obrazovky", () => {
    const puvodni = [radek({ name: "a", margin: 1 }), radek({ name: "b", margin: 9 })];
    sortMarginRows(puvodni, "margin");
    expect(puvodni.map((x) => x.name)).toEqual(["a", "b"]);
  });
});
