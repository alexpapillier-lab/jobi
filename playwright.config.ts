import { defineConfig, devices } from "@playwright/test";

/**
 * E2E testy hlavních cest.
 *
 * Jezdí proti webové verzi (`npm run dev:web`) a proti **ostrému Supabase**,
 * ale ve vlastním servisu „E2E testovací servis“ pod účtem e2e@jobi.test.
 * Ostatní servisy o něm nevědí a RLS je odděluje stejně jako kterékoli dva
 * zákaznické servisy, takže test nemůže sáhnout na cizí data.
 *
 * Bez `E2E_PASSWORD` v prostředí se testy přeskočí. Nemají tichý fallback:
 * test, který se bez přihlášení tváří, že prošel, je horší než žádný.
 */
const PORT = Number(process.env.E2E_PORT ?? 5190);

export default defineConfig({
  testDir: "./e2e",
  // Jedna zakázka se zakládá a pak se s ní pracuje – paralelně by si testy
  // přepisovaly stav pod rukama.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "cs-CZ",
    timezoneId: "Europe/Prague",
  },
  projects: [
    {
      name: "chromium",
      // Viewport musí být až tady: `devices` ho nastavuje taky a v projektu
      // přebíjí to, co je v globálním `use`. V malém okně se spodní lišta
      // s tlačítky překrývá s hlavičkou a testy klikají do prázdna.
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } },
    },
  ],
  webServer: {
    command: `npm run dev:web -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
