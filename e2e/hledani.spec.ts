import { test, expect } from "@playwright/test";
import { prihlasSe, testovaciJmeno, zalozZakazku, vidZakazku } from "./pomocnici";

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
  await expect(vidZakazku(page, kod).first()).toBeVisible({ timeout: 20_000 });

  await hledani.fill(kod);
  await expect(vidZakazku(page, kod).first()).toBeVisible({ timeout: 20_000 });

  // Zařízení je taky vodítko, kterým lidi hledají.
  await hledani.fill("Herní notebook");
  await expect(vidZakazku(page, kod).first()).toBeVisible({ timeout: 20_000 });

  // Nesmysl nesmí vrátit nic – jinak filtr nefiltruje.
  await hledani.fill("nexistujicizakazka-zzz");
  await expect(vidZakazku(page, kod)).toHaveCount(0, { timeout: 20_000 });

  await hledani.fill("");
  await expect(vidZakazku(page, kod).first()).toBeVisible({ timeout: 20_000 });
});

test("zakázka bez čísla nesundá hledání", async ({ page }) => {
  /*
   * Zakázka bez `code` vzniká importem i veřejným API. Filtr na ni volal
   * `t.code.toLowerCase()`, takže první písmeno v hledání shodilo celou
   * stránku Zakázky na chybovou obrazovku – všem, ne jen tomu, kdo tu
   * zakázku založil. V E2E servisu proto jedna taková schválně zůstává
   * („FIXTURE zakazka bez cisla“, viz e2e/README.md).
   */
  const chyby: string[] = [];
  page.on("pageerror", (e) => chyby.push(String(e)));
  await prihlasSe(page);
  const hledani = page.getByPlaceholder("Vyhledávání…");
  await hledani.fill("FIXTURE");
  await expect(page.getByText("FIXTURE zakazka bez cisla").first()).toBeVisible({ timeout: 20_000 });
  await hledani.fill("a");
  await page.waitForTimeout(1000);
  await expect(page.getByText(/Došlo k chybě aplikace/)).toHaveCount(0);
  expect(chyby, `Hledání shodilo stránku: ${chyby[0] ?? ""}`).toHaveLength(0);
});

test("filtr Dokončené oddělí hotové zakázky od aktivních", async ({ page }) => {
  await prihlasSe(page);
  const kod = await zalozZakazku(page, { zakaznik: testovaciJmeno("Filtr"), zarizeni: "Tablet" });

  // Nová zakázka je aktivní, mezi dokončenými být nesmí.
  await page.getByRole("button", { name: /^Dokončené/ }).click();
  await expect(vidZakazku(page, kod)).toHaveCount(0, { timeout: 20_000 });

  await page.getByRole("button", { name: /^Aktivní/ }).click();
  await expect(vidZakazku(page, kod).first()).toBeVisible({ timeout: 20_000 });
});
