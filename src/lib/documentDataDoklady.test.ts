/**
 * Podklady, ze kterých vzniká papír v ruce zákazníka.
 *
 * Tenhle modul stojí mezi databází a JobiDocs: co sem propadne špatně, to
 * si zákazník přečte na zakázkovém listu, záručním listu, příjemce
 * reklamace nebo na faktuře. Testy proto sledují, co se dostane na doklad
 * a co se z něj má naopak ztratit – ne jak je kód napsaný.
 */
import { describe, expect, it } from "vitest";
import { claimDocumentData, invoiceDocumentData, nadpisDokladu, pridejMesice, serviceParty, ticketDocumentData } from "./documentData";
import type { TicketEx } from "../pages/Orders";
import type { WarrantyClaimRow } from "../pages/Orders/hooks/useWarrantyClaims";
import type { CompanyData } from "./companyData";

const zakazka = (extra: Partial<TicketEx> = {}): TicketEx =>
  ({ id: "t1", code: "Z26000001", customerName: "Jan Novák", deviceLabel: "iPhone 13", createdAt: "2026-09-01T10:00:00.000Z", status: "received", ...extra }) as unknown as TicketEx;

const reklamace = (extra: Record<string, unknown> = {}): WarrantyClaimRow =>
  ({ id: "r1", code: "R26000012", created_at: "2026-09-01T10:00:00.000Z", ...extra }) as unknown as WarrantyClaimRow;

const firma = (extra: Partial<CompanyData> = {}): CompanyData => ({ name: "Servis Novák", ico: "12345678", ...extra }) as CompanyData;

const faktura = (extra: Record<string, unknown> = {}) =>
  ({
    number: "FV2026-0042",
    kind: "invoice",
    currency: "CZK",
    issue_date: "2026-09-03",
    due_date: "2026-09-17",
    taxable_date: "2026-09-03",
    subtotal: 1000,
    vat_amount: 210,
    total: 1210,
    rounding: 0,
    variable_symbol: "20260042",
    ...extra,
  }) as never;

// Servis tiskne i zakázku, do které nikdo nic nedopsal. Prázdný údaj se má
// na dokladu ztratit – ne se objevit jako „undefined“ nebo osamocená čárka.
describe("zakázka s dírami v datech", () => {
  it("zakázka bez oprav nemá na dokladu ani jednu položku a žádnou celkovou cenu", () => {
    const d = ticketDocumentData(zakazka(), {});
    expect(d.items).toEqual([]);
    expect(d.totals?.total).toBeUndefined();
  });

  it("oprava bez ceny se na doklad dostane, ale celková cena se nevytiskne", () => {
    const d = ticketDocumentData(zakazka({ performedRepairs: [{ id: "a", name: "Výměna displeje", type: "manual" }] } as Partial<TicketEx>), {});
    expect(d.items?.[0]).toMatchObject({ name: "Výměna displeje", qty: 1, unit: "ks" });
    expect(d.items?.[0].total).toBeUndefined();
    expect(d.totals?.total).toBeUndefined();
  });

  it("oprava bez názvu se na doklad vůbec nedostane – prázdná odrážka mate", () => {
    const d = ticketDocumentData(zakazka({ performedRepairs: [{ id: "a", name: "   ", type: "manual", price: 500 }, { id: "b", name: "Displej", type: "manual", price: 1000 }] } as Partial<TicketEx>), {});
    expect(d.items?.map((i) => i.name)).toEqual(["Displej"]);
  });

  it("chybějící zákazník, sériové číslo a poznámky zůstanou nevyplněné", () => {
    const d = ticketDocumentData(zakazka({ customerName: undefined, deviceLabel: undefined }), {});
    expect(d.customer?.name).toBeUndefined();
    expect(d.customer?.phone).toBeUndefined();
    expect(d.device?.name).toBeUndefined();
    expect(d.device?.serial).toBeUndefined();
    expect(d.note).toBeUndefined();
  });

  it("mezery místo jména se berou jako nevyplněné, ne jako jméno", () => {
    const d = ticketDocumentData(zakazka({ customerName: "   ", serialOrImei: "  " }), {});
    expect(d.customer?.name).toBeUndefined();
    expect(d.device?.serial).toBeUndefined();
  });

  it("prázdné firemní údaje nevytisknou hlavičku servisu s prázdným názvem", () => {
    const p = serviceParty({ name: "  ", ico: "", addressStreet: "", addressCity: "", addressZip: "" });
    expect(p.name).toBeUndefined();
    expect(p.ico).toBeUndefined();
    expect(p.address).toBeUndefined();
  });

  it("adresa servisu se poskládá bez čárek navíc, i když část chybí", () => {
    expect(serviceParty({ addressStreet: "Dlouhá 5", addressZip: "110 00", addressCity: "Praha" }).address).toBe("Dlouhá 5, 110 00 Praha");
    expect(serviceParty({ addressStreet: "Dlouhá 5" }).address).toBe("Dlouhá 5");
    expect(serviceParty({ addressCity: "Praha" }).address).toBe("Praha");
  });

  it("web servisu se na doklad tiskne bez https://", () => {
    expect(serviceParty({ website: "https://servis.iswap.cz" }).web).toBe("servis.iswap.cz");
  });
});

// Záruční list bez správného „do kdy“ je pro zákazníka bezcenný a pro
// servis nebezpečný – reklamaci by pak uznával podle špatného data.
describe("konec záruky", () => {
  it("počítá se z data dokončení opravy, ne z data přijetí zakázky", () => {
    const d = ticketDocumentData(zakazka(), {}, { completedAt: "2026-09-03T12:00:00.000Z", warrantyMonths: 12 });
    expect(d.warranty?.months).toBe(12);
    expect(d.warranty?.until?.slice(0, 10)).toBe("2027-09-03");
  });

  it("záruka sjednaná na podzim přeteče do dalšího roku", () => {
    const d = ticketDocumentData(zakazka(), {}, { completedAt: "2026-11-20T12:00:00.000Z", warrantyMonths: 3 });
    expect(d.warranty?.until?.slice(0, 10)).toBe("2027-02-20");
  });

  it("záruka z 31. prosince končí posledním únorovým dnem, ne 3. března", () => {
    const konec = pridejMesice(new Date(2026, 11, 31), 2);
    expect([konec.getFullYear(), konec.getMonth(), konec.getDate()]).toEqual([2027, 1, 28]);
  });

  it("záruka z 29. února v přestupném roce končí 28. února", () => {
    const konec = pridejMesice(new Date(2024, 1, 29), 12);
    expect([konec.getFullYear(), konec.getMonth(), konec.getDate()]).toEqual([2025, 1, 28]);
  });

  it("bez data dokončení se vytiskne délka záruky, ale žádné datum", () => {
    const d = ticketDocumentData(zakazka(), {}, { warrantyMonths: 12 });
    expect(d.warranty?.months).toBe(12);
    expect(d.warranty?.until).toBeUndefined();
  });

  it("bez sjednané záruky se blok záruky na doklad nedostane vůbec", () => {
    expect(ticketDocumentData(zakazka(), {}, { completedAt: "2026-09-03T12:00:00.000Z" }).warranty).toBeUndefined();
  });
});

// Sleva se na doklad tiskne jako samostatný řádek. Když se do dat dostane
// sleva, která se nemá odečítat, zákazník uvidí slevu a zaplatí plnou cenu.
describe("sleva zakázky", () => {
  const sOpravou = (extra: Partial<TicketEx>) =>
    ticketDocumentData(zakazka({ performedRepairs: [{ id: "a", name: "Displej", type: "manual", price: 1000 }], ...extra } as Partial<TicketEx>), {});

  it("sleva se propíše i jako samostatný řádek, aby ji zákazník na dokladu viděl", () => {
    expect(sOpravou({ discountType: "percentage", discountValue: 10 }).discount).toEqual({ type: "percentage", value: 10 });
  });

  it("nulová sleva se na doklad nedostane jako prázdný řádek", () => {
    const d = sOpravou({ discountType: "percentage", discountValue: 0 });
    expect(d.discount).toBeUndefined();
    expect(d.totals?.total).toBe(1000);
  });

  it("hodnota slevy bez zvoleného typu se ignoruje", () => {
    const d = sOpravou({ discountType: null, discountValue: 500 });
    expect(d.discount).toBeUndefined();
    expect(d.totals?.total).toBe(1000);
  });

  it("procentní sleva vyšší než sto procent nevytiskne zápornou cenu", () => {
    expect(sOpravou({ discountType: "percentage", discountValue: 150 }).totals?.total).toBe(0);
  });
});

// Příjemka reklamace je potvrzení, že servis zařízení převzal. Musí na ní
// být, co zákazník přinesl a kdy – i když se reklamace teprve zakládá.
describe("příjemka a výdejka reklamace", () => {
  it("reklamace bez vyřízení nemá položky ani poznámku", () => {
    const d = claimDocumentData(reklamace(), firma());
    expect(d.items).toEqual([]);
    expect(d.note).toBeUndefined();
  });

  it("uložené položky vyřízení se rozpadnou na řádky s cenou", () => {
    const d = claimDocumentData(reklamace({ resolution_summary: JSON.stringify([{ name: "Výměna displeje", price: 1500 }, { name: "Kontrola", price: 0 }]) }), firma());
    expect(d.items?.map((i) => i.name)).toEqual(["Výměna displeje", "Kontrola"]);
    expect(d.items?.[0]).toMatchObject({ qty: 1, unit: "ks", total: 1500 });
    expect(d.note).toBeUndefined();
  });

  it("psaný závěr reklamace se vytiskne jako poznámka, ne jako položka", () => {
    const d = claimDocumentData(reklamace({ resolution_summary: "Reklamace uznána, displej vyměněn." }), firma());
    expect(d.items).toEqual([]);
    expect(d.note).toBe("Reklamace uznána, displej vyměněn.");
  });

  it("na příjemce je datum převzetí, ne datum založení záznamu", () => {
    const d = claimDocumentData(reklamace({ received_at: "2026-09-05T08:00:00.000Z" }), firma());
    expect(d.dates?.received).toBe("2026-09-05T08:00:00.000Z");
  });

  it("bez data převzetí se použije datum založení, aby doklad nebyl bez data", () => {
    expect(claimDocumentData(reklamace(), firma()).dates?.received).toBe("2026-09-01T10:00:00.000Z");
  });

  it("adresa zákazníka se poskládá bez čárek navíc", () => {
    const d = claimDocumentData(reklamace({ customer_address_street: "Havlíčkova 45", customer_address_city: "Praha", customer_address_zip: "110 00" }), firma());
    expect(d.customer?.address).toBe("Havlíčkova 45, 110 00 Praha");
    expect(claimDocumentData(reklamace(), firma()).customer?.address).toBeUndefined();
  });

  it("na příjemce je vidět číslo původní zakázky, ať zákazník ví, čeho se reklamace týká", () => {
    expect(claimDocumentData(reklamace(), firma(), "Z26000001").relatedNumber).toBe("Z26000001");
    expect(claimDocumentData(reklamace(), firma()).relatedNumber).toBeUndefined();
  });
});

// Na faktuře rozhoduje o slovech i o QR kódu druh dokladu. Napsat
// „daňový doklad“ jako neplátce DPH je chyba, kterou řeší finanční úřad.
describe("faktura, záloha a dobropis", () => {
  it("neplátce DPH nesmí mít na faktuře napsáno „daňový doklad“", () => {
    expect(nadpisDokladu("invoice", false)).toBe("Faktura");
    expect(nadpisDokladu("invoice", true)).toBe("Faktura – daňový doklad");
  });

  it("záloha a dobropis se jmenují podle druhu, ne „Faktura“", () => {
    expect(nadpisDokladu("proforma", true)).toBe("Zálohová faktura");
    expect(nadpisDokladu("credit_note", true)).toBe("Dobropis");
  });

  it("zálohová faktura nemá datum zdanitelného plnění – není zdanitelné plnění", () => {
    const d = invoiceDocumentData(faktura({ kind: "proforma" }), [], firma());
    expect(d.dates?.taxable).toBeUndefined();
    expect(d.dates?.issued).toBe("2026-09-03");
  });

  it("dobropis nese vazbu na původní fakturu, i když si servis poznámku přepsal", () => {
    const d = invoiceDocumentData(faktura({ kind: "credit_note", total: -1210, notes: "Vráceno v hotovosti." }), [], firma(), true, undefined, "FV2026-0001");
    expect(d.note).toContain("Dobropis k faktuře FV2026-0001");
    expect(d.note).toContain("Vráceno v hotovosti.");
  });

  it("vazba na fakturu se nezdvojí, když ji servis do poznámky napsal sám", () => {
    const d = invoiceDocumentData(faktura({ kind: "credit_note", total: -1210, notes: "Dobropis k faktuře FV2026-0001 – vráceno." }), [], firma(), true, undefined, "FV2026-0001");
    expect(d.note?.match(/FV2026-0001/g)?.length).toBe(1);
  });

  it("na dobropis se QR platba netiskne – zákazník ho neplatí", () => {
    const d = invoiceDocumentData(faktura({ kind: "credit_note", total: -1210 }), [], firma({ iban: "CZ6508000000192000145399" }));
    expect(d.payment?.spayd).toBeUndefined();
  });

  it("QR platba nese částku i variabilní symbol z dokladu", () => {
    const d = invoiceDocumentData(faktura(), [], firma({ iban: "CZ65 0800 0000 1920 0014 5399" }));
    expect(d.payment?.spayd).toContain("AM:1210.00");
    expect(d.payment?.spayd).toContain("X-VS:20260042");
    expect(d.payment?.spayd).toContain("ACC:CZ6508000000192000145399");
  });

  it("IBAN pro QR platbu se odvodí z čísla účtu, když ho servis nevyplnil", () => {
    const d = invoiceDocumentData(faktura(), [], firma({ bankAccount: "19-2000145399/0800" }));
    expect(d.payment?.spayd).toContain("ACC:CZ6508000000192000145399");
  });

  it("bez účtu i bez IBANu se QR kód nevyrobí, místo nefunkčního", () => {
    expect(invoiceDocumentData(faktura(), [], firma()).payment?.spayd).toBeUndefined();
  });

  it("položky se na doklad tisknou v pořadí, ve kterém je servis zapsal", () => {
    const polozky = [
      { name: "Práce", qty: 1, unit: "h", unit_price: 600, vat_rate: 21, line_total: 600, sort_order: 2 },
      { name: "Displej", qty: 1, unit: "ks", unit_price: 5990, vat_rate: 21, line_total: 5990, sort_order: 1 },
    ] as never;
    const d = invoiceDocumentData(faktura(), polozky, firma());
    expect(d.items?.map((i) => i.name)).toEqual(["Displej", "Práce"]);
  });

  it("údaje dodavatele z faktury mají přednost před aktuálními firemními údaji", () => {
    const d = invoiceDocumentData(faktura({ supplier_name: "Servis Novák (starý název)", supplier_ico: "87654321" }), [], firma());
    expect(d.service.name).toBe("Servis Novák (starý název)");
    expect(d.service.ico).toBe("87654321");
  });
});
