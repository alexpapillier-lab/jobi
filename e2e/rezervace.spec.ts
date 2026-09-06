import { test, expect } from "@playwright/test";
import { prihlasSe, testovaciJmeno } from "./pomocnici";

/**
 * Online rezervace z webu: formulář na webu servisu volá veřejnou edge
 * funkci, rezervace přistane v Kalendáři a jedním kliknutím z ní vznikne
 * zakázka s předvyplněnými údaji. Testovací servis má slug `e2e-servis`
 * a rezervace zapnuté (viz e2e/README.md).
 */
const FUNKCE = "https://ijtvcgolsdsrquqbvjrz.supabase.co/functions/v1/public-booking";

test("rezervace z webu se objeví v Kalendáři a jde z ní založit zakázka", async ({ page, request }) => {
  const zakaznik = testovaciJmeno("Rezervace");
  const odpoved = await request.post(FUNKCE, {
    data: { service: "e2e-servis", name: zakaznik, phone: "+420777555333", email: "rezervace@example.com", device: "iPad Air (rezervace)", repair: "Prasklé sklo", preferred_at: "2026-09-15T10:30:00+02:00", note: "Přijdu v poledne" },
  });
  expect(odpoved.status()).toBe(201);

  await prihlasSe(page);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "calendar" } })));
  const panel = page.getByRole("region", { name: "Rezervace z webu" });
  await expect(panel).toBeVisible({ timeout: 30_000 });
  const radek = panel.locator("li", { hasText: zakaznik });
  await expect(radek).toBeVisible({ timeout: 20_000 });
  await expect(radek).toContainText("iPad Air (rezervace) · Prasklé sklo");
  await expect(radek).toContainText("Nová");
  await expect(radek).toContainText("15. 9. 10:30");

  // Založit zakázku → formulář příjmu s údaji z rezervace.
  await radek.getByRole("button", { name: "Založit zakázku" }).click();
  await expect(page.getByPlaceholder("Jan Novák")).toHaveValue(zakaznik, { timeout: 20_000 });
  await expect(page.getByPlaceholder("Název nebo typ zařízení…").first()).toHaveValue("iPad Air (rezervace)");
  await expect(page.getByPlaceholder("Výměna displeje, výměna baterie, diagnostika").first()).toHaveValue("Prasklé sklo");

  const bezPrirazeni = page.getByRole("button", { name: /Ne, pokračovat bez přiřazení/ });
  if (await bezPrirazeni.isVisible().catch(() => false)) await bezPrirazeni.click();
  await page.getByRole("button", { name: "Vytvořit zakázku" }).click();
  await expect(page.getByText(new RegExp(`^${zakaznik} · `)).first()).toBeVisible({ timeout: 30_000 });

  // Rezervace je označená jako převedená a vede na zakázku.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "calendar" } })));
  await expect(page.getByRole("region", { name: "Rezervace z webu" })).toBeVisible({ timeout: 30_000 });
  const vyrizene = page.getByRole("button", { name: /Vyřízené/ });
  if (await vyrizene.isVisible().catch(() => false)) await vyrizene.click();
  const hotova = page.getByRole("region", { name: "Rezervace z webu" }).locator("li", { hasText: zakaznik });
  await expect(hotova).toContainText("Zakázka založena", { timeout: 20_000 });
  await expect(hotova.getByRole("button", { name: "Otevřít zakázku" })).toBeVisible();
});
