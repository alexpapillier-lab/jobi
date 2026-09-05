import { test, expect } from "@playwright/test";
import { prihlasSe } from "./pomocnici";

/**
 * Nastavení se musí pamatovat.
 *
 * Zobrazení zakázek se dřív po každém spuštění vracelo na výchozí, protože
 * se ukládalo, ale při dalším načtení ho přepsala starší kopie. Zákazník to
 * hlásil dvakrát a poznat to jde jedině tím, že se aplikace znovu načte.
 */
/** Nastavení → Aplikace → Rozhraní. Přes hledání, protože v levém sloupci
 *  je položka podle výšky okna pod přehybem a klik na ni nemusí projít. */
async function otevriRozhrani(page: import("@playwright/test").Page) {
  // Do nastavení se skáče událostí aplikace, ne klikem do postranní lišty:
  // ta se při najetí myší rozbalí přes obsah a tlačítko se posune jinam.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "settings" } })));
  const hledani = page.getByPlaceholder("Hledat v nastavení…");
  await expect(hledani).toBeVisible({ timeout: 20_000 });
  await hledani.fill("zobrazení zakázek");
  await page.getByRole("button", { name: /Rozhraní/ }).first().click();
  await hledani.fill("");
}

test("zvolené zobrazení zakázek přežije obnovení aplikace", async ({ page }) => {
  await prihlasSe(page);
  await otevriRozhrani(page);

  const skupina = page.getByRole("radiogroup", { name: "Zobrazení zakázek" });
  await expect(skupina).toBeVisible({ timeout: 20_000 });
  await skupina.getByRole("radio", { name: /Mřížka/ }).click();
  await expect(skupina.getByRole("radio", { name: /Mřížka/ })).toBeChecked();

  // Uložení jde přes síť; bez čekání by se stránka načetla dřív, než odejde.
  await page.waitForTimeout(2000);
  await page.reload();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });

  await otevriRozhrani(page);
  const poZnovunacteni = page.getByRole("radiogroup", { name: "Zobrazení zakázek" });
  await expect(poZnovunacteni.getByRole("radio", { name: /Mřížka/ })).toBeChecked({ timeout: 20_000 });

  // Uklidit po sobě, ať další běh začíná od výchozího stavu.
  await poZnovunacteni.getByRole("radio", { name: /Seznam/ }).click();
  await page.waitForTimeout(1500);
});
