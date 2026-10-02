import { describe, it, expect } from "vitest";
import { aplikujAktualizaci, naplanujAktualizaci, popisHodnoty, prectiCislo } from "./importCeniku";
import { HLAVICKA_CENIKU, listCeniku } from "./exportCeniku";
import type { DevicesData } from "./types";

const t = "2026-01-01T00:00:00.000Z";

const data = (): DevicesData => ({
  brands: [{ id: "a", name: "Apple", createdAt: t }],
  categories: [{ id: "c", brandId: "a", name: "iPhone", createdAt: t }],
  models: [{ id: "m", categoryId: "c", name: "iPhone 13", createdAt: t }],
  repairs: [
    { id: "r1", modelIds: ["m"], name: "Výměna displeje", price: 1490, estimatedTime: 60, details: "", createdAt: t },
    { id: "r2", modelIds: ["m"], name: "Baterie", price: 990, estimatedTime: 30, details: "Originál", createdAt: t, costs: 300, warrantyMonths: 12 },
  ],
});

const H = [...HLAVICKA_CENIKU];
// sloupce: 0 ID, 1 Značka, 2 Kategorie, 3 Modely, 4 Oprava, 5 Cena, 6 Náklady, 7 Marže, 8 Čas, 9 Záruka, 10 Popis, 11 V API
const radek = (id: string, prepis: Record<number, unknown>) => {
  const r: unknown[] = [id, "Apple", "iPhone", "iPhone 13", "", "", "", "", "", "", "", ""];
  for (const [i, v] of Object.entries(prepis)) r[Number(i)] = v;
  return r as Array<string | number>;
};

describe("prectiCislo", () => {
  it("bere čísla i ručně psané hodnoty, prázdné jako null", () => {
    expect(prectiCislo(1490)).toBe(1490);
    expect(prectiCislo("1 490,50 Kč")).toBe(1490.5);
    expect(prectiCislo("")).toBeNull();
    expect(prectiCislo(undefined)).toBeNull();
    expect(prectiCislo("—")).toBeNull();
    expect(prectiCislo("hodně")).toBe("chyba");
  });
});

describe("naplanujAktualizaci", () => {
  it("doplní náklady a změní cenu, ostatní prázdné buňky nechá být", () => {
    const plan = naplanujAktualizaci(data(), [H, radek("r1", { 6: 620, 5: 1590 })]);
    expect(plan.chyby).toEqual([]);
    expect(plan.neznama).toEqual([]);
    expect(plan.zmeny).toEqual([{ id: "r1", nazev: "Výměna displeje", nove: { price: 1590, costs: 620 }, puvodni: { price: 1490, costs: undefined } }]);
  });

  it("řádek beze změny jen spočítá", () => {
    const plan = naplanujAktualizaci(data(), [H, radek("r2", { 4: "Baterie", 5: 990, 6: 300, 8: 30, 9: 12, 10: "Originál", 11: "ano" })]);
    expect(plan.zmeny).toEqual([]);
    expect(plan.bezeZmeny).toBe(1);
  });

  it("export a zpětné načtení beze změny nic nezmění", () => {
    const d = data();
    const list = listCeniku(d);
    const plan = naplanujAktualizaci(d, [list.hlavicka, ...list.radky.map((r) => r.map((h) => (h === null || h === undefined ? "" : h)))]);
    expect(plan.zmeny).toEqual([]);
    expect(plan.bezeZmeny).toBe(2);
  });

  it("neznámé ID nahlásí a přeskočí, prázdný řádek ignoruje", () => {
    const plan = naplanujAktualizaci(data(), [H, radek("cizi", { 6: 1 }), [], ["", "", ""]]);
    expect(plan.neznama).toEqual(["cizi"]);
    expect(plan.zmeny).toEqual([]);
  });

  it("nečitelná hodnota vyřadí celý řádek s číslem řádku", () => {
    const plan = naplanujAktualizaci(data(), [H, radek("r1", { 5: "drahé", 6: 100 })]);
    expect(plan.zmeny).toEqual([]);
    expect(plan.chyby).toEqual(['Řádek 2 (Výměna displeje): cena „drahé“ není číslo']);
  });

  it("záporné a necelé hodnoty tam, kde nedávají smysl, odmítne", () => {
    const plan = naplanujAktualizaci(data(), [H, radek("r1", { 6: -5 }), radek("r2", { 8: 12.5 })]);
    expect(plan.chyby).toEqual([
      "Řádek 2 (Výměna displeje): náklady -5 není nezáporné číslo",
      "Řádek 3 (Baterie): čas 12.5 není celé nezáporné číslo",
    ]);
  });

  it("V API bere ano/ne a změnu hlásí proti účinné hodnotě", () => {
    const plan = naplanujAktualizaci(data(), [H, radek("r1", { 11: "NE" }), radek("r2", { 11: "ano" })]);
    expect(plan.zmeny).toEqual([{ id: "r1", nazev: "Výměna displeje", nove: { publicVisible: false }, puvodni: { publicVisible: true } }]);
    expect(plan.bezeZmeny).toBe(1);
    expect(naplanujAktualizaci(data(), [H, radek("r1", { 11: "možná" })]).chyby[0]).toContain("má být ano nebo ne");
  });

  it("sloupce poznává podle názvu, ne podle pořadí", () => {
    const plan = naplanujAktualizaci(data(), [["Náklady", "id opravy"], [777, "r1"]]);
    expect(plan.zmeny[0].nove).toEqual({ costs: 777 });
  });

  it("bez sloupce ID nejde nic", () => {
    const plan = naplanujAktualizaci(data(), [["Oprava", "Cena"], ["Baterie", 1]]);
    expect(plan.chyby[0]).toContain("ID opravy");
  });
});

describe("aplikujAktualizaci", () => {
  it("přepíše jen dotčené opravy a jen uvedená pole", () => {
    const d = data();
    const out = aplikujAktualizaci(d, [{ id: "r1", nazev: "x", nove: { costs: 620, publicVisible: false }, puvodni: {} }]);
    expect(out.repairs[0]).toMatchObject({ id: "r1", price: 1490, costs: 620, publicVisible: false, name: "Výměna displeje" });
    expect(out.repairs[1]).toBe(d.repairs[1]);
    expect(out.brands).toBe(d.brands);
  });
});

describe("popisHodnoty", () => {
  it("formátuje pro náhled", () => {
    expect(popisHodnoty("costs", undefined)).toBe("—");
    // oddělovač tisíců je v cs-CZ úzká nezlomitelná mezera
    expect(popisHodnoty("price", 1490.5).replace(/\s/g, " ")).toBe("1 490,5 Kč");
    expect(popisHodnoty("publicVisible", false)).toBe("ne");
    expect(popisHodnoty("estimatedTime", 60)).toBe("60 min");
  });
});
