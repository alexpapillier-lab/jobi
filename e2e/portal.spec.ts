import { test, expect } from "@playwright/test";
import { prihlasSe, testovaciJmeno, zalozZakazku, zavriDetail } from "./pomocnici";

/**
 * Zákaznický portál: servis pošle cenovou nabídku, zákazník ji na svém
 * telefonu schválí a rozhodnutí se objeví v zakázce.
 *
 * Je to jediné místo, kde do databáze zapisuje někdo zvenčí, a rozhodnutí
 * o ceně je právně to nejcitlivější, co v aplikaci je. Portál běží na
 * appjobi.com, takže test jde přes skutečnou adresu, kterou dostane
 * zákazník – ne přes vývojový server.
 */
test.describe.configure({ mode: "serial" });

const zakaznik = testovaciJmeno("Portál");
let kod = "";
let odkaz = "";

test("servis sestaví nabídku a pošle ji zákazníkovi", async ({ page }) => {
  test.setTimeout(120_000);
  await prihlasSe(page);
  kod = await zalozZakazku(page, { zakaznik, zarizeni: "iPhone (portál)", popis: "Rozbitý displej", nechatOtevrene: true });

  await expect(page.getByText("Cenová nabídka").first()).toBeVisible({ timeout: 20_000 });
  await page.getByPlaceholder("Vlastní položka").fill("Výměna displeje");
  await page.getByPlaceholder("Kč", { exact: true }).fill("3500");
  await page.getByRole("button", { name: "Přidat", exact: true }).click();
  await page.getByRole("button", { name: "Poslat ke schválení" }).click();
  await expect(page.getByText(/Čeká na schválení/).first()).toBeVisible({ timeout: 20_000 });

  // Odkaz pro zákazníka vzniká až tady; do teď zakázka žádný token nemá.
  const kotva = page.locator('a[href^="https://appjobi.com/z/"]').first();
  await expect(kotva).toBeVisible({ timeout: 30_000 });
  odkaz = (await kotva.getAttribute("href")) ?? "";
  expect(odkaz).toMatch(/^https:\/\/appjobi\.com\/z\/\?t=.+/);
  await zavriDetail(page);
});

test("zákazník nabídku na telefonu schválí", async ({ browser }) => {
  test.setTimeout(150_000);
  const mobil = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "cs-CZ",
    isMobile: true,
    hasTouch: true,
  });
  const portal = await mobil.newPage();
  try {
    await portal.goto(odkaz);
    // Zákazník vidí svoje zařízení a částku, nic z vnitřku servisu.
    await expect(portal.getByText("Cenová nabídka").first()).toBeVisible({ timeout: 45_000 });
    await expect(portal.getByText(/3\s*500/).first()).toBeVisible();
    await expect(portal.getByText(kod).first()).toBeVisible();

    await portal.getByRole("button", { name: "Schválit opravu" }).click();
    await portal.getByRole("button", { name: "Potvrdit" }).click();
    await expect(portal.getByText(/Schváleno/).first()).toBeVisible({ timeout: 45_000 });

    // Po obnovení stránky rozhodnutí drží – je v databázi, ne v prohlížeči.
    await portal.reload();
    await expect(portal.getByText(/Schváleno/).first()).toBeVisible({ timeout: 45_000 });
  } finally {
    await mobil.close();
  }
});

test("schválení je vidět v zakázce", async ({ page }) => {
  test.setTimeout(120_000);
  await prihlasSe(page);
  await page.getByText(kod, { exact: true }).first().click();
  await expect(page.getByText(/Schváleno/).first()).toBeVisible({ timeout: 30_000 });
  await zavriDetail(page);
});
