import { test, expect, type Page } from "@playwright/test";
import { prihlasSe } from "./pomocnici";

/** Počká, až rozdělaný sklad zmizí z localStorage – tedy až ho potvrdí databáze. */
async function pockejNaZapisSkladu(page: Page) {
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("jobi_sklad_neulozeno_v1")), {
      timeout: 60_000,
      message: "Sklad zůstal rozdělaný – změna se nedostala do databáze.",
    })
    .toBeNull();
}

/**
 * Sklad: založení produktu, změna počtu kusů a hlavně to, že se změna
 * opravdu dostane do databáze.
 *
 * Sklad se ukládá jinak než zbytek aplikace – ne jedním zápisem řádku, ale
 * několika požadavky proti snímku toho, co je v databázi. Právě tady se
 * v minulosti povedlo smazat celý sklad odchodem ze stránky ve špatnou
 * chvíli, takže na něj patří vlastní testy.
 */
test.describe.configure({ mode: "serial" });

const produkt = `Díl E2E ${Date.now().toString(36)}`;

async function naSklad(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "inventory" } })));
  await expect(page.getByLabel("Hledat produkt").first()).toBeVisible({ timeout: 30_000 });
}

/** Řádek produktu i s tlačítky na počet kusů. */
function radek(page: Page, nazev: string) {
  return page.locator(`:text-is("${nazev}"):visible`).first().locator('xpath=ancestor::*[.//button[@aria-label="Přidat kus"]][1]');
}

async function najdi(page: Page, nazev: string) {
  await page.getByLabel("Hledat produkt").first().fill(nazev);
  await expect(page.locator(`:text-is("${nazev}"):visible`).first()).toBeVisible({ timeout: 20_000 });
}

test("nový produkt se založí i s počtem kusů a cenou", async ({ page }) => {
  test.setTimeout(120_000);
  await prihlasSe(page);
  await naSklad(page);

  await page.getByRole("button", { name: "Nový produkt" }).first().click();
  await page.getByRole("checkbox", { name: "Nepřiřazovat k zařízení" }).check();
  await page.getByPlaceholder("Název produktu…").fill(produkt);
  await page.getByPlaceholder("Sklad (ks)").fill("5");
  await page.getByPlaceholder("Cena (Kč)").first().fill("249");
  await page.getByRole("button", { name: "Přidat produkt" }).click();

  /* Hláška „Produkt přidán" se ukazuje teprve po potvrzení z databáze –
     dokud nesvítí, produkt je jen na obrazovce. */
  await expect(page.getByText("Produkt přidán").first()).toBeVisible({ timeout: 30_000 });
  await najdi(page, produkt);
  await expect(radek(page, produkt)).toContainText("5 ks");
  await pockejNaZapisSkladu(page);
});

test("produkt a počet kusů jsou v databázi, ne jen na obrazovce", async ({ page }) => {
  test.setTimeout(120_000);
  await prihlasSe(page);
  await naSklad(page);
  await najdi(page, produkt);
  await expect(radek(page, produkt)).toContainText("5 ks");
  await expect(page.getByText("249").first()).toBeVisible();
});

test("přidaný kus přežije odchod ze stránky hned po kliknutí", async ({ page }) => {
  test.setTimeout(120_000);
  await prihlasSe(page);
  await naSklad(page);
  await najdi(page, produkt);

  await radek(page, produkt).getByRole("button", { name: "Přidat kus" }).click();
  await expect(radek(page, produkt)).toContainText("6 ks");

  /* Odchod dřív, než uběhne odklad ukládání (1,2 s). Přesně takhle se dřív
     změny ztrácely – a jednou i celý sklad. */
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "orders" } })));
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 20_000 });

  await page.reload();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
  await naSklad(page);
  await najdi(page, produkt);
  await expect(radek(page, produkt)).toContainText("6 ks");
  // Až tohle znamená, že kus je v databázi, ne jen v rozdělaném stavu.
  await pockejNaZapisSkladu(page);
});

test("změna skladu při výpadku sítě se doplní sama, až se spojení vrátí", async ({ page }) => {
  test.setTimeout(180_000);
  await prihlasSe(page);
  await naSklad(page);
  await najdi(page, produkt);

  /* Shodí se jen zápisy do skladu, ne celá síť: aplikace zůstane použitelná
     a test tak trefí přesně ten okamžik, kdy uložení neprojde. */
  await page.route(/\/rest\/v1\/inventory_/, (route) =>
    route.request().method() === "GET" ? route.continue() : route.abort("failed"),
  );

  await radek(page, produkt).getByRole("button", { name: "Přidat kus" }).click();
  await expect(radek(page, produkt)).toContainText("7 ks");

  const ukazatel = page.locator("[data-neulozene-zmeny]");
  await expect(ukazatel).toBeVisible({ timeout: 60_000 });
  await expect(ukazatel).toContainText("čeká na uložení");

  await page.unroute(/\/rest\/v1\/inventory_/);
  // Sklad si opakování řídí sám; nic se neklikalo.
  await expect(ukazatel).toHaveCount(0, { timeout: 90_000 });

  await pockejNaZapisSkladu(page);

  await page.reload();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
  await naSklad(page);
  await najdi(page, produkt);
  await expect(radek(page, produkt)).toContainText("7 ks");
});

test("prázdný sklad se neuloží místo skutečných dat", async ({ page }) => {
  test.setTimeout(120_000);
  await prihlasSe(page);

  /* Otevřít Sklad a hned zase odejít: komponenta v tu chvíli nemá data a
     bez pojistky by uložila prázdno přes celý sklad servisu. */
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "inventory" } })));
  await page.waitForTimeout(150);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "orders" } })));
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 20_000 });

  await pockejNaZapisSkladu(page);

  await page.reload();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
  await naSklad(page);
  await najdi(page, produkt);
  await expect(radek(page, produkt)).toContainText("7 ks");
});

test("úklid: testovací produkty se ze skladu smažou", async ({ page }) => {
  test.setTimeout(180_000);
  await prihlasSe(page);
  await naSklad(page);

  /* Každý běh zakládá vlastní produkt, jinak by se testovací servis zaplnil.
     Maže se přes rozhraní, takže se u toho ověří i mazání. */
  await page.getByLabel("Hledat produkt").first().fill("Díl E2E");
  for (let i = 0; i < 30; i++) {
    const prvni = page.locator(':text-matches("^Díl E2E ", ""):visible').first();
    if ((await prvni.count()) === 0) break;
    const rad = prvni.locator('xpath=ancestor::*[.//button[@aria-label="Přidat kus"]][1]');
    await rad.getByRole("button", { name: "Smazat" }).click();
    await page.getByRole("button", { name: "Smazat produkt" }).click();
    await expect(page.getByText("Produkt smazán").first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(500);
  }
  await pockejNaZapisSkladu(page);
  await expect(page.locator(':text-matches("^Díl E2E ", ""):visible')).toHaveCount(0);
});
