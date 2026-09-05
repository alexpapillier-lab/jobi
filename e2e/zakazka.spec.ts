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
