import { test, expect } from "@playwright/test";
import { prihlasSe, testovaciJmeno, zalozZakazku, vidZakazku } from "./pomocnici";

/**
 * Koš smazaných zakázek. „Omylem jsem to smazal" je běžná situace u pultu
 * a odpověď na ni musí být „nic se neděje, vrátíme to“. Test proto ověřuje
 * obě strany: že smazaná zakázka ze seznamu opravdu zmizí, a že se dá
 * beze zbytku vrátit i po restartu aplikace.
 */
test.describe.configure({ mode: "serial" });

const zakaznik = testovaciJmeno("Koš");
let kod = "";

/** Nastavení → Zakázky → Koš smazaných zakázek. */
async function otevriKos(page: import("@playwright/test").Page) {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "settings" } })));
  const hledani = page.getByPlaceholder("Hledat v nastavení…");
  await expect(hledani).toBeVisible({ timeout: 20_000 });
  await hledani.fill("koš smazaných");
  await page.getByRole("button", { name: /Koš smazaných/ }).first().click();
  await hledani.fill("");
}

test("smazaná zakázka zmizí ze seznamu a je v koši", async ({ page }) => {
  test.setTimeout(150_000);
  await prihlasSe(page);
  kod = await zalozZakazku(page, { zakaznik, zarizeni: "Telefon (koš)", nechatOtevrene: true });

  await page.getByRole("button", { name: "Další akce" }).first().click();
  await page.getByText("Smazat zakázku").first().click();
  await page.getByRole("button", { name: "Smazat", exact: true }).click();

  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 30_000 });
  // Ze seznamu musí zmizet hned, ještě před přenačtením.
  await expect(vidZakazku(page, kod)).toHaveCount(0, { timeout: 30_000 });
  // A po přenačtení taky – teprve to čte stav z databáze.
  await page.reload();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
  await expect(vidZakazku(page, kod)).toHaveCount(0, { timeout: 30_000 });

  await otevriKos(page);
  await expect(vidZakazku(page, kod).first()).toBeVisible({ timeout: 30_000 });
});

test("smazaná zakázka je v koši i po restartu a jde obnovit", async ({ page }) => {
  test.setTimeout(150_000);
  await prihlasSe(page);
  await otevriKos(page);
  const radek = vidZakazku(page, kod).first().locator('xpath=ancestor::*[.//button[normalize-space()="Obnovit"]][1]');
  await expect(radek).toBeVisible({ timeout: 30_000 });

  await radek.getByRole("button", { name: "Obnovit" }).click();
  // Potvrzení: „Obnovit" je i na řádku v seznamu, proto se klika hledá uvnitř okna.
  const okno = page.getByText("Obnovit zakázku").first().locator("xpath=ancestor::div[1]");
  await expect(okno).toBeVisible({ timeout: 20_000 });
  await okno.getByRole("button", { name: "Obnovit", exact: true }).click();
  await expect(okno).toHaveCount(0, { timeout: 30_000 });

  // Zpátky v seznamu zakázek – a po přenačtení, tedy opravdu v databázi.
  await page.reload();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
  await expect(vidZakazku(page, kod).first()).toBeVisible({ timeout: 30_000 });
});
