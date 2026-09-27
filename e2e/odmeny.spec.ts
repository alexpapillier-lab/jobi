import { test, expect, type Page } from "@playwright/test";
import { prihlasSe, testovaciJmeno } from "./pomocnici";

/**
 * Odměny týmu: pravidlo v Nastavení → Lidé a přístupy → Odměny za opravy,
 * přepínač „Zobrazit Odměny v navigaci“ a stránka Odměny se zaměstnancem
 * měsíce. Pravidla jsou v service_settings celého servisu a přepočítávají
 * odměny za dřívější měsíce, proto si test po sobě pravidlo smaže
 * a přepínač vrátí, jak byl – i když spadne v půlce.
 */

/** Nastavení → Lidé a přístupy → Odměny za opravy (přes hledání, viz nastaveni.spec.ts). */
async function otevriOdmenyVNastaveni(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "settings" } })));
  const hledani = page.getByPlaceholder("Hledat v nastavení…");
  await expect(hledani).toBeVisible({ timeout: 20_000 });
  await hledani.fill("odměny za opravy");
  await page.getByRole("button", { name: /Odměny za opravy/ }).first().click();
  await hledani.fill("");
  // Přidat jde až po načtení nastavení z databáze – jinak by se přepsal celý seznam pravidel.
  await expect(page.getByRole("button", { name: "Přidat pravidlo" })).toBeEnabled({ timeout: 30_000 });
}

/** Řádek pravidla v tabulce – podle textu, který se hledá v názvu opravy (ten je unikátní). */
function radekPravidla(page: Page, hledat: string) {
  return page.locator("tr").filter({ has: page.locator(`input[aria-label="Text v názvu opravy"][value="${hledat}"]`) });
}

function prepinacNavigace(page: Page) {
  return page.getByRole("checkbox", { name: /Zobrazit Odměny v navigaci/ });
}

async function pockejNaUlozeno(page: Page) {
  await expect(page.getByText("Uloženo", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
}

test("pravidlo odměn se uloží, zapne stránku Odměny a po úklidu zmizí", async ({ page }) => {
  test.setTimeout(240_000);
  const nazev = testovaciJmeno("E2E odměna");
  const hledat = `e2e-odmena-${Date.now().toString(36)}`;

  await prihlasSe(page);
  await otevriOdmenyVNastaveni(page);
  const puvodneVNavigaci = await prepinacNavigace(page).isChecked();

  try {
    // Přidání pravidla: název, „v názvu opravy je“, částka v Kč.
    await page.getByPlaceholder("Servisní čištění", { exact: true }).fill(nazev);
    await page.getByPlaceholder("servisní čištění", { exact: true }).fill(hledat);
    await page.getByPlaceholder("100", { exact: true }).fill("150");
    await page.getByRole("button", { name: "Přidat pravidlo" }).click();
    await pockejNaUlozeno(page);

    const radek = radekPravidla(page, hledat);
    await expect(radek).toHaveCount(1, { timeout: 20_000 });
    await expect(radek.getByLabel("Název pravidla")).toHaveValue(nazev);
    await expect(radek.getByLabel("Hodnota odměny")).toHaveValue("150");
    await expect(radek.getByLabel("Aktivní")).toBeChecked();

    // Zkoušeč pod tabulkou musí na název opravy s tím textem najít právě tohle pravidlo.
    await page.getByPlaceholder(/Vyzkoušet název opravy/).fill(`Výměna displeje + ${hledat}`);
    await expect(page.getByText(new RegExp(`Sedí pravidlo „${nazev}“`))).toBeVisible();

    // Přepínač stránky Odměny pro celý tým.
    const prepinac = prepinacNavigace(page);
    await expect(prepinac).toBeVisible();
    if (!puvodneVNavigaci) {
      await prepinac.click();
      await pockejNaUlozeno(page);
    }
    await expect(prepinac).toBeChecked();

    // Nastavení sdílí celý servis, takže musí přežít nové načtení.
    await page.reload();
    await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
    await otevriOdmenyVNastaveni(page);
    await expect(radekPravidla(page, hledat)).toHaveCount(1, { timeout: 30_000 });
    await expect(prepinacNavigace(page)).toBeChecked();

    // Stránka Odměny s dlaždicí zaměstnance měsíce (i když zatím nikdo odměnu nemá).
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "odmeny" } })));
    // Snímek před kontrolou: při pádu se jinak fotí až po úklidu ve `finally`
    // a není poznat, co stránka Odměny ukázala.
    await page.waitForTimeout(3_000);
    await page.screenshot({ path: test.info().outputPath("odmeny-stranka.png"), fullPage: true });
    try {
      await expect(page.getByText(/^Zaměstnanc[ei] měsíce$/).first()).toBeVisible({ timeout: 30_000 });
    } catch (e) {
      // Diagnostika: co je na stránce ve chvíli selhání (před úklidem ve finally).
      await page.screenshot({ path: test.info().outputPath("odmeny-selhani.png"), fullPage: true });
      const stav = await page.evaluate(() => ({
        url: location.href,
        stranky: [...document.querySelectorAll('[data-tour^="page-"]')].map((el) => `${(el as HTMLElement).dataset.tour}:${(el as HTMLElement).style.display || "block"}`),
        odmeny: document.querySelector('[data-tour="page-odmeny"]')?.textContent?.slice(0, 300) ?? null,
        vyskyt: document.body.innerText.includes("měsíce"),
      }));
      await test.info().attach("odmeny-stav.json", { body: JSON.stringify(stav, null, 2), contentType: "application/json" });
      throw e;
    }
    await expect(page.getByText("Celkem odměn za měsíc", { exact: true })).toBeVisible();
  } finally {
    // Úklid: pravidlo pryč, přepínač jak byl. Smazání se potvrzuje oknem prohlížeče.
    await otevriOdmenyVNastaveni(page);
    const radek = radekPravidla(page, hledat);
    if ((await radek.count()) > 0) {
      page.once("dialog", (d) => void d.accept());
      await radek.getByRole("button", { name: "Smazat" }).click();
      await expect(radek).toHaveCount(0, { timeout: 20_000 });
      await pockejNaUlozeno(page);
    }
    const prepinac = prepinacNavigace(page);
    if ((await prepinac.isChecked()) !== puvodneVNavigaci) {
      await prepinac.click();
      await pockejNaUlozeno(page);
    }
    // Poslední zápis jde přes síť; bez chvilky čekání by test skončil dřív, než odejde.
    await page.waitForTimeout(1500);
  }
});
