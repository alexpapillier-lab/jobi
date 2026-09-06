import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Fronta neuložených změn je poslední pojistka proti ztrátě dat, takže se
 * testuje i to, co „se nemůže stát": dvojí odeslání, novější stav během
 * odesílání, chyba, kterou opakování nespraví.
 */

/** Zápisy, které „databáze" dostala. */
const zapsano: Array<{ tabulka: string; data: unknown; id: string }> = [];
/** Co má další zápis vrátit; `null` = úspěch. */
let dalsiChyba: unknown = null;

vi.mock("./supabaseClient", () => ({
  supabase: {
    from(tabulka: string) {
      return {
        update(data: unknown) {
          return {
            async eq(_sloupec: string, id: string) {
              if (dalsiChyba) return { error: dalsiChyba };
              zapsano.push({ tabulka, data, id });
              return { error: null };
            },
          };
        },
      };
    },
  },
}));

vi.mock("./errorLog", () => ({ logError: async () => {} }));

const { ulozNaPozdeji, odesliFrontu, neulozeneZmeny, vycistiFrontu, naFrontu, jeTrvalaChyba, nahlasCekani } = await import("./frontaZapisu");

function pametovyStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

beforeEach(() => {
  (globalThis as any).localStorage = pametovyStorage();
  zapsano.length = 0;
  dalsiChyba = null;
  vycistiFrontu();
});

const polozka = (klic: string, data: Record<string, unknown>) => ({
  klic,
  tabulka: "tickets",
  id: "t1",
  data,
  popis: "Zakázka · T1",
  serviceId: "s1",
});

describe("fronta neuložených změn", () => {
  it("zařazený zápis přežije a odešle se", async () => {
    ulozNaPozdeji(polozka("tickets:t1:detail", { title: "Ahoj" }));
    expect(neulozeneZmeny()).toHaveLength(1);

    const r = await odesliFrontu();
    expect(r.odeslano).toBe(1);
    expect(r.zbyva).toBe(0);
    expect(zapsano).toEqual([{ tabulka: "tickets", id: "t1", data: { title: "Ahoj" } }]);
    expect(neulozeneZmeny()).toHaveLength(0);
  });

  it("stejný klíč se nehromadí – ve frontě je poslední stav", () => {
    ulozNaPozdeji(polozka("tickets:t1:detail", { title: "První" }));
    ulozNaPozdeji(polozka("tickets:t1:detail", { title: "Druhý" }));
    const f = neulozeneZmeny();
    expect(f).toHaveLength(1);
    expect(f[0].data).toEqual({ title: "Druhý" });
  });

  it("různé klíče se odešlou obě", async () => {
    ulozNaPozdeji(polozka("tickets:t1:detail", { title: "A" }));
    ulozNaPozdeji(polozka("tickets:t1:loaner", { loaner: { nazev: "iPhone SE" } }));
    const r = await odesliFrontu();
    expect(r.odeslano).toBe(2);
    expect(zapsano).toHaveLength(2);
  });

  it("při výpadku sítě položka zůstane a zkusí se znovu", async () => {
    ulozNaPozdeji(polozka("tickets:t1:detail", { title: "Neztratit" }));
    dalsiChyba = new Error("Failed to fetch");
    const prvni = await odesliFrontu();
    expect(prvni.odeslano).toBe(0);
    expect(neulozeneZmeny()[0].pokusy).toBe(1);

    // Po neúspěchu se čeká, ať fronta nemlátí do sítě a baterie; ruční
    // „Zkusit hned“ čekání přeskočí.
    dalsiChyba = null;
    expect((await odesliFrontu()).odeslano).toBe(0);
    const druhy = await odesliFrontu(true);
    expect(druhy.odeslano).toBe(1);
    expect(zapsano[0].data).toEqual({ title: "Neztratit" });
  });

  it("odstup mezi pokusy roste, ať se nezkouší donekonečna každou chvíli", async () => {
    ulozNaPozdeji(polozka("tickets:t1:detail", { title: "X" }));
    dalsiChyba = new Error("Failed to fetch");
    await odesliFrontu();
    const dalsi = neulozeneZmeny()[0].dalsiPokusOd ?? 0;
    expect(dalsi).toBeGreaterThan(Date.now());
  });

  it("zaseknutou položku fronta sama nezkouší, ruční pokus ano", async () => {
    ulozNaPozdeji(polozka("tickets:t1:detail", { title: "Bez práva" }));
    dalsiChyba = { code: "42501", message: "row-level security" };
    await odesliFrontu();
    expect(neulozeneZmeny()[0].zaseknuto).toBe(true);

    dalsiChyba = null;
    expect((await odesliFrontu()).odeslano).toBe(0);
    expect((await odesliFrontu(true)).odeslano).toBe(1);
  });

  it("chyba oprávnění se neopakuje donekonečna, ale položka nezmizí", async () => {
    ulozNaPozdeji(polozka("tickets:t1:detail", { title: "Bez práva" }));
    dalsiChyba = { code: "42501", message: "new row violates row-level security policy" };
    await odesliFrontu();
    const f = neulozeneZmeny();
    expect(f).toHaveLength(1);
    expect(f[0].zaseknuto).toBe(true);
  });

  it("jeTrvalaChyba rozezná síť od oprávnění", () => {
    expect(jeTrvalaChyba(new Error("Failed to fetch"))).toBe(false);
    expect(jeTrvalaChyba(new TypeError("Load failed"))).toBe(false);
    expect(jeTrvalaChyba({ code: "42501", message: "x" })).toBe(true);
    expect(jeTrvalaChyba({ code: "23503", message: "violates foreign key" })).toBe(true);
  });

  it("posluchač dostane každou změnu fronty", async () => {
    const stavy: number[] = [];
    const odhlas = naFrontu((p) => stavy.push(p.length));
    ulozNaPozdeji(polozka("tickets:t1:detail", { title: "X" }));
    await odesliFrontu();
    odhlas();
    expect(stavy[0]).toBe(0);
    expect(stavy).toContain(1);
    expect(stavy[stavy.length - 1]).toBe(0);
  });

  it("fronta přežije restart aplikace – čte se z localStorage", async () => {
    ulozNaPozdeji(polozka("tickets:t1:detail", { title: "Po restartu" }));
    const ulozene = (globalThis as any).localStorage.getItem("jobi_neulozene_zmeny_v1");
    expect(ulozene).toContain("Po restartu");

    // Nový běh aplikace: modul si stav načte ze storage, nic v paměti nemá.
    vi.resetModules();
    const znovu = await import("./frontaZapisu");
    expect(znovu.neulozeneZmeny()).toHaveLength(1);
  });

  it("čekání mimo frontu je vidět, ale neodesílá se jako řádek", async () => {
    nahlasCekani("sklad", "Sklad · neuložené změny", new Error("Failed to fetch"));
    expect(neulozeneZmeny()).toHaveLength(1);
    expect(neulozeneZmeny()[0].popis).toBe("Sklad · neuložené změny");

    // Fronta má co odeslat jen z localStorage – sklad si opakování řídí sám.
    const r = await odesliFrontu();
    expect(r.odeslano).toBe(0);
    expect(zapsano).toHaveLength(0);
    expect(neulozeneZmeny()).toHaveLength(1);

    nahlasCekani("sklad", null);
    expect(neulozeneZmeny()).toHaveLength(0);
  });

  it("posluchač vidí i čekání mimo frontu", () => {
    const stavy: number[] = [];
    const odhlas = naFrontu((p) => stavy.push(p.length));
    nahlasCekani("sklad", "Sklad · neuložené změny");
    ulozNaPozdeji(polozka("tickets:t1:detail", { title: "X" }));
    odhlas();
    expect(stavy).toEqual([0, 1, 2]);
  });

  it("rozbitý obsah v localStorage frontu neshodí", () => {
    (globalThis as any).localStorage.setItem("jobi_neulozene_zmeny_v1", "{tohle není JSON");
    expect(neulozeneZmeny()).toEqual([]);
    ulozNaPozdeji(polozka("tickets:t1:detail", { title: "Nová" }));
    expect(neulozeneZmeny()).toHaveLength(1);
  });
});
