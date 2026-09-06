import { test, expect, type Page } from "@playwright/test";
import { prihlasSe, testovaciJmeno, vidZakazku, zalozZakazku } from "./pomocnici";

/**
 * Pobočky. Servis se dvěma provozovnami potřebuje vědět, kde zakázka leží,
 * a číslo zakázky nese zkratku pobočky – když se to rozejde, začnou se
 * čísla srážet mezi pobočkami.
 *
 * Oddělení dat mezi pobočkami hlídají sondy v databázi (scripts/rls-probe.sql,
 * série 300 a 500). Tady jde o rozhraní: že pobočku jde založit, přiřadit
 * zakázce a zase smazat.
 */
test.describe.configure({ mode: "serial" });

const nazevPobocky = "Pobočka E2E";
const zkratka = "PE";

/** Nastavení → Firma → Pobočky. */
async function otevriPobocky(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "settings" } })));
  const hledani = page.getByPlaceholder("Hledat v nastavení…");
  await expect(hledani).toBeVisible({ timeout: 20_000 });
  await hledani.fill("pobočky");
  await page.getByRole("button", { name: /Pobočky/ }).first().click();
  await hledani.fill("");
  await expect(page.getByRole("button", { name: "Přidat pobočku" })).toBeVisible({ timeout: 20_000 });
}

/** Smaže testovací pobočku, pokud existuje. Testy po sobě uklízejí. */
async function smazPobocku(page: Page) {
  const radek = page.locator(`:text-is("${nazevPobocky}"):visible`).first();
  if ((await radek.count()) === 0) return;
  await radek.locator('xpath=ancestor::*[.//button[@aria-label="Smazat pobočku"]][1]')
    .getByRole("button", { name: "Smazat pobočku" }).click();
  await page.getByRole("button", { name: "Smazat", exact: true }).click();
  await expect(page.locator(`:text-is("${nazevPobocky}"):visible`)).toHaveCount(0, { timeout: 20_000 });
}

test("pobočku jde založit i se zkratkou", async ({ page }) => {
  test.setTimeout(150_000);
  await prihlasSe(page);
  await otevriPobocky(page);
  await smazPobocku(page);

  await page.getByRole("button", { name: "Přidat pobočku" }).click();
  await page.getByPlaceholder("Praha 6 – Dejvice").fill(nazevPobocky);
  await page.getByPlaceholder("PH").fill(zkratka);
  await page.getByRole("button", { name: "Uložit pobočku" }).click();

  await expect(page.locator(`:text-is("${nazevPobocky}"):visible`).first()).toBeVisible({ timeout: 30_000 });
  // Zkratka se ukazuje u pobočky jako štítek – bez ní by čísla zakázek
  // z různých poboček vypadala stejně.
  const radek = page.locator(`:text-is("${nazevPobocky}"):visible`).first().locator("xpath=ancestor::*[3]");
  await expect(radek).toContainText(zkratka);
});

test("pobočka drží i po přenačtení aplikace", async ({ page }) => {
  test.setTimeout(150_000);
  await prihlasSe(page);
  await otevriPobocky(page);
  await expect(page.locator(`:text-is("${nazevPobocky}"):visible`).first()).toBeVisible({ timeout: 30_000 });
});

test("zakázku jde přesunout na pobočku a je to vidět v historii", async ({ page }) => {
  test.setTimeout(180_000);
  await prihlasSe(page);
  const zakaznik = testovaciJmeno("Pobočka");
  const kod = await zalozZakazku(page, { zakaznik, zarizeni: "Telefon (pobočka)", nechatOtevrene: true });

  await page.getByRole("button", { name: "Další akce" }).first().click();
  await page.getByText("Přesunout na pobočku…").first().click();
  const okno = page.getByRole("dialog", { name: "Přesunout na pobočku" });
  await expect(okno).toBeVisible({ timeout: 20_000 });
  await okno.getByText(nazevPobocky, { exact: true }).first().click();
  // Okno se po volbě zavírá samo; než se přejde dál, musí být pryč.
  await expect(okno).toHaveCount(0, { timeout: 20_000 });
  /* Počkat na potvrzení. Zápis se posílá bez čekání, takže přenačtení hned
     po kliknutí požadavek přeruší – přesně tím se přesun dřív ztrácel. */
  await expect(page.getByText(/přesunuta na pobočku/i).first()).toBeVisible({ timeout: 30_000 });

  /* Po přenačtení se přesun ověří v historii zakázky – v detailu se pobočka
     nikde nevypisuje, jediná stopa je právě záznam o změně. */
  await page.reload();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
  await vidZakazku(page, kod).first().click();

  const dalsiAkce = page.getByRole("button", { name: "Další akce" }).first();
  const polozkaHistorie = page.getByText("Historie", { exact: true }).first();
  await dalsiAkce.click();
  if (!(await polozkaHistorie.isVisible().catch(() => false))) {
    await dalsiAkce.click();
    await expect(polozkaHistorie).toBeVisible({ timeout: 10_000 });
  }
  await polozkaHistorie.click();
  const oknoHistorie = page.getByRole("dialog", { name: "Historie zakázky" });
  await expect(oknoHistorie).toBeVisible({ timeout: 20_000 });
  await oknoHistorie.getByRole("button", { name: "Detail změn" }).first().click();
  await expect(oknoHistorie).toContainText(nazevPobocky, { timeout: 20_000 });
});

test("úklid: testovací pobočka se smaže", async ({ page }) => {
  test.setTimeout(150_000);
  await prihlasSe(page);
  await otevriPobocky(page);
  await smazPobocku(page);
});
