import { describe, expect, it } from "vitest";
import { fetchAllPages } from "./fetchAllPages";

/**
 * Stránkování je jediné místo, kudy do aplikace tečou velké seznamy. Když se
 * splete o stránku, uživatel to nepozná – jen mu část zakázek zmizí.
 */

/** Falešná tabulka: vrací výsek pole podle `range`, jako to dělá PostgREST. */
function tabulka(pocet: number) {
  const volani: [number, number][] = [];
  const radky = Array.from({ length: pocet }, (_, i) => ({ id: i }));
  const nacti = async (od: number, doo: number) => {
    volani.push([od, doo]);
    return { data: radky.slice(od, doo + 1), error: null };
  };
  return { nacti, volani };
}

describe("fetchAllPages", () => {
  it("malý servis se zeptá jenom jednou", async () => {
    const t = tabulka(37);
    const { data, error } = await fetchAllPages(t.nacti, 100);
    expect(error).toBeNull();
    expect(data).toHaveLength(37);
    expect(t.volani).toEqual([[0, 99]]);
  });

  it("prázdná tabulka vrátí prázdno a jeden dotaz", async () => {
    const t = tabulka(0);
    const { data } = await fetchAllPages(t.nacti, 100);
    expect(data).toHaveLength(0);
    expect(t.volani).toHaveLength(1);
  });

  it("posbírá všechny řádky ve správném pořadí i přes víc stránek", async () => {
    const t = tabulka(4800);
    const { data } = await fetchAllPages(t.nacti, 1000);
    expect(data).toHaveLength(4800);
    expect(data.map((r) => r.id)).toEqual(Array.from({ length: 4800 }, (_, i) => i));
  });

  it("stránky od druhé tahá po dávkách, ne jednu po druhé", async () => {
    const t = tabulka(4800);
    await fetchAllPages(t.nacti, 1000, 4);
    // První stránka sama, zbylé čtyři v jedné dávce – tedy dvě kola po síti.
    expect(t.volani).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
      [3000, 3999],
      [4000, 4999],
    ]);
  });

  it("souběžnost 1 se chová jako původní sekvenční stránkování", async () => {
    const t = tabulka(2500);
    const { data } = await fetchAllPages(t.nacti, 1000, 1);
    expect(data).toHaveLength(2500);
    expect(t.volani).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("chyba na první stránce se vrátí a dál se nečte", async () => {
    let volani = 0;
    const { data, error } = await fetchAllPages(async () => {
      volani += 1;
      return { data: null, error: { message: "spadlo to" } };
    }, 100);
    expect(error).toEqual({ message: "spadlo to" });
    expect(data).toHaveLength(0);
    expect(volani).toBe(1);
  });

  it("chyba v dávce vrátí to, co se stihlo načíst", async () => {
    const radky = Array.from({ length: 3000 }, (_, i) => ({ id: i }));
    const { data, error } = await fetchAllPages<{ id: number }>(async (od, doo) => {
      if (od >= 2000) return { data: null, error: { message: "timeout" } };
      return { data: radky.slice(od, doo + 1), error: null };
    }, 1000, 4);
    expect(error).toEqual({ message: "timeout" });
    expect(data).toHaveLength(2000);
  });
});
