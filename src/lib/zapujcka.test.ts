import { afterEach, describe, expect, it, vi } from "vitest";
import { dnesDatum, jeVraceno, normalizujNahradni } from "./zapujcka";

describe("zápůjčka", () => {
  it("normalizace seznamu náhradních zařízení: nesmysly pryč, id pořadové, kauce jen kladné číslo", () => {
    expect(normalizujNahradni(undefined)).toEqual([]);
    expect(normalizujNahradni("x")).toEqual([]);
    expect(normalizujNahradni({})).toEqual([]);
    expect(normalizujNahradni([
      null, 1, { nazev: "" }, { nazev: "   " }, { seriove: "bez názvu" },
      { id: "", nazev: " iPhone SE ", seriove: " ", prislusenstvi: " kabel ", kauce: 0 },
      { id: "k1", nazev: "Pixel", kauce: "500", seriove: "SN1" },
      { nazev: "Nokia", kauce: -5, prislusenstvi: 7 },
      { nazev: "Moto", kauce: Number.NaN },
    ])).toEqual([
      { id: "n_0", nazev: "iPhone SE", seriove: undefined, prislusenstvi: "kabel", kauce: undefined },
      // kauce jako text („500“ z ručně upraveného configu) se tiše zahodí
      { id: "k1", nazev: "Pixel", seriove: "SN1", prislusenstvi: undefined, kauce: undefined },
      { id: "n_2", nazev: "Nokia", seriove: undefined, prislusenstvi: undefined, kauce: undefined },
      { id: "n_3", nazev: "Moto", seriove: undefined, prislusenstvi: undefined, kauce: undefined },
    ]);
  });

  it("jeVraceno: jen neprázdné datum vrácení", () => {
    expect(jeVraceno(null)).toBe(false);
    expect(jeVraceno(undefined)).toBe(false);
    expect(jeVraceno({ nazev: "x", pujceno: "2026-09-01" })).toBe(false);
    expect(jeVraceno({ nazev: "x", pujceno: "2026-09-01", vraceno: null })).toBe(false);
    expect(jeVraceno({ nazev: "x", pujceno: "2026-09-01", vraceno: "" })).toBe(false);
    expect(jeVraceno({ nazev: "x", pujceno: "2026-09-01", vraceno: "2026-09-05" })).toBe(true);
  });

  describe("dnesDatum", () => {
    const puvodniTz = process.env.TZ;
    afterEach(() => {
      vi.useRealTimers();
      process.env.TZ = puvodniTz;
    });

    it("vrací YYYY-MM-DD", () => {
      expect(dnesDatum()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("po půlnoci místního času vrací dnešek, ne včerejšek podle UTC (nález)", () => {
      process.env.TZ = "Europe/Prague";
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-07-02T00:30:00+02:00"));
      const d = new Date();
      const mistni = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      expect(mistni).toBe("2026-07-02");
      expect(dnesDatum()).toBe(mistni);
    });
  });
});
