/**
 * Objednávky z webu: ověření položky z API, stavy, sledovací čísla, podpis
 * a plán opakování webhooku, výběr událostí a mapování na příjem zakázky.
 *
 * Edge funkce běží v Denu bez vlastních testů, proto se jejich čistá logika
 * (supabase/functions/_shared/objednavky.ts) testuje odsud.
 */
import { describe, it, expect } from "vitest";
import {
  MAX_POKUSU,
  STAV_API,
  lisiSe,
  maOdeslat,
  maSmyslOpakovat,
  naplanujOpakovani,
  normalizujDopravce,
  objednavkaProApi,
  odkazSledovani,
  overObjednavku,
  overPodpisWebhooku,
  overSledovaciCisla,
  podpisWebhooku,
  povoleneZmeny,
  overSouhlas,
  slucSouhlas,
  formularNaObjednavku,
  nastaveniFormulare,
  novyKodObjednavky,
  typObrazku,
  udalostiZmenyStavu,
  type PolozkaObjednavky,
} from "../../supabase/functions/_shared/objednavky";
import { detailSouhlasu, mapujPodpisPrevzeti, obrazekPodpisuPrevzeti, textSouhlasu } from "./souhlasPrevzeti";
import { ticketDocumentData } from "./documentData";
import { modulProRozsah, ocistiRozsahy } from "../../supabase/functions/_shared/tokeny";
import { nazevModelu, objednavkaNaKoncept, odpovidaHledani, popisDopravy, sledovaciOdkazy, type WebObjednavka } from "./objednavky";

const ok = (v: unknown) => {
  const r = overObjednavku(v, "orders[0]");
  if (!r.ok) throw new Error(r.chyba);
  return r.polozka;
};
const chyba = (v: unknown) => {
  const r = overObjednavku(v, "orders[0]");
  if (r.ok) throw new Error("mělo selhat");
  return r.chyba;
};

describe("overObjednavku", () => {
  it("převede celou objednávku z webu na sloupce", () => {
    const p = ok({
      external_id: " SRV-2026-0123 ",
      status: "in_transit",
      source: "servis.iswap.cz",
      customer: { name: "Jan Novák", phone: "+420777123456", email: "jan@example.cz", company: "Firma", ico: "12345678", dic: "CZ12345678", address: { street: "Dlouhá 1", city: "Praha", zip: "110 00" } },
      device: { name: "iPhone 13", model_id: "0A7587F1-1111-4222-8333-444455556666", serial: "356789", passcode: "1234", accessories: "nabíječka" },
      issue: "Prasklý displej",
      requested_repair: "Výměna displeje",
      shipping: { inbound: "DPD", outbound: "Zásilkovna", pickup_point: { id: "123", name: "Z-BOX Praha 7" }, return_address: "Dlouhá 1, Praha", tracking: [{ number: "13912345678901", direction: "inbound" }] },
      note: "Prosím rychle",
      data: { cena_dopravy: 99 },
    });
    expect(p.externiCislo).toBe("SRV-2026-0123");
    expect(p.stav).toBe("na_ceste");
    expect(p.hodnoty).toMatchObject({
      zdroj: "servis.iswap.cz",
      zakaznik_jmeno: "Jan Novák",
      zakaznik_email: "jan@example.cz",
      zakaznik_ulice: "Dlouhá 1",
      zakaznik_mesto: "Praha",
      zakaznik_psc: "110 00",
      zakaznik_dic: "CZ12345678",
      zarizeni: "iPhone 13",
      model_id: "0a7587f1-1111-4222-8333-444455556666",
      sn_imei: "356789",
      heslo_zarizeni: "1234",
      prislusenstvi: "nabíječka",
      popis_zavady: "Prasklý displej",
      pozadovana_oprava: "Výměna displeje",
      doprava_tam: "DPD",
      doprava_zpet: "Zásilkovna",
      vydejni_misto: "Z-BOX Praha 7, 123",
      adresa_zpet: "Dlouhá 1, Praha",
      poznamka: "Prosím rychle",
      data: { cena_dopravy: 99 },
    });
    // Dopravce se odhadne ze směru (inbound = DPD) a doplní se odkaz na sledování.
    expect(p.hodnoty.sledovaci_cisla).toEqual([
      { dopravce: "dpd", cislo: "13912345678901", smer: "tam", url: "https://tracking.dpd.de/status/cs_CZ/parcel/13912345678901" },
    ]);
  });

  it("mění jen poslaná pole; null hodnotu smaže, prázdný text je null", () => {
    const p = ok({ external_id: "X-1", customer: { phone: null, name: "  " } });
    expect(p.hodnoty).toEqual({ zakaznik_telefon: null, zakaznik_jmeno: null });
    expect(p.stav).toBeUndefined();
    expect(ok({ external_id: 42 }).externiCislo).toBe("42");
  });

  it("do sloupců nepustí nic, co tam nepatří (service_id, ticket_id, stav)", () => {
    const p = ok({ external_id: "X-2", service_id: "cizí", ticket_id: "cizí", stav: "prevedeno", zdroj: "x" });
    expect(p.hodnoty).toEqual({});
    expect(p.stav).toBeUndefined();
  });

  it("odmítne chybějící nebo nesmyslné external_id", () => {
    expect(chyba({})).toMatch(/chybí external_id/);
    expect(chyba({ external_id: "   " })).toMatch(/chybí external_id/);
    expect(chyba({ external_id: "x".repeat(101) })).toMatch(/100 znaků/);
    expect(chyba({ external_id: "A\u0000B" })).toMatch(/neplatné znaky/);
    expect(chyba("SRV-1")).toMatch(/musí být objekt/);
  });

  it("stav smí být jen new / in_transit / arrived / cancelled", () => {
    expect(ok({ external_id: "a", status: "arrived" }).stav).toBe("dorazilo");
    expect(ok({ external_id: "a", status: "cancelled" }).stav).toBe("zrusena");
    expect(chyba({ external_id: "a", status: "converted" })).toMatch(/status/);
    expect(chyba({ external_id: "a", status: "nova" })).toMatch(/status/);
  });

  it("hlídá e-mail, UUID, délky a typy", () => {
    expect(chyba({ external_id: "a", customer: { email: "neni-email" } })).toMatch(/customer.email nevypadá platně/);
    expect(chyba({ external_id: "a", repair_id: "123" })).toMatch(/repair_id musí být UUID/);
    expect(chyba({ external_id: "a", device: { name: "x".repeat(201) } })).toMatch(/device.name je delší než 200/);
    expect(chyba({ external_id: "a", issue: { text: "x" } })).toMatch(/issue musí být text/);
    expect(chyba({ external_id: "a", customer: "Jan" })).toMatch(/customer musí být objekt/);
  });

  it("data nad 20 kB odmítne", () => {
    expect(chyba({ external_id: "a", data: { x: "y".repeat(21 * 1024) } })).toMatch(/limit je 20 kB/);
    expect(chyba({ external_id: "a", data: [1, 2] })).toMatch(/data musí být objekt/);
    expect(ok({ external_id: "a", data: null }).hodnoty.data).toEqual({});
  });

  it("zařízení jde poslat i jako text a IMEI i pod klíčem imei", () => {
    expect(ok({ external_id: "a", device: "Pixel 8" }).hodnoty).toEqual({ zarizeni: "Pixel 8" });
    expect(ok({ external_id: "a", device: { imei: "35" } }).hodnoty).toEqual({ sn_imei: "35" });
  });
});

describe("sledovací čísla", () => {
  it("pozná dopravce podle názvu", () => {
    expect(normalizujDopravce("DPD CZ")).toBe("dpd");
    expect(normalizujDopravce("Zásilkovna")).toBe("zasilkovna");
    expect(normalizujDopravce("Packeta")).toBe("zasilkovna");
    expect(normalizujDopravce("Česká pošta")).toBe("ceska_posta");
    expect(normalizujDopravce("Balíkovna")).toBe("balikovna");
    expect(normalizujDopravce("kurýr Franta")).toBe("jiny");
    expect(normalizujDopravce(undefined)).toBe("jiny");
  });

  it("vyrobí odkaz na sledování, u neznámého dopravce ne", () => {
    expect(odkazSledovani("zasilkovna", "Z 123")).toBe("https://tracking.packeta.com/cs/?id=Z%20123");
    expect(odkazSledovani("jiny", "123")).toBeNull();
  });

  it("přijme řetězce i objekty, vlastní odkaz jen https", () => {
    expect(overSledovaciCisla(["123"], {})).toEqual([{ dopravce: "jiny", cislo: "123", smer: null, url: null }]);
    expect(overSledovaciCisla([{ number: "9", carrier: "PPL", direction: "outbound", url: "https://x.cz/s/9" }])).toEqual([
      { dopravce: "ppl", cislo: "9", smer: "zpet", url: "https://x.cz/s/9" },
    ]);
    expect(overSledovaciCisla([{ number: "9", url: "javascript:alert(1)" }])).toMatch(/https/);
    expect(overSledovaciCisla([{ number: "9", direction: "doleva" }])).toMatch(/direction/);
    expect(overSledovaciCisla("123")).toMatch(/pole/);
    expect(overSledovaciCisla(Array.from({ length: 21 }, (_, i) => String(i)))).toMatch(/20/);
  });
});

describe("povoleneZmeny podle stavu objednávky", () => {
  const p: PolozkaObjednavky = { externiCislo: "a", hodnoty: { zarizeni: "x", sledovaci_cisla: [], poznamka: "p" }, stav: "dorazilo" };

  it("otevřená objednávka: vše", () => {
    expect(povoleneZmeny("na_ceste", p)).toEqual({ hodnoty: p.hodnoty, stav: "dorazilo" });
  });

  it("převedená: jen sledovací čísla, poznámka a data; zrušit ani změnit stav nejde", () => {
    expect(povoleneZmeny("prevedeno", p)).toEqual({ hodnoty: { sledovaci_cisla: [], poznamka: "p" } });
    expect(povoleneZmeny("prevedeno", { ...p, stav: "zrusena" }).chyba).toMatch(/zrušte ji v Jobi/);
    expect(povoleneZmeny("prevedeno", { ...p, stav: "na_ceste" }).chyba).toMatch(/řídí zakázkou/);
  });

  it("zrušená: nic", () => {
    expect(povoleneZmeny("zrusena", p).chyba).toMatch(/zrušená/);
  });

  it("lisiSe nehledí na pořadí klíčů z jsonb", () => {
    const radek = { sledovaci_cisla: [{ url: null, smer: "tam", cislo: "1", dopravce: "dpd" }], zarizeni: "x" };
    expect(lisiSe(radek, { sledovaci_cisla: [{ dopravce: "dpd", cislo: "1", smer: "tam", url: null }] })).toBe(false);
    expect(lisiSe(radek, { zarizeni: "y" })).toBe(true);
    expect(lisiSe({ poznamka: null }, { poznamka: null })).toBe(false);
  });
});

describe("odpověď API", () => {
  it("vrací anglické stavy a zakázku", () => {
    const o = objednavkaProApi(
      {
        externi_cislo: "SRV-1", stav: "prevedeno", zdroj: "web", zakaznik_jmeno: "Jan", zarizeni: "iPhone",
        sledovaci_cisla: [{ dopravce: "zasilkovna", cislo: "Z1", smer: "zpet", url: null }],
        created_at: "2026-10-01T10:00:00Z", updated_at: "2026-10-02T10:00:00Z", dorazilo_at: "2026-10-02T09:00:00Z", prevedeno_at: "2026-10-02T10:00:00Z",
      },
      { code: "A-12", status: { key: "done", label: "Vydáno", is_final: true }, total: 2700, updated_at: "2026-10-05T10:00:00Z" },
    );
    expect(o).toMatchObject({
      external_id: "SRV-1",
      status: "converted",
      ticket_code: "A-12",
      ticket: { code: "A-12", status: { key: "done", label: "Vydáno", is_final: true }, total: 2700 },
      tracking: [{ carrier: "zasilkovna", number: "Z1", direction: "outbound", url: "https://tracking.packeta.com/cs/?id=Z1" }],
    });
    expect(objednavkaProApi({ externi_cislo: "x", stav: "na_ceste", zdroj: null, created_at: "", updated_at: "" }, null)).toMatchObject({ status: "in_transit", ticket: null, ticket_code: null });
    expect(Object.values(STAV_API)).toEqual(["new", "in_transit", "arrived", "converted", "cancelled"]);
  });
});

describe("podpis webhooku", () => {
  it("je HMAC-SHA256 těla (RFC 4231, test 2)", async () => {
    expect(await podpisWebhooku("Jefe", "what do ya want for nothing?")).toBe("sha256=5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
  });

  it("ověření projde jen se stejným tajemstvím a nezměněným tělem", async () => {
    const telo = JSON.stringify({ event: "order.converted", external_id: "SRV-1" });
    const podpis = await podpisWebhooku("whsec_abc", telo);
    expect(await overPodpisWebhooku("whsec_abc", telo, podpis)).toBe(true);
    expect(await overPodpisWebhooku("whsec_xyz", telo, podpis)).toBe(false);
    expect(await overPodpisWebhooku("whsec_abc", telo.replace("SRV-1", "SRV-2"), podpis)).toBe(false);
    expect(await overPodpisWebhooku("whsec_abc", telo, null)).toBe(false);
  });
});

describe("opakování a výběr událostí", () => {
  const ted = new Date("2026-10-13T10:00:00Z");
  const za = (d: Date | null) => (d ? (d.getTime() - ted.getTime()) / 60_000 : null);

  it("3 opakování s rostoucí pauzou 1, 5, 30 minut, pak konec", () => {
    expect(MAX_POKUSU).toBe(4);
    expect(za(naplanujOpakovani(1, ted))).toBe(1);
    expect(za(naplanujOpakovani(2, ted))).toBe(5);
    expect(za(naplanujOpakovani(3, ted))).toBe(30);
    expect(naplanujOpakovani(4, ted)).toBeNull();
    expect(naplanujOpakovani(0, ted)).toBeNull();
  });

  it("opakuje výpadky a 5xx, ne chyby příjemce", () => {
    expect(maSmyslOpakovat(null)).toBe(true);
    expect(maSmyslOpakovat(503)).toBe(true);
    expect(maSmyslOpakovat(429)).toBe(true);
    expect(maSmyslOpakovat(401)).toBe(false);
    expect(maSmyslOpakovat(404)).toBe(false);
  });

  it("změna stavu zakázky: vždy status_changed, completed jen při vstupu do koncového", () => {
    const koncovy = (k: string) => k === "done" || k === "cancelled";
    expect(udalostiZmenyStavu("received", "in_progress", koncovy)).toEqual(["ticket.status_changed"]);
    expect(udalostiZmenyStavu("in_progress", "done", koncovy)).toEqual(["ticket.status_changed", "ticket.completed"]);
    expect(udalostiZmenyStavu("done", "cancelled", koncovy)).toEqual(["ticket.status_changed"]);
    expect(udalostiZmenyStavu("done", "done", koncovy)).toEqual([]);
  });

  it("posílá jen odebírané události aktivního webhooku; ping vždy", () => {
    expect(maOdeslat("ticket.completed", ["ticket.completed"], true)).toBe(true);
    expect(maOdeslat("ticket.completed", ["order.converted"], true)).toBe(false);
    expect(maOdeslat("ticket.completed", ["ticket.completed"], false)).toBe(false);
    expect(maOdeslat("ping", null, false)).toBe(true);
  });

  it("token se scope orders patří k modulu veřejného API ceníku", () => {
    expect(ocistiRozsahy(["orders", "objednavky"])).toEqual(["orders"]);
    expect(modulProRozsah("orders")).toBe("api_catalog");
  });
});

describe("objednávka → příjem zakázky", () => {
  const o: WebObjednavka = {
    id: "o1", service_id: "s1", branch_id: "b2", externi_cislo: "SRV-2026-0123", zdroj: "servis.iswap.cz", stav: "dorazilo",
    zakaznik_jmeno: " Jan Novák ", zakaznik_telefon: "+420777123456", zakaznik_email: "jan@example.cz", zakaznik_firma: "Firma s.r.o.",
    zakaznik_ico: "12345678", zakaznik_dic: "CZ12345678", zakaznik_ulice: "Dlouhá 1", zakaznik_mesto: "Praha", zakaznik_psc: "110 00",
    zarizeni: "iphone 13 modrý", model_id: "m1", sn_imei: "356789", heslo_zarizeni: "1234", prislusenstvi: "obal",
    popis_zavady: "Prasklý displej", pozadovana_oprava: "Výměna displeje", repair_id: "r1",
    doprava_tam: "DPD", doprava_zpet: "Zásilkovna", vydejni_misto: "Z-BOX Praha 7", adresa_zpet: null,
    sledovaci_cisla: [{ dopravce: "dpd", cislo: "139", smer: "tam", url: null }], poznamka: "Spěchá",
    ticket_id: null, created_at: "2026-10-01T10:00:00Z", updated_at: "2026-10-01T10:00:00Z", dorazilo_at: null,
  };

  it("předvyplní zákazníka, zařízení, závadu, dopravu, externí číslo a pobočku", () => {
    const k = objednavkaNaKoncept(o, {
      handoffDefault: "Osobně",
      handbackDefault: "Osobně",
      modelNazev: "Apple iPhone 13",
      oprava: { id: "r1", name: "Výměna displeje", price: 2990, costs: 900, estimatedTime: 60 },
      pridalUserId: "u1",
      branchIdDefault: "b1",
    });
    expect(k).toMatchObject({
      customerName: "Jan Novák",
      customerPhone: "+420777123456",
      customerEmail: "jan@example.cz",
      company: "Firma s.r.o.",
      ico: "12345678",
      customerInfo: "DIČ: CZ12345678",
      addressStreet: "Dlouhá 1",
      addressCity: "Praha",
      addressZip: "11000",
      branchId: "b2",
      objednavkaId: "o1",
    });
    const d = k.devices[0];
    expect(d).toMatchObject({
      deviceLabel: "Apple iPhone 13",
      serialOrImei: "356789",
      devicePasscode: "1234",
      deviceAccessories: "obal",
      requestedRepair: "Výměna displeje – Prasklý displej",
      handoffMethod: "Poštou – DPD",
      handbackMethod: "Poštou – Zásilkovna",
      externalId: "SRV-2026-0123",
    });
    expect(d.deviceNote).toContain("Z objednávky SRV-2026-0123 (servis.iswap.cz)");
    expect(d.deviceNote).toContain("Zákazník uvedl: iphone 13 modrý");
    expect(d.deviceNote).toContain("Výdejní místo: Z-BOX Praha 7");
    expect(d.deviceNote).toContain("Zásilky: DPD 139");
    expect(d.deviceNote).toContain("Spěchá");
    expect(d.plannedRepairs).toHaveLength(1);
    expect(d.plannedRepairs![0]).toMatchObject({ name: "Výměna displeje", type: "selected", repairId: "r1", price: 2990, pridalUserId: "u1" });
  });

  it("bez ceníku a dopravy vezme text od zákazníka a výchozí předání", () => {
    const k = objednavkaNaKoncept({ ...o, branch_id: null, doprava_tam: null, doprava_zpet: null, pozadovana_oprava: null, sledovaci_cisla: null, zakaznik_dic: null }, { handoffDefault: "Osobně", handbackDefault: "", branchIdDefault: "b1" });
    expect(k.branchId).toBe("b1");
    expect(k.customerInfo).toBe("");
    expect(k.devices[0]).toMatchObject({ deviceLabel: "iphone 13 modrý", requestedRepair: "Prasklý displej", handoffMethod: "Osobně", handbackMethod: "" });
    expect(k.devices[0].plannedRepairs).toBeUndefined();
  });

  it("název modelu se značkou z ceníku", () => {
    const data = {
      brands: [{ id: "b", name: "Apple", createdAt: "" }],
      categories: [{ id: "c", brandId: "b", name: "iPhone", createdAt: "" }],
      models: [{ id: "m1", categoryId: "c", name: "iPhone 13", createdAt: "" }, { id: "m2", categoryId: "c", name: "Apple Watch", createdAt: "" }],
    };
    expect(nazevModelu(data, "m1")).toBe("Apple iPhone 13");
    expect(nazevModelu(data, "m2")).toBe("Apple Watch");
    expect(nazevModelu(data, "nic")).toBeNull();
    expect(nazevModelu(data, null)).toBeNull();
  });

  it("řádek seznamu: stav dopravy a odkazy na sledování", () => {
    expect(popisDopravy({ stav: "na_ceste", doprava_tam: "DPD" })).toBe("Na cestě · DPD");
    expect(popisDopravy({ stav: "dorazilo", doprava_tam: "DPD" })).toBe("Dorazilo");
    expect(sledovaciOdkazy(o)).toEqual([{ text: "DPD 139", url: "https://tracking.dpd.de/status/cs_CZ/parcel/139", smer: "tam" }]);
    expect(sledovaciOdkazy({ sledovaci_cisla: null })).toEqual([]);
  });
});

describe("elektronické odsouhlasení (consent)", () => {
  const ted = new Date("2026-10-13T13:00:00Z");
  // 1×1 PNG
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

  it("očistí souhlas, metodu odvodí, obrázek dekóduje a pozná podle bajtů", () => {
    const v = overSouhlas({ id: " ABC123 ", signed_at: "2026-10-13T14:32:00+02:00", ip: "203.0.113.7", user_agent: "Mozilla/5.0", terms_version: "v3", signature_image: PNG, nesmysl: "x" }, ted);
    if (typeof v === "string") throw new Error(v);
    expect(v.souhlas).toEqual({ id: "ABC123", signed_at: "2026-10-13T12:32:00.000Z", method: "drawn", ip: "203.0.113.7", user_agent: "Mozilla/5.0", terms_version: "v3" });
    expect(v.podpis?.typ).toBe("data");
    expect(v.podpis && v.podpis.typ === "data" ? v.podpis.mime : null).toBe("image/png");
    const bezObrazku = overSouhlas({ id: "X", signed_at: "2026-10-13T10:00:00Z" }, ted);
    expect(typeof bezObrazku !== "string" && bezObrazku.souhlas.method).toBe("checkbox");
    const odkaz = overSouhlas({ id: "X", signed_at: "2026-10-13T10:00:00Z", signature_image: "https://web.cz/podpis/1.png" }, ted);
    expect(typeof odkaz !== "string" && odkaz.podpis).toEqual({ typ: "url", url: "https://web.cz/podpis/1.png" });
  });

  it("odmítne chybějící ID a čas, nesmyslnou metodu, IP, obrázek a velikost", () => {
    expect(overSouhlas({ signed_at: "2026-10-13T10:00:00Z" }, ted)).toMatch(/chybí id/);
    expect(overSouhlas({ id: "X" }, ted)).toMatch(/chybí signed_at/);
    expect(overSouhlas({ id: "X", signed_at: "13. 10. 2026" }, ted)).toMatch(/ISO 8601/);
    expect(overSouhlas({ id: "X", signed_at: "2026-12-24T10:00:00Z" }, ted)).toMatch(/budoucnosti/);
    expect(overSouhlas({ id: "X", signed_at: "2026-10-13T10:00:00Z", method: "telepatie" }, ted)).toMatch(/method musí být/);
    expect(overSouhlas({ id: "X", signed_at: "2026-10-13T10:00:00Z", ip: "<script>" }, ted)).toMatch(/ip/);
    expect(overSouhlas({ id: "X", signed_at: "2026-10-13T10:00:00Z", signature_image: "data:image/gif;base64,R0lGOD" }, ted)).toMatch(/signature_image musí být/);
    expect(overSouhlas({ id: "X", signed_at: "2026-10-13T10:00:00Z", signature_image: "data:image/png;base64,QUJD" }, ted)).toMatch(/PNG nebo JPEG/);
    expect(overSouhlas({ id: "X", signed_at: "2026-10-13T10:00:00Z", signature_image: "http://web.cz/p.png" }, ted)).toMatch(/signature_image/);
    const velky = "data:image/png;base64," + btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47) + "x".repeat(210 * 1024));
    expect(overSouhlas({ id: "X", signed_at: "2026-10-13T10:00:00Z", signature_image: velky }, ted)).toMatch(/limit je 200 kB/);
    expect(overSouhlas("ano", ted)).toMatch(/objekt/);
  });

  it("jde v objednávce jako pole consent; null souhlas smaže", () => {
    const p = ok({ external_id: "a", consent: { id: "C1", signed_at: "2026-10-13T10:00:00Z", signature_image: PNG } });
    expect((p.hodnoty.souhlas as { id: string }).id).toBe("C1");
    expect(p.podpis?.typ).toBe("data");
    expect(ok({ external_id: "a", consent: null }).hodnoty).toEqual({ souhlas: null });
    expect(chyba({ external_id: "a", consent: { id: "C1" } })).toMatch(/consent: chybí signed_at/);
  });

  it("stejné ID = stejný souhlas: obrázek ani čas přijetí se nemění; jiné ID = nový", () => {
    const ulozeny = { id: "C1", signed_at: "x", method: "drawn", received_at: "2026-10-01T00:00:00Z", signature_url: "https://x/podpis.png" };
    const stejny = slucSouhlas(ulozeny, { id: "C1", signed_at: "x", method: "drawn" }, ted);
    expect(stejny).toEqual({ stejny: true, souhlas: { id: "C1", signed_at: "x", method: "drawn", received_at: "2026-10-01T00:00:00Z", signature_url: "https://x/podpis.png" } });
    const novy = slucSouhlas(ulozeny, { id: "C2", signed_at: "y", method: "checkbox" }, ted);
    expect(novy).toEqual({ stejny: false, souhlas: { id: "C2", signed_at: "y", method: "checkbox", received_at: ted.toISOString() } });
    expect(slucSouhlas(null, { id: "C3", signed_at: "z", method: "checkbox" }, ted).stejny).toBe(false);
  });

  it("u převedené objednávky se souhlas už nemění", () => {
    const p: PolozkaObjednavky = { externiCislo: "a", hodnoty: { souhlas: { id: "C9" }, poznamka: "p" } };
    expect(povoleneZmeny("prevedeno", p).hodnoty).toEqual({ poznamka: "p" });
  });

  it("API vrací jen shrnutí souhlasu", () => {
    const o = objednavkaProApi({ externi_cislo: "x", stav: "nova", zdroj: "web", created_at: "", updated_at: "", souhlas: { id: "C1", signed_at: "s", method: "drawn", ip: "1.2.3.4", signature_url: "https://x" } }, null);
    expect(o.consent).toEqual({ id: "C1", signed_at: "s", method: "drawn", has_signature_image: true });
    expect(typObrazku(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
  });

  it("přenos na zakázku: data dokumentu mají souhlas a podpis do kolonky převzetí", () => {
    const souhlas = { id: "ABC123", signed_at: "2026-10-13T12:32:00Z", method: "checkbox" as const, ip: "203.0.113.7", terms_version: "v3", external_id: "SRV-2026-0123", source: "servis.iswap.cz", signature_url: "https://x.supabase.co/storage/v1/object/public/diagnostic-photos/s1/objednavky/o1.png" };
    const zakazka = { id: "t1", code: "A-1", customerName: "Jan", createdAt: "2026-10-13T12:40:00Z", performedRepairs: [], intakeConsent: souhlas } as unknown as Parameters<typeof ticketDocumentData>[0];
    const d = ticketDocumentData(zakazka, {});
    expect(d.consent).toMatchObject({ id: "ABC123", signedAt: "2026-10-13T12:32:00Z", source: "servis.iswap.cz", ip: "203.0.113.7", termsVersion: "v3", orderNumber: "SRV-2026-0123" });
    expect(d.intakeSignature).toBe(souhlas.signature_url);
    // Ruční podpis z dílny / portálu má přednost, souhlas zůstává.
    const sRucnim = ticketDocumentData({ ...zakazka, intakeSignatureUrl: "https://x/rucni.png" } as typeof zakazka, {});
    expect(sRucnim.intakeSignature).toBe("https://x/rucni.png");
    expect(sRucnim.consent?.id).toBe("ABC123");
    expect(ticketDocumentData({ ...zakazka, intakeConsent: undefined } as typeof zakazka, {}).consent).toBeUndefined();
    expect(textSouhlasu(souhlas)).toBe("Elektronicky odsouhlaseno 13. 10. 2026 14:32 · ID ABC123 · formulář servis.iswap.cz");
    expect(detailSouhlasu(souhlas)).toContainEqual(["IP adresa", "203.0.113.7"]);
    expect(detailSouhlasu(souhlas)).toContainEqual(["Způsob", "zaškrtnutím souhlasu"]);
    expect(mapujPodpisPrevzeti({ intake_signature_url: "", intake_consent: { bez: "id" } })).toEqual({});
    expect(obrazekPodpisuPrevzeti({})).toBeUndefined();
  });
});

describe("vložitelný formulář Jobi", () => {
  const kontext = { ip: "203.0.113.7", userAgent: "Mozilla/5.0", podminkyUrl: "https://servis.cz/podminky" };
  const ted = new Date("2026-10-13T12:00:00Z");
  const zaklad = { name: "Jan Novák", phone: "777 123 456", device: "iPhone 13", issue: "Prasklý displej", consent: true };

  it("osobní předání: sloupce objednávky a souhlas zaškrtnutím s IP a prohlížečem", () => {
    const v = formularNaObjednavku({ ...zaklad, model_id: "0A7587F1-1111-4222-8333-444455556666", repair_id: "nesmysl", handoff: "osobne", street: "Ignoruje se" }, kontext, ted);
    if (typeof v === "string") throw new Error(v);
    expect(v.hodnoty).toMatchObject({
      zakaznik_jmeno: "Jan Novák", zarizeni: "iPhone 13", popis_zavady: "Prasklý displej", doprava_tam: "Osobně", doprava_zpet: "Osobně",
      zakaznik_ulice: null, adresa_zpet: null, model_id: "0a7587f1-1111-4222-8333-444455556666", repair_id: null,
    });
    expect(v.hodnoty.souhlas).toMatchObject({ method: "checkbox", signed_at: ted.toISOString(), ip: "203.0.113.7", user_agent: "Mozilla/5.0", terms_url: "https://servis.cz/podminky", signer_name: "Jan Novák" });
  });

  it("poštou chce adresu pro vrácení; bez souhlasu, jména nebo závady neprojde", () => {
    expect(formularNaObjednavku({ ...zaklad, handoff: "postou" }, kontext, ted)).toMatch(/adresu/);
    const v = formularNaObjednavku({ ...zaklad, handoff: "postou", street: "Dlouhá 1", city: "Praha", zip: "11000" }, kontext, ted);
    expect(typeof v !== "string" && v.hodnoty).toMatchObject({ doprava_tam: "Poštou", adresa_zpet: "Dlouhá 1, 11000 Praha", zakaznik_mesto: "Praha" });
    expect(formularNaObjednavku({ ...zaklad, consent: false }, kontext, ted)).toMatch(/souhlasu/);
    expect(formularNaObjednavku({ ...zaklad, consent: "true" }, kontext, ted)).toMatch(/souhlasu/);
    expect(formularNaObjednavku({ ...zaklad, name: "J" }, kontext, ted)).toMatch(/jméno/);
    expect(formularNaObjednavku({ ...zaklad, issue: "" }, kontext, ted)).toMatch(/opravit/);
    expect(formularNaObjednavku({ ...zaklad, email: "x@" }, kontext, ted)).toMatch(/E-mail/);
  });

  it("číslo objednávky a nastavení formuláře", () => {
    expect(novyKodObjednavky(ted)).toMatch(/^JOBI-261013-[2-9A-HJ-NP-Z]{6}$/);
    expect(nastaveniFormulare({ zapnuto: true, uvod: " Ahoj ", podminkyUrl: "javascript:alert(1)" })).toEqual({ zapnuto: true, uvod: "Ahoj", podminkyUrl: null });
    expect(nastaveniFormulare(undefined)).toEqual({ zapnuto: false, uvod: "", podminkyUrl: null });
  });
});

describe("odpovidaHledani", () => {
  const o = {
    externi_cislo: "SRV-2026-0353", zakaznik_jmeno: "Martina Mašanská", zakaznik_telefon: "+420 736 773 155", zakaznik_email: "m@example.cz",
    zakaznik_firma: null, zarizeni: "Dyson V12", sn_imei: "ZE7-EU-RDJ1433A", popis_zavady: "Nesvítí laser", pozadovana_oprava: null,
    sledovaci_cisla: [{ dopravce: "dpd", cislo: "13836603263934", smer: "tam", url: null }],
  } as unknown as WebObjednavka;
  it("najde podle jména bez diakritiky, čísla, telefonu i zásilky", () => {
    expect(odpovidaHledani(o, "")).toBe(true);
    expect(odpovidaHledani(o, "masanska")).toBe(true);
    expect(odpovidaHledani(o, "0353")).toBe(true);
    expect(odpovidaHledani(o, "736 773")).toBe(true);
    expect(odpovidaHledani(o, "736773155")).toBe(true);
    expect(odpovidaHledani(o, "13836603")).toBe(true);
    expect(odpovidaHledani(o, "v12 laser")).toBe(true);
    expect(odpovidaHledani(o, "rdj1433a")).toBe(true);
    expect(odpovidaHledani(o, "v15")).toBe(false);
    expect(odpovidaHledani(o, "martina novak")).toBe(false);
  });
});
