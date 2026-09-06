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

/** Otevře podsekci nastavení podle názvu (přes hledání, viz otevriRozhrani). */
async function otevriSekci(page: import("@playwright/test").Page, hledat: string, nazev: RegExp) {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "settings" } })));
  const hledani = page.getByPlaceholder("Hledat v nastavení…");
  await expect(hledani).toBeVisible({ timeout: 20_000 });
  await hledani.fill(hledat);
  await page.getByRole("button", { name: nazev }).first().click();
  await hledani.fill("");
}

test("výchozí hodinová sazba se uloží servisu a předvyplní se v zakázce", async ({ page }) => {
  test.setTimeout(150_000);
  await prihlasSe(page);
  await otevriSekci(page, "hodinová sazba", /Hodinová práce/);

  const sazba = page.getByLabel("Výchozí hodinová sazba v Kč za hodinu");
  await expect(sazba).toBeVisible({ timeout: 20_000 });
  const puvodni = await sazba.inputValue();

  await sazba.fill("950");
  // Ukládá se po opuštění pole – kliknutí jinam je součást chování.
  await sazba.blur();
  await expect(page.getByText(/Uloženo/i).first()).toBeVisible({ timeout: 20_000 });

  // Nastavení servisu sdílí celý tým, takže se musí načíst i po restartu.
  await page.reload();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
  await otevriSekci(page, "hodinová sazba", /Hodinová práce/);
  await expect(page.getByLabel("Výchozí hodinová sazba v Kč za hodinu")).toHaveValue("950", { timeout: 20_000 });

  // A hlavně: projeví se tam, kde se používá.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "orders" } })));
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 20_000 });
  await page.getByText(/^E2E\d{6,}$/).first().click();
  await expect(page.getByText("Provedené opravy").first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Hodinová práce" }).first().click();
  await expect(page.getByLabel("Sazba (Kč/h)")).toHaveValue("950", { timeout: 20_000 });
  await page.keyboard.press("Escape");

  // Uklidit po sobě.
  await otevriSekci(page, "hodinová sazba", /Hodinová práce/);
  const zpet = page.getByLabel("Výchozí hodinová sazba v Kč za hodinu");
  await zpet.fill(puvodni);
  await zpet.blur();
  await page.waitForTimeout(1500);
});
