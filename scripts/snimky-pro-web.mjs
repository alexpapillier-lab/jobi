// Nafotí obrazovky aplikace pro marketingový web (web/img/*.png).
//
// Proč skript, a ne ruční snímky: aplikace se mění a snímky na webu mají
// odpovídat tomu, co zákazník dostane. Když se změní vzhled, stačí skript
// pustit znovu. Fotí se z ukázkového servisu „Servis Novák“ s vymyšlenými daty,
// nikdy z ostrého servisu.
//
// Spuštění (aplikace musí běžet, `npm run dev:web` na portu 1430):
//   E2E_PASSWORD='…' node scripts/snimky-pro-web.mjs
//
// Retina rozlišení (2×), okno 1440×900 – tak vypadá aplikace na běžném
// notebooku. Portál se fotí na šířce telefonu, protože tam ho zákazníci
// otevírají.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const URL_APP = process.env.APP_URL ?? "http://localhost:1430";
const UCET = "e2e@jobi.test";
const HESLO = process.env.E2E_PASSWORD;
const SERVIS = "Servis Novák";
/** Id ukázkového servisu v databázi – viz e2e/README.md. */
const SERVIS_ID = process.env.DEMO_SERVICE_ID ?? "72de5c11-6c2d-486a-9a44-dd0a9060cf97";
const PORTAL_TOKEN = process.env.PORTAL_TOKEN ?? "Bg6PKHqi-Kb7QiSDnMp5lZiGQZRwriV3";
const CIL = "web/img";

if (!HESLO) {
  console.error("Chybí E2E_PASSWORD.");
  process.exit(1);
}
mkdirSync(CIL, { recursive: true });

const pauza = (ms) => new Promise((r) => setTimeout(r, ms));

/** Přepne stránku aplikace událostí – postranní lišta se při najetí rozbaluje a klik do ní není spolehlivý. */
async function naStranku(page, stranka) {
  await page.evaluate((s) => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: s } })), stranka);
  await pauza(2500);
}

async function snimek(page, nazev) {
  await page.screenshot({ path: `${CIL}/${nazev}.png` });
  console.log("✓", nazev);
}

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: "cs-CZ", timezoneId: "Europe/Prague" });
  const page = await ctx.newPage();

  // Aktivní servis se aplikaci podstrčí přes localStorage ještě před
  // přihlášením. Přepínač servisů v postranní liště se při najetí myší
  // rozbaluje a klikat do něj automaticky není spolehlivé.
  await page.addInitScript(
    ([klic, id]) => localStorage.setItem(klic, id),
    ["jobsheet_active_service_id_v1", SERVIS_ID],
  );
  await page.goto(URL_APP);
  await page.locator('input[type="email"]').first().fill(UCET);
  await page.locator('input[type="password"]').first().fill(HESLO);
  await page.getByRole("button", { name: "Přihlásit se" }).click();
  await page.getByRole("button", { name: "+ Nová zakázka" }).waitFor({ timeout: 45_000 });
  await page.waitForLoadState("networkidle").catch(() => {});

  // Kód SN… existuje jen v ukázkovém servisu – když se objeví, je aktivní ten správný.
  await page.getByText("SN26000017").first().waitFor({ timeout: 30_000 });
  await pauza(1500);

  // 1) Seznam zakázek
  await snimek(page, "zakazky");

  // 2) Detail dokončené zakázky s opravami a schválenou nabídkou – od shora.
  // Dokončené zakázky nejsou ve výchozím filtru Aktivní.
  await page.getByRole("button", { name: /^Vše/ }).click();
  await pauza(800);
  await page.getByText("SN26000001", { exact: true }).click();
  await page.getByText("Provedené opravy").first().waitFor({ timeout: 20_000 });
  await pauza(1200);
  await snimek(page, "detail-zakazky");
  await page.keyboard.press("Escape");
  await pauza(800);

  // 3) Okno Nová zakázka – prázdné, ať je vidět formulář.
  await page.getByRole("button", { name: "+ Nová zakázka" }).click();
  await pauza(1000);
  await snimek(page, "nova-zakazka");
  await page.keyboard.press("Escape");
  await pauza(800);

  // 4) Faktury – seznam
  await naStranku(page, "invoices");
  await snimek(page, "faktury");

  // 5) Sklad
  await naStranku(page, "inventory");
  await snimek(page, "sklad");

  // 6) Statistiky – karty s čísly
  await naStranku(page, "statistics");
  await pauza(2500);
  await snimek(page, "statistiky");

  // 7) Zákaznický portál na telefonu – z produkce, tam ho zákazníci otevírají.
  const mobil = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, locale: "cs-CZ", isMobile: true, hasTouch: true });
  const portal = await mobil.newPage();
  await portal.goto(`https://appjobi.com/z/?t=${PORTAL_TOKEN}`);
  await portal.getByText("Cenová nabídka").first().waitFor({ timeout: 30_000 });
  await pauza(1500);
  await portal.screenshot({ path: `${CIL}/portal-mobil.png`, fullPage: false });
  console.log("✓ portal-mobil");
  await mobil.close();
} finally {
  await browser.close();
}
