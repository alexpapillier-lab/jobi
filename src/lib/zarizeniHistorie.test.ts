import { describe, expect, it } from "vitest";
import { najdiStejneZarizeni, normalizujSeriove, platnyImei, vypadaJakoImei } from "./zarizeniHistorie";

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
