/**
 * Čísla na obrazovce Statistiky.
 *
 * Majitel se na tahle čísla dívá při rozhodování o cenách. Když se tisíce
 * neoddělí, přečte 120000 jako 12000 a splete se o řád. Když se do úzké
 * karty nevejde částka a zalomí se mezi číslo a „Kč“, vypadá to jako dvě
 * různá čísla. A české skloňování („5 dní“, ne „5 den“) je to, co odděluje
 * hotový program od rozdělané verze.
 */
import { describe, it, expect } from "vitest";
import {
  celeCislo,
  cislo,
  dny,
  formatCurrencyCompact,
  formatCurrencyRounded,
  monthLabelLong,
  monthLabelShort,
  zakazky,
} from "./format";

const NBSP = "\u00A0";

describe("částka v kartě", () => {
  it("tisíce se oddělují pevnou mezerou, aby se částka nezalomila", () => {
    expect(formatCurrencyRounded(1234)).toBe(`1${NBSP}234${NBSP}Kč`);
    expect(formatCurrencyRounded(1250000)).toBe(`1${NBSP}250${NBSP}000${NBSP}Kč`);
  });

  it("haléře se v kartě netisknou, ale zaokrouhlují", () => {
    expect(formatCurrencyRounded(1234.6)).toBe(`1${NBSP}235${NBSP}Kč`);
    expect(formatCurrencyRounded(1234.4)).toBe(`1${NBSP}234${NBSP}Kč`);
  });

  it("nula a ztráta se ukážou jako číslo, ne jako prázdno", () => {
    expect(formatCurrencyRounded(0)).toBe(`0${NBSP}Kč`);
    expect(formatCurrencyRounded(-2500)).toBe(`-2${NBSP}500${NBSP}Kč`);
  });
});

describe("zkrácená částka do grafu", () => {
  it("malé částky zůstávají přesné – u pár tisíc by zkratka ubrala informaci", () => {
    expect(formatCurrencyCompact(9999)).toBe(formatCurrencyRounded(9999));
    expect(formatCurrencyCompact(0)).toBe(formatCurrencyRounded(0));
  });

  it("od deseti tisíc se zkracuje, ať se popisek vejde nad sloupec", () => {
    expect(formatCurrencyCompact(12500)).toContain("tis.");
    expect(formatCurrencyCompact(1250000)).toContain("mil.");
  });

  it("zkracuje se i ztráta, ne jen zisk", () => {
    expect(formatCurrencyCompact(-45000)).toContain("tis.");
    expect(formatCurrencyCompact(-45000).startsWith("-")).toBe(true);
  });

  it("na hranici deseti tisíc se přepíná právě jednou", () => {
    expect(formatCurrencyCompact(9999)).not.toContain("tis.");
    expect(formatCurrencyCompact(10000)).toContain("tis.");
  });
});

describe("čísla česky", () => {
  it("desetinná čísla mají čárku, ne tečku", () => {
    expect(cislo(1234.567)).toBe(`1${NBSP}234,6`);
    expect(cislo(2.5)).toBe("2,5");
  });

  it("počet desetinných míst se dá zvolit a drží se, i když je číslo celé", () => {
    expect(cislo(3, 0)).toBe("3");
    expect(cislo(3, 2)).toBe("3,00");
  });

  it("celá čísla mají oddělené tisíce", () => {
    expect(celeCislo(1234567)).toBe(`1${NBSP}234${NBSP}567`);
    expect(celeCislo(0)).toBe("0");
  });
});

describe("skloňování ve statistikách", () => {
  it("dny se skloňují podle počtu", () => {
    expect(dny(1)).toBe("1 den");
    expect(dny(2)).toBe("2 dny");
    expect(dny(4)).toBe("4 dny");
    expect(dny(5)).toBe("5 dní");
    expect(dny(0)).toBe("0 dní");
  });

  it("průměr, který není celé číslo, se skloňuje jako „dne“", () => {
    expect(dny(2.5)).toBe("2,5 dne");
    expect(dny(1.2)).toBe("1,2 dne");
  });

  it("zakázky se skloňují podle počtu a u velkých čísel se oddělí tisíce", () => {
    expect(zakazky(1)).toBe("1 zakázka");
    expect(zakazky(3)).toBe("3 zakázky");
    expect(zakazky(5)).toBe("5 zakázek");
    expect(zakazky(0)).toBe("0 zakázek");
    expect(zakazky(1234)).toBe(`1${NBSP}234 zakázek`);
  });
});

describe("popisky měsíců v grafu", () => {
  it("krátký popisek je česká zkratka a dvojčíslí roku", () => {
    expect(monthLabelShort(2026, 0)).toBe("led 26");
    expect(monthLabelShort(2026, 2)).toBe("bře 26");
    expect(monthLabelShort(2026, 11)).toBe("pro 26");
  });

  it("každý měsíc má vlastní zkratku, žádná se neopakuje ani nechybí", () => {
    const zkratky = Array.from({ length: 12 }, (_, i) => monthLabelShort(2026, i).split(" ")[0]);
    expect(zkratky.filter((z) => z.length > 0)).toHaveLength(12);
    expect(new Set(zkratky).size).toBe(12);
  });

  it("dlouhý popisek je celý název měsíce s rokem", () => {
    expect(monthLabelLong(2026, 2)).toBe("březen 2026");
  });
});
