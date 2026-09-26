import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { onboardingKroky } from "./onboardingKroky";
import { PRUVODCI, bezDiakritiky, dostupniPruvodci, hledejVPruvodcich, pruvodceProMisto, zjistiNovinky, type KontextPruvodcu } from "./pruvodci";

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

  it("„Ukázat, jak“ v Prvních krocích vede na existující průvodce a krok", () => {
    for (const k of onboardingKroky({ config: {}, zakazek: 0, clenu: 1, jobiDocsBezi: false, desktop: true, odkazJobiDocs: "" })) {
      const p = PRUVODCI.find((x) => x.id === k.pruvodce.id);
      expect(p, `krok „${k.id}“ odkazuje na neznámého průvodce ${k.pruvodce.id}`).toBeTruthy();
      expect(k.pruvodce.krok ?? 0).toBeLessThan(p!.kroky.length);
    }
  });

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

describe("hledání v průvodcích", () => {
  const d = dostupniPruvodci(kontext({ admin: true }));

  it("bez diakritiky a velikosti písmen", () => {
    expect(bezDiakritiky("Zakázkový LIST")).toBe("zakazkovy list");
    const a = hledejVPruvodcich(d, "REKLAMACE");
    const b = hledejVPruvodcich(d, "reklamace");
    expect(a.length).toBeGreaterThan(0);
    expect(a.map((v) => `${v.pruvodce.id}:${v.krok}`)).toEqual(b.map((v) => `${v.pruvodce.id}:${v.krok}`));
  });

  it("dotaz kratší než dva znaky nic nevrací", () => {
    expect(hledejVPruvodcich(d, "")).toEqual([]);
    expect(hledejVPruvodcich(d, "t")).toEqual([]);
    expect(hledejVPruvodcich(d, "  t ")).toEqual([]);
  });

  it("vede na konkrétní krok, ne jen na začátek průvodce", () => {
    const v = hledejVPruvodcich(d, "nová reklamace");
    const zakazky = v.find((x) => x.pruvodce.id === "zakazky");
    expect(zakazky).toBeTruthy();
    expect(zakazky!.pruvodce.kroky[zakazky!.krok].title).toBe("Nová reklamace");
  });

  it("shoda jen v názvu nebo popisu průvodce vrátí jeho první krok", () => {
    // „prémie“ je v popisu průvodce Odměny za opravy i v jeho kroku;
    // „pravidla prémií“ jako celek je jen v popisu.
    const v = hledejVPruvodcich(d, "pravidla prémií");
    const odmeny = v.find((x) => x.pruvodce.id === "nastaveni-odmeny");
    expect(odmeny).toBeTruthy();
    expect(odmeny!.krok).toBe(0);
  });

  it("každé slovo dotazu musí v průvodci být", () => {
    const ids = hledejVPruvodcich(d, "sklad rezervace").map((v) => v.pruvodce.id);
    expect(ids).toContain("sklad");
    expect(ids).not.toContain("zakaznici");
    expect(hledejVPruvodcich(d, "xyzneexistuje")).toEqual([]);
  });

  it("prohledává jen předané (dostupné) průvodce", () => {
    const bezAdmina = dostupniPruvodci(kontext());
    expect(hledejVPruvodcich(bezAdmina, "pozvat člena").map((v) => v.pruvodce.id)).not.toContain("nastaveni-tym");
    expect(hledejVPruvodcich(d, "pozvat člena").map((v) => v.pruvodce.id)).toContain("nastaveni-tym");
  });
});
