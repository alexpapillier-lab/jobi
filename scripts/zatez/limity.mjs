/**
 * Kde přesně se zapne limit veřejného API a jak rychle se pustí zpátky.
 *
 *   node scripts/zatez/limity.mjs
 *
 * Rampa v `verejne-api.mjs` řekne „tady se to zlomilo". Tenhle skript řekne
 * proč a po kolikátém požadavku – posílá požadavky po jednom a počítá, kolik
 * jich projde, než přijde 429. Čísla se pak porovnají s tím, co je v kódu
 * (`supabase/functions/_shared/limity.ts`: 60 na IP a 600 na servis za minutu,
 * `portal-ticket`: 120 čtení na IP za minutu).
 *
 * Proč to stojí za samostatné měření: limit se počítá na otisk IP solený dnem,
 * takže se z jednoho stroje nedá otestovat chování více návštěvníků. Co ale
 * poznat jde – a je to to podstatné – je, jestli jeden zaseknutý web (nebo
 * jeden robot) dokáže vyčerpat limit celého servisu a shodit ceník všem.
 *
 * Skript záměrně limit vyčerpá. Pouští se jen na testovacím servisu; okno je
 * minutové, takže se do minuty všechno vrátí do normálu.
 */

import { nactiEnv, overSlug, percentil } from "./spolecne.mjs";

const env = nactiEnv();
const BASE = `${env.VITE_SUPABASE_URL}/functions/v1`;
const HLAVICKY = { apikey: env.VITE_SUPABASE_ANON_KEY };
const SLUG = overSlug(process.argv[2] ?? "e2e-servis");

const cekej = (ms) => new Promise((r) => setTimeout(r, ms));

/** Počká na začátek další minuty – okno limitu je date_trunc('minute'). */
async function naZacatekMinuty() {
  const zbyva = 60_000 - (Date.now() % 60_000) + 500;
  console.log(`# čekám ${(zbyva / 1000).toFixed(1)} s na čistou minutu…`);
  await cekej(zbyva);
}

/**
 * Posílá požadavky po jednom, dokud nepřijde 429 nebo dokud nedojde strop
 * pokusů. Sekvenčně schválně: u souběžných by se nedalo říct, kolikátý
 * požadavek limit překročil.
 */
async function kdyPrijde429(nazev, url, maxPokusu = 200) {
  const casy = [];
  let prvni429 = null;
  let retryAfter = null;
  for (let i = 1; i <= maxPokusu; i++) {
    const t0 = performance.now();
    const o = await fetch(url(), { headers: HLAVICKY });
    await o.arrayBuffer();
    casy.push(performance.now() - t0);
    if (o.status === 429) {
      prvni429 = i;
      retryAfter = o.headers.get("retry-after");
      break;
    }
  }
  console.log(
    `| ${nazev} | ${prvni429 ?? `>${maxPokusu}`} | ${retryAfter ?? "–"} | ` +
      `${Math.round(percentil(casy, 50))} | ${Math.round(percentil(casy, 95))} |`,
  );
  return prvni429;
}

console.log(`# Limity veřejného API – servis ${SLUG}\n`);
console.log("| Endpoint | 429 přišla po … požadavcích | Retry-After | medián ms | p95 ms |");
console.log("|---|---:|---:|---:|---:|");

await naZacatekMinuty();
const catalog = await kdyPrijde429("public-catalog (limit v kódu 60/min/IP)", () => `${BASE}/public-catalog?service=${SLUG}`, 120);

await naZacatekMinuty();
await kdyPrijde429("public-inventory (limit v kódu 60/min/IP)", () => `${BASE}/public-inventory?service=${SLUG}`, 120);

await naZacatekMinuty();
await kdyPrijde429(
  "portal-ticket GET (limit v kódu 120/min/IP)",
  () => `${BASE}/portal-ticket?t=zatez${Math.random().toString(36).slice(2, 12)}`,
  200,
);

await naZacatekMinuty();
const booking = await kdyPrijde429("public-booking GET nastavení (limit v kódu žádný)", () => `${BASE}/public-booking?service=${SLUG}`, 150);

await naZacatekMinuty();
const embed = await kdyPrijde429("public-booking/embed.js (limit v kódu žádný)", () => `${BASE}/public-booking/embed.js?service=${SLUG}`, 150);

// Zotavení: po přetečení limitu na ceníku má další minuta zase projít.
console.log("\n# Zotavení po vyčerpání limitu");
if (catalog) {
  await naZacatekMinuty();
  const o = await fetch(`${BASE}/public-catalog?service=${SLUG}`, { headers: HLAVICKY });
  await o.arrayBuffer();
  console.log(`#   catalog v další minutě: HTTP ${o.status} ${o.status === 200 ? "(v pořádku)" : "(POZOR: limit se nepustil)"}`);
}

console.log("\n# Shrnutí");
console.log(`#   catalog / inventory: limit se zapíná, ceník cizího webu se po ${catalog ?? "?"} dotazech za minutu přestane zobrazovat`);
console.log(`#   booking GET: ${booking ? `limit po ${booking}` : "žádný limit – tluče se do databáze bez stropu"}`);
console.log(`#   embed.js: ${embed ? `limit po ${embed}` : "žádný limit – ale je to jen text, databáze se nedotkne"}`);
