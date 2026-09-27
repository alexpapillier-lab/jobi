import { describe, it, expect } from "vitest";
import {
  filtrujPolozky,
  lzeUzavrit,
  mapInventura,
  mapPolozka,
  najdiPodleKodu,
  najdiProduktPodleKodu,
  nazevProtokolu,
  ocenitRozdil,
  parseNapocitano,
  poctemZeCtecky,
  protokolCsv,
  prubehInventury,
  rozdilPolozky,
  souhrnInventury,
  type Inventura,
  type PolozkaInventury,
} from "./inventura";

let citac = 0;
function polozka(o: Partial<PolozkaInventury> = {}): PolozkaInventury {
  citac += 1;
  return {
    id: `i${citac}`,
    stocktakeId: "st1",
    productId: `p${citac}`,
    nazev: `Díl ${citac}`,
    sku: null,
    nakupniCena: null,
    ocekavano: 0,
    rezervovano: 0,
    napocitano: null,
    stavPriPocitani: null,
    napocital: null,
    napocitanoAt: null,
    stavPredUzavrenim: null,
    zapsanyRozdil: null,
    pridanoRucne: false,
    ...o,
  };
}

const otevrena: Inventura = {
  id: "st1",
  serviceId: "s1",
  warehouseId: "w1",
  branchId: null,
  cislo: "INV-2026-001",
  skladNazev: "Hlavní sklad",
  status: "open",
  poznamka: null,
  zahajil: "u1",
  zahajenoAt: "2026-09-27T08:00:00Z",
  uzavrel: null,
  uzavrenoAt: null,
  nespocitaneBezeZmeny: false,
  souhrn: null,
};

describe("rozdíl řádku", () => {
  it("nespočítaný řádek nemá rozdíl ani ocenění", () => {
    const p = polozka({ ocekavano: 5, nakupniCena: 100 });
    expect(rozdilPolozky(p)).toBeNull();
    expect(ocenitRozdil(p)).toBeNull();
  });

  it("manko je záporné, přebytek kladný, oceněno nákupní cenou", () => {
    expect(rozdilPolozky(polozka({ ocekavano: 5, napocitano: 3 }))).toBe(-2);
    expect(rozdilPolozky(polozka({ ocekavano: 5, napocitano: 8 }))).toBe(3);
    expect(ocenitRozdil(polozka({ ocekavano: 5, napocitano: 3, nakupniCena: 249.9 }))).toBe(-499.8);
  });

  it("počítá se proti stavu při počítání, ne při zahájení", () => {
    // Při zahájení 5 ks, pak zakázka odepsala 1 → při počítání evidence ukazovala 4, napočítány 4 = bez rozdílu.
    const p = polozka({ ocekavano: 5, stavPriPocitani: 4, napocitano: 4 });
    expect(rozdilPolozky(p)).toBe(0);
  });

  it("bez ceny se rozdíl nedá ocenit", () => {
    expect(ocenitRozdil(polozka({ ocekavano: 2, napocitano: 1, nakupniCena: null }))).toBeNull();
  });

  it("nula napočítaných kusů je platný počet, ne nespočítáno", () => {
    expect(rozdilPolozky(polozka({ ocekavano: 3, napocitano: 0 }))).toBe(-3);
  });
});

describe("souhrn a průběh", () => {
  const polozky = [
    polozka({ ocekavano: 5, napocitano: 3, nakupniCena: 100 }), // manko 2 = 200 Kč
    polozka({ ocekavano: 1, napocitano: 2, nakupniCena: 50.5 }), // přebytek 1 = 50,5 Kč
    polozka({ ocekavano: 4, napocitano: 4, nakupniCena: 10 }), // sedí
    polozka({ ocekavano: 2, napocitano: 0, nakupniCena: null }), // manko 2 bez ceny
    polozka({ ocekavano: 7 }), // nespočítáno
    polozka({ ocekavano: 9, napocitano: 1, productId: null }), // smazaný produkt – nepočítá se
  ];

  it("sečte manko a přebytek v ks i Kč", () => {
    expect(souhrnInventury(polozky)).toEqual({
      polozek: 5,
      spocitano: 4,
      nespocitano: 1,
      sRozdilem: 3,
      mankoKs: 4,
      prebytekKs: 1,
      mankoKc: 200,
      prebytekKc: 50.5,
      bezCeny: 1,
    });
  });

  it("průběh X/Y, 100 % jen když je hotovo všechno", () => {
    expect(prubehInventury(polozky)).toEqual({ hotovo: 4, celkem: 5, procento: 80 });
    const skoro = [...Array.from({ length: 199 }, () => polozka({ napocitano: 1 })), polozka()];
    expect(prubehInventury(skoro).procento).toBe(99);
    expect(prubehInventury([polozka({ napocitano: 0 })]).procento).toBe(100);
    expect(prubehInventury([])).toEqual({ hotovo: 0, celkem: 0, procento: 0 });
  });

  it("ocenění nezanáší chyby plovoucí čárky", () => {
    const s = souhrnInventury([
      polozka({ ocekavano: 3, napocitano: 0, nakupniCena: 0.1 }),
      polozka({ ocekavano: 3, napocitano: 0, nakupniCena: 0.2 }),
    ]);
    expect(s.mankoKc).toBe(0.9);
  });
});

describe("uzavření", () => {
  it("se všemi spočítanými jde uzavřít", () => {
    expect(lzeUzavrit(otevrena, [polozka({ napocitano: 1 }), polozka({ napocitano: 0 })], false)).toEqual({ ok: true });
  });

  it("s nespočítanými jen s výslovným „beze změny“", () => {
    const polozky = [polozka({ napocitano: 1 }), polozka(), polozka()];
    const r = lzeUzavrit(otevrena, polozky, false);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.duvod).toContain("Nespočítané položky: 2");
    expect(lzeUzavrit(otevrena, polozky, true)).toEqual({ ok: true });
  });

  it("nic nespočítáno a bez potvrzení nejde", () => {
    expect(lzeUzavrit(otevrena, [polozka()], false).ok).toBe(false);
  });

  it("uzavřenou, zrušenou, prázdnou ani bez skladu uzavřít nejde", () => {
    const p = [polozka({ napocitano: 1 })];
    expect(lzeUzavrit({ ...otevrena, status: "closed" }, p, true).ok).toBe(false);
    expect(lzeUzavrit({ ...otevrena, status: "cancelled" }, p, true).ok).toBe(false);
    expect(lzeUzavrit({ ...otevrena, warehouseId: null }, p, true).ok).toBe(false);
    expect(lzeUzavrit(otevrena, [], true).ok).toBe(false);
  });

  it("smazaný produkt nebrání uzavření", () => {
    expect(lzeUzavrit(otevrena, [polozka({ napocitano: 2 }), polozka({ productId: null })], false)).toEqual({ ok: true });
  });
});

describe("zápis počtu", () => {
  it("prázdné pole = nespočítáno", () => {
    expect(parseNapocitano("")).toEqual({ ok: true, hodnota: null });
    expect(parseNapocitano("   ")).toEqual({ ok: true, hodnota: null });
  });

  it("celá nezáporná čísla projdou, mezery se ignorují", () => {
    expect(parseNapocitano("0")).toEqual({ ok: true, hodnota: 0 });
    expect(parseNapocitano(" 12 ")).toEqual({ ok: true, hodnota: 12 });
    expect(parseNapocitano("1 200")).toEqual({ ok: true, hodnota: 1200 });
  });

  it("záporné, desetinné, text a EAN omylem v poli počtu neprojdou", () => {
    expect(parseNapocitano("-1").ok).toBe(false);
    expect(parseNapocitano("1,5").ok).toBe(false);
    expect(parseNapocitano("abc").ok).toBe(false);
    expect(parseNapocitano("8594001234567").ok).toBe(false);
  });

  it("každé pípnutí čtečky přičte kus", () => {
    expect(poctemZeCtecky({ napocitano: null })).toBe(1);
    expect(poctemZeCtecky({ napocitano: 4 })).toBe(5);
  });
});

describe("hledání a čtečka", () => {
  const polozky = [
    polozka({ nazev: "Displej iPhone 13", sku: "DSP-IP13" }),
    polozka({ nazev: "Baterie Samsung", sku: "BAT-S21", napocitano: 2, ocekavano: 2 }),
    polozka({ nazev: "Sklíčko kamery", sku: null, napocitano: 1, ocekavano: 3 }),
  ];

  it("hledá bez diakritiky v názvu i kódu", () => {
    expect(filtrujPolozky(polozky, "sklicko", "vse").map((p) => p.nazev)).toEqual(["Sklíčko kamery"]);
    expect(filtrujPolozky(polozky, "bat-s", "vse").map((p) => p.nazev)).toEqual(["Baterie Samsung"]);
  });

  it("filtr nespočítané a rozdíly", () => {
    expect(filtrujPolozky(polozky, "", "nespocitane").map((p) => p.nazev)).toEqual(["Displej iPhone 13"]);
    expect(filtrujPolozky(polozky, "", "rozdily").map((p) => p.nazev)).toEqual(["Sklíčko kamery"]);
  });

  it("kód čtečky se shoduje přesně, bez ohledu na velikost písmen a mezery", () => {
    expect(najdiPodleKodu(polozky, " dsp-ip13 ")?.nazev).toBe("Displej iPhone 13");
    expect(najdiPodleKodu(polozky, "DSP")).toBeNull();
    expect(najdiPodleKodu(polozky, "")).toBeNull();
  });

  it("dva řádky se stejným kódem = nejednoznačné", () => {
    expect(najdiPodleKodu([polozka({ sku: "X1" }), polozka({ sku: "x1" })], "X1")).toBeNull();
  });

  it("produkt k přidání najde podle SKU, jinak podle kódu dodavatele", () => {
    const produkty = [
      { id: "a", sku: "ABC", supplierSku: "D-1" },
      { id: "b", sku: "", supplierSku: "D-2" },
    ];
    expect(najdiProduktPodleKodu(produkty, "abc")?.id).toBe("a");
    expect(najdiProduktPodleKodu(produkty, "D-2")?.id).toBe("b");
    expect(najdiProduktPodleKodu(produkty, "nic")).toBeNull();
  });
});

describe("mapování z databáze", () => {
  it("čísla z PostgRESTu přijdou i jako text, prázdné zůstane null", () => {
    const p = mapPolozka({
      id: "i", stocktake_id: "st", product_id: "p", nazev: "Díl", sku: "",
      nakupni_cena: "120.50", ocekavano: 3, rezervovano: null, napocitano: null,
      stav_pri_pocitani: null, pridano_rucne: true,
    });
    expect(p.nakupniCena).toBe(120.5);
    expect(p.sku).toBeNull();
    expect(p.rezervovano).toBe(0);
    expect(p.napocitano).toBeNull();
    expect(p.pridanoRucne).toBe(true);
    expect(mapPolozka({ id: "i", stocktake_id: "st", napocitano: 0 }).napocitano).toBe(0);
  });

  it("souhrn z uzavření převede na camelCase", () => {
    const i = mapInventura({
      id: "st", service_id: "s", status: "closed", cislo: "INV-2026-002", zahajeno_at: "2026-09-27T08:00:00Z",
      souhrn: { polozek: 3, spocitano: 3, nespocitano: 0, s_rozdilem: 1, manko_ks: 2, prebytek_ks: 0, manko_kc: "300", prebytek_kc: 0, bez_ceny: 0 },
    });
    expect(i.status).toBe("closed");
    expect(i.souhrn?.mankoKc).toBe(300);
    expect(i.souhrn?.sRozdilem).toBe(1);
    expect(mapInventura({ id: "x", service_id: "s", status: "divny" }).status).toBe("open");
  });
});

describe("protokol CSV", () => {
  it("má BOM, středníky, řádky produktů a souhrn; středník v názvu se uzavře do uvozovek", () => {
    const csv = protokolCsv(
      { ...otevrena, status: "closed", uzavrel: "u2", uzavrenoAt: "2026-09-28T10:00:00Z" },
      [
        polozka({ nazev: "Kabel; USB-C", sku: "K1", ocekavano: 4, napocitano: 3, nakupniCena: 12.5, napocital: "u2" }),
        polozka({ nazev: "Starý díl", productId: null, ocekavano: 1 }),
      ],
      { u1: "Petr", u2: "Jana" }
    );
    expect(csv.startsWith("﻿")).toBe(true);
    const radky = csv.slice(1).split("\r\n");
    expect(radky[0]).toBe("Inventura;INV-2026-001");
    expect(radky).toContain("Zahájil;Petr");
    expect(radky).toContain("Uzavřel;Jana");
    const kabel = radky.find((r) => r.startsWith('"Kabel; USB-C"'));
    expect(kabel).toBe('"Kabel; USB-C";K1;4;0;4;3;-1;12,5;-12,5;;Jana;');
    expect(radky.some((r) => r.startsWith("Starý díl (smazaný produkt)"))).toBe(true);
    expect(radky).toContain("Manko ks;1");
    expect(radky).toContain("Manko Kč;12,5");
  });

  it("název souboru z čísla inventury", () => {
    expect(nazevProtokolu(otevrena)).toBe("inventura-INV-2026-001.csv");
    expect(nazevProtokolu({ cislo: "", zahajenoAt: "2026-09-27T08:00:00Z" })).toBe("inventura-2026-09-27.csv");
  });
});
