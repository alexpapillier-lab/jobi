import { defineConfig } from "@playwright/test";

/**
 * Testy desktopové aplikace JobiDocs.
 *
 * Jsou oddělené od testů hlavního Jobi (kořenový playwright.config.ts):
 * nespouštějí prohlížeč ani vývojový server, ale samotný Electron z buildu.
 * Před během musí projít `npm run build:electron` – testy sahají na
 * `dist/` a `dist-electron/`, tedy přesně na to, co se zabalí uživateli.
 *
 * Nic z toho nesahá do ostrých dat: každý test si otevře vlastní adresář
 * s daty v systémovém tempu a vlastní port lokálního API, takže běží i ve
 * chvíli, kdy má vývojář nainstalovaný JobiDocs spuštěný.
 *
 * Spuštění: `npm run test:e2e` v jobidocs/.
 */
export default defineConfig({
  testDir: "./e2e",
  // Electron je jeden proces na test a testy si sahají na tytéž porty
  // a adresáře; paralelně by si přepisovaly stav pod rukama.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  // První spuštění Electronu po buildu bývá pomalé (ověřování podpisu).
  timeout: 120_000,
  expect: { timeout: 20_000 },
  outputDir: "./test-results",
});
