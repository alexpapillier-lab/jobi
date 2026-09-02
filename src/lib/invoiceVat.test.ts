/**
 * DPH na faktuře a na tištěném dokumentu.
 *
 * Tři chyby, které tenhle test hlídá:
 *  1. šablona četla inv_vat_amount, aplikace posílala jen inv_vat –
 *     na skutečné faktuře řádek s DPH vůbec nevyšel
 *  2. "DPH 21%" bylo v šabloně napevno, i u položky s jinou sazbou
 *  3. neplátci DPH vyjela rekapitulace s nulou místo poznámky
 */
import { describe, it, expect } from "vitest";
import { invoiceToJobiDocsVariables } from "./invoiceToJobiDocs";
import { emptyLineItem } from "./invoiceMath";
import { sazbaProNovouPolozku } from "../hooks/useServiceVat";

const faktura = {
  currency: "CZK",
  subtotal: 1000,
  vat_amount: 210,
  total: 1210,
  rounding: 0,
} as never;

const polozky = (sazby: number[]) =>
  sazby.map((r) => ({ name: "x", qty: 1, unit: "ks", unit_price: 100, vat_rate: r })) as never;

describe("proměnné faktury pro dokument", () => {
  it("posílá inv_vat_amount, které šablona skutečně čte", () => {
    const v = invoiceToJobiDocsVariables(faktura, polozky([21]));
    expect(v.inv_vat_amount).toBeTruthy();
    // staré jméno zůstává kvůli existujícím šablonám
    expect(v.inv_vat).toBe(v.inv_vat_amount);
  });

  it("vypisuje sazby, které se na faktuře opravdu vyskytly", () => {
    expect(invoiceToJobiDocsVariables(faktura, polozky([21])).inv_vat_rates).toBe("21%");
    expect(invoiceToJobiDocsVariables(faktura, polozky([12, 21])).inv_vat_rates).toBe("12%, 21%");
    // duplicity se slučují
    expect(invoiceToJobiDocsVariables(faktura, polozky([21, 21])).inv_vat_rates).toBe("21%");
  });

  it("označí neplátce DPH", () => {
    expect(invoiceToJobiDocsVariables(faktura, polozky([0]), false).inv_vat_payer).toBe("0");
    expect(invoiceToJobiDocsVariables(faktura, polozky([21]), true).inv_vat_payer).toBe("1");
    // bez uvedení se chováme jako dosud
    expect(invoiceToJobiDocsVariables(faktura, polozky([21])).inv_vat_payer).toBe("1");
  });
});

describe("sazba pro novou položku", () => {
  it("neplátce má vždy nulu, i když je sazba nastavená", () => {
    expect(sazbaProNovouPolozku({ vatPayer: false, defaultVatRate: 21 })).toBe(0);
  });

  it("plátce dostane svou sazbu, ne napevno 21", () => {
    expect(sazbaProNovouPolozku({ vatPayer: true, defaultVatRate: 12 })).toBe(12);
    expect(sazbaProNovouPolozku({ vatPayer: true, defaultVatRate: 21 })).toBe(21);
  });

  it("emptyLineItem sazbu přebírá", () => {
    expect(emptyLineItem(0).vat_rate).toBe(0);
    expect(emptyLineItem(12).vat_rate).toBe(12);
    // bez argumentu zůstává původní chování
    expect(emptyLineItem().vat_rate).toBe(21);
  });
});
