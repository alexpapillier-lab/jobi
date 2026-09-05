import { test, expect } from "@playwright/test";
import { prihlasSe, SERVIS, testovaciJmeno } from "./pomocnici";

/**
 * Hlavní cesta servisu: založit zakázku, najít ji v seznamu, otevřít detail
 * a přidat provedenou opravu. Kdyby se rozbila kterákoli část, servis nemůže
 * pracovat.
 *
 * Testy na sebe navazují a běží sériově, protože pracují se stejnou zakázkou.
 * Po sobě ji nemažou – je v testovacím servisu, kam nikdo nekouká.
 */
test.describe.configure({ mode: "serial" });

const zakaznik = testovaciJmeno("E2E zákazník");
const zarizeni = "iPhone 13 (E2E)";

test("založení zakázky vytvoří číslo se zkratkou servisu", async ({ page }) => {
  await prihlasSe(page);
  await page.getByRole("button", { name: "+ Nová zakázka" }).click();

  await page.getByPlaceholder("Jan Novák").fill(zakaznik);
  await page.getByPlaceholder("+420 777 123 456").fill("+420777123456");
  await page.getByPlaceholder("Název nebo typ zařízení…").first().fill(zarizeni);
  // Vyplnění dalšího pole zavře napovídač zařízení, který jinak leží přes
  // tlačítko Vytvořit zakázku.
  await page.getByPlaceholder("Výměna displeje, výměna baterie, diagnostika").first().fill("Nejde nabíjet (E2E test)");

  await page.getByRole("button", { name: "Vytvořit zakázku" }).click();

  await expect(page.getByText(zakaznik).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(new RegExp(`^${SERVIS.zkratka}\\d{6,}$`)).first()).toBeVisible();
});

test("zakázka je v seznamu i po novém přihlášení", async ({ page }) => {
  await prihlasSe(page);
  await expect(page.getByText(zakaznik).first()).toBeVisible({ timeout: 30_000 });
});

/** Zapne asistenta postupu. Předvolba se ukládá na server k účtu, takže
 *  po spadlém běhu by zůstal vypnutý i pro další běhy testů. */
async function zapniAsistenta(page: import("@playwright/test").Page) {
  try {
    await page.evaluate(() => {
      const klic = "jobsheet_ui_settings_v1";
      const raw = localStorage.getItem(klic);
      const cfg = raw ? JSON.parse(raw) : {};
      cfg.app = { ...(cfg.app ?? {}), postupZakazky: true };
      localStorage.setItem(klic, JSON.stringify(cfg));
      window.dispatchEvent(new CustomEvent("jobsheet:ui-updated"));
    });
    await page.waitForTimeout(1500);
  } catch {
    /* stránka už je zavřená (timeout testu) – napraví to další běh */
  }
}

test("v detailu jde přidat provedenou opravu a asistent postupu se posune", async ({ page }) => {
  await prihlasSe(page);
  await zapniAsistenta(page);
  await page.getByText(zakaznik).first().click();

  // Nová zakázka bez oprav: asistent nabízí jako další krok opravy.
  const asistent = page.getByRole("group", { name: /Postup zakázky/ });
  await expect(asistent).toBeVisible({ timeout: 20_000 });
  await expect(asistent).toHaveAttribute("aria-label", /hotovo 1 z 6/);
  await expect(asistent.getByRole("button", { name: "Přejít na opravy" })).toBeVisible();

  await expect(page.getByText("Provedené opravy").first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Manuálně zadat" }).first().click();
  await page.getByPlaceholder("Napište název opravy...").first().fill("Výměna konektoru (E2E)");
  await page.getByRole("button", { name: "Přidat opravu" }).first().click();

  await expect(page.getByText("Výměna konektoru (E2E)").first()).toBeVisible();

  // Díly k opravě se nabízejí ze skladu v databázi (dřív jen z místní kopie,
  // která na jiném počítači neexistovala). V testovacím servisu je „Displej AUDIT“.
  // Tlačítko Upravit té konkrétní opravy – v hlavičce detailu je jiné „Upravit zakázku“.
  const radekOpravy = page
    .getByText("Výměna konektoru (E2E)", { exact: true })
    .first()
    .locator("xpath=ancestor::div[.//button[normalize-space()='Upravit']][1]");
  await radekOpravy.getByRole("button", { name: "Upravit", exact: true }).click();
  await page.getByPlaceholder("Hledat produkt…").first().fill("AUDIT");
  await expect(page.getByText("Displej AUDIT").first()).toBeVisible({ timeout: 15_000 });
  // Escape by zavřel celý detail; nabídku stačí smazáním hledaného textu skrýt.
  await page.getByPlaceholder("Hledat produkt…").first().fill("");
  // Krok Opravy je hotový, dalším povinným krokem je dokončení.
  await expect(asistent).toHaveAttribute("aria-label", /hotovo 2 z 6/);
  await expect(asistent).toContainText("Přepněte stav v hlavičce");
});

test("asistent postupu jde skrýt křížkem a zapnout v Nastavení", async ({ page }) => {
  // Tři přechody mezi stránkami; ve výchozí minutě se to při pomalé síti nestihne.
  test.setTimeout(120_000);
  await prihlasSe(page);
  await zapniAsistenta(page);
  await page.getByText(zakaznik).first().click();
  const asistent = page.getByRole("group", { name: /Postup zakázky/ });
  await expect(asistent).toBeVisible({ timeout: 20_000 });

  try {
    await asistent.getByRole("button", { name: "Skrýt asistenta postupu" }).click();
    await expect(asistent).toBeHidden();

    // Znovu zapnout: Nastavení → Aplikace → Rozhraní → Chování.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "settings" } })));
    const hledani = page.getByPlaceholder("Hledat v nastavení…");
    await expect(hledani).toBeVisible({ timeout: 20_000 });
    await hledani.fill("asistent postupu");
    await page.getByRole("button", { name: /Rozhraní/ }).first().click();
    await hledani.fill("");
    const prepinac = page.getByRole("checkbox", { name: /Asistent postupu/ });
    await expect(prepinac).not.toBeChecked({ timeout: 20_000 });
    await prepinac.check();
    await expect(prepinac).toBeChecked();
    await page.waitForTimeout(1500);

    await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "orders" } })));
    await page.getByText(zakaznik).first().click();
    await expect(page.getByRole("group", { name: /Postup zakázky/ })).toBeVisible({ timeout: 20_000 });
  } finally {
    await zapniAsistenta(page);
  }
});

test("hodinová práce se přidá jako hodiny × sazba", async ({ page }) => {
  await prihlasSe(page);
  await page.getByText(zakaznik).first().click();
  await expect(page.getByText("Provedené opravy").first()).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: "Hodinová práce" }).first().click();
  await page.getByLabel("Popis práce").fill("Diagnostika a čištění (E2E)");
  await page.getByLabel("Hodiny").fill("1.5");
  await page.getByLabel("Sazba (Kč/h)").fill("800");
  await page.getByLabel("Technik").fill("Technik E2E");
  await page.getByRole("button", { name: "Přidat práci" }).click();

  // Položka ukazuje hodiny × sazbu a technika; cena je jejich součin.
  await expect(page.getByText("Diagnostika a čištění (E2E)").first()).toBeVisible();
  await expect(page.getByText(/Hodinová práce · 1,5 h × 800 Kč\/h · Technik E2E/).first()).toBeVisible();
  await expect(page.getByText("1 200,00 Kč").first()).toBeVisible();
});

test("při stornu se servis zeptá na důvod a zapíše ho do historie", async ({ page }) => {
  await prihlasSe(page);
  await page.getByText(zakaznik).first().click();

  // Přepínač stavu v hlavičce detailu – v seznamu za ním jsou další stejné.
  const hlavicka = page
    .getByText(new RegExp(`^${zakaznik} · `))
    .first()
    .locator("xpath=ancestor::*[.//button[contains(., 'Přijato')]][1]");
  await hlavicka.getByRole("button", { name: /Přijato/ }).first().click();
  await page.getByRole("button", { name: "Zrušeno", exact: true }).first().click();

  // Stav se ještě nezměnil – nejdřív otázka proč.
  const dialog = page.getByRole("dialog", { name: "Proč zakázka končí?" });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByLabel("Cena byla pro zákazníka vysoká").check();
  await dialog.getByPlaceholder(/Poznámka/).fill("Nabídka 3 500 Kč, zákazník odmítl (E2E)");
  await dialog.getByRole("button", { name: "Potvrdit storno" }).click();

  await expect(hlavicka.getByRole("button", { name: /Zrušeno/ }).first()).toBeVisible({ timeout: 20_000 });

  // Důvod je v historii zakázky.
  await page.getByRole("button", { name: "Další akce" }).first().click();
  await page.getByText("Historie", { exact: true }).first().click();
  await expect(page.getByText("Důvod storna").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Cena byla pro zákazníka vysoká – Nabídka 3 500 Kč/).first()).toBeVisible();
});
