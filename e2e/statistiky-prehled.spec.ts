import { test, expect, type Page } from "@playwright/test";
import { prihlasSe } from "./pomocnici";

/**
 * Přehled statistik: dlaždice „Přijato zakázek“, „Rozpracováno“ a „Celkový
 * příjem“ a poznámka, že peníze jdou podle data vydání a počty podle
 * přijetí. Majitel si obrat porovnává s počtem přijatých zakázek a bez té
 * věty hledá chybu (viz Statistiky vs. Zakázkový list). Čísla samotná hlídá
 * `statistiky.spec.ts`; tady jde o to, že přepnutí období nic z toho
 * neschová.
 */

async function naStatistiky(page: Page) {
  const nadpis = page.getByText("Přijato zakázek", { exact: true }).first();
  await expect
    .poll(async () => {
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "statistics" } })));
      return nadpis.isVisible().catch(() => false);
    }, { timeout: 60_000, message: "Statistiky se neotevřely." })
    .toBe(true);
  await pockejNaDopocitani(page);
}

/** Dokud se čísla počítají, jsou v dlaždicích šedé obdélníky místo hodnot. */
async function pockejNaDopocitani(page: Page) {
  await expect(page.locator(".stats-skeleton")).toHaveCount(0, { timeout: 60_000 });
}

async function dlazdiceJsouVidet(page: Page) {
  for (const nadpis of ["Přijato zakázek", "Rozpracováno", "Celkový příjem"]) {
    await expect(page.getByText(nadpis, { exact: true }).first(), nadpis).toBeVisible({ timeout: 20_000 });
  }
  // Poznámka pod klíčovými čísly – bez ní si majitel porovná obrat s počtem
  // přijatých zakázek a bude hledat chybu.
  await expect(page.getByText(/podle data vydání/).first()).toBeVisible();
}

test("přepnutí období nechá dlaždice i poznámku o datu vydání na místě", async ({ page }) => {
  test.setTimeout(150_000);
  await prihlasSe(page);
  await naStatistiky(page);
  await dlazdiceJsouVidet(page);

  // Které období je zvolené, se pozná podle stisknutého tlačítka.
  const obdobi = page.getByRole("group", { name: "Časové období" });
  await expect(obdobi).toBeVisible();
  const vychozi = (await obdobi.locator('button[aria-pressed="true"]').first().innerText()).trim();

  for (const nazev of ["Měsíc", "Rok"]) {
    await obdobi.getByRole("button", { name: nazev, exact: true }).click();
    await expect(obdobi.getByRole("button", { name: nazev, exact: true })).toHaveAttribute("aria-pressed", "true");
    // Ostatní tlačítka musí pustit – jinak by šlo o dvě zvolená období naráz.
    await expect(obdobi.locator('button[aria-pressed="true"]')).toHaveCount(1);
    await pockejNaDopocitani(page);
    await dlazdiceJsouVidet(page);
  }

  // Zpět na výchozí období, ať další test nezačíná jinde než uživatel.
  await obdobi.getByRole("button", { name: vychozi, exact: true }).click();
  await expect(obdobi.getByRole("button", { name: vychozi, exact: true })).toHaveAttribute("aria-pressed", "true");
  await pockejNaDopocitani(page);
  await dlazdiceJsouVidet(page);
});
