import { test, expect, type Page, type Browser } from "@playwright/test";
import { prihlasSe, testovaciJmeno, zalozZakazku, vidZakazku } from "./pomocnici";

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

test("reklamace i její řešení jsou po přenačtení v databázi", async ({ page }) => {
  test.setTimeout(150_000);
  await prihlasSe(page, "owner");
  const jmeno = testovaciJmeno("Reklamace trvanlivost");
  await zalozReklamaci(page, jmeno, "Tablet (reklamace)");

  await page.reload();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
  await page.getByRole("button", { name: /^Reklamace/ }).first().click();
  await expect(page.getByText(jmeno).first()).toBeVisible({ timeout: 30_000 });
});

test("neuložená reklamace zůstane ve formuláři, nezmizí", async ({ page }) => {
  test.setTimeout(150_000);
  await prihlasSe(page, "owner");
  const jmeno = testovaciJmeno("Reklamace bez zápisu");

  /* Shodí se jen zakládání reklamací. Vyplněný formulář nesmí zmizet –
     zákazník stojí u pultu a údaje by se musely vyplňovat znovu. */
  await page.route(/\/rest\/v1\/warranty_claims/, (route) =>
    route.request().method() === "GET" ? route.continue() : route.abort("failed"),
  );

  await page.getByRole("button", { name: "+ Nová reklamace" }).click();
  await page.getByRole("button", { name: "Reklamace bez propojení na zakázku" }).click();
  await page.getByPlaceholder("Jméno zákazníka").fill(jmeno);
  await page.getByPlaceholder("např. iPhone 13, notebook").fill("Tablet (bez zápisu)");
  await page.getByRole("button", { name: "Vytvořit reklamaci" }).click();

  await expect(page.getByText(/Chyba při vytváření reklamace/).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByPlaceholder("Jméno zákazníka")).toHaveValue(jmeno);

  await page.unroute(/\/rest\/v1\/warranty_claims/);
  await page.getByRole("button", { name: "Vytvořit reklamaci" }).click();
  await expect(page.getByText(jmeno).first()).toBeVisible({ timeout: 30_000 });
});

test("diagnostika psaná v reklamaci se uloží do napojené zakázky", async ({ page }) => {
  test.setTimeout(180_000);
  await prihlasSe(page, "owner");

  const zakaznik = testovaciJmeno("Reklamace diagnostika");
  const kod = await zalozZakazku(page, { zakaznik, zarizeni: "Notebook (reklamace)" });

  // Reklamace navázaná na zakázku – jen tam se diagnostika napojené zakázky ukazuje.
  await page.getByRole("button", { name: "+ Nová reklamace" }).click();
  await page.getByPlaceholder("Vyhledat zakázku (kód, zákazník, SN, telefon…)").fill(kod);
  await page.getByRole("button", { name: new RegExp(kod) }).first().click();
  await page.getByRole("button", { name: "Vytvořit reklamaci" }).click();
  await expect(vidZakazku(page, kod).first()).toBeVisible({ timeout: 30_000 });

  /* Do detailu přes zakázku, ne přes první reklamaci v seznamu: předchozí
     testy tam nechaly reklamace bez zakázky a na té by diagnostika nebyla
     vůbec (ukáže se jen u napojených). Zakázka má v detailu sekci
     „Reklamace k této zakázce“, a tou se dostaneme právě k té naší. */
  await vidZakazku(page, kod).first().click();
  await page.getByRole("button", { name: /^R\d{8}/ }).first().click();

  // Detail reklamace ukazuje diagnostiku zakázky; dřív se odtud neukládala vůbec.
  const protokol = page.getByPlaceholder("Zadejte výsledky diagnostiky zařízení...");
  await expect(protokol).toBeVisible({ timeout: 20_000 });
  const text = `Naměřeno v reklamaci ${Date.now().toString(36)}`;
  await protokol.fill(text);
  await page.waitForTimeout(2000);

  // Až v zakázce po přenačtení je jisté, že to skončilo v databázi.
  await page.reload();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
  await vidZakazku(page, kod).first().click();
  await expect(page.getByText(text).first()).toBeVisible({ timeout: 30_000 });
});
