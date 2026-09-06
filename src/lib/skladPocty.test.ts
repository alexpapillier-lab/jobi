/**
 * Počty kusů na skladě.
 *
 * Součet přes sklady je číslo, které vidí technik na zakázce i zákazník ve
 * veřejném ceníku jako „skladem“. Když se spočítá špatně, slíbí servis díl,
 * který nemá, a zakázka se protáhne o dodací lhůtu.
 *
 * Minimální zásoba rozhoduje o tom, co se servisu nabídne k objednání.
 * Špatná výchozí hodnota znamená buď hlášky o všem, nebo o ničem.
 *
 * Převod ze staršího tvaru (jedno číslo `stock`) běží na hranici, kde do
 * aplikace vstupují data z localStorage a ze starších klientů – tady se
 * kusy nesmí ztratit ani zdvojit.
 */
import { describe, it, expect } from "vitest";
import {
  celkemKusu,
  minimalniZasoba,
  stavyZeStarehoTvaru,
  vychoziSklad,
  VYCHOZI_MIN_ZASOBA,
  type Warehouse,
} from "./inventoryDb";

const sklad = (id: string, isDefault = false): Warehouse => ({
  id,
  name: id,
  isDefault,
  publicVisible: true,
  createdAt: "2026-01-01T00:00:00Z",
});

describe("součet kusů přes sklady", () => {
  it("sečte kusy ze všech skladů servisu", () => {
    expect(celkemKusu({ hlavni: 3, pobocka: 2, dodavatel: 1 })).toBe(6);
  });

  it("produkt bez zásoby má nulu, ne NaN a ne prázdno", () => {
    expect(celkemKusu({})).toBe(0);
    expect(celkemKusu({ hlavni: 0, pobocka: 0 })).toBe(0);
  });

  it("chybějící hodnota u skladu součet neshodí na NaN", () => {
    expect(celkemKusu({ hlavni: 4, rozbity: undefined as unknown as number })).toBe(4);
    expect(celkemKusu({ hlavni: 4, rozbity: null as unknown as number })).toBe(4);
  });

  it("záporný stav (odepsáno víc, než bylo) se ze součtu neschová", () => {
    // technik musí vidět, že sklad nesedí, ne vyleštěnou nulu
    expect(celkemKusu({ hlavni: 5, pobocka: -2 })).toBe(3);
  });
});

describe("minimální zásoba", () => {
  it("vyplněná hodnota má přednost před výchozí", () => {
    expect(minimalniZasoba({ minStock: 2 })).toBe(2);
    expect(minimalniZasoba({ minStock: 0 })).toBe(0);
  });

  it("nevyplněná zásoba je výchozí, ne nula – jinak by nic nikdy nebylo pod minimem", () => {
    expect(minimalniZasoba({})).toBe(VYCHOZI_MIN_ZASOBA);
    expect(minimalniZasoba({ minStock: null })).toBe(VYCHOZI_MIN_ZASOBA);
    expect(minimalniZasoba({ minStock: undefined })).toBe(VYCHOZI_MIN_ZASOBA);
  });

  it("nesmysl z importu nepropadne do skladu", () => {
    expect(minimalniZasoba({ minStock: -3 })).toBe(VYCHOZI_MIN_ZASOBA);
    expect(minimalniZasoba({ minStock: Number.NaN })).toBe(VYCHOZI_MIN_ZASOBA);
    expect(minimalniZasoba({ minStock: Number.POSITIVE_INFINITY })).toBe(VYCHOZI_MIN_ZASOBA);
  });

  it("desetinná zásoba se zaokrouhlí na kusy – půl displeje neexistuje", () => {
    expect(minimalniZasoba({ minStock: 2.4 })).toBe(2);
    expect(minimalniZasoba({ minStock: 2.6 })).toBe(3);
  });
});

describe("výchozí sklad", () => {
  it("vybere označený výchozí, i když není v seznamu první", () => {
    expect(vychoziSklad([sklad("pobocka"), sklad("hlavni", true)])).toBe("hlavni");
  });

  it("bez označeného výchozího padne na první, ať se kusy mají kam zapsat", () => {
    expect(vychoziSklad([sklad("pobocka"), sklad("dodavatel")])).toBe("pobocka");
  });

  it("servis bez skladu nevrátí smyšlené id", () => {
    expect(vychoziSklad([])).toBeNull();
  });
});

describe("převod staršího tvaru skladu", () => {
  it("stavy po skladech se nechají, jak jsou – přepočet by data přepsal", () => {
    const stavy = { hlavni: 3, pobocka: 1 };
    expect(stavyZeStarehoTvaru({ stock: 99, stockByWarehouse: stavy }, "hlavni")).toEqual(stavy);
  });

  it("starý jediný počet spadne do výchozího skladu, ať se kusy neztratí", () => {
    expect(stavyZeStarehoTvaru({ stock: 7 }, "hlavni")).toEqual({ hlavni: 7 });
  });

  it("nulová zásoba nezaloží prázdný řádek skladu", () => {
    expect(stavyZeStarehoTvaru({ stock: 0 }, "hlavni")).toEqual({});
    expect(stavyZeStarehoTvaru({}, "hlavni")).toEqual({});
  });

  it("záporný ani desetinný počet se do skladu nedostane", () => {
    expect(stavyZeStarehoTvaru({ stock: -5 }, "hlavni")).toEqual({});
    expect(stavyZeStarehoTvaru({ stock: 2.6 }, "hlavni")).toEqual({ hlavni: 3 });
    expect(stavyZeStarehoTvaru({ stock: 2.4 }, "hlavni")).toEqual({ hlavni: 2 });
  });

  it("prázdná mapa stavů se bere jako „nic nevím“ a použije se starý počet", () => {
    expect(stavyZeStarehoTvaru({ stock: 4, stockByWarehouse: {} }, "hlavni")).toEqual({ hlavni: 4 });
  });

  it("součet po převodu odpovídá původnímu počtu", () => {
    for (const ks of [0, 1, 7, 250]) {
      expect(celkemKusu(stavyZeStarehoTvaru({ stock: ks }, "hlavni"))).toBe(ks);
    }
  });
});
