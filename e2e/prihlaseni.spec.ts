import { test, expect } from "@playwright/test";
import { prihlasSe, SERVIS } from "./pomocnici";

/**
 * Nejzákladnější cesta: přihlásit se a dostat se do aplikace.
 * Když spadne tenhle test, nemá smysl číst zbytek.
 */
test("přihlášení pustí do aplikace se správným servisem", async ({ page }) => {
  await prihlasSe(page);
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible();
  // Že jsme ve správném servisu, ověří test zakázky podle čísla – v postranním
  // panelu je název zkrácený a v úzkém okně schovaný.
  await expect(page.getByRole("button", { name: "+ Nová reklamace" })).toBeVisible();
});

test("špatné heslo nepustí dál", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="email"]').fill(SERVIS.email);
  await page.locator('input[type="password"]').fill("rozhodne-spatne-heslo");
  await page.getByRole("button", { name: "Přihlásit se" }).click();
  await expect(page.locator('input[type="password"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeHidden();
});
