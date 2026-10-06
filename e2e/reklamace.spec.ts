import { test, expect, type Page, type Browser } from "@playwright/test";
import { prihlasSe, rozbalSekci, testovaciJmeno, zalozZakazku, vidZakazku, vyplnReklamaci } from "./pomocnici";

/**
 * Reklamace: kód přiděluje databáze (funkce dalsi_cislo_reklamace) a je
 * unikátní. Dřív si ho počítal klient jako „nejvyšší + 1“, takže dvě
 * reklamace založené naráz dostaly stejný kód. Teď by druhou z nich odmítl
 * unikátní index – test proto zakládá obě ve stejnou chvíli a chce vidět obě.
 *
 * Od 6. 10. je „+ Nová reklamace“ plný příjem (okno jako Nová zakázka):
 * popis reklamované závady je povinný a po vytvoření se rovnou otevře detail
 * reklamace. Zakázky a reklamace z testů se nemažou (viz e2e/README.md,
 * Data po testech); rozepsaný koncept žije jen v localStorage kontextu.
 */

async function druhyClovek(browser: Browser): Promise<Page> {
  const kontext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "cs-CZ" });
  const page = await kontext.newPage();
  await prihlasSe(page, "technik");
  return page;
}

/** Založí reklamaci bez zakázky a počká na její detail (otevře se sám). */
async function zalozReklamaci(page: Page, zakaznik: string, zarizeni: string) {
  await page.getByRole("button", { name: "+ Nová reklamace" }).click();
  await page.getByRole("button", { name: "Reklamace bez propojení na zakázku" }).click();
  await vyplnReklamaci(page, { zakaznik, zarizeni });
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
  await vyplnReklamaci(page, { zakaznik: jmeno, zarizeni: "Tablet (bez zápisu)" });
  await page.getByRole("button", { name: "Vytvořit reklamaci" }).click();

  await expect(page.getByText(/Chyba při vytváření reklamace/).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByPlaceholder("Jméno zákazníka")).toHaveValue(jmeno);
  await expect(page.getByPlaceholder("Co zákazník reklamuje – projevy závady, od kdy se objevuje")).not.toHaveValue("");

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
  // Zákazník a zařízení se převezmou ze zakázky; popis závady je povinný.
  await expect(page.getByPlaceholder("např. iPhone 13, notebook")).toHaveValue("Notebook (reklamace)", { timeout: 30_000 });
  await vyplnReklamaci(page, { popis: "Po opravě nejde nabíjet" });
  await page.getByRole("button", { name: "Vytvořit reklamaci" }).click();

  /* Po založení se rovnou otevře detail nové reklamace (jako u zakázky) –
     do seznamu se nejde. Dřív se reklamace hledala v seznamu podle jména
     zákazníka, protože „první R…“ klidně patřilo reklamaci z minulého běhu. */

  // Detail reklamace ukazuje diagnostiku zakázky; dřív se odtud neukládala vůbec.
  // Zakázka se k reklamaci dotahuje celá, což chvíli trvá.
  const protokol = page.getByPlaceholder("Zadejte výsledky diagnostiky zařízení...");
  await expect(protokol).toBeVisible({ timeout: 30_000 });
  const text = `Naměřeno v reklamaci ${Date.now().toString(36)}`;
  await protokol.fill(text);
  await page.waitForTimeout(2000);

  // Až v zakázce po přenačtení je jisté, že to skončilo v databázi.
  await page.reload();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
  await vidZakazku(page, kod).first().click();
  // Karta Diagnostika je v detailu sbalená a textové pole se vykreslí až po rozbalení.
  await rozbalSekci(page, "Diagnostika");
  await expect(page.getByPlaceholder("Zadejte výsledky diagnostiky zařízení...").first()).toHaveValue(text, { timeout: 30_000 });
});
