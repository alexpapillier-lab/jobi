/**
 * Odhadovaný čas opravy v lidské podobě pro veřejné API.
 * Hlídá hlavně české skloňování – 1 den / 2 dny / 5 dní.
 */
import { describe, it, expect } from "vitest";
import { popisCasu } from "../../supabase/functions/public-catalog/cas";

describe("popisCasu", () => {
  it("minuty skloňuje", () => {
    expect(popisCasu(1)).toBe("1 minuta");
    expect(popisCasu(3)).toBe("3 minuty");
    expect(popisCasu(30)).toBe("30 minut");
    expect(popisCasu(59)).toBe("59 minut");
  });

  it("hodiny skloňuje a půlhodiny nechává v desetinné podobě", () => {
    expect(popisCasu(60)).toBe("1 hodina");
    expect(popisCasu(120)).toBe("2 hodiny");
    expect(popisCasu(300)).toBe("5 hodin");
    expect(popisCasu(90)).toBe("1,5 hodiny");
  });

  it("dny skloňuje", () => {
    expect(popisCasu(1440)).toBe("1 den");
    expect(popisCasu(2880)).toBe("2 dny");
    expect(popisCasu(7200)).toBe("5 dní");
    // skutečná hodnota z ceníku iSwapu
    expect(popisCasu(10080)).toBe("7 dní");
  });

  it("neceloděnní hodnoty nezaokrouhluje na nesmysl", () => {
    expect(popisCasu(2160)).toBe("1,5 dne");
  });

  it("nesmysly vrací null, ne text", () => {
    expect(popisCasu(0)).toBeNull();
    expect(popisCasu(-5)).toBeNull();
    expect(popisCasu(null)).toBeNull();
    expect(popisCasu(undefined)).toBeNull();
    expect(popisCasu("abc")).toBeNull();
  });

  it("používá desetinnou čárku, ne tečku", () => {
    expect(popisCasu(90)).toContain(",");
    expect(popisCasu(90)).not.toContain(".");
  });
});
