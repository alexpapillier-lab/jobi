import { test, expect, type Page } from "@playwright/test";
import { prihlasSe, testovaciJmeno, zalozZakazku } from "./pomocnici";

/**
 * Statistiky počítá databáze, ne prohlížeč. Test proto ověřuje, že čísla
 * odpovídají tomu, co se právě stalo – kdyby se rozešla, majitel by podle
 * nich stavěl ceny a rozhodoval o lidech.
 */
test.describe.configure({ mode: "serial" });

async function naStatistiky(page: Page) {
  const nadpis = page.getByText("Celkem zakázek").first();
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

/** Hodnota dlaždice podle jejího nadpisu, jako číslo. */
async function dlazdice(page: Page, nadpis: string): Promise<number> {
  const karta = page.getByText(nadpis, { exact: true }).first().locator('xpath=ancestor::div[contains(@class,"ui-card")][1]');
  /* Nadpis se vykresluje verzálkami přes CSS, takže se z textu nedá
     odstranit porovnáním. Bere se první skupina, která začíná číslicí –
     mezery v tisících bývají nedělitelné. */
  const text = await karta.innerText();
  const nalezeno = text.match(/\d[\d\s]*/u);
  return Number((nalezeno?.[0] ?? "").replace(/\s/gu, ""));
}

test("nová zakázka se objeví v počtu zakázek za období", async ({ page }) => {
  test.setTimeout(180_000);
  await prihlasSe(page);
  await naStatistiky(page);
  const pred = await dlazdice(page, "Celkem zakázek");
  expect(pred).toBeGreaterThanOrEqual(0);

  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "orders" } })));
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 20_000 });
  await zalozZakazku(page, { zakaznik: testovaciJmeno("Statistika"), zarizeni: "Notebook (statistiky)" });

  // Statistiky se počítají v databázi, takže se musí přenačíst ze serveru.
  await page.reload();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
  await naStatistiky(page);
  await expect.poll(() => dlazdice(page, "Celkem zakázek"), { timeout: 60_000 }).toBe(pred + 1);
});

test("statistiky se dají zúžit na období a čísla se přepočítají", async ({ page }) => {
  test.setTimeout(150_000);
  await prihlasSe(page);
  await naStatistiky(page);
  const zaObdobi = await dlazdice(page, "Celkem zakázek");
  // Které období je zvolené, se pozná podle stisknutého tlačítka.
  const obdobi = page.getByRole("group", { name: "Časové období" });
  const vychozi = (await obdobi.locator('button[aria-pressed="true"]').first().innerText()).trim();

  // Období, ve kterém servis ještě neexistoval – musí vyjít nula.
  // Pole s daty se ukážou, až se zvolí vlastní období.
  await page.getByRole("button", { name: "Vlastní", exact: true }).click();
  await page.getByRole("textbox", { name: "Od", exact: true }).fill("2020-01-01");
  await page.getByRole("textbox", { name: "Do", exact: true }).fill("2020-01-31");
  await pockejNaDopocitani(page);
  await expect.poll(() => dlazdice(page, "Celkem zakázek"), { timeout: 60_000 }).toBe(0);

  await obdobi.getByRole("button", { name: vychozi, exact: true }).click();
  await pockejNaDopocitani(page);
  await expect.poll(() => dlazdice(page, "Celkem zakázek"), { timeout: 60_000 }).toBe(zaObdobi);
});
