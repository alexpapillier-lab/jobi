#!/usr/bin/env node
/**
 * Poznámky k vydání z commitů.
 *
 * `latest.json` mělo v poli `notes` napevno „See GitHub Releases for details.“,
 * takže okno „Co je nového“ v aplikaci ukazovalo anglickou větu bez obsahu –
 * uživatel se nedozvěděl, co si vlastně stahuje. Titulky commitů v tomhle
 * repozitáři jsou přitom české věty psané pro člověka, takže stačí je vzít.
 *
 * Použití:
 *   node scripts/poznamky-vydani.mjs                 # od poslední značky po HEAD
 *   node scripts/poznamky-vydani.mjs --od jobi-v0.5.0
 *   node scripts/poznamky-vydani.mjs --do HEAD~5 --max 8
 *   NOTES_FILE=poznamky.txt node scripts/…            # obsah souboru má přednost
 *
 * Vypisuje prostý text s odrážkami; `AppUpdateCard` z nich udělá seznam.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** Kolik odrážek se vejde do okna, aniž by ho nikdo přestal číst. */
export const VYCHOZI_MAX = 12;

/**
 * Titulky, které uživateli aplikace nic neřeknou.
 *
 * Schválně se zahazují až tady, ne při psaní commitů: v historii repozitáře
 * mají smysl, v okně „Co je nového“ ne. Vzory jsou na začátek řádku, aby
 * „Testovací režim plateb“ nezmizel kvůli slovu „test“.
 */
const NEZAJIMAVE = [
  /^merge\b/i,
  /^revert\b/i,
  /^wip\b/i,
  /^ci[:\s]/i,
  /^chore[:\s]/i,
  /^refactor[:\s]/i,
  /^bump\b/i,
  /^verze \d/i,
  /^úklid\b/i,
  /^uklid\b/i,
  /^typo\b/i,
  /^překlep\b/i,
  /^formát/i,
  /^dokumentace\b/i,
  /^docs[:\s]/i,
  /^testy?\b/i,
  /^test:/i,
];

/** Značky, kterými se v titulcích odkazuje na commity a čísla úkolů. */
const SMETI = [
  /\s*\(#\d+\)\s*$/,
  /\s*\[[0-9a-f]{7,40}\]\s*$/i,
];

/**
 * Z titulků commitů udělá odrážky.
 *
 * Bere jen první řádek commitu (tělo je pro programátora, ne pro uživatele),
 * zahazuje nezajímavé, sjednocuje duplicity a nechává pořadí od nejnovějšího.
 */
export function poznamkyZTitulku(titulky, max = VYCHOZI_MAX) {
  const videne = new Set();
  const out = [];
  for (const raw of titulky) {
    let t = String(raw ?? "").trim();
    if (!t) continue;
    for (const s of SMETI) t = t.replace(s, "").trim();
    if (NEZAJIMAVE.some((v) => v.test(t))) continue;
    // Titulky píšeme velkým písmenem a bez tečky; sjednotí se i to, co se
    // vymyká, ať seznam vypadá jako seznam, a ne jako výpis z gitu.
    t = t.charAt(0).toUpperCase() + t.slice(1);
    t = t.replace(/[.\s]+$/, "");
    const klic = t.toLowerCase();
    if (videne.has(klic)) continue;
    videne.add(klic);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/** Poslední značka vydání před `do` – bez ní by se vypsala celá historie. */
export function predchoziZnacka(spust = (p) => execSync(p, { encoding: "utf8" })) {
  try {
    return spust("git describe --tags --abbrev=0 --match 'jobi-v*' 2>/dev/null").trim() || null;
  } catch {
    return null;
  }
}

/** Titulky commitů v rozsahu; prázdné pole, když rozsah nic nemá. */
export function titulkyCommitu(od, doRef = "HEAD", spust = (p) => execSync(p, { encoding: "utf8" })) {
  const rozsah = od ? `${od}..${doRef}` : doRef;
  try {
    return spust(`git log --no-merges --pretty=%s ${rozsah}`).split("\n").map((r) => r.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** Hotový text pro `notes` v latest.json. */
export function sestavPoznamky(titulky, max = VYCHOZI_MAX) {
  const body = poznamkyZTitulku(titulky, max);
  if (body.length === 0) return "";
  return body.map((b) => `- ${b}`).join("\n");
}

function argument(nazev) {
  const i = process.argv.indexOf(`--${nazev}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // Ruční poznámky mají přednost: u velkého vydání je lepší jedna věta, kterou
  // člověk napsal, než dvanáct titulků commitů.
  const soubor = process.env.NOTES_FILE || argument("soubor");
  if (soubor) {
    process.stdout.write(readFileSync(soubor, "utf8").trim() + "\n");
  } else {
    const od = argument("od") ?? predchoziZnacka();
    const doRef = argument("do") ?? "HEAD";
    const max = Number(argument("max") ?? VYCHOZI_MAX);
    const text = sestavPoznamky(titulkyCommitu(od, doRef), max);
    // Prázdno se nevypisuje jako prázdno: aplikace by ukázala prázdný rámeček.
    process.stdout.write((text || "Opravy a vylepšení.") + "\n");
  }
}
