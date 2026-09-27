import { describe, expect, it } from "vitest";
import { chybiPodkladZaruky, jeAppleZarizeni, najdiStejneZarizeni, normalizujSeriove, odkazKontrolaImei, platnyImei, stavSerioveho, vypadaJakoAppleSeriove, vypadaJakoImei } from "./zarizeniHistorie";

describe("kontrola IMEI a sériového čísla při příjmu", () => {
  it("rozezná platné a neplatné IMEI včetně špatné délky", () => {
    expect(stavSerioveho("35-693803-564380-9")).toEqual({ druh: "imei", platne: true, hlaska: "IMEI je platné." });
    const spatne = stavSerioveho("356938035643800");
    expect(spatne.druh).toBe("imei");
    expect(spatne.platne).toBe(false);
    expect(spatne.hlaska).toMatch(/kontrolní číslice/);
    // 14 číslic je nejspíš IMEI bez jedné číslice – hlásí se délka, ne Luhn.
    expect(stavSerioveho("35693803564380")).toEqual({ druh: "imei", platne: false, hlaska: "IMEI má 15 číslic, zadáno 14." });
    expect(stavSerioveho("3569380356438090").platne).toBe(false);
  });

  it("Apple sériové číslo hlídá jen tvar; ostatní text a prázdno nehodnotí", () => {
    expect(vypadaJakoAppleSeriove("F2LXK1ABCD9X")).toBe(true);
    expect(vypadaJakoAppleSeriove("f2lx k1ab cd9x")).toBe(true);
    // Nová náhodná čísla mají 10 znaků.
    expect(vypadaJakoAppleSeriove("H4TJ9K2LMN")).toBe(true);
    expect(vypadaJakoAppleSeriove("F2LXK1ABCD9")).toBe(false);
    expect(vypadaJakoAppleSeriove("123456789012")).toBe(false);
    expect(stavSerioveho("F2LXK1ABCD9X")).toEqual({ druh: "apple", platne: true, hlaska: "Sériové číslo Apple ve správném tvaru." });
    expect(stavSerioveho("RF8N123ABC456")).toEqual({ druh: "jine", platne: true });
    expect(stavSerioveho("12345")).toEqual({ druh: "jine", platne: true });
    expect(stavSerioveho("")).toEqual({ druh: "prazdne", platne: true });
    expect(stavSerioveho(null)).toEqual({ druh: "prazdne", platne: true });
  });

  it("odkaz na kontrolu IMEI jen pro platné IMEI, bez mezer a pomlček", () => {
    expect(odkazKontrolaImei("35 693803 564380 9")).toBe("https://www.imei.info/?imei=356938035643809");
    expect(odkazKontrolaImei("356938035643800")).toBeNull();
    expect(odkazKontrolaImei("F2LXK1ABCD9X")).toBeNull();
    expect(odkazKontrolaImei("")).toBeNull();
  });

  it("pozná zařízení Apple podle názvu, ale ne Galaxy Watch", () => {
    for (const n of ["iPhone 13 Pro", "Apple iPad Air", "MacBook Pro 14", "iMac 24", "Mac mini M2", "Apple Watch Series 9", "Watch Ultra 2", "AirPods Pro"]) {
      expect(jeAppleZarizeni(n), n).toBe(true);
    }
    for (const n of ["Samsung Galaxy Watch 6", "Samsung Galaxy S23", "Xiaomi Redmi Note 12", "Macron TV", "", null]) {
      expect(jeAppleZarizeni(n), String(n)).toBe(false);
    }
  });

  it("záruční oprava vyžaduje datum nákupu nebo doklad", () => {
    expect(chybiPodkladZaruky({ warrantyClaim: true })).toBe(true);
    expect(chybiPodkladZaruky({ warrantyClaim: true, purchaseDate: "  ", purchaseProof: "" })).toBe(true);
    expect(chybiPodkladZaruky({ warrantyClaim: true, purchaseDate: "2025-03-12" })).toBe(false);
    expect(chybiPodkladZaruky({ warrantyClaim: true, purchaseProof: "účtenka Alza 123" })).toBe(false);
    expect(chybiPodkladZaruky({ warrantyClaim: false })).toBe(false);
    expect(chybiPodkladZaruky({})).toBe(false);
  });
});

describe("historie zařízení", () => {
  it("IMEI podle Luhna", () => {
    expect(vypadaJakoImei("35-693803-564380-9")).toBe(true);
    expect(platnyImei("356938035643809")).toBe(true);
    expect(platnyImei("35 693803 564380 9")).toBe(true);
    expect(platnyImei("356938035643800")).toBe(false);
    // Sériové číslo Apple není IMEI – nekontroluje se.
    expect(vypadaJakoImei("F2LXK1ABCD9")).toBe(false);
    expect(platnyImei("F2LXK1ABCD9")).toBe(true);
  });

  it("najde zakázky se stejným sériovým číslem bez ohledu na formát", () => {
    const z = [
      { id: "a", code: "Z1", createdAt: "2026-01-01", serialOrImei: "f2lxk1abcd9" },
      { id: "b", code: "Z2", createdAt: "2026-03-01", serialOrImei: "F2LX K1AB CD9" },
      { id: "c", code: "Z3", createdAt: "2026-02-01", serialOrImei: "jiné" },
      { id: "d", code: "Z4", createdAt: "2026-02-01", serialOrImei: "bez" },
    ];
    expect(najdiStejneZarizeni(z, "F2LXK1ABCD9").map((t) => t.code)).toEqual(["Z2", "Z1"]);
    expect(najdiStejneZarizeni(z, "F2LXK1ABCD9", "b").map((t) => t.code)).toEqual(["Z1"]);
    expect(najdiStejneZarizeni(z, "bez")).toEqual([]);
    expect(normalizujSeriove(" 35-69 ")).toBe("3569");
  });
});

describe("historie zařízení – hraniční případy", () => {
  it("prázdné a krátké vstupy nic nenajdou a nehlásí chybu", () => {
    expect(normalizujSeriove(null)).toBe("");
    expect(normalizujSeriove(undefined)).toBe("");
    expect(normalizujSeriove("  \t ")).toBe("");
    expect(vypadaJakoImei("")).toBe(false);
    expect(platnyImei("")).toBe(true);
    expect(platnyImei(null)).toBe(true);
    expect(najdiStejneZarizeni([{ id: "a", createdAt: "2026-01-01", serialOrImei: "" }], "")).toEqual([]);
    expect(najdiStejneZarizeni([{ id: "a", createdAt: "2026-01-01", serialOrImei: null }], null)).toEqual([]);
    expect(najdiStejneZarizeni([{ id: "a", createdAt: "2026-01-01" }], "ABC123456")).toEqual([]);
  });

  it("IMEI: 14 nebo 16 číslic není IMEI a nekontroluje se; samé nuly Luhnem projdou", () => {
    expect(vypadaJakoImei("35693803564380")).toBe(false);
    expect(platnyImei("35693803564380")).toBe(true);
    expect(vypadaJakoImei("3569380356438090")).toBe(false);
    expect(platnyImei("000000000000000")).toBe(true);
    // IMEI s písmenem uvnitř není IMEI, i když má po odstranění písmene 15 číslic.
    expect(vypadaJakoImei("35693803564380A9")).toBe(false);
  });

  it("diakritika a interpunkce se zahodí; textové poznámky nad 6 znaků se ale porovnávají (nález, nízká)", () => {
    expect(normalizujSeriove("Šn-ě 12")).toBe("N12");
    const z = [
      { id: "a", createdAt: "2026-01-01", serialOrImei: "neuvedeno" },
      { id: "b", createdAt: "2026-02-01", serialOrImei: "NEUVEDENO" },
    ];
    // „neuvedeno“ není identifikátor, přesto se hlásí jako stejné zařízení.
    expect(najdiStejneZarizeni(z, "Neuvedeno", "a").map((t) => t.id)).toEqual(["b"]);
  });

  it("řadí nejnovější první i při shodných datech", () => {
    const z = [
      { id: "a", createdAt: "2026-01-01T10:00:00Z", serialOrImei: "ABC123456" },
      { id: "b", createdAt: "2026-01-01T10:00:00Z", serialOrImei: "abc-123-456" },
      { id: "d", createdAt: "2026-05-01T10:00:00Z", serialOrImei: "abc123456" },
    ];
    const r = najdiStejneZarizeni(z, " abc-123-456 ");
    expect(r[0].id).toBe("d");
    expect(r.map((t) => t.id).sort()).toEqual(["a", "b", "d"]);
  });

  it("neplatné createdAt jednoho záznamu nesmí rozhodit pořadí ostatních (nález, nízká: NaN v komparátoru)", () => {
    const z = [
      { id: "a", createdAt: "2026-01-01T10:00:00Z", serialOrImei: "ABC123456" },
      { id: "b", createdAt: "2026-01-01T10:00:00Z", serialOrImei: "abc-123-456" },
      { id: "c", createdAt: "neplatné", serialOrImei: "ABC 123 456" },
      { id: "d", createdAt: "2026-05-01T10:00:00Z", serialOrImei: "abc123456" },
    ];
    const r = najdiStejneZarizeni(z, "ABC123456");
    expect(r.map((t) => t.id).sort()).toEqual(["a", "b", "c", "d"]);
    expect(r[0].id).toBe("d");
  });
});
