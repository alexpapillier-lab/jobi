import { describe, it, expect } from "vitest";
import { soucetPolozek } from "./QuoteBuilder";
import type { QuoteItem } from "../../lib/portal";

const polozka = (o: Partial<QuoteItem>): QuoteItem => ({ id: "p1", name: "Oprava", ...o });

/**
 * Součet cenové nabídky.
 *
 * Tohle číslo vidí zákazník v portálu a odsouhlasí ho; podle něj se pak
 * vystaví faktura. Když je vyšší, servis se hádá o cenu, kterou zákazník
 * neschválil. Když z něj vypadne „NaN Kč“, nabídka se nedá odeslat vůbec.
 */
describe("součet položek cenové nabídky", () => {
  it("prázdná nabídka stojí nula, ne prázdno", () => {
    expect(soucetPolozek([])).toBe(0);
  });

  it("sečte ceny všech položek nabídky", () => {
    expect(
      soucetPolozek([
        polozka({ id: "a", name: "Displej", price: 2490 }),
        polozka({ id: "b", name: "Baterie", price: 890 }),
        polozka({ id: "c", name: "Práce", price: 500 }),
      ])
    ).toBe(3880);
  });

  it("položka bez vyplněné ceny se počítá jako nula a nesmaže součet ostatních", () => {
    expect(
      soucetPolozek([
        polozka({ id: "a", name: "Displej", price: 2490 }),
        polozka({ id: "b", name: "Diagnostika" }),
      ])
    ).toBe(2490);
  });

  it("cena zapsaná jako text se sečte jako číslo, ne slepí do řetězce", () => {
    const zFormulare = [
      polozka({ id: "a", price: "1500" as unknown as number }),
      polozka({ id: "b", price: "500" as unknown as number }),
    ];
    expect(soucetPolozek(zFormulare)).toBe(2000);
  });

  it("nečíselná cena se počítá jako nula – zákazník nesmí v portálu vidět NaN", () => {
    const rozbite = [
      polozka({ id: "a", name: "Displej", price: 2000 }),
      polozka({ id: "b", name: "Překlep", price: "dva tisíce" as unknown as number }),
      polozka({ id: "c", name: "Chybí", price: null as unknown as number }),
    ];
    const soucet = soucetPolozek(rozbite);
    expect(Number.isNaN(soucet)).toBe(false);
    expect(soucet).toBe(2000);
  });

  it("záporná položka (sleva zapsaná do nabídky) součet sníží", () => {
    expect(
      soucetPolozek([
        polozka({ id: "a", name: "Displej", price: 2000 }),
        polozka({ id: "b", name: "Sleva stálému zákazníkovi", price: -300 }),
      ])
    ).toBe(1700);
  });

  it("haléřové ceny se sečtou přesně na dvě desetinná místa", () => {
    expect(soucetPolozek([polozka({ id: "a", price: 100.5 }), polozka({ id: "b", price: 200.25 })])).toBeCloseTo(300.75, 2);
  });

  it("dlouhá nabídka s desítkami položek se sečte celá", () => {
    const mnoho = Array.from({ length: 100 }, (_, i) => polozka({ id: `p${i}`, name: `Oprava ${i}`, price: 999 }));
    expect(soucetPolozek(mnoho)).toBe(99_900);
  });

  it("hodinová práce jde do součtu jako hotová částka, hodiny se znovu nenásobí", () => {
    const hodinovka = polozka({ id: "h", name: "Práce technika", type: "hourly", hodiny: 2.5, sazba: 600, price: 1500 });
    expect(soucetPolozek([hodinovka])).toBe(1500);
  });
});
