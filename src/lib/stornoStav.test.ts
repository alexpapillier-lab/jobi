/**
 * Storno stavy. Pravidlo rozhoduje o tom, které peníze se objeví v tržbách,
 * takže se nesmí utrhnout od databázové funkce `public.stav_je_storno`.
 */
import { describe, it, expect } from "vitest";
import { jeStornoStav, stornoPodleStavu } from "./stornoStav";

describe("rozpoznání storna", () => {
  it("pozná storno podle klíče, ať se stav jmenuje jakkoli", () => {
    expect(jeStornoStav("cancelled", "Zrušeno")).toBe(true);
    expect(jeStornoStav("cancelled", "Stornováno")).toBe(true);
    expect(jeStornoStav("storno", "Konec")).toBe(true);
  });

  it("pozná storno podle názvu, i když si servis dal vlastní klíč", () => {
    expect(jeStornoStav("stav_7", "Neopraveno / Neopravitelné")).toBe(true);
    expect(jeStornoStav("x", "Nerealizováno")).toBe(true);
    expect(jeStornoStav("x", "Zákazník odmítnul")).toBe(true);
  });

  it("běžné stavy storno nejsou – jinak by z tržeb zmizely opravené zakázky", () => {
    for (const [klic, nazev] of [
      ["received", "Přijato"],
      ["completed", "Opraveno"],
      ["issued", "Vydáno"],
      ["ready_for_pickup", "Připraveno k převzetí"],
      ["returned_unrepaired", "Vráceno bez opravy"],
      ["waiting_part", "Čeká na díl"],
      ["diagnosis", "Diagnostika"],
    ] as const) {
      expect(jeStornoStav(klic, nazev), `${klic} / ${nazev}`).toBe(false);
    }
  });

  it("prázdný nebo chybějící stav storno není", () => {
    expect(jeStornoStav(null)).toBe(false);
    expect(jeStornoStav(undefined, undefined)).toBe(false);
    expect(jeStornoStav("", "")).toBe(false);
  });

  it("regulární výraz si nepamatuje pozici z minulého volání", () => {
    // Se zapnutým /g by druhé volání vyšlo jinak než první.
    expect(jeStornoStav("cancelled")).toBe(true);
    expect(jeStornoStav("cancelled")).toBe(true);
  });
});

describe("předpis podle seznamu stavů servisu", () => {
  const jeStorno = stornoPodleStavu([
    { key: "prijato", label: "Přijato" },
    { key: "hotovo", label: "Opraveno" },
    { key: "x1", label: "Zrušeno zákazníkem" },
  ]);

  it("použije název ze seznamu stavů", () => {
    expect(jeStorno("x1")).toBe(true);
    expect(jeStorno("hotovo")).toBe(false);
  });

  it("neznámý stav posoudí aspoň podle klíče", () => {
    expect(jeStorno("cancelled")).toBe(true);
    expect(jeStorno("neco_jineho")).toBe(false);
    expect(jeStorno(null)).toBe(false);
  });
});
