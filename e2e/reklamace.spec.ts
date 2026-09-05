import { test, expect, type Page, type Browser } from "@playwright/test";
import { prihlasSe, testovaciJmeno } from "./pomocnici";

/**
 * Reklamace: kód přiděluje databáze (funkce dalsi_cislo_reklamace) a je
 * unikátní. Dřív si ho počítal klient jako „nejvyšší + 1“, takže dvě
 * reklamace založené naráz dostaly stejný kód. Teď by druhou z nich odmítl
 * unikátní index – test proto zakládá obě ve stejnou chvíli a chce vidět obě.
 */

async function druhyClovek(browser: Browser): Promise<Page> {
  const kontext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "cs-CZ" });
  const page = await kontext.newPage();
  await prihlasSe(page, "technik");
  return page;
}

/** Založí reklamaci bez zakázky a počká, až se objeví v seznamu reklamací. */
async function zalozReklamaci(page: Page, zakaznik: string, zarizeni: string) {
  await page.getByRole("button", { name: "+ Nová reklamace" }).click();
  await page.getByRole("button", { name: "Reklamace bez propojení na zakázku" }).click();
  await page.getByPlaceholder("Jméno zákazníka").fill(zakaznik);
  await page.getByPlaceholder("např. iPhone 13, notebook").fill(zarizeni);
  await page.getByRole("button", { name: "Vytvořit reklamaci" }).click();
  await expect(page.getByText(zakaznik).first()).toBeVisible({ timeout: 30_000 });
}

test("dvě reklamace založené naráz dostanou různé kódy", async ({ page, browser }) => {
  await prihlasSe(page, "owner");
  const technik = await druhyClovek(browser);
  try {
    const jmenoA = testovaciJmeno("Reklamace A");
    const jmenoB = testovaciJmeno("Reklamace B");
    await Promise.all([
      zalozReklamaci(page, jmenoA, "Telefon A (reklamace)"),
      zalozReklamaci(technik, jmenoB, "Telefon B (reklamace)"),
    ]);
    // Obě existují – kdyby se kód srazil, druhá by se nezaložila.
    await expect(page.getByText(jmenoB).first()).toBeVisible({ timeout: 30_000 });
    await expect(technik.getByText(jmenoA).first()).toBeVisible({ timeout: 30_000 });
    // A mají kód ve tvaru R + rok + šest číslic.
    await expect(page.getByText(/^R\d{8}$/).first()).toBeVisible();
  } finally {
    await technik.context().close();
  }
});
