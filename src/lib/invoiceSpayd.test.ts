/**
 * QR platba na faktuře (řetězec SPAYD).
 *
 * Zákazník si QR kód načte v mobilní bance a odešle přesně to, co v něm je.
 * Když se do částky dostane čárka místo tečky nebo z IBANu vypadne kus,
 * banka platbu nenačte a zákazník volá do servisu. Když v kódu chybí
 * variabilní symbol, přijdou peníze bez identifikace a nikdo neví,
 * která faktura je zaplacená.
 */
import { describe, it, expect } from "vitest";
import { invoiceToJobiDocsVariables } from "./invoiceToJobiDocs";

const doklad = (o: Record<string, unknown> = {}) =>
  ({
    number: "FV2026-0042",
    variable_symbol: "20260042",
    currency: "CZK",
    subtotal: 1000,
    vat_amount: 210,
    total: 1210,
    rounding: 0,
    supplier_iban: "CZ6508000000192000145399",
    ...o,
  }) as never;

const bezPolozek = [] as never;

/** Rozebere SPAYD na dvojice klíč:hodnota. */
const casti = (spayd: string) => {
  const out: Record<string, string> = {};
  for (const p of spayd.split("*").slice(2)) {
    const i = p.indexOf(":");
    if (i > 0) out[p.slice(0, i)] = p.slice(i + 1);
  }
  return out;
};

describe("QR platba na faktuře", () => {
  it("bez čísla účtu se QR platba netiskne vůbec, místo prázdného kódu", () => {
    expect(invoiceToJobiDocsVariables(doklad({ supplier_iban: null }), bezPolozek).inv_spayd_qr).toBe("");
    expect(invoiceToJobiDocsVariables(doklad({ supplier_iban: "" }), bezPolozek).inv_spayd_qr).toBe("");
    expect(invoiceToJobiDocsVariables(doklad({ supplier_iban: "   " }), bezPolozek).inv_spayd_qr).toBe("");
  });

  it("začíná hlavičkou SPD*1.0, jinak ji banka nepozná", () => {
    expect(invoiceToJobiDocsVariables(doklad(), bezPolozek).inv_spayd_qr.startsWith("SPD*1.0*")).toBe(true);
  });

  it("z IBANu zmizí mezery, se kterými ho lidé opisují", () => {
    const s = invoiceToJobiDocsVariables(doklad({ supplier_iban: "CZ65 0800 0000 1920 0014 5399" }), bezPolozek).inv_spayd_qr;
    expect(casti(s).ACC).toBe("CZ6508000000192000145399");
  });

  it("částka má vždy dvě desetinná místa a desetinnou tečku, ne českou čárku", () => {
    expect(casti(invoiceToJobiDocsVariables(doklad({ total: 1210 }), bezPolozek).inv_spayd_qr).AM).toBe("1210.00");
    expect(casti(invoiceToJobiDocsVariables(doklad({ total: 1209.5 }), bezPolozek).inv_spayd_qr).AM).toBe("1209.50");
  });

  it("na nulový doklad a na dobropis se QR kód netiskne", () => {
    // Záporná částka ve SPAYD není platná a banka takový kód odmítne;
    // dobropis se navíc neplatí, peníze jdou opačným směrem.
    expect(invoiceToJobiDocsVariables(doklad({ total: 0 }), bezPolozek).inv_spayd_qr).toBe("");
    expect(invoiceToJobiDocsVariables(doklad({ total: -1210, kind: "credit_note" }), bezPolozek).inv_spayd_qr).toBe("");
  });

  it("doklad bez částky nesloží QR kód – a hlavně kvůli němu nespadne celý tisk", () => {
    /*
     * `undefined <= 0` je `false`, takže chybějící částka propadla až
     * k `toFixed` a shodila `TypeError`. Nešlo přitom jen o QR kód: proměnné
     * pro doklad se skládají tímhle jedním voláním, takže se nevytiskla celá
     * faktura. Stejně tak `NaN`, které se do součtu dostane z rozbité sazby.
     */
    expect(invoiceToJobiDocsVariables(doklad({ total: undefined }), bezPolozek).inv_spayd_qr).toBe("");
    expect(invoiceToJobiDocsVariables(doklad({ total: null }), bezPolozek).inv_spayd_qr).toBe("");
    expect(invoiceToJobiDocsVariables(doklad({ total: NaN }), bezPolozek).inv_spayd_qr).toBe("");
  });

  it("v QR je stejná částka, jakou má zákazník na dokladu zaplatit", () => {
    const inv = doklad({ total: 1234.5, currency: "CZK" });
    const v = invoiceToJobiDocsVariables(inv, bezPolozek);
    expect(v.inv_total).toBe("1\u00A0234,50\u00A0Kč");
    expect(casti(v.inv_spayd_qr).AM).toBe("1234.50");
  });

  it("platí se v měně dokladu, ne vždycky v korunách", () => {
    expect(casti(invoiceToJobiDocsVariables(doklad({ currency: "EUR" }), bezPolozek).inv_spayd_qr).CC).toBe("EUR");
    expect(casti(invoiceToJobiDocsVariables(doklad({ currency: "CZK" }), bezPolozek).inv_spayd_qr).CC).toBe("CZK");
  });

  it("nese variabilní symbol, aby servis platbu spároval s fakturou", () => {
    expect(casti(invoiceToJobiDocsVariables(doklad(), bezPolozek).inv_spayd_qr)["X-VS"]).toBe("20260042");
  });

  it("bez variabilního symbolu se do kódu nepíše prázdné pole", () => {
    const s = invoiceToJobiDocsVariables(doklad({ variable_symbol: null }), bezPolozek).inv_spayd_qr;
    expect(s).not.toContain("X-VS");
    expect(s.split("*").every((p) => p === "SPD" || p === "1.0" || p.split(":")[1]?.length > 0)).toBe(true);
  });

  it("do zprávy pro příjemce dá číslo dokladu, ať zákazník pozná, co platí", () => {
    expect(casti(invoiceToJobiDocsVariables(doklad(), bezPolozek).inv_spayd_qr).MSG).toBe("Faktura FV2026-0042");
  });
});
