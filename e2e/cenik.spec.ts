import { test, expect, type Page } from "@playwright/test";
import { prihlasSe } from "./pomocnici";

/**
 * Ceník oprav (stránka Zařízení). Ukládá se stejným způsobem jako sklad –
 * s odkladem a přes celý snímek dat – takže ho ohrožují stejné věci:
 * zavření aplikace před zápisem, neúspěšný zápis bez opakování a přenačtení
 * po změně od kolegy.
 */
test.describe.configure({ mode: "serial" });

const oprava = `Oprava E2E ${Date.now().toString(36)}`;

/** Počká, až rozdělaný ceník zmizí z localStorage – tedy až ho potvrdí databáze. */
async function pockejNaZapis(page: Page) {
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("jobi_zarizeni_neulozeno_v1")), {
      timeout: 60_000,
      message: "Ceník zůstal rozdělaný – změna se nedostala do databáze.",
    })
    .toBeNull();
}

async function naZarizeni(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "devices" } })));
  await expect(page.getByLabel("Hledat opravu").first()).toBeVisible({ timeout: 30_000 });
}

/** Opravu jde přidat jen k vybranému modelu – proto se ve stromu proklikne. */
async function vyberModel(page: Page) {
  const rozbal = async (nazev: string | RegExp) => {
    const uzel = page.getByRole("treeitem", { name: nazev }).first();
    await expect(uzel).toBeVisible({ timeout: 20_000 });
    const tlacitko = uzel.getByRole("button", { name: "Rozbalit" });
    if (await tlacitko.count()) await tlacitko.click();
  };
  await rozbal(/Apple QA/);
  // Stačí vybrat kategorii; oprava se přidá k ní.
  const kategorie = page.getByRole("treeitem", { name: /Tablety/ }).first();
  await expect(kategorie).toBeVisible({ timeout: 20_000 });
  // Klik na jméno, ne doprostřed řádku – tam sedí přepínač „v API".
  await kategorie.getByText("Tablety", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Přidat opravu" }).first()).toBeEnabled({ timeout: 20_000 });
}

test("nová oprava v ceníku se uloží do databáze", async ({ page }) => {
  test.setTimeout(120_000);
  await prihlasSe(page);
  await naZarizeni(page);
  await vyberModel(page);

  await page.getByRole("button", { name: "Přidat opravu" }).first().click();
  await page.getByPlaceholder("Název opravy…").first().fill(oprava);
  await page.getByRole("button", { name: "Přidat opravu" }).last().click();

  await expect(page.locator(`:text-is("${oprava}"):visible`).first()).toBeVisible({ timeout: 20_000 });
  await pockejNaZapis(page);

  await page.reload();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
  await naZarizeni(page);
  await page.getByLabel("Hledat opravu").first().fill(oprava);
  await expect(page.locator(`:text-is("${oprava}"):visible`).first()).toBeVisible({ timeout: 20_000 });
});

test("neúspěšný zápis ceníku se opakuje, dokud neprojde", async ({ page }) => {
  test.setTimeout(180_000);
  await prihlasSe(page);
  await naZarizeni(page);
  await page.getByLabel("Hledat opravu").first().fill(oprava);
  await expect(page.locator(`:text-is("${oprava}"):visible`).first()).toBeVisible({ timeout: 20_000 });

  // Shodí se jen zápisy ceníku; zbytek aplikace zůstane použitelný.
  await page.route(/\/rest\/v1\/device_/, (route) =>
    route.request().method() === "GET" ? route.continue() : route.abort("failed"),
  );

  const novy = `${oprava} upraveno`;
  const radek = page.locator(`:text-is("${oprava}"):visible`).first().locator('xpath=ancestor::*[.//button[@aria-label="Upravit"]][1]');
  await radek.getByRole("button", { name: "Upravit" }).click();
  const nazev = page.getByPlaceholder("Název opravy…").first();
  await expect(nazev).toBeVisible({ timeout: 20_000 });
  await nazev.fill(novy);
  await page.getByRole("button", { name: "Uložit" }).first().click();

  const ukazatel = page.locator("[data-neulozene-zmeny]");
  await expect(ukazatel).toBeVisible({ timeout: 60_000 });
  await expect(ukazatel).toContainText("čeká na uložení");

  await page.unroute(/\/rest\/v1\/device_/);
  await expect(ukazatel).toHaveCount(0, { timeout: 90_000 });
  await pockejNaZapis(page);

  await page.reload();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
  await naZarizeni(page);
  await page.getByLabel("Hledat opravu").first().fill(novy);
  await expect(page.locator(`:text-is("${novy}"):visible`).first()).toBeVisible({ timeout: 20_000 });
});

test("úklid: testovací opravy se z ceníku smažou", async ({ page }) => {
  test.setTimeout(120_000);
  await prihlasSe(page);
  await naZarizeni(page);
  await page.getByLabel("Hledat opravu").first().fill("Oprava E2E");

  for (let i = 0; i < 20; i++) {
    const prvni = page.locator(':text-matches("^Oprava E2E ", ""):visible').first();
    if ((await prvni.count()) === 0) break;
    const rad = prvni.locator('xpath=ancestor::*[.//button[@aria-label="Smazat"]][1]');
    await rad.getByRole("button", { name: "Smazat" }).click();
    const potvrdit = page.getByRole("button", { name: /^Smazat/ }).last();
    if (await potvrdit.isVisible().catch(() => false)) await potvrdit.click();
    await page.waitForTimeout(800);
  }
  await pockejNaZapis(page);
  await expect(page.locator(':text-matches("^Oprava E2E ", ""):visible')).toHaveCount(0);
});
