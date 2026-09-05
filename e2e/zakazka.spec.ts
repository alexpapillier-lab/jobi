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

test("v detailu jde přidat provedenou opravu", async ({ page }) => {
  await prihlasSe(page);
  await page.getByText(zakaznik).first().click();

  await expect(page.getByText("Provedené opravy").first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Manuálně zadat" }).first().click();
  await page.getByPlaceholder("Napište název opravy...").first().fill("Výměna konektoru (E2E)");
  await page.getByRole("button", { name: "Přidat opravu" }).first().click();

  await expect(page.getByText("Výměna konektoru (E2E)").first()).toBeVisible();
});
