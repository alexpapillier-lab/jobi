import { describe, expect, it } from "vitest";
import {
  delkaZarukyOpravy,
  formatDatumZaruky,
  jeZakazkaFirmy,
  nastaveniZarukyZConfigu,
  normalizujMesice,
  stavZarukyOpravy,
  textZarukyOpravy,
  zarukaDo,
} from "./zarukaOpravy";

describe("záruka na opravu", () => {
  it("výchozí délky: spotřebitel 24, firma 12, přepsatelné v nastavení", () => {
    expect(nastaveniZarukyZConfigu(null)).toEqual({ spotrebitel: 24, firma: 12 });
    expect(nastaveniZarukyZConfigu({ zaruka_opravy_mesice: 6, zaruka_opravy_mesice_firma: 0 })).toEqual({ spotrebitel: 6, firma: 0 });
    // Text z formuláře se do configu neukládá; jen čísla, stejně jako v triggeru.
    expect(nastaveniZarukyZConfigu({ zaruka_opravy_mesice: "6" })).toEqual({ spotrebitel: 24, firma: 12 });
    expect(nastaveniZarukyZConfigu({ zaruka_opravy_mesice: 500 })).toEqual({ spotrebitel: 120, firma: 12 });
  });

  it("normalizace měsíců", () => {
    expect(normalizujMesice("")).toBeNull();
    expect(normalizujMesice(" ")).toBeNull();
    expect(normalizujMesice("abc")).toBeNull();
    expect(normalizujMesice("12,4")).toBe(12);
    expect(normalizujMesice(-3)).toBe(0);
    expect(normalizujMesice(0)).toBe(0);
  });

  it("firma se pozná podle IČO", () => {
    expect(jeZakazkaFirmy("123 45 678")).toBe(true);
    expect(jeZakazkaFirmy("  ")).toBe(false);
    expect(jeZakazkaFirmy(undefined)).toBe(false);
  });

  it("nejdelší záruka z provedených oprav, ceník má přednost před výchozí", () => {
    const cenik: Record<string, number | null> = { displej: 6, baterie: null, diagnostika: 0, kryt: 36 };
    const z = (id: string) => cenik[id];
    const n = { spotrebitel: 24, firma: 12 };
    expect(delkaZarukyOpravy([{ name: "Displej", repairId: "displej" }], z, false, n)).toBe(6);
    expect(delkaZarukyOpravy([{ name: "Displej", repairId: "displej" }, { name: "Ruční" }], z, false, n)).toBe(24);
    expect(delkaZarukyOpravy([{ name: "Baterie", repairId: "baterie" }], z, true, n)).toBe(12);
    expect(delkaZarukyOpravy([{ name: "Kryt", repairId: "kryt" }, { name: "Baterie", repairId: "baterie" }], z, true, n)).toBe(36);
    expect(delkaZarukyOpravy([{ name: "Diagnostika", repairId: "diagnostika" }], z, false, n)).toBe(0);
    // Bez oprav (nebo jen prázdné řádky) platí výchozí.
    expect(delkaZarukyOpravy([], z, false, n)).toBe(24);
    expect(delkaZarukyOpravy([{ name: " ", repairId: "diagnostika" }], z, true, n)).toBe(12);
  });

  it("konec záruky bez přetečení měsíce", () => {
    expect(zarukaDo(new Date(2026, 2, 12), 24)).toBe("2028-03-12");
    expect(zarukaDo(new Date(2026, 0, 31), 1)).toBe("2026-02-28");
    expect(zarukaDo(new Date(2027, 11, 31), 2)).toBe("2028-02-29");
    expect(zarukaDo(new Date(2026, 0, 31), 0)).toBeNull();
  });

  it("stav k dnešku: poslední den ještě platí", () => {
    expect(formatDatumZaruky("2028-03-12")).toBe("12. 3. 2028");
    expect(stavZarukyOpravy("2028-03-12", new Date(2028, 2, 12, 23, 59))).toEqual({ platna: true, datum: "12. 3. 2028" });
    const po = stavZarukyOpravy("2028-03-12", new Date(2028, 2, 13, 0, 1));
    expect(po?.platna).toBe(false);
    expect(textZarukyOpravy(po!)).toBe("Záruka na opravu do 12. 3. 2028 – prošla");
    expect(stavZarukyOpravy(null)).toBeNull();
    expect(stavZarukyOpravy("nesmysl")).toBeNull();
  });
});
