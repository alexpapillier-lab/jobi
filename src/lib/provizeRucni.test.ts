import { describe, expect, it } from "vitest";
import { ctiRucniCastku, jePolozkaBezZakazky, jeRucniPolozka, kodRucni } from "./provizeRucni";

describe("ruční položky provizí", () => {
  it("kód a rozpoznání", () => {
    expect(kodRucni(new Date(1_700_000_000_000))).toBe("RUCNI-1700000000000");
    expect(jeRucniPolozka("RUCNI-1")).toBe(true);
    expect(jeRucniPolozka("IRP26000001")).toBe(false);
    expect(jePolozkaBezZakazky("MESICNI-2026-11")).toBe(true);
    expect(jePolozkaBezZakazky("IRP26000001")).toBe(false);
  });

  it("částka z pole: kladné číslo, znaménko určuje tlačítko", () => {
    expect(ctiRucniCastku("6 000")).toBe(6000);
    expect(ctiRucniCastku("-6000")).toBe(6000);
    expect(ctiRucniCastku("1250,50 Kč")).toBe(1250.5);
    expect(ctiRucniCastku("")).toBeNull();
    expect(ctiRucniCastku("0")).toBeNull();
    expect(ctiRucniCastku("abc")).toBeNull();
  });
});
