/**
 * Zvýraznění stavu ve výpisu zakázek.
 *
 * Nejdůležitější je dopočet barvy písma: barvy stavů si nastavuje servis
 * sám, takže plná výplň libovolnou barvou nesmí skončit bílým textem na
 * žluté.
 */
import { describe, it, expect } from "vitest";
import { barvaTextu, jas, rozlozBarvu, stylStavu, jeZvyrazneni } from "./zvyrazneniStavu";

const CERNA = "#10171A";
const BILA = "#FFFFFF";

describe("rozlozBarvu", () => {
  it("umí #rrggbb i zkrácené #rgb", () => {
    expect(rozlozBarvu("#ff8800")).toEqual({ r: 255, g: 136, b: 0 });
    expect(rozlozBarvu("#f80")).toEqual({ r: 255, g: 136, b: 0 });
    expect(rozlozBarvu("#FF8800")).toEqual({ r: 255, g: 136, b: 0 });
  });

  it("na cokoli jiného vrátí null", () => {
    expect(rozlozBarvu("var(--border)")).toBeNull();
    expect(rozlozBarvu("rgb(1,2,3)")).toBeNull();
    expect(rozlozBarvu("")).toBeNull();
    expect(rozlozBarvu("#12345")).toBeNull();
  });
});

describe("barvaTextu", () => {
  it("na světlém pozadí černá, na tmavém bílá", () => {
    expect(barvaTextu("#FFFFFF")).toBe(CERNA);
    expect(barvaTextu("#000000")).toBe(BILA);
  });

  // Přesně ty případy, kvůli kterým se to počítá.
  it("žlutá chce černý text, tmavě modrá bílý", () => {
    expect(barvaTextu("#FFE500")).toBe(CERNA);
    expect(barvaTextu("#F2C744")).toBe(CERNA);
    expect(barvaTextu("#1B3A6B")).toBe(BILA);
    expect(barvaTextu("#0E7C6B")).toBe(BILA);
  });

  it("zelená váží víc než modrá – čistě modrá je tmavší než čistě zelená", () => {
    expect(jas("#00FF00")!).toBeGreaterThan(jas("#0000FF")!);
    expect(barvaTextu("#00FF00")).toBe(CERNA);
    expect(barvaTextu("#0000FF")).toBe(BILA);
  });

  it("u neznámé barvy nehádá a nechá barvu z motivu", () => {
    expect(barvaTextu("var(--border)")).toBe("var(--text)");
  });
});

describe("stylStavu", () => {
  it("bez zvýraznění nechá panel a jen tenký proužek", () => {
    const s = stylStavu("#0E7C6B", "zadne");
    expect(s.pozadi).toBe("var(--panel)");
    expect(s.barvaPisma).toBe("var(--text)");
    expect(s.sirkaProuzku).toBe(4);
  });

  it("jemné obarví podklad s nízkým krytím a text nechá z motivu", () => {
    const s = stylStavu("#0E7C6B", "jemne");
    expect(s.pozadi).toBe("#0E7C6B1F");
    expect(s.barvaPisma).toBe("var(--text)");
    expect(s.sirkaProuzku).toBe(6);
  });

  it("výrazné vyplní barvou a dopočítá čitelný text", () => {
    expect(stylStavu("#FFE500", "vyrazne").pozadi).toBe("#FFE500");
    expect(stylStavu("#FFE500", "vyrazne").barvaPisma).toBe(CERNA);
    expect(stylStavu("#1B3A6B", "vyrazne").barvaPisma).toBe(BILA);
  });

  // Hotové zakázky nemají křičet stejně jako ty, co čekají na práci.
  it("konečný stav ztlumí", () => {
    expect(stylStavu("#0E7C6B", "jemne", true).pozadi).toBe("#0E7C6B0A");
    const v = stylStavu("#FFE500", "vyrazne", true);
    expect(v.pozadi).toBe("#FFE50055");
    expect(v.barvaPisma).toBe("var(--text)");
  });

  it("na proměnnou CSS se chová jako bez zvýraznění – nedá se z ní počítat", () => {
    const s = stylStavu(undefined, "vyrazne");
    expect(s.pozadi).toBe("var(--panel)");
    expect(s.barvaPisma).toBe("var(--text)");
  });
});

describe("jeZvyrazneni", () => {
  it("propustí jen známé hodnoty", () => {
    expect(jeZvyrazneni("jemne")).toBe(true);
    expect(jeZvyrazneni("vyrazne")).toBe(true);
    expect(jeZvyrazneni("zadne")).toBe(true);
    expect(jeZvyrazneni("silne")).toBe(false);
    expect(jeZvyrazneni(null)).toBe(false);
  });
});
