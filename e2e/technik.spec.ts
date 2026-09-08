import { test, expect } from "@playwright/test";
import { prihlasSe, testovaciJmeno, zalozZakazku, zavriDetail } from "./pomocnici";

/**
 * Přidělený technik: „Přidělit mně“ v detailu, skupina Moje v seznamu,
 * jméno na kartě. Kdyby se přidělení neuložilo do databáze, po obnovení
 * stránky by zmizelo – proto se kontroluje až po reloadu.
 */
const zakaznik = testovaciJmeno("Technik");

test("zakázka přidělená mně je ve skupině Moje i po obnovení", async ({ page }) => {
  test.setTimeout(150_000);
  await prihlasSe(page);
  const kod = await zalozZakazku(page, { zakaznik, zarizeni: "iPad (technik)", popis: "Přidělení technika", nechatOtevrene: true });

  // Karta má vlastní id – nadpis „Technik“ je v detailu i jako popisek pole u hodinové práce.
  const karta = page.locator("#detail-technik");
  await expect(karta).toBeVisible({ timeout: 30_000 });
  await karta.getByRole("button", { name: "Přidělit mně" }).click();
  await expect(karta.getByRole("combobox", { name: "Přidělený technik" })).toHaveValue(/.+/);
  await expect(karta.getByRole("button", { name: "Přidělit mně" })).toHaveCount(0);
  await zavriDetail(page);

  await page.reload();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
  await page.getByRole("radio", { name: /^Moje/ }).or(page.getByRole("button", { name: /^Moje/ })).first().click();
  await expect(page.locator(`:text-is("${kod}"):visible`).first()).toBeVisible({ timeout: 30_000 });
});
