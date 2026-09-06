import { test, expect } from "@playwright/test";
import { nahodnyTelefon, prihlasSe, testovaciJmeno, zalozZakazku } from "./pomocnici";

/**
 * Zákazníci: adresář servisu.
 *
 * Zákazník vzniká hlavně sám při příjmu zakázky – proto se testuje, že se
 * po zadání telefonu propojí se zakázkou, že jde upravit, že se změna
 * zapíše do historie a že hledání najde zákazníka i podle čísla opsaného
 * z papíru (s mezerami).
 */
test.describe.configure({ mode: "serial" });

/**
 * Jen to, co je opravdu vidět. Stránky zůstávají po první návštěvě
 * připojené (schované přes display:none), takže stejné jméno bývá v DOM
 * na několika místech a `getByText(...).first()` trefí to schované.
 */
const vidCelek = (page: import("@playwright/test").Page, text: string) => page.locator(`:text-is("${text}"):visible`).first();
const vidObsah = (page: import("@playwright/test").Page, text: string) => page.locator(`:has-text("${text}"):visible`).last();

const jmeno = testovaciJmeno("Zákazník");
const telefon = nahodnyTelefon();

/** Zákazníci se otevírají událostí; postranní lišta se při najetí rozbaluje. */
async function naZakazniky(page: import("@playwright/test").Page) {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "customers" } })));
  await expect(page.getByPlaceholder("Vyhledávání zákazníků…")).toBeVisible({ timeout: 30_000 });
}

test("zákazník vznikne z příjmu zakázky i s telefonem", async ({ page }) => {
  await prihlasSe(page);
  await zalozZakazku(page, { zakaznik: jmeno, zarizeni: "Notebook (zákazníci)", telefon });

  await naZakazniky(page);
  await page.getByPlaceholder("Vyhledávání zákazníků…").fill(jmeno);
  await expect(vidCelek(page, jmeno)).toBeVisible({ timeout: 20_000 });
});

test("hledání najde zákazníka podle telefonu i s mezerami", async ({ page }) => {
  await prihlasSe(page);
  await naZakazniky(page);
  const hledani = page.getByPlaceholder("Vyhledávání zákazníků…");

  // Číslo opsané z papíru: jinak zapsané mezery nesmí hledání rozbít.
  const sMezerami = telefon.replace(/^(\+420)(\d{3})(\d{3})(\d{3})$/, "$1 $2 $3 $4");
  await hledani.fill(sMezerami);
  await expect(vidCelek(page, jmeno)).toBeVisible({ timeout: 20_000 });

  await hledani.fill("+420 000 000 000");
  await expect(page.locator(`:text-is("${jmeno}"):visible`)).toHaveCount(0);
});

test("úprava zákazníka se uloží a je vidět v historii změn", async ({ page }) => {
  await prihlasSe(page);
  await naZakazniky(page);
  await page.getByPlaceholder("Vyhledávání zákazníků…").fill(jmeno);
  await vidCelek(page, jmeno).click();

  await page.locator('button:text-is("Upravit"):visible').first().click();
  const mesto = `Brno ${Date.now().toString(36).slice(-4)}`;
  await page.getByLabel("Město").fill(mesto);
  await page.getByLabel("Informace").fill("Volat před opravou (E2E)");
  await page.locator('button:has-text("Uložit"):visible').first().click();

  await expect(vidObsah(page, mesto)).toBeVisible({ timeout: 20_000 });
  await expect(vidObsah(page, "Volat před opravou (E2E)")).toBeVisible();

  // Po obnovení stránky musí změna zůstat a být v historii.
  await page.reload();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
  await naZakazniky(page);
  await page.getByPlaceholder("Vyhledávání zákazníků…").fill(jmeno);
  await vidCelek(page, jmeno).click();
  await expect(vidObsah(page, mesto)).toBeVisible({ timeout: 20_000 });
  await expect(vidObsah(page, "Historie změn")).toBeVisible();
});

test("neplatné údaje zákazníka nejdou uložit", async ({ page }) => {
  await prihlasSe(page);
  await naZakazniky(page);
  await page.getByPlaceholder("Vyhledávání zákazníků…").fill(jmeno);
  await vidCelek(page, jmeno).click();
  await page.locator('button:text-is("Upravit"):visible').first().click();

  const ulozit = page.locator('button:has-text("Uložit"):visible').first();
  await expect(ulozit).toBeEnabled();

  // Krátké PSČ a IČO jsou nesmysl na dokladu – uložit nejdou.
  await page.getByLabel("PSČ").fill("12");
  await expect(ulozit).toBeDisabled();
  await page.getByLabel("PSČ").fill("60200");
  await expect(ulozit).toBeEnabled();

  await page.getByLabel("IČO").fill("123");
  await expect(ulozit).toBeDisabled();
  await page.getByLabel("IČO").fill("");
  await expect(ulozit).toBeEnabled();

  // Zákazník bez jména by se v adresáři nedal najít.
  await page.getByLabel("Jméno a příjmení").fill("");
  await expect(ulozit).toBeDisabled();

  await page.getByLabel("Jméno a příjmení").fill(jmeno);
  await expect(ulozit).toBeEnabled();
});

test("zakázky zákazníka jsou v jeho detailu a jde z nich založit další", async ({ page }) => {
  await prihlasSe(page);
  await naZakazniky(page);
  await page.getByPlaceholder("Vyhledávání zákazníků…").fill(jmeno);
  await vidCelek(page, jmeno).click();

  await expect(vidObsah(page, "Notebook (zákazníci)")).toBeVisible({ timeout: 20_000 });

  // Přesně tlačítko u zákazníka: „Vytvořit zakázku“ se jmenuje i potvrzení v okně příjmu.
  await page.locator('button:text-is("+ Vytvořit zakázku"):visible').first().click();
  // Otevře se příjem s vybraným zákazníkem: místo pole pro jméno je jeho jmenovka
  // s telefonem a tlačítkem Změnit.
  // Pole telefon zobrazuje číslo po trojicích, porovnáváme tedy číslice.
  await expect
    .poll(async () => (await page.getByPlaceholder("+420 777 123 456").inputValue()).replace(/\D/g, ""), { timeout: 20_000 })
    .toBe(telefon.replace(/\D/g, ""));
  await expect(page.locator('button:text-is("Změnit"):visible')).toBeVisible();
  await expect(page.locator("#new-order-name")).toHaveCount(0);
});

test("rozepsaná úprava zákazníka se nezahodí kliknutím vedle okna", async ({ page }) => {
  test.setTimeout(120_000);
  await prihlasSe(page);
  await naZakazniky(page);
  await page.getByPlaceholder("Vyhledávání zákazníků…").fill(jmeno);
  await vidCelek(page, jmeno).click();

  await page.locator('button:text-is("Upravit"):visible').first().click();
  await expect(page.locator("[data-upravy-zakaznika]")).toHaveAttribute("data-upravy-zakaznika", "otevreno", { timeout: 20_000 });
  const poznamka = page.getByLabel("Informace");
  const text = `Volá jen odpoledne ${Date.now().toString(36)}`;
  await poznamka.fill(text);

  // Klik do ztmavení vedle okna se dřív rozepsaných údajů jen tak zbavil.
  await page.keyboard.press("Escape");
  await expect(page.getByText("Zahodit rozepsané změny?").first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Zpět k úpravám" }).click();
  await expect(poznamka).toHaveValue(text);

  // Zahození je vědomá volba, ne nehoda.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Zahodit", exact: true }).click();
  // Okno zůstává v DOM a jen se prolíná, proto se čte jeho stav.
  await expect(page.locator("[data-upravy-zakaznika]")).toHaveAttribute("data-upravy-zakaznika", "zavreno", { timeout: 20_000 });
});
