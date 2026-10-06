import { describe, it, expect } from "vitest";
import {
  LHUTA_VYRIZENI_DNI,
  STAV_PREVEDENO,
  chybyReklamace,
  diagnostikaZReklamace,
  duvodBlokace,
  fotkyReklamace,
  jeKonceptRozepsany,
  komentareProPrevod,
  konceptNaReklamaci,
  lzePrevestNaZakazku,
  nactiKoncept,
  odpojZdroj,
  predvyplnZeZakazky,
  reklamaceNaZakazku,
  reklamovaneOpravyReklamace,
  vychoziKoncept,
  vychoziTerminVyrizeni,
  type ZakazkaProReklamaci,
} from "./reklamacePrijem";
import type { WarrantyClaimRow } from "../pages/Orders/hooks/useWarrantyClaims";

const zakazka = (o: Partial<ZakazkaProReklamaci> = {}): ZakazkaProReklamaci => ({
  id: "t-1",
  code: "SRV26000042",
  customerId: "c-1",
  customerName: "Jan Novák",
  customerPhone: "+420777123456",
  customerEmail: "jan@example.cz",
  customerAddressStreet: "Dlouhá 12",
  customerAddressCity: "Praha",
  customerAddressZip: "110 00",
  customerCompany: "",
  customerIco: "",
  customerInfo: "Volá odpoledne",
  deviceLabel: "iPhone 13",
  serialOrImei: "356789012345678",
  devicePasscode: "1234",
  branchId: "b-1",
  warrantyUntil: "2027-09-01",
  performedRepairs: [
    { id: "r-1", name: "Výměna displeje", price: 3500 },
    { id: "r-2", name: "Výměna baterie", price: 1200 },
  ],
  ...o,
});

const reklamace = (o: Partial<WarrantyClaimRow> = {}): WarrantyClaimRow => ({
  id: "w-1",
  service_id: "s-1",
  branch_id: "b-1",
  source_ticket_id: "t-1",
  code: "R26000007",
  status: "received",
  notes: "Displej po týdnu bliká",
  resolution_summary: null,
  received_at: "2026-10-01T09:00:00.000Z",
  released_at: null,
  created_at: "2026-10-01T09:00:00.000Z",
  updated_at: null,
  customer_id: "c-1",
  customer_name: "Jan Novák",
  customer_phone: "+420777123456",
  customer_email: "jan@example.cz",
  customer_address_street: "Dlouhá 12",
  customer_address_city: "Praha",
  customer_address_zip: "110 00",
  customer_address_country: null,
  customer_company: null,
  customer_ico: null,
  customer_info: null,
  device_condition: "Oděrky na rámečku",
  device_accessories: "Pouzdro",
  device_note: "Zálohovat fotky",
  device_label: "iPhone 13",
  device_brand: null,
  device_model: null,
  device_serial: "356789012345678",
  device_imei: null,
  device_passcode: "1234",
  expected_completion_at: null,
  completed_at: null,
  claimed_repairs: [{ id: "r-1", name: "Výměna displeje", price: 3500 }],
  intake_photos: ["https://x.supabase.co/storage/v1/object/public/diagnostic-photos/s-1/w-1/a.jpg"],
  handoff_method: "Poštou",
  converted_ticket_id: null,
  converted_at: null,
  ...o,
});

describe("předvyplnění ze zdrojové zakázky", () => {
  it("převezme zákazníka, zařízení, SN, heslo a pobočku a zapamatuje si záruku i opravy", () => {
    const k = predvyplnZeZakazky(vychoziKoncept("Osobně"), zakazka());
    expect(k.customerId).toBe("c-1");
    expect(k.customerName).toBe("Jan Novák");
    expect(k.customerPhone).toBe("+420777123456");
    expect(k.addressZip).toBe("11000");
    expect(k.deviceLabel).toBe("iPhone 13");
    expect(k.serialOrImei).toBe("356789012345678");
    expect(k.devicePasscode).toBe("1234");
    expect(k.branchId).toBe("b-1");
    expect(k.zdroj?.kod).toBe("SRV26000042");
    expect(k.zdroj?.zarukaDo).toBe("2027-09-01");
    expect(k.zdroj?.opravy.map((o) => o.name)).toEqual(["Výměna displeje", "Výměna baterie"]);
    expect(k.handoffMethod).toBe("Osobně");
  });

  it("víc oprav nezaškrtne nic, jediná oprava se zaškrtne sama", () => {
    expect(predvyplnZeZakazky(vychoziKoncept(), zakazka()).reklamovaneOpravy).toEqual([]);
    const jedna = predvyplnZeZakazky(vychoziKoncept(), zakazka({ performedRepairs: [{ id: "r-9", name: "Čištění" }] }));
    expect(jedna.reklamovaneOpravy).toEqual(["r-9"]);
  });

  it("popis závady, poznámka a fotky z rozepsané reklamace zůstanou; stav a příslušenství se nepřebírají", () => {
    const rozepsana = { ...vychoziKoncept(), popisZavady: "Nejde nabíjet", poznamkaTechnik: "Spěchá", fotky: ["data:image/png;base64,AA"], deviceCondition: "Prasklé sklo" };
    const k = predvyplnZeZakazky(rozepsana, zakazka());
    expect(k.popisZavady).toBe("Nejde nabíjet");
    expect(k.poznamkaTechnik).toBe("Spěchá");
    expect(k.fotky).toHaveLength(1);
    expect(k.deviceCondition).toBe("Prasklé sklo");
  });

  it("opravy bez názvu se nenabízí a bez id dostanou náhradní", () => {
    const k = predvyplnZeZakazky(vychoziKoncept(), zakazka({ performedRepairs: [{ name: "  " }, { id: null, name: "Kontrola" }] }));
    expect(k.zdroj?.opravy).toEqual([{ id: "oprava-1", name: "Kontrola" }]);
  });

  it("odpojení zdroje nechá vyplněné údaje a zruší zaškrtnuté opravy", () => {
    const k = odpojZdroj(predvyplnZeZakazky(vychoziKoncept(), zakazka({ performedRepairs: [{ id: "r-1", name: "A" }] })));
    expect(k.zdroj).toBeNull();
    expect(k.reklamovaneOpravy).toEqual([]);
    expect(k.customerName).toBe("Jan Novák");
  });
});

describe("povinná pole", () => {
  const vyplneny = () => ({ ...vychoziKoncept(), deviceLabel: "Tablet", popisZavady: "Nejde zapnout", customerPhone: "+420777123456" });

  it("vyplněná reklamace projde", () => {
    expect(chybyReklamace(vyplneny(), { telefonPovinny: true })).toEqual({});
    expect(duvodBlokace({})).toBeNull();
  });

  it("chybí popis závady → blokuje s důvodem", () => {
    const e = chybyReklamace({ ...vyplneny(), popisZavady: "  " }, { telefonPovinny: false });
    expect(Object.keys(e)).toEqual(["popisZavady"]);
    expect(duvodBlokace(e)).toBe("Chybí popis závady");
  });

  it("telefon podle nastavení povinných polí zakázky", () => {
    const bez = { ...vyplneny(), customerPhone: "" };
    expect(duvodBlokace(chybyReklamace(bez, { telefonPovinny: true }))).toBe("Chybí telefon");
    expect(chybyReklamace(bez, { telefonPovinny: false })).toEqual({});
  });

  it("zařízení je povinné jako u zakázky a formáty se hlídají stejně", () => {
    expect(duvodBlokace(chybyReklamace({ ...vyplneny(), deviceLabel: "" }, { telefonPovinny: false }))).toBe("Chybí zařízení");
    const e = chybyReklamace({ ...vyplneny(), customerEmail: "spatne", addressZip: "12", ico: "123" }, { telefonPovinny: false });
    expect(Object.keys(e).sort()).toEqual(["addressZip", "customerEmail", "ico"]);
    expect(duvodBlokace(e)).toBe("Neplatný e-mail");
    expect(duvodBlokace(chybyReklamace({ ...vyplneny(), customerPhone: "12" }, { telefonPovinny: true }))).toBe("Neplatný telefon");
  });
});

describe("koncept v localStorage", () => {
  it("prázdný koncept není rozepsaný, výchozí převzetí se nepočítá", () => {
    expect(jeKonceptRozepsany(vychoziKoncept("Osobně"))).toBe(false);
    expect(jeKonceptRozepsany({ ...vychoziKoncept(), popisZavady: "x" })).toBe(true);
    expect(jeKonceptRozepsany({ ...vychoziKoncept(), bezZakazky: true })).toBe(true);
  });

  it("starší / poškozené uložení se doplní na úplný koncept", () => {
    expect(nactiKoncept(null)).toBeNull();
    const k = nactiKoncept({ customerName: "Eva", fotky: ["a", 3], zdroj: { ticketId: "t-1", kod: "X" } }, "Osobně");
    expect(k?.customerName).toBe("Eva");
    expect(k?.fotky).toEqual(["a"]);
    expect(k?.zdroj?.opravy).toEqual([]);
    expect(k?.handoffMethod).toBe("Osobně");
    expect(k?.popisZavady).toBe("");
  });
});

describe("koncept → řádek reklamace", () => {
  const prijato = new Date("2026-10-06T08:00:00.000Z");

  it("uloží jen zaškrtnuté opravy, popis do notes a poznámku pro technika do device_note", () => {
    const k = { ...predvyplnZeZakazky(vychoziKoncept(), zakazka()), reklamovaneOpravy: ["r-2"], popisZavady: " Baterie drží hodinu ", poznamkaTechnik: "Zálohovat" };
    const r = konceptNaReklamaci(k, prijato);
    expect(r.source_ticket_id).toBe("t-1");
    expect(r.notes).toBe("Baterie drží hodinu");
    expect(r.device_note).toBe("Zálohovat");
    expect(r.claimed_repairs).toEqual([{ id: "r-2", name: "Výměna baterie", price: 1200 }]);
    expect(r.branch_id).toBe("b-1");
    expect(r.customer_id).toBe("c-1");
    expect(r.received_at).toBe(prijato.toISOString());
  });

  it("bez termínu se uloží zákonná lhůta 30 dní, ručně zadaný termín má přednost", () => {
    const k = { ...vychoziKoncept(), deviceLabel: "Tablet", popisZavady: "x" };
    const vychozi = konceptNaReklamaci(k, prijato).expected_completion_at!;
    expect(Math.round((new Date(vychozi).getTime() - prijato.getTime()) / 86_400_000)).toBe(LHUTA_VYRIZENI_DNI);
    expect(vychozi).toBe(vychoziTerminVyrizeni(prijato));
    expect(konceptNaReklamaci({ ...k, terminVyrizeni: "2026-10-10T10:00:00.000Z" }, prijato).expected_completion_at).toBe("2026-10-10T10:00:00.000Z");
  });

  it("reklamace bez zakázky: bez source_ticket_id, prázdná pole jako null", () => {
    const r = konceptNaReklamaci({ ...vychoziKoncept(), deviceLabel: "Notebook", popisZavady: "Nejde", bezZakazky: true }, prijato);
    expect(r.source_ticket_id).toBeNull();
    expect(r.customer_name).toBeNull();
    expect(r.claimed_repairs).toEqual([]);
    expect("branch_id" in r).toBe(false);
  });
});

describe("převod reklamace na zakázku", () => {
  const isFinal = (k: string) => k === "issued";

  it("jde jen jednou a jen z neuzavřené reklamace", () => {
    expect(lzePrevestNaZakazku(reklamace(), isFinal).ok).toBe(true);
    expect(lzePrevestNaZakazku(reklamace({ status: "issued" }), isFinal).ok).toBe(false);
    expect(lzePrevestNaZakazku(reklamace({ converted_ticket_id: "t-9" }), isFinal).ok).toBe(false);
    expect(lzePrevestNaZakazku(reklamace({ status: STAV_PREVEDENO }), isFinal).ok).toBe(false);
  });

  it("zakázka převezme zákazníka, zařízení, závadu, stav, příslušenství, fotky, poznámku a pobočku", () => {
    const z = reklamaceNaZakazku(reklamace(), { handoffDefault: "Osobně", handbackDefault: "Osobně" });
    expect(z.customerId).toBe("c-1");
    expect(z.customerName).toBe("Jan Novák");
    expect(z.addressZip).toBe("11000");
    expect(z.branchId).toBe("b-1");
    expect(z.devices).toHaveLength(1);
    const d = z.devices[0];
    expect(d.deviceLabel).toBe("iPhone 13");
    expect(d.serialOrImei).toBe("356789012345678");
    expect(d.requestedRepair).toBe("Displej po týdnu bliká");
    expect(d.deviceCondition).toBe("Oděrky na rámečku");
    expect(d.deviceAccessories).toBe("Pouzdro");
    expect(d.devicePasscode).toBe("1234");
    expect(d.handoffMethod).toBe("Poštou");
    expect(d.handbackMethod).toBe("Osobně");
    expect(d.deviceNote).toContain("Zálohovat fotky");
    expect(d.deviceNote).toContain("R26000007");
    expect(d.plannedRepairs).toBeUndefined();
    expect(z.hotoveFotkyPred).toEqual(fotkyReklamace(reklamace()));
  });

  it("bez názvu zařízení složí značku a model, bez SN vezme IMEI", () => {
    const z = reklamaceNaZakazku(reklamace({ device_label: null, device_brand: "Apple", device_model: "iPad", device_serial: null, device_imei: "35000" }));
    expect(z.devices[0].deviceLabel).toBe("Apple iPad");
    expect(z.devices[0].serialOrImei).toBe("35000");
    expect(reklamaceNaZakazku(reklamace({ device_label: null })).devices[0].deviceLabel).toBe("Zařízení z reklamace");
  });

  it("diagnostika: zákroky z reklamace a diagnostika zdrojové zakázky s odkazem", () => {
    const text = diagnostikaZReklamace("R26000007", {
      zdrojKod: "SRV26000042",
      zdrojDiagnostika: "Vadný konektor",
      zakroky: [{ id: "1", name: "Kontrola", price: 0 }, { id: "2", name: " " }],
    });
    expect(text).toContain("Zákroky v reklamaci R26000007:\n- Kontrola (0 Kč)");
    expect(text).toContain("Diagnostika ze zakázky SRV26000042 (reklamace R26000007):\nVadný konektor");
    expect(diagnostikaZReklamace("R1", {})).toBe("");
    expect(reklamaceNaZakazku(reklamace(), { zdrojDiagnostika: "X" }).diagnosticText).toContain("Diagnostika původní zakázky (reklamace R26000007)");
  });

  it("komentáře zdrojové zakázky se zkopírují do nové s autorem, datem, připnutím a předponou", () => {
    const k = (content: string, extra: Partial<Parameters<typeof komentareProPrevod>[0][number]> = {}) => ({
      author: "Jakub", author_id: "u-1", author_nickname: "jakub", author_avatar_url: null, content, pinned: false, created_at: "2026-10-01T10:00:00+00:00", ...extra,
    });
    const radky = komentareProPrevod([k("Volat paní Novákové 777 000 111", { pinned: true }), k("   "), k("Díl objednán", { author_id: null, author: "Servis" })], "R26000007", "svc", "t-new");
    expect(radky).toEqual([
      { ticket_id: "t-new", service_id: "svc", author: "Jakub", author_id: "u-1", author_nickname: "jakub", author_avatar_url: null, content: "[Z reklamace R26000007] Volat paní Novákové 777 000 111", pinned: true, created_at: "2026-10-01T10:00:00+00:00" },
      { ticket_id: "t-new", service_id: "svc", author: "Servis", author_id: null, author_nickname: "jakub", author_avatar_url: null, content: "[Z reklamace R26000007] Díl objednán", pinned: false, created_at: "2026-10-01T10:00:00+00:00" },
    ]);
    expect(komentareProPrevod([], "R1", "svc", "t")).toEqual([]);
  });

  it("reklamované opravy a fotky ze starého řádku (bez sloupců) jsou prázdné", () => {
    const stary = { ...reklamace() } as Partial<WarrantyClaimRow>;
    delete stary.claimed_repairs;
    delete stary.intake_photos;
    expect(reklamovaneOpravyReklamace(stary)).toEqual([]);
    expect(fotkyReklamace(stary)).toEqual([]);
    expect(reklamovaneOpravyReklamace(reklamace())).toEqual([{ id: "r-1", name: "Výměna displeje", price: 3500 }]);
  });
});
