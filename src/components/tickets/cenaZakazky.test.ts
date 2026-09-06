/**
 * Konečná cena na kartě zakázky.
 *
 * Tohle číslo technik čte zákazníkovi u pultu, když si přichází pro
 * spravené zařízení. Když nesedí se slevou, kterou mu servis slíbil,
 * hádá se u pokladny. Když se sleva odečte dvakrát nebo vůbec, přijde
 * servis o peníze, nebo je vezme navíc.
 */
import { describe, it, expect } from "vitest";
import { computeFinalPrice, formatCZDate, formatPhone, type TicketCardData } from "./types";

const zakazka = (o: Partial<TicketCardData>): TicketCardData =>
  ({
    id: "z1",
    code: "2026-001",
    customerName: "Novák",
    deviceLabel: "iPhone 13",
    issueShort: "Rozbitý displej",
    createdAt: "2026-01-05T09:00:00Z",
    status: "in_progress",
    ...o,
  }) as TicketCardData;

describe("konečná cena zakázky", () => {
  it("bez oprav je cena nula, ne prázdno ani NaN", () => {
    expect(computeFinalPrice(zakazka({}))).toBe(0);
    expect(computeFinalPrice(zakazka({ performedRepairs: [] }))).toBe(0);
  });

  it("sečte ceny všech provedených oprav", () => {
    const t = zakazka({ performedRepairs: [{ name: "Displej", price: 2000 }, { name: "Baterie", price: 900 }] });
    expect(computeFinalPrice(t)).toBe(2900);
  });

  it("oprava bez vyplněné ceny se počítá jako nula, ne jako chyba", () => {
    const t = zakazka({ performedRepairs: [{ name: "Displej", price: 2000 }, { name: "Diagnostika" }] });
    expect(computeFinalPrice(t)).toBe(2000);
  });

  it("procentní sleva se počítá z ceny všech oprav dohromady", () => {
    const t = zakazka({
      performedRepairs: [{ name: "Displej", price: 2000 }, { name: "Baterie", price: 1000 }],
      discountType: "percentage",
      discountValue: 10,
    });
    expect(computeFinalPrice(t)).toBe(2700);
  });

  it("sleva pevnou částkou se odečte v korunách, ne v procentech", () => {
    const t = zakazka({
      performedRepairs: [{ name: "Displej", price: 2000 }],
      discountType: "amount",
      discountValue: 300,
    });
    expect(computeFinalPrice(t)).toBe(1700);
  });

  it("zapomenutá hodnota slevy bez zvoleného druhu cenu nesnižuje", () => {
    const t = zakazka({ performedRepairs: [{ name: "Displej", price: 2000 }], discountType: null, discountValue: 500 });
    expect(computeFinalPrice(t)).toBe(2000);
  });

  it("stoprocentní sleva znamená zdarma, ne zápornou cenu", () => {
    const t = zakazka({
      performedRepairs: [{ name: "Reklamace", price: 2000 }],
      discountType: "percentage",
      discountValue: 100,
    });
    expect(computeFinalPrice(t)).toBe(0);
  });

  it("sleva vyšší než cena oprav nedá zápornou cenu – servis by zákazníkovi doplácel", () => {
    const t = zakazka({
      performedRepairs: [{ name: "Displej", price: 1000 }],
      discountType: "amount",
      discountValue: 1500,
    });
    expect(computeFinalPrice(t)).toBe(0);
  });
});

describe("telefon na kartě zakázky", () => {
  it("české číslo se rozdělí po trojicích, ať se dá přečíst nahlas", () => {
    expect(formatPhone("777123456")).toBe("777 123 456");
  });

  it("číslo s předvolbou se ukáže s mezinárodní předvolbou a trojicemi", () => {
    expect(formatPhone("+420777123456")).toBe("+420 777 123 456");
    expect(formatPhone("420 777 123 456")).toBe("+420 777 123 456");
  });

  it("cizí nebo neúplné číslo se nechá, jak ho servis zapsal", () => {
    expect(formatPhone("+49 170 1234567")).toBe("+49 170 1234567");
    expect(formatPhone("12345")).toBe("12345");
    expect(formatPhone("")).toBe("");
  });
});

describe("datum na kartě zakázky", () => {
  it("nečitelné datum se vypíše, jak přišlo – nikdy ne NaN.NaN.NaN", () => {
    expect(formatCZDate("nesmysl")).toBe("nesmysl");
    expect(formatCZDate("")).toBe("");
  });

  it("datum se píše česky s mezerami, stejně jako na dokladech", () => {
    expect(formatCZDate("2026-01-05T12:00:00")).toBe("5. 1. 2026");
    expect(formatCZDate("2026-12-31T12:00:00")).toBe("31. 12. 2026");
  });
});
