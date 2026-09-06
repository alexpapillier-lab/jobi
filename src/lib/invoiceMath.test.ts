/**
 * Počítadlo faktury.
 *
 * Tohle je jediné místo, kde se v aplikaci tvoří částka, kterou zákazník
 * skutečně zaplatí. Když se tady zmýlí halíř, nesedí doklad s tím, co přišlo
 * na účet, a servis to řeší s účetní. Když se zmýlí rekapitulace DPH, jede
 * servis špatné přiznání. A když dobropis nevyjde přesně jako záporná
 * faktura, zůstane v účetnictví rozdíl, který nikdo nedohledá.
 */
import { describe, it, expect } from "vitest";
import { computeLine, computeTotals, formatCurrency, emptyLineItem, type InvoiceLineItem } from "./invoiceMath";

const polozka = (o: Partial<InvoiceLineItem> = {}): InvoiceLineItem => ({
  name: "Výměna displeje",
  qty: 1,
  unit: "ks",
  unit_price: 0,
  vat_rate: 21,
  ...o,
});

describe("řádek faktury", () => {
  it("cena řádku je množství krát jednotková cena zaokrouhlené na halíře", () => {
    // 3 × 333,33 = 999,99 – ani o halíř víc, jinak nesedí součet s tiskem
    expect(computeLine(polozka({ qty: 3, unit_price: 333.33 })).line_total).toBe(999.99);
    expect(computeLine(polozka({ qty: 0.5, unit_price: 999 })).line_total).toBe(499.5);
  });

  it("DPH řádku se počítá ze zaokrouhlené ceny řádku, ne z neurčitého mezivýsledku", () => {
    const r = computeLine(polozka({ qty: 3, unit_price: 333.33, vat_rate: 21 }));
    expect(r.line_total).toBe(999.99);
    expect(r.line_vat).toBe(210);
  });

  it("neplátce DPH má na řádku nulovou daň, ne 21 %", () => {
    const r = computeLine(polozka({ unit_price: 1500, vat_rate: 0 }));
    expect(r.line_total).toBe(1500);
    expect(r.line_vat).toBe(0);
  });

  it("snížená sazba 12 % se počítá vlastní sazbou, ne základní", () => {
    expect(computeLine(polozka({ unit_price: 1000, vat_rate: 12 })).line_vat).toBe(120);
  });

  it("nechává původní název, jednotku i sazbu beze změny", () => {
    const r = computeLine(polozka({ name: "Práce technika", unit: "hod", qty: 2, unit_price: 490 }));
    expect(r.name).toBe("Práce technika");
    expect(r.unit).toBe("hod");
    expect(r.vat_rate).toBe(21);
  });
});

describe("součty faktury", () => {
  it("prázdná faktura je čistá nula, ne NaN ani prázdná rekapitulace s nulovým řádkem", () => {
    const t = computeTotals([]);
    expect(t).toEqual({ subtotal: 0, vat_amount: 0, total: 0, rounding: 0, total_rounded: 0, vat_breakdown: [] });
  });

  it("běžná faktura: základ, DPH a celkem sedí na sebe", () => {
    const t = computeTotals([polozka({ unit_price: 1000 })]);
    expect(t.subtotal).toBe(1000);
    expect(t.vat_amount).toBe(210);
    expect(t.total).toBe(1210);
    expect(t.total_rounded).toBe(1210);
    expect(t.rounding).toBe(0);
  });

  it("součet základů v rekapitulaci se rovná mezisoučtu a součet daní celkové DPH", () => {
    const t = computeTotals([
      polozka({ qty: 3, unit_price: 333.33, vat_rate: 21 }),
      polozka({ qty: 7, unit_price: 14.29, vat_rate: 12 }),
      polozka({ qty: 2, unit_price: 49.95, vat_rate: 21 }),
    ]);
    const zaklady = t.vat_breakdown.reduce((s, r) => s + r.base, 0);
    const dane = t.vat_breakdown.reduce((s, r) => s + r.vat, 0);
    expect(Math.round(zaklady * 100) / 100).toBe(t.subtotal);
    expect(Math.round(dane * 100) / 100).toBe(t.vat_amount);
    expect(Math.round((t.subtotal + t.vat_amount) * 100) / 100).toBe(t.total);
  });
});

describe("rekapitulace DPH", () => {
  it("položky se stejnou sazbou se slučují do jednoho řádku", () => {
    const t = computeTotals([
      polozka({ unit_price: 1000, vat_rate: 21 }),
      polozka({ unit_price: 500, vat_rate: 21 }),
    ]);
    expect(t.vat_breakdown).toEqual([{ rate: 21, base: 1500, vat: 315 }]);
  });

  it("každá sazba má vlastní řádek a řadí se vzestupně", () => {
    const t = computeTotals([
      polozka({ unit_price: 1000, vat_rate: 21 }),
      polozka({ unit_price: 500, vat_rate: 12 }),
      polozka({ unit_price: 100, vat_rate: 0 }),
    ]);
    expect(t.vat_breakdown.map((r) => r.rate)).toEqual([0, 12, 21]);
    expect(t.vat_breakdown).toEqual([
      { rate: 0, base: 100, vat: 0 },
      { rate: 12, base: 500, vat: 60 },
      { rate: 21, base: 1000, vat: 210 },
    ]);
    expect(t.vat_amount).toBe(270);
  });

  it("pořadí položek na faktuře nemění výsledné částky", () => {
    const a = computeTotals([polozka({ unit_price: 1000, vat_rate: 21 }), polozka({ unit_price: 500, vat_rate: 12 })]);
    const b = computeTotals([polozka({ unit_price: 500, vat_rate: 12 }), polozka({ unit_price: 1000, vat_rate: 21 })]);
    expect(b).toEqual(a);
  });
});

describe("zaokrouhlení dokladu na koruny", () => {
  it("halíře nad půl koruny jdou nahoru a doplněk se vykáže jako zaokrouhlení", () => {
    const t = computeTotals([polozka({ unit_price: 100.5, vat_rate: 0 })]);
    expect(t.total).toBe(100.5);
    expect(t.total_rounded).toBe(101);
    expect(t.rounding).toBe(0.5);
  });

  it("halíře pod půl koruny jdou dolů a zaokrouhlení je záporné", () => {
    const t = computeTotals([polozka({ unit_price: 100.49, vat_rate: 0 })]);
    expect(t.total_rounded).toBe(100);
    expect(t.rounding).toBe(-0.49);
  });

  it("celkem plus zaokrouhlení vždy dá zaokrouhlenou částku – tak to čte i tisk", () => {
    for (const cena of [1000, 100.49, 100.5, 999.99, 1234.56, 0.01]) {
      const t = computeTotals([polozka({ unit_price: cena, vat_rate: 21 })]);
      expect(Math.round((t.total + t.rounding) * 100) / 100).toBe(t.total_rounded);
    }
  });

  it("nulová faktura se nezaokrouhluje na zápornou nulu", () => {
    const t = computeTotals([polozka({ unit_price: 0 })]);
    expect(t.total_rounded).toBe(0);
    expect(Object.is(t.total_rounded, -0)).toBe(false);
    expect(t.rounding).toBe(0);
  });
});

describe("dobropis", () => {
  it("dobropis vyjde přesně jako faktura s opačným znaménkem, včetně zaokrouhlení", () => {
    const faktura = computeTotals([polozka({ unit_price: 100.5, vat_rate: 0 })]);
    const dobropis = computeTotals([polozka({ qty: -1, unit_price: 100.5, vat_rate: 0 })]);
    expect(dobropis.total).toBe(-faktura.total);
    expect(dobropis.total_rounded).toBe(-faktura.total_rounded);
    expect(dobropis.rounding).toBe(-faktura.rounding);
  });

  it("dobropis vrací i DPH, ne jen základ", () => {
    const t = computeTotals([polozka({ qty: -1, unit_price: 1000, vat_rate: 21 })]);
    expect(t.subtotal).toBe(-1000);
    expect(t.vat_amount).toBe(-210);
    expect(t.total).toBe(-1210);
    expect(t.vat_breakdown).toEqual([{ rate: 21, base: -1000, vat: -210 }]);
  });
});

describe("slevy a odečet zálohy", () => {
  it("sleva zapsaná záporným řádkem snižuje základ i DPH", () => {
    const t = computeTotals([
      polozka({ unit_price: 1000, vat_rate: 21 }),
      polozka({ name: "Sleva", qty: 1, unit_price: -100, vat_rate: 21 }),
    ]);
    expect(t.subtotal).toBe(900);
    expect(t.vat_amount).toBe(189);
    expect(t.total).toBe(1089);
  });

  it("odečet uhrazené zálohy po sazbách vynuluje celý doklad", () => {
    // Přesně to dělá „Vyúčtovat zálohu“: ke kopii položek přidá záporné
    // základy po sazbách. Kdyby odečet byl jedním řádkem se sazbou 0,
    // zůstala by na faktuře DPH k doplacení, kterou už zákazník zaplatil.
    const puvodni = [
      polozka({ unit_price: 1000, vat_rate: 21 }),
      polozka({ unit_price: 500, vat_rate: 12 }),
    ];
    const odecty = computeTotals(puvodni).vat_breakdown.map((r) =>
      polozka({ name: `Uhrazená záloha (základ DPH ${r.rate} %)`, unit_price: -r.base, vat_rate: r.rate }),
    );
    const t = computeTotals([...puvodni, ...odecty]);
    expect(t.subtotal).toBe(0);
    expect(t.vat_amount).toBe(0);
    expect(t.total).toBe(0);
    expect(t.total_rounded).toBe(0);
  });
});

describe("formátování částky", () => {
  it("české tisíce s pevnou mezerou, desetinná čárka a dva halíře", () => {
    expect(formatCurrency(1234.5)).toBe("1\u00A0234,50\u00A0Kč");
    expect(formatCurrency(0)).toBe("0,00\u00A0Kč");
  });

  it("záporná částka na dobropisu je vidět jako záporná", () => {
    expect(formatCurrency(-1210)).toBe("-1\u00A0210,00\u00A0Kč");
  });

  it("respektuje měnu dokladu, nepřipisuje Kč k euru", () => {
    expect(formatCurrency(99.9, "EUR")).toBe("99,90\u00A0€");
  });
});

describe("nová prázdná položka", () => {
  it("začíná na jednom kusu s nulovou cenou, aby se nedala omylem naúčtovat", () => {
    const p = emptyLineItem();
    expect(p.qty).toBe(1);
    expect(p.unit_price).toBe(0);
    expect(p.name).toBe("");
  });

  it("neplátci DPH nabídne nulovou sazbu, ne výchozích 21 %", () => {
    expect(emptyLineItem(0).vat_rate).toBe(0);
    expect(emptyLineItem(12).vat_rate).toBe(12);
    expect(emptyLineItem().vat_rate).toBe(21);
  });
});
