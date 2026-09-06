import { test, expect, type Page } from "@playwright/test";
import { prihlasSe } from "./pomocnici";

/**
 * Objednávky dílů u dodavatele: z produktu se udělá návrh, ten se odešle
 * a po dodání se přijme na sklad. Je to nejdelší řetěz zápisů v aplikaci –
 * objednávka, její položky a nakonec změna zásoby – a každý článek je jinde
 * v databázi, takže přerušení uprostřed by nechalo sklad v nesmyslu.
 */
test.describe.configure({ mode: "serial" });

const PRODUKT = "Displej AUDIT";
let kusuPred = 0;
let cisloObjednavky = "";

async function naSklad(page: Page) {
  // Značka otevřené stránky: přepínač částí skladu. Hledání produktu je jen
  // na záložce Produkty, a ta nemusí být zrovna vybraná.
  const prepinac = page.getByRole("group", { name: "Část skladu" });
  await expect
    .poll(async () => {
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "inventory" } })));
      return prepinac.isVisible().catch(() => false);
    }, { timeout: 45_000, message: "Stránka Sklad se neotevřela." })
    .toBe(true);
}

/** Přepne na záložku Produkty a počká na hledání. */
async function naProdukty(page: Page) {
  await page.getByRole("button", { name: /^Produkty/ }).first().click();
  await expect(page.getByLabel("Hledat produkt").first()).toBeVisible({ timeout: 20_000 });
}

function radek(page: Page, nazev: string) {
  return page.locator(`:text-is("${nazev}"):visible`).first().locator('xpath=ancestor::*[.//button[@aria-label="Přidat kus"]][1]');
}

async function pocetKusu(page: Page): Promise<number> {
  const text = await radek(page, PRODUKT).innerText();
  return Number((text.match(/(\d+) ks/) ?? [])[1] ?? -1);
}

test("z produktu vznikne návrh objednávky u jeho dodavatele", async ({ page }) => {
  test.setTimeout(120_000);
  await prihlasSe(page);
  await naSklad(page);
  await naProdukty(page);
  await page.getByLabel("Hledat produkt").first().fill(PRODUKT);
  await expect(radek(page, PRODUKT)).toBeVisible({ timeout: 20_000 });
  kusuPred = await pocetKusu(page);
  expect(kusuPred).toBeGreaterThanOrEqual(0);

  await radek(page, PRODUKT).getByRole("button", { name: "Objednat" }).click();
  await expect(page.getByText(/přidán do návrhu/i).first()).toBeVisible({ timeout: 20_000 });
});

test("návrh se odešle a přijme na sklad, zásoba naroste", async ({ page }) => {
  test.setTimeout(180_000);
  await prihlasSe(page);
  await naSklad(page);
  await page.getByRole("button", { name: /^Objednávky/ }).first().click();

  // Nejnovější návrh je ten z předchozího testu.
  const navrh = page.getByText(/^OBJ/).first();
  await expect(navrh).toBeVisible({ timeout: 20_000 });
  cisloObjednavky = (await navrh.textContent())!.trim();
  await navrh.click();

  await page.getByRole("button", { name: "Označit jako objednáno" }).click();
  await expect(page.getByText("Přijmout na sklad").first()).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: "Přijmout na sklad" }).click();
  await page.getByRole("button", { name: "Přijmout", exact: true }).click();
  await expect(page.getByText(/Přijato \d+ ks/).first()).toBeVisible({ timeout: 30_000 });

  // Zásoba narostla a drží i po přenačtení – tedy je v databázi.
  await page.reload();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
  await naSklad(page);
  await naProdukty(page);
  await page.getByLabel("Hledat produkt").first().fill(PRODUKT);
  await expect(radek(page, PRODUKT)).toBeVisible({ timeout: 20_000 });
  expect(await pocetKusu(page)).toBe(kusuPred + 1);
});

test("přijatá objednávka zůstane v historii i po přenačtení", async ({ page }) => {
  test.setTimeout(120_000);
  await prihlasSe(page);
  await naSklad(page);
  await page.getByRole("button", { name: /^Objednávky/ }).first().click();
  // Výchozí filtr ukazuje jen rozpracované; přijatá je pod „Přijaté".
  await page.getByRole("button", { name: "Přijaté" }).first().click();
  await expect(page.getByText(cisloObjednavky, { exact: true }).first()).toBeVisible({ timeout: 20_000 });

  /* Úklid: přijatý kus se zase odepíše, ať zásoba testovacího produktu
     neroste s každým během. */
  await naProdukty(page);
  await page.getByLabel("Hledat produkt").first().fill(PRODUKT);
  await expect(radek(page, PRODUKT)).toBeVisible({ timeout: 20_000 });
  await radek(page, PRODUKT).getByRole("button", { name: "Odebrat kus" }).click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("jobi_sklad_neulozeno_v1")), { timeout: 60_000 })
    .toBeNull();
  expect(await pocetKusu(page)).toBe(kusuPred);
});
