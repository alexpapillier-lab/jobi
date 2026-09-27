import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Zápis napočítaných kusů: číslo z regálu se nesmí ztratit. Výpadek sítě ho
 * pošle do fronty neuložených změn, chybějící právo ho ukáže jako chybu
 * (opakování by nepomohlo) a novější úspěšný zápis nesmí přepsat starší
 * zápis, který ve frontě čeká na síť.
 */

/** Co má další `update` vrátit. */
let odpoved: { data: unknown; error: unknown } | "vyjimka" = { data: [], error: null };
const zapisy: Array<{ data: unknown; id: string }> = [];

const klient = {
  from(_tabulka: string) {
    return {
      update(data: unknown) {
        return {
          eq(_sloupec: string, id: string) {
            return {
              async select(_sloupce: string) {
                if (odpoved === "vyjimka") throw new TypeError("Failed to fetch");
                zapisy.push({ data, id });
                return odpoved;
              },
            };
          },
        };
      },
    };
  },
};

vi.mock("./supabaseClient", () => ({ supabase: null, getSupabaseClient: () => klient }));
vi.mock("./errorLog", () => ({ logError: async () => {} }));

const { zapsatNapocitano } = await import("./inventuraDb");
const { neulozeneZmeny, vycistiFrontu } = await import("./frontaZapisu");

function pametovyStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

const radek = { id: "i1", nazev: "Displej" };
const zDb = (napocitano: number | null) => ({
  id: "i1", stocktake_id: "st1", product_id: "p1", nazev: "Displej", ocekavano: 5, napocitano,
  stav_pri_pocitani: 5, napocital: "u1", napocitano_at: "2026-09-27T10:00:00Z",
});

beforeEach(() => {
  (globalThis as unknown as { localStorage: unknown }).localStorage = pametovyStorage();
  zapisy.length = 0;
  vycistiFrontu();
});

describe("zápis napočítaných kusů", () => {
  it("povedený zápis vrátí čerstvý řádek (kdo, kdy, stav při počítání)", async () => {
    odpoved = { data: [zDb(4)], error: null };
    const r = await zapsatNapocitano(radek, 4, "s1", "INV-2026-001");
    expect(r.stav).toBe("ulozeno");
    if (r.stav === "ulozeno") {
      expect(r.polozka?.napocitano).toBe(4);
      expect(r.polozka?.stavPriPocitani).toBe(5);
    }
    expect(zapisy).toEqual([{ data: { napocitano: 4 }, id: "i1" }]);
    expect(neulozeneZmeny()).toHaveLength(0);
  });

  it("výpadek sítě = do fronty s cílovým stavem, nic se neztratí", async () => {
    odpoved = "vyjimka";
    const r = await zapsatNapocitano(radek, 3, "s1", "INV-2026-001");
    expect(r.stav).toBe("ve-fronte");
    const fronta = neulozeneZmeny();
    expect(fronta).toHaveLength(1);
    expect(fronta[0]).toMatchObject({ tabulka: "inventory_stocktake_items", id: "i1", data: { napocitano: 3 } });
    expect(fronta[0].popis).toContain("INV-2026-001");
  });

  it("uzavřená inventura nebo chybějící právo = chyba, ne fronta", async () => {
    odpoved = { data: null, error: { code: "42501", message: "Inventura už je uzavřená – napočítaný stav se nezapsal." } };
    const r = await zapsatNapocitano(radek, 3, "s1", "INV-2026-001");
    expect(r).toEqual({ stav: "chyba", zprava: "Inventura už je uzavřená – napočítaný stav se nezapsal." });
    expect(neulozeneZmeny()).toHaveLength(0);
  });

  it("zápis, který nesedl na žádný řádek, se nehlásí jako uložený", async () => {
    odpoved = { data: [], error: null };
    const r = await zapsatNapocitano(radek, 3, "s1", "INV-2026-001");
    expect(r.stav).toBe("chyba");
  });

  it("novější úspěšný zápis přepíše starší čekající ve frontě", async () => {
    odpoved = "vyjimka";
    await zapsatNapocitano(radek, 3, "s1", "INV-2026-001");
    odpoved = { data: [zDb(7)], error: null };
    const r = await zapsatNapocitano(radek, 7, "s1", "INV-2026-001");
    expect(r.stav).toBe("ulozeno");
    const fronta = neulozeneZmeny();
    expect(fronta).toHaveLength(1);
    // Fronta po návratu sítě zapíše 7, ne zastaralou 3.
    expect(fronta[0].data).toEqual({ napocitano: 7 });
  });
});
