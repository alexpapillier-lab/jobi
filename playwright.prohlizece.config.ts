import { defineConfig, devices } from "@playwright/test";

/**
 * E2E v Safari (WebKit) a Firefoxu.
 *
 * Hlavní sada (`playwright.config.ts`) zůstává schválně jen v Chromiu – jezdí
 * v CI po každém pushi a tři prohlížeče by ji ztrojnásobily. Tahle sada je
 * malá a jede zvlášť: ověřuje, že hlavní cesty fungují i tam, kde je zákazník
 * doopravdy otevírá. Na iPhonu je Safari jediná možnost, takže tam se to
 * netýká hrstky lidí, ale všech zákazníků servisu, co dostanou odkaz na portál.
 *
 * ```bash
 * E2E_PASSWORD='…' npx playwright test -c playwright.prohlizece.config.ts
 * ```
 *
 * Běží na jiných portech než hlavní sada, aby šly spustit vedle sebe.
 */
const PORT = Number(process.env.E2E_PORT_PROHLIZECE ?? 5761);
/** Statický server nad `web/` – zákaznický portál (`web/z/`) je čisté HTML mimo Vite. */
const PORT_PORTAL = Number(process.env.E2E_PORT_PORTAL ?? 5762);

export default defineConfig({
  testDir: "./e2e",
  // Jen tahle jedna sada; hlavní testy jsou psané na Chromium a jejich
  // časování by tu jen dělalo šum.
  testMatch: /prohlizece\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  // Safari i Firefox startují pomaleji než Chromium a přihlášení jde přes
  // ostrý Supabase; s minutou se test utrhne dřív, než se stačí načíst.
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "cs-CZ",
    timezoneId: "Europe/Prague",
  },
  projects: [
    {
      name: "webkit",
      // Viewport až tady – `devices` ho nastavuje taky a v projektu přebíjí
      // to, co je v globálním `use` (stejný důvod jako v hlavním configu).
      use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 1000 } },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"], viewport: { width: 1440, height: 1000 } },
    },
  ],
  webServer: [
    {
      // Schválně ne `dev:web`, ale hotový build.
      //
      // Dva důvody. Zaprvé se testuje to, co zákazník opravdu dostane: Vite
      // ve vývoji posílá zdrojáky tak, jak jsou (esnext), kdežto build je
      // přepíše na starší syntaxi kvůli Safari 14 – rozdíl mezi prohlížeči
      // se tím posouvá jinam než ve vývoji. Zadruhé vývojový server při
      // každé úpravě souboru přenačte stránku a rozjetý test spadne uprostřed
      // – u sady, která běží dlouho a vedle jiné práce, to byla polovina pádů.
      command: `npx vite build --config vite.config.web.ts --outDir dist-web-prohlizece --emptyOutDir --logLevel warn && python3 -m http.server ${PORT} --bind 127.0.0.1 --directory dist-web-prohlizece`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
    },
    {
      // Portál je statická stránka; nejjednodušší server, co je všude po ruce.
      command: `python3 -m http.server ${PORT_PORTAL} --bind 127.0.0.1 --directory web`,
      url: `http://127.0.0.1:${PORT_PORTAL}/z/`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});

/** Adresa místní kopie zákaznického portálu – testy si k ní přilepí token. */
export const PORTAL_URL = `http://127.0.0.1:${PORT_PORTAL}/z/`;
