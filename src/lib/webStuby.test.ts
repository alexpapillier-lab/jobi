/**
 * Web-stuby vs. skutečné pluginy Tauri.
 *
 * Webová verze podstrkuje místo `@tauri-apps/*` vlastní soubory z web-stubs/
 * (viz vite.config.web.ts). Rozejití rozhraní je zákeřné: web funguje dál,
 * desktop padá (nebo naopak), a nikdo si toho nevšimne, protože každou verzi
 * zkouší někdo jiný.
 *
 * Typy hlídá `tsc` (stuby jsou psané jako `typeof Skutecny.neco` a jsou
 * v tsconfigu). Tady se hlídá to, co typy neuvidí:
 * 1. každý modul `@tauri-apps/*`, který aplikace importuje, má ve webovém
 *    configu náhradu – jinak by se do prohlížeče zabalil skutečný plugin
 *    a spadl při prvním volání,
 * 2. stub nevymýšlí funkce, které v pluginu nejsou,
 * 3. stub má všechno, co z modulu aplikace používá.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const KOREN = path.resolve(__dirname, "..", "..");
const SRC = path.join(KOREN, "src");
const STUBY = path.join(KOREN, "web-stubs");

function vsechnyZdroje(dir: string, sber: string[] = []): string[] {
  for (const polozka of readdirSync(dir)) {
    const p = path.join(dir, polozka);
    if (statSync(p).isDirectory()) vsechnyZdroje(p, sber);
    else if (/\.tsx?$/.test(polozka) && !/\.test\.tsx?$/.test(polozka)) sber.push(p);
  }
  return sber;
}

/** Moduly @tauri-apps/*, které aplikace importuje – staticky i dynamicky. */
function importovaneModuly(): Map<string, Set<string>> {
  const nalezene = new Map<string, Set<string>>();
  for (const soubor of vsechnyZdroje(SRC)) {
    const text = readFileSync(soubor, "utf-8");
    for (const m of text.matchAll(/from\s+"(@tauri-apps\/[^"]+)"|import\("(@tauri-apps\/[^"]+)"\)/g)) {
      const modul = m[1] ?? m[2];
      if (!nalezene.has(modul)) nalezene.set(modul, new Set());
    }
    // `const { openUrl } = await import("…")` a `import { save } from "…"`
    for (const m of text.matchAll(/(?:const|import)\s*\{([^}]+)\}\s*=?\s*(?:await\s+)?(?:from\s+)?(?:import\()?"(@tauri-apps\/[^"]+)"/g)) {
      const modul = m[2];
      const jmena = nalezene.get(modul) ?? new Set<string>();
      for (const j of m[1].split(",")) {
        const cist = j.split(":")[0].trim().replace(/^type\s+/, "");
        if (cist && /^[A-Za-z_$][\w$]*$/.test(cist)) jmena.add(cist);
      }
      nalezene.set(modul, jmena);
    }
  }
  return nalezene;
}

/** Mapa alias → soubor stubu z vite.config.web.ts. */
function aliasyWebu(): Map<string, string> {
  const config = readFileSync(path.join(KOREN, "vite.config.web.ts"), "utf-8");
  const mapa = new Map<string, string>();
  for (const m of config.matchAll(/"(@tauri-apps\/[^"]+)":\s*stub\("([^"]+)"\)/g)) mapa.set(m[1], m[2]);
  return mapa;
}

const moduly = importovaneModuly();
const aliasy = aliasyWebu();

describe("webový build nesmí zabalit skutečný plugin Tauri", () => {
  it("aplikace vůbec nějaké @tauri-apps moduly importuje (test by jinak nic nehlídal)", () => {
    expect(moduly.size).toBeGreaterThan(3);
  });

  it("každý importovaný modul má ve vite.config.web.ts náhradu", () => {
    const bezNahrady = [...moduly.keys()].filter((m) => !aliasy.has(m));
    expect(bezNahrady, "chybí stub – web by spadl při prvním volání").toEqual([]);
  });

  it("konfigurace neodkazuje na neexistující soubor stubu", () => {
    for (const [modul, soubor] of aliasy) {
      expect(() => statSync(path.join(STUBY, soubor)), `${modul} → ${soubor}`).not.toThrow();
    }
  });
});

describe("rozhraní stubu odpovídá pluginu", () => {
  for (const [modul, soubor] of aliasyWebu()) {
    it(`${modul}: stub nevymýšlí nic navíc a má vše, co aplikace používá`, async () => {
      const stub = await import(/* @vite-ignore */ path.join(STUBY, soubor));
      const skutecny = await import(/* @vite-ignore */ modul);
      const exportyStubu = Object.keys(stub).filter((k) => k !== "default");
      const exportySkutecne = new Set(Object.keys(skutecny));

      const navic = exportyStubu.filter((k) => !exportySkutecne.has(k));
      expect(navic, "stub exportuje něco, co v pluginu není").toEqual([]);

      const pouzivane = [...(moduly.get(modul) ?? [])].filter((j) => exportySkutecne.has(j));
      const chybejici = pouzivane.filter((j) => !exportyStubu.includes(j));
      expect(chybejici, "aplikace to používá, ale stub to nemá").toEqual([]);
    });
  }
});
