import { test, expect, type Page } from "@playwright/test";
import { prihlasSe, TECHNIK } from "./pomocnici";

/**
 * Práva členů týmu. Kdo co smí, se ukládá do `service_memberships.capabilities`
 * a rozhoduje o tom, co člověk v aplikaci vidí. Test hlídá, že se změna
 * povolení opravdu uloží a že po ní zůstane vypnuté to, co bylo vypnuté –
 * omylem rozdaná práva jsou horší než chybějící.
 *
 * Test si stav na konci srovná, aby po sobě nenechal rozdaná práva.
 */
test.describe.configure({ mode: "serial" });

/* Zkouší se „Sklad (úpravy)“: technik ho ve výchozím stavu nemá a žádný
   jiný test na něm nestojí. */
const POVOLENI = /Sklad \(úpravy\)/;

async function otevriPovoleniTechnika(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "settings" } })));
  const hledani = page.getByPlaceholder("Hledat v nastavení…");
  await expect(hledani).toBeVisible({ timeout: 20_000 });
  await hledani.fill("tým");
  await page.getByRole("button", { name: /Tým/ }).first().click();
  await hledani.fill("");

  const radek = page.getByText(TECHNIK.email).first().locator('xpath=ancestor::*[.//button[normalize-space()="Povolení"]][1]');
  await expect(radek).toBeVisible({ timeout: 30_000 });
  await radek.getByRole("button", { name: "Povolení" }).click();
  const okno = page.getByText("Povolení pro člena").first().locator("xpath=ancestor::div[1]");
  await expect(okno).toBeVisible({ timeout: 20_000 });
  return { okno, prepinac: okno.getByRole("checkbox", { name: POVOLENI }) };
}

test("povolení člena jde zapnout a uložení přežije restart", async ({ page }) => {
  test.setTimeout(180_000);
  await prihlasSe(page);

  const { okno, prepinac } = await otevriPovoleniTechnika(page);
  await expect(prepinac).toBeVisible({ timeout: 20_000 });
  await prepinac.check();
  await okno.getByRole("button", { name: "Uložit", exact: true }).click();
  await expect(page.getByText("Povolení uložena").first()).toBeVisible({ timeout: 30_000 });

  // Práva sdílí celý servis, takže se musí načíst i po restartu aplikace.
  await page.reload();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
  const po = await otevriPovoleniTechnika(page);
  await expect(po.prepinac).toBeChecked({ timeout: 20_000 });
});

test("odebrané povolení zůstane odebrané", async ({ page }) => {
  test.setTimeout(180_000);
  await prihlasSe(page);

  const { okno, prepinac } = await otevriPovoleniTechnika(page);
  await expect(prepinac).toBeVisible({ timeout: 20_000 });
  await prepinac.uncheck();
  await okno.getByRole("button", { name: "Uložit", exact: true }).click();
  await expect(page.getByText("Povolení uložena").first()).toBeVisible({ timeout: 30_000 });

  await page.reload();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
  const po = await otevriPovoleniTechnika(page);
  await expect(po.prepinac).not.toBeChecked({ timeout: 20_000 });
});
