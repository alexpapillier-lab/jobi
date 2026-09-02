/**
 * Přepočet cen s DPH ve veřejném API.
 *
 * Testuje se odsud, protože edge funkce běží v Denu a vlastní testy nemá.
 * Soubor ceny.ts je proto záměrně bez Deno API.
 */
import { describe, it, expect } from "vitest";
import { cenoveVarianty } from "../../supabase/functions/public-catalog/ceny";

describe("cenoveVarianty", () => {
  it("ceny zadané včetně DPH rozpočítá dolů", () => {
    // 2420 s 21 % → základ 2000
    expect(cenoveVarianty(2420, 21, true, true)).toEqual({
      price: 2420, price_incl_vat: 2420, price_excl_vat: 2000,
    });
  });

  it("ceny zadané bez DPH dopočítá nahoru", () => {
    expect(cenoveVarianty(2000, 21, false, true)).toEqual({
      price: 2000, price_incl_vat: 2420, price_excl_vat: 2000,
    });
  });

  it("neplátci nechá cenu být ve všech třech polích", () => {
    expect(cenoveVarianty(1500, 21, true, false)).toEqual({
      price: 1500, price_incl_vat: 1500, price_excl_vat: 1500,
    });
  });

  it("nulová sazba se chová jako neplátce", () => {
    expect(cenoveVarianty(999, 0, true, true)).toEqual({
      price: 999, price_incl_vat: 999, price_excl_vat: 999,
    });
  });

  it("zaokrouhluje na haléře, ne na hrubé číslo", () => {
    // 1000 / 1.21 = 826,446… → 826,45
    expect(cenoveVarianty(1000, 21, true, true).price_excl_vat).toBe(826.45);
    // 826,45 * 1.12 = 925,624 → 925,62
    expect(cenoveVarianty(826.45, 12, false, true).price_incl_vat).toBe(925.62);
  });

  it("jiná sazba než 21 % se opravdu použije", () => {
    expect(cenoveVarianty(1120, 12, true, true).price_excl_vat).toBe(1000);
  });

  it("nesmyslnou sazbu nespočítá do NaN", () => {
    expect(cenoveVarianty(500, Number.NaN, true, true)).toEqual({
      price: 500, price_incl_vat: 500, price_excl_vat: 500,
    });
  });
});
