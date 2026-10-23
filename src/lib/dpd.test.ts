import { describe, expect, it } from "vitest";
import {
  adresaPobocky,
  cislaBaliku,
  coChybiPobocce,
  dnySvozu,
  idSvozu,
  jdeTisknoutStitek,
  mestoProDpd,
  registrovanaAdresa,
  variantyZasilky,
  rozdelUlici,
  stavZTrackingu,
  teloZasilky,
  telefonProDpd,
  vyberAdresuPlatce,
} from "../../supabase/functions/_shared/dpd";

const praha = { name: "Hlavní pobočka", company_name: null, address_street: "U Vokovické školy 299/4", address_city: "Praha 6", address_zip: "160 00", phone: "773 118 472" };
const brno = { name: "Brno", company_name: "VortexWorks s.r.o.", address_street: "Krkoškova 739/19", address_city: "Brno - Černá Pole", address_zip: "61300", phone: "+420773118415" };

describe("adresy poboček pro DPD", () => {
  it("rozdělí ulici a číslo, zkrátí město o městskou část", () => {
    expect(rozdelUlici("U Vokovické školy 299/4")).toEqual({ street: "U Vokovické školy", houseNumber: "299/4" });
    expect(rozdelUlici("Krkoškova 739/19")).toEqual({ street: "Krkoškova", houseNumber: "739/19" });
    expect(rozdelUlici("Náměstí 5a")).toEqual({ street: "Náměstí", houseNumber: "5a" });
    expect(rozdelUlici("Bez čísla")).toEqual({ street: "Bez čísla", houseNumber: "" });
    expect(mestoProDpd("Praha 6")).toBe("Praha");
    expect(mestoProDpd("Brno - Černá Pole")).toBe("Brno");
    expect(mestoProDpd("Ostrava")).toBe("Ostrava");
  });

  it("telefon v mezinárodním tvaru", () => {
    expect(telefonProDpd("773 118 472")).toBe("+420773118472");
    expect(telefonProDpd("00420773118472")).toBe("+420773118472");
    expect(telefonProDpd("")).toBeUndefined();
  });

  it("adresa pobočky: firma pobočky, jinak název servisu", () => {
    expect(adresaPobocky(brno, "iSwap Repair Point Praha")).toEqual({
      info: { name1: "VortexWorks s.r.o.", contact: { phone: "+420773118415" } },
      address: { street: "Krkoškova", houseNumber: "739/19", city: "Brno", postalCode: "61300", country: { isoAlpha2: "CZ" } },
    });
    expect(adresaPobocky(praha, "iSwap Repair Point Praha")?.info.name1).toBe("iSwap Repair Point Praha");
    expect(adresaPobocky(praha, "x")?.address.postalCode).toBe("16000");
  });

  it("neúplná adresa → null a seznam, co chybí", () => {
    const bez = { name: "X", address_street: "Dlouhá", address_city: "", address_zip: "123", phone: null };
    expect(adresaPobocky(bez, "S")).toBeNull();
    expect(coChybiPobocce(bez)).toEqual(["číslo popisné v ulici", "město", "PSČ", "telefon"]);
  });
});

describe("zásilka DPD", () => {
  const a = adresaPobocky(praha, "iSwap")!;
  const b = adresaPobocky(brno, "iSwap")!;

  it("z neregistrované pobočky: štítek = Return s dpdReturn, kurýr = Collection; plátce z registrované adresy", () => {
    const [stitek] = teloZasilky({ dsw: "15500476", varianta: "return", balicku: 2, reference: "Z-0016", poznamka: "křehké", odesilatel: a, prijemce: b, adresaPlatce: { it4emId: 77 } }) as any[];
    expect(stitek.shipmentType).toBe("Return");
    expect(stitek.services).toEqual({ dpdReturn: true });
    expect(stitek.parcels).toHaveLength(2);
    expect(stitek.references).toEqual({ ref1: "Z-0016", ref2: "křehké" });
    expect(stitek.payer).toEqual({ customer: { dsw: "15500476" }, customerAddress: { it4emId: 77 } });
    const [kuryr] = teloZasilky({ dsw: "1", varianta: "collection", balicku: 1, reference: "Z-0001", odesilatel: a, prijemce: b, adresaPlatce: { id: 5 } }) as any[];
    expect(kuryr.shipmentType).toBe("Collection");
    expect(kuryr.services).toBeUndefined();
    expect(kuryr.references).toEqual({ ref1: "Z-0001" });
  });

  it("z registrované adresy účtu: Standard + Shop to Home, odesílatel = registrovaná adresa", () => {
    const [shop] = teloZasilky({ dsw: "9", varianta: "standard_shop", balicku: 1, reference: "Z-0011", odesilatel: a, prijemce: b, registrovana: { it4emId: 77 }, adresaPlatce: { it4emId: 77 } }) as any[];
    expect(shop.shipmentType).toBe("Standard");
    expect(shop.sender).toEqual({ it4emId: 77 });
    expect(shop.payer).toEqual({ customer: { dsw: "9" } });
    expect(shop.services).toEqual({ shopToHome: true });
    const [std] = teloZasilky({ dsw: "9", varianta: "standard", balicku: 1, reference: "Z-0011", odesilatel: a, prijemce: b, registrovana: { it4emId: 77 }, adresaPlatce: { it4emId: 77 } }) as any[];
    expect(std.services).toBeUndefined();
    expect(() => teloZasilky({ dsw: "9", varianta: "standard", balicku: 1, reference: "Z", odesilatel: a, prijemce: b, registrovana: null, adresaPlatce: a })).toThrow();
  });

  it("varianty podle registrované adresy a tisk štítku", () => {
    expect(variantyZasilky("label", true)).toEqual(["standard_shop", "standard"]);
    expect(variantyZasilky("courier", true)).toEqual(["standard"]);
    expect(variantyZasilky("label", false)).toEqual(["return"]);
    expect(variantyZasilky("courier", false)).toEqual(["collection"]);
    expect(jdeTisknoutStitek("collection")).toBe(false);
    expect(jdeTisknoutStitek("standard")).toBe(true);
    const seznam = [{ it4emId: 5, address: { postalCode: "16000", street: "U Vokovické školy" } }];
    expect(registrovanaAdresa(seznam, "160 00")).toEqual({ it4emId: 5 });
    expect(registrovanaAdresa(seznam, "61300")).toBeNull();
    expect(registrovanaAdresa(seznam, "")).toBeNull();
  });

  it("plátce: it4emId podle PSČ hlavní pobočky, jinak id, jinak fyzická adresa", () => {
    const seznam = [{ it4emId: 1, address: { postalCode: "61300" } }, { it4emId: 2, address: { postalCode: "16000" } }, { it4emId: 3, isActive: false, address: { postalCode: "16000" } }];
    expect(vyberAdresuPlatce(seznam, "160 00", a)).toEqual({ it4emId: 2 });
    expect(vyberAdresuPlatce({ items: [{ id: 9 }] }, "16000", a)).toEqual({ id: 9 });
    expect(vyberAdresuPlatce([], "16000", a)).toBe(a);
  });

  it("čísla balíků a ID svozu z odpovědí", () => {
    expect(cislaBaliku([{ id: 55, parcels: [{ parcelNumbers: { main: "1350" } }, { parcelNumber: "1351" }] }])).toEqual({ shipmentId: "55", parcelNumbers: ["1350", "1351"] });
    expect(idSvozu([{ id: "P1" }], null)).toBe("P1");
    expect(idSvozu({ pickupOrders: [{ id: "P2" }] }, null)).toBe("P2");
    expect(idSvozu(null, "https://geoapi.dpd.cz/v1/pickup-orders/P3")).toBe("P3");
    expect(idSvozu({}, null)).toBe("");
  });

  it("dny svozu: dnešek a pracovní dny v pražském čase", () => {
    // Pátek 23. 10. 2026 v 23:30 UTC = sobota 24. 10. v Praze.
    expect(dnySvozu(new Date("2026-10-23T23:30:00Z"))).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29"]);
    expect(dnySvozu(new Date("2026-10-21T08:00:00Z"), 2)).toEqual(["2026-10-21", "2026-10-22"]);
  });
});

describe("stav ze sledování DPD", () => {
  const ev = (createdAt: string, statusCode: string, description: string) => ({ createdAt, status: { statusCode, description } });

  it("13 = doručeno; informační 18 a 91 se přeskočí", () => {
    expect(stavZTrackingu({ parcelEvents: [
      ev("2026-10-20T09:12:00+02:00", "13", "Parcel is delivered to recipient"),
      ev("2026-10-20T10:00:00+02:00", "91", "End of exception – without COD"),
      ev("2026-10-19T16:05:00+02:00", "18", "Parcel has been given additional information"),
    ] })).toEqual({ status: "delivered", text: "Parcel is delivered to recipient", at: "2026-10-20T09:12:00+02:00" });
  });

  it("pohyb bez doručení = na cestě", () => {
    expect(stavZTrackingu({ parcelEvents: [ev("2026-10-20T07:40:00+02:00", "03", "Parcel picked up by delivery driver")] }).status).toBe("in_transit");
  });

  it("jen 18 = štítek vytvořený, balík se nehnul (bez změny stavu)", () => {
    expect(stavZTrackingu({ parcelEvents: [ev("2026-10-19T16:05:00+02:00", "18", "Parcel has been given additional information")] }))
      .toEqual({ text: "Parcel has been given additional information", at: "2026-10-19T16:05:00+02:00" });
  });

  it("bez událostí nic; „nedoručeno“ není doručeno", () => {
    expect(stavZTrackingu({ parcelEvents: [] })).toEqual({});
    expect(stavZTrackingu(null)).toEqual({});
    expect(stavZTrackingu({ parcelEvents: [ev("2026-10-20T09:00:00Z", "14", "Parcel not delivered – recipient absent")] }).status).toBe("in_transit");
  });
});
