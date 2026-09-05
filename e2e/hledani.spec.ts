import { test, expect } from "@playwright/test";
import { prihlasSe, testovaciJmeno, zalozZakazku } from "./pomocnici";

/**
 * Hledání a filtry. Servis s tisícovkami zakázek je používá pořád a rozbité
 * hledání znamená, že se zakázka „ztratí", i když v databázi leží.
 */
test("zakázku najde hledání podle jména i podle čísla", async ({ page }) => {
  await prihlasSe(page);
  const zakaznik = testovaciJmeno("Hledání");
  const kod = await zalozZakazku(page, { zakaznik, zarizeni: "Herní notebook" });

  const hledani = page.getByPlaceholder("Vyhledávání…");

  await hledani.fill(zakaznik);
  await expect(page.getByText(kod, { exact: true })).toBeVisible({ timeout: 20_000 });

  await hledani.fill(kod);
  await expect(page.getByText(kod, { exact: true })).toBeVisible({ timeout: 20_000 });

  // Zařízení je taky vodítko, kterým lidi hledají.
  await hledani.fill("Herní notebook");
  await expect(page.getByText(kod, { exact: true })).toBeVisible({ timeout: 20_000 });

  // Nesmysl nesmí vrátit nic – jinak filtr nefiltruje.
  await hledani.fill("nexistujicizakazka-zzz");
  await expect(page.getByText(kod, { exact: true })).toBeHidden({ timeout: 20_000 });

  await hledani.fill("");
  await expect(page.getByText(kod, { exact: true })).toBeVisible({ timeout: 20_000 });
});

test("filtr Dokončené oddělí hotové zakázky od aktivních", async ({ page }) => {
  await prihlasSe(page);
  const kod = await zalozZakazku(page, { zakaznik: testovaciJmeno("Filtr"), zarizeni: "Tablet" });

  // Nová zakázka je aktivní, mezi dokončenými být nesmí.
  await page.getByRole("button", { name: /^Dokončené/ }).click();
  await expect(page.getByText(kod, { exact: true })).toBeHidden({ timeout: 20_000 });

  await page.getByRole("button", { name: /^Aktivní/ }).click();
  await expect(page.getByText(kod, { exact: true })).toBeVisible({ timeout: 20_000 });
});
