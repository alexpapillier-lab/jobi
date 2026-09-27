import { test, expect, type Page } from "@playwright/test";
import { prihlasSe } from "./pomocnici";

/**
 * Průvodci: otazník v postranním panelu otevře „Průvodce a nápověda“,
 * „Spustit“ pustí průvodce stránkou (na Zakázkách „Přehled zakázek“),
 * karta má „Další →“ a na konci „Hotovo“, „Přeskočit průvodce“ ji
 * zavře. Co kdo prošel, se pamatuje jen v localStorage prohlížeče, takže
 * test v databázi nic nemění.
 */

async function otevriNapovedu(page: Page) {
  // Otazník je nad Nastavením; ve sbaleném panelu má jen ikonu, ale tlačítko tam je vždy.
  // Sbalený postranní panel se při najetí myší rozbaluje a otazník se při
  // tom posune – první klik v CI padal mimo. Nejdřív najet, počkat na
  // animaci a pak kliknout; kdyby okno přesto nebylo, kliknout znovu
  // (tlačítko okno přepíná, proto nejvýš dvakrát).
  const otaznik = page.locator('[data-tour="sidebar-help"]');
  const panel = page.getByRole("dialog", { name: "Průvodce a nápověda" });
  await otaznik.hover();
  await page.waitForTimeout(400);
  await otaznik.click();
  if (!(await panel.isVisible({ timeout: 5_000 }).catch(() => false))) {
    await otaznik.click();
  }
  await expect(panel).toBeVisible({ timeout: 20_000 });
  return panel;
}

/** Karta právě běžícího průvodce – pozná se podle tlačítka, které je jen na ní. */
function kartaPruvodce(page: Page) {
  return page.getByRole("button", { name: "Přeskočit průvodce" });
}

async function spustPruvodceStranky(page: Page) {
  const panel = await otevriNapovedu(page);
  const spustit = panel.getByRole("button", { name: /Přehled zakázek.*Spustit/ });
  await expect(spustit).toContainText("Přehled zakázek");
  await spustit.click();
  // Panel nápovědy se zavře a místo něj je karta průvodce s prvním krokem.
  await expect(panel).toBeHidden();
  await expect(kartaPruvodce(page)).toBeVisible({ timeout: 20_000 });
  // Každý průvodce začíná krokem „K čemu to je“.
  await expect(page.getByRole("heading", { level: 3, name: "K čemu to je" })).toBeVisible();
}

test("otazník otevře nápovědu, Spustit pustí průvodce a Přeskočit ho zavře", async ({ page }) => {
  test.setTimeout(120_000);
  await prihlasSe(page);
  await spustPruvodceStranky(page);

  await page.getByRole("button", { name: "Další →" }).click();
  await expect(page.getByRole("heading", { level: 3, name: "Hledání" })).toBeVisible();
  // Od druhého kroku jde i zpátky.
  await expect(page.getByRole("button", { name: "← Zpět" })).toBeVisible();

  await kartaPruvodce(page).click();
  await expect(kartaPruvodce(page)).toBeHidden();
  await expect(page.getByRole("heading", { level: 3, name: "Hledání" })).toBeHidden();
  // Aplikace zůstala na Zakázkách a dá se s ní dál pracovat.
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible();
});

test("průvodce se dá projít až na „Hotovo“ a nápověda zavřít křížkem", async ({ page }) => {
  test.setTimeout(120_000);
  await prihlasSe(page);
  await spustPruvodceStranky(page);

  // Kroků je pár; když by „Hotovo“ nepřišlo, je průvodce v cyklu a test má spadnout.
  const hotovo = page.getByRole("button", { name: "Hotovo", exact: true });
  for (let i = 0; i < 12 && !(await hotovo.isVisible().catch(() => false)); i++) {
    await page.getByRole("button", { name: "Další →" }).click();
  }
  await expect(hotovo).toBeVisible();
  await hotovo.click();
  await expect(kartaPruvodce(page)).toBeHidden();

  // Nápověda jde otevřít znovu a zavřít křížkem, bez spuštění průvodce.
  const panel = await otevriNapovedu(page);
  await panel.getByRole("button", { name: "Zavřít nápovědu" }).click();
  await expect(panel).toBeHidden();
});
