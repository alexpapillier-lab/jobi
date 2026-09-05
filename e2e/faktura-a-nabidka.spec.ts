import { test, expect } from "@playwright/test";
import { prihlasSe, testovaciJmeno, zalozZakazku } from "./pomocnici";

/**
 * Peníze: cenová nabídka pro zákazníka a faktura ze zakázky.
 *
 * Obojí končí u zákazníka, takže tichá chyba tady stojí víc než kdekoli jinde
 * v aplikaci.
 */
test.describe.configure({ mode: "serial" });

const zakaznik = testovaciJmeno("Faktura");
let kod = "";

test("na zakázce jde sestavit cenová nabídka z položek", async ({ page }) => {
  await prihlasSe(page);
  // Detail se po vytvoření otevře sám a rovnou v něm nabídku sestavíme.
  kod = await zalozZakazku(page, { zakaznik, zarizeni: "MacBook (faktura)", popis: "Nejde nabíjet", nechatOtevrene: true });

  await expect(page.getByText("Cenová nabídka").first()).toBeVisible({ timeout: 20_000 });
  await page.getByPlaceholder("Vlastní položka").fill("Výměna baterie");
  await page.getByPlaceholder("Kč", { exact: true }).fill("1490");
  await page.getByRole("button", { name: "Přidat", exact: true }).click();
  await page.getByPlaceholder("Vlastní položka").fill("Práce technika");
  await page.getByPlaceholder("Kč", { exact: true }).fill("300");
  await page.getByRole("button", { name: "Přidat", exact: true }).click();

  // Součet se dopočítá z položek – to je celý smysl rozpisu.
  await expect(page.getByText("1 790 Kč").first()).toBeVisible();

  await page.getByRole("button", { name: "Poslat ke schválení" }).click();
  await expect(page.getByText(/Čeká na schválení/).first()).toBeVisible({ timeout: 20_000 });
});

test("ze zakázky jde vystavit faktura", async ({ page }) => {
  await prihlasSe(page);
  await page.getByText(kod, { exact: true }).click();
  await page.getByRole("button", { name: /Vystavit fakturu/ }).first().click();

  // Otevře se editor faktury s předvyplněným odběratelem a číslem z řady.
  await expect(page.getByText("Nová faktura")).toBeVisible({ timeout: 30_000 });
  const cislo = page.getByText(/FV\d{4}-\d+/).first();
  await expect(cislo).toBeVisible();
  const cisloText = ((await cislo.textContent()) ?? "").match(/FV\d{4}-\d+/)?.[0] ?? "";
  expect(cisloText).toMatch(/^FV\d{4}-\d+$/);

  // Prázdnou fakturu vystavovat nebudeme – doplníme položku a vystavíme.
  await page.getByPlaceholder("Název položky").first().fill("Oprava (E2E)");
  await page.locator('input[type="number"]').nth(1).fill("1000");
  await expect(page.getByText("1 000,00 Kč").first()).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: "Vystavit", exact: true }).click();
  // Po vystavení se faktura objeví v seznamu se svým číslem.
  await expect(page.getByText(cisloText).first()).toBeVisible({ timeout: 30_000 });
});
