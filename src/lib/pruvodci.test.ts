import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PRUVODCI, dostupniPruvodci, pruvodceProMisto, zjistiNovinky, type KontextPruvodcu } from "./pruvodci";

/** Všechny kotvy data-tour v kódu: literály a předpony dynamických (`sidebar-nav-${…}`). */
function kotvyVKodu(): { literaly: Set<string>; predpony: string[] } {
  const literaly = new Set<string>();
  const predpony: string[] = [];
  const koren = path.resolve(__dirname, "..");
  const projdi = (dir: string) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) projdi(p);
      else if (/\.tsx?$/.test(f.name) && !f.name.endsWith(".test.ts")) {
        const s = fs.readFileSync(p, "utf-8");
        for (const m of s.matchAll(/data-tour="([^"]+)"/g)) literaly.add(m[1]);
        // Komponenty (Segmented) dostávají kotvu jako prop dataTour="…" a vykreslí ji jako data-tour.
        for (const m of s.matchAll(/dataTour(?:="|: ")([^"]+)"/g)) literaly.add(m[1]);
        for (const m of s.matchAll(/data-tour=\{`([^`$]+)\$\{/g)) predpony.push(m[1]);
      }
    }
  };
  projdi(koren);
  return { literaly, predpony };
}

const kontext = (o: Partial<KontextPruvodcu> = {}): KontextPruvodcu => ({
  admin: false,
  rootOwner: false,
  web: false,
  stranky: { orders: true, calendar: true, customers: true, inventory: true, devices: true, settings: true, statistics: true },
  moduly: {},
  ...o,
});

describe("kotvy průvodců existují v kódu", () => {
  const { literaly, predpony } = kotvyVKodu();
  for (const p of PRUVODCI) {
    it(`průvodce „${p.nazev}“ ukazuje jen na existující prvky`, () => {
      expect(p.kroky.length).toBeGreaterThan(0);
      for (const k of p.kroky) {
        if (!k.selector) continue;
        const m = k.selector.match(/^\[data-tour="([^"]+)"\]$/);
        expect(m, `selektor ${k.selector} má tvar [data-tour="…"]`).toBeTruthy();
        const kotva = m![1];
        const existuje = literaly.has(kotva) || predpony.some((pre) => kotva.startsWith(pre));
        expect(existuje, `kotva „${kotva}“ (krok „${k.title}“) v kódu není`).toBe(true);
      }
    });
  }

  it("id průvodců jsou jedinečná", () => {
    const ids = PRUVODCI.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("dostupnost podle role a modulů", () => {
  it("API průvodce jen s modulem API, pobočky jen správci s modulem", () => {
    const bez = dostupniPruvodci(kontext()).map((p) => p.id);
    expect(bez).not.toContain("nastaveni-api");
    expect(bez).not.toContain("nastaveni-pobocky");
    expect(bez).not.toContain("nastaveni-tym");
    const s = dostupniPruvodci(kontext({ admin: true, moduly: { api_catalog: true, branches: true } })).map((p) => p.id);
    expect(s).toContain("nastaveni-api");
    expect(s).toContain("nastaveni-pobocky");
    expect(s).toContain("nastaveni-tym");
  });

  it("stránky, které uživatel nemá v navigaci, průvodce nenabízí", () => {
    const ids = dostupniPruvodci(kontext({ stranky: { orders: true, statistics: false } })).map((p) => p.id);
    expect(ids).not.toContain("statistiky");
    expect(ids).not.toContain("faktury");
    expect(ids).not.toContain("odmeny");
    expect(ids).toContain("zakazky");
  });

  it("průvodce pro místo: podsekce Nastavení má přednost, Zakázky nedostanou úvod", () => {
    const d = dostupniPruvodci(kontext({ admin: true }));
    expect(pruvodceProMisto(d, "orders")?.id).toBe("zakazky");
    expect(pruvodceProMisto(d, "settings", "orders_prace")?.id).toBe("nastaveni-prace");
    expect(pruvodceProMisto(d, "settings", "neexistuje")).toBeNull();
  });
});

describe("novinky", () => {
  const d = dostupniPruvodci(kontext({ admin: true, stranky: { orders: true, statistics: true, odmeny: true, settings: true } }));

  it("první spuštění nic neoznamuje, jen si zapamatuje stav", () => {
    const r = zjistiNovinky(d, null, new Date("2026-09-26"));
    expect(r.novinky).toEqual([]);
    expect(r.ulozit.dostupneDrive).toContain("odmeny");
    expect(r.ulozit.posledniKontrola).toBe("2026-09-26");
  });

  it("nově zpřístupněný průvodce (zapnutý modul) je novinka; prošlý už ne", () => {
    const drive = { dostupneDrive: d.map((p) => p.id).filter((id) => id !== "odmeny"), posledniKontrola: "2026-09-27", videno: {}, neprosle: [] };
    const r = zjistiNovinky(d, drive, new Date("2026-09-28"));
    expect(r.novinky.map((p) => p.id)).toEqual(["odmeny"]);
    expect(r.ulozit.neprosle).toContain("odmeny");
    const uzProsel = { ...drive, videno: { odmeny: "2026-09-27" } };
    expect(zjistiNovinky(d, uzProsel, new Date("2026-09-28")).novinky).toEqual([]);
  });

  it("průvodce s novinkaOd po poslední kontrole je novinka i pro známou stránku", () => {
    const drive = { dostupneDrive: d.map((p) => p.id), posledniKontrola: "2026-09-01", videno: {}, neprosle: [] };
    const ids = zjistiNovinky(d, drive, new Date("2026-09-28")).novinky.map((p) => p.id);
    expect(ids).toContain("statistiky");
    expect(ids).not.toContain("uvod");
    expect(ids).not.toContain("zakazky");
  });
});
