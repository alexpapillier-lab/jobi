/**
 * Načtení aplikace v prohlížeči: čas do vykreslení, počet a velikost požadavků.
 *
 *   node scripts/zatez/prohlizec.mjs                    # jen po přihlašovací obrazovku
 *   E2E_PASSWORD='…' node scripts/zatez/prohlizec.mjs   # navíc až po seznam zakázek
 *   node scripts/zatez/prohlizec.mjs --opakovani 5 --url http://localhost:5190
 *
 * Měří se na nasazené webové verzi (appjobi.com/servis/), ne na dev serveru.
 * Vite v dev režimu posílá stovky nezabalených modulů, takže by čísla neměla
 * s tím, co uvidí uživatel, nic společného.
 *
 * Čísla se berou z `performance.getEntriesByType("navigation" | "resource")`,
 * tedy z prohlížeče samotného. Playwright by uměl říct, kdy skončil `goto`,
 * ale to je čas do `load`, ne do chvíle, kdy člověk uvidí seznam zakázek.
 *
 * Přenesená velikost je `transferSize` – tedy po kompresi, jak to opravdu leze
 * po drátě. `decodedBodySize` je vedle pro srovnání: rozdíl mezi nimi ukazuje,
 * co dělá brotli.
 */

import { chromium } from "@playwright/test";
import { nactiEnv, percentil } from "./spolecne.mjs";

const arg = (jmeno, vychozi) => {
  const i = process.argv.indexOf(`--${jmeno}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : vychozi;
};

const env = nactiEnv();
const URL_APP = arg("url", "https://appjobi.com/servis/");
const OPAKOVANI = Number(arg("opakovani", "5"));
const HESLO = env.E2E_PASSWORD;

/** Sesbírá metriky z běžícího dokumentu. Pouští se až po tom, co se čeká na obsah. */
const SBER = () => {
  const nav = performance.getEntriesByType("navigation")[0] ?? {};
  const zdroje = performance.getEntriesByType("resource");
  const paint = Object.fromEntries(performance.getEntriesByType("paint").map((p) => [p.name, p.startTime]));
  const soucet = (k) => zdroje.reduce((a, z) => a + (z[k] || 0), 0);
  return {
    ttfb: nav.responseStart ?? null,
    dcl: nav.domContentLoadedEventEnd ?? null,
    load: nav.loadEventEnd ?? null,
    fcp: paint["first-contentful-paint"] ?? null,
    pozadavku: zdroje.length,
    preneseno: soucet("transferSize") + (nav.transferSize || 0),
    rozbaleno: soucet("decodedBodySize") + (nav.decodedBodySize || 0),
    // Největší jednotlivý soubor – u jednoho velkého balíku je to celý příběh
    najvetsi: zdroje
      .map((z) => ({ soubor: z.name.split("/").pop(), kb: Math.round((z.transferSize || 0) / 1024) }))
      .sort((a, b) => b.kb - a.kb)
      .slice(0, 5),
  };
};

const kb = (b) => (b / 1024).toFixed(0);
const msf = (v) => (v == null ? "–" : Math.round(v));

/**
 * Jedno měření. `cekejNa` je selektor, po jehož objevení se považuje obrazovka
 * za vykreslenou – proto se čas bere až potom, ne po `load`.
 */
async function jednoMereni(browser, { prihlasit, cekejNa, popis, pomala = false }) {
  // Vlastní kontext pokaždé: sdílená cache by druhé měření udělala nerealisticky
  // rychlým a měřili bychom cache prohlížeče, ne aplikaci.
  const ctx = await browser.newContext({ locale: "cs-CZ", viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();

  if (pomala) {
    // Pomalé 4G podle profilu, který používá Lighthouse. Není to schválnost:
    // webová verze je podle docs/WEBOVA_VERZE.md „záložní nástroj, po kterém
    // se sahá z mobilu v dílně" – a v dílně bývá jeden čárek signálu.
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    });
  }

  const t0 = Date.now();
  await page.goto(URL_APP, { waitUntil: "domcontentloaded" });

  if (prihlasit) {
    await page.getByLabel(/e-?mail/i).first().fill("e2e@jobi.test");
    await page.getByLabel(/heslo/i).first().fill(HESLO);
    await page.getByRole("button", { name: /přihlásit/i }).first().click();
  }

  await page.waitForSelector(cekejNa, { timeout: 45_000 });
  const doVykresleni = Date.now() - t0;
  const m = await page.evaluate(SBER);
  await ctx.close();
  return { popis, doVykresleni, ...m };
}

function shrn(nazev, mereni) {
  const casy = mereni.map((m) => m.doVykresleni);
  const p = mereni[mereni.length - 1];
  console.log(
    `| ${nazev} | ${mereni.length} | ${msf(percentil(casy, 50))} | ${msf(percentil(casy, 95))} | ${msf(Math.max(...casy))} | ` +
      `${msf(percentil(mereni.map((m) => m.fcp), 50))} | ${p.pozadavku} | ${kb(p.preneseno)} | ${kb(p.rozbaleno)} |`,
  );
  return p;
}

console.log(`# Načtení aplikace v prohlížeči – ${URL_APP}, ${OPAKOVANI}× každý scénář\n`);

const browser = await chromium.launch();
try {
  console.log("| Scénář | běhů | medián ms | p95 ms | max ms | FCP ms | požadavků | přeneseno kB | rozbaleno kB |");
  console.log("|---|---:|---:|---:|---:|---:|---:|---:|---:|");

  const prihlaseni = [];
  for (let i = 0; i < OPAKOVANI; i++) {
    // Na přihlašovací obrazovce je pole pro e-mail – jakmile je vidět, appka běží.
    prihlaseni.push(await jednoMereni(browser, { cekejNa: "input[type=email], input[name=email]", popis: "přihlašovací obrazovka" }));
  }
  const posledni = shrn("studený start → přihlašovací obrazovka", prihlaseni);

  const pomale = [];
  for (let i = 0; i < OPAKOVANI; i++) {
    pomale.push(
      await jednoMereni(browser, { cekejNa: "input[type=email], input[name=email]", popis: "pomalé 4G", pomala: true }),
    );
  }
  shrn("totéž na pomalém 4G (1,6 Mb/s, 150 ms)", pomale);

  if (HESLO) {
    const seznam = [];
    for (let i = 0; i < OPAKOVANI; i++) {
      seznam.push(
        await jednoMereni(browser, {
          prihlasit: true,
          // Tabulka zakázek – čeká se na první řádek, ne na hlavičku stránky
          cekejNa: "table tbody tr, [data-zakazka], [data-testid=zakazka-radek]",
          popis: "seznam zakázek",
        }),
      );
    }
    shrn("studený start → seznam zakázek (po přihlášení)", seznam);
  } else {
    console.log("\n# E2E_PASSWORD není nastavené – seznam zakázek se nezměřil (přihlašovací obrazovka ano).");
  }

  console.log("\n## Největší soubory při studeném startu\n");
  console.log("| Soubor | kB (přeneseno) |");
  console.log("|---|---:|");
  for (const s of posledni.najvetsi) console.log(`| ${s.soubor} | ${s.kb} |`);
  console.log(
    `\n- TTFB ${msf(posledni.ttfb)} ms, DOMContentLoaded ${msf(posledni.dcl)} ms, load ${msf(posledni.load)} ms`,
  );
} finally {
  await browser.close();
}
