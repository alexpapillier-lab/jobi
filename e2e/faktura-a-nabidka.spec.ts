import { test, expect } from "@playwright/test";
import { prihlasSe, testovaciJmeno, zalozZakazku, vidZakazku } from "./pomocnici";

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
  // Formát je stejný jako na dokladu a v portálu – „1 790,00 Kč“, ne „1 790 Kč“.
  await expect(page.getByText("1 790,00 Kč").first()).toBeVisible();

  await page.getByRole("button", { name: "Poslat ke schválení" }).click();
  await expect(page.getByText(/Čeká na schválení/).first()).toBeVisible({ timeout: 20_000 });
});

test("ze zakázky jde vystavit faktura", async ({ page }) => {
  await prihlasSe(page);
  await vidZakazku(page, kod).first().click();
  await page.getByRole("button", { name: /Vystavit fakturu/ }).first().click();

  // Otevře se editor faktury s předvyplněným odběratelem. Číslo z řady se
  // přidělí až při uložení – zavřený koncept by jinak v řadě nechal díru.
  await expect(page.getByText("Nová faktura")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("číslo se přidělí při uložení").first()).toBeVisible();

  // Prázdnou fakturu vystavovat nebudeme – doplníme položku a vystavíme.
  await page.getByPlaceholder("Název položky").first().fill("Oprava (E2E)");
  await page.locator('input[type="number"]').nth(1).fill("1000");
  await expect(page.getByText("1 000,00 Kč").first()).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: "Vystavit", exact: true }).click();
  // Po vystavení má faktura číslo z řady. Hlášení mizí po pár vteřinách a na
  // pomalém CI ho test nestihl – číslo se proto čte z detailu nebo seznamu,
  // kam se po vystavení přejde.
  const cislo = page.getByText(/FV\d{4}-\d{4}/).first();
  await expect(cislo).toBeVisible({ timeout: 30_000 });
  const cisloText = ((await cislo.textContent()) ?? "").match(/FV\d{4}-\d{4}/)?.[0] ?? "";
  expect(cisloText).toMatch(/^FV\d{4}-\d{4}$/);
});

test("zaplacení se ptá na způsob platby a faktura je v denní uzávěrce", async ({ page }) => {
  await prihlasSe(page);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "invoices" } })));
  await expect(page.getByRole("button", { name: "Uzávěrka" })).toBeVisible({ timeout: 30_000 });

  // Poslední vystavená faktura (z předchozího testu) – otevřít detail a označit zaplacenou hotově.
  // Filtr má v názvu i počet („Vystavené 22“).
  await page.getByRole("button", { name: /^Vystavené/ }).click();
  const prvni = page.getByText(/^FV\d{4}-\d{4}$/).first();
  await expect(prvni).toBeVisible({ timeout: 20_000 });
  const cislo = (await prvni.textContent())!.trim();
  await prvni.click();
  await page.getByRole("button", { name: "Označit zaplacenou" }).click();
  const dotaz = page.getByRole("dialog", { name: new RegExp(`Jak zákazník zaplatil ${cislo}`) });
  await expect(dotaz).toBeVisible();
  await dotaz.getByRole("button", { name: "Hotově" }).click();
  await expect(page.getByText("Stav změněn na: Zaplaceno").first()).toBeVisible({ timeout: 20_000 });

  // Detail je panel přes seznam – zavřít, jinak klik na Uzávěrku skončí na kulise.
  await page.getByRole("button", { name: "Zavřít" }).last().click();
  // Uzávěrka dnešního dne ji má v řádku Hotově.
  await page.getByRole("button", { name: "Uzávěrka" }).click();
  const uzaverka = page.getByRole("dialog", { name: "Denní uzávěrka" });
  await expect(uzaverka).toBeVisible();
  await expect(uzaverka).toContainText(cislo);
  await expect(uzaverka.locator("tfoot")).toContainText("Hotově");
});


test("faktura je po přenačtení pořád v databázi", async ({ page }) => {
  test.setTimeout(120_000);
  await prihlasSe(page);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "invoices" } })));
  await expect(page.getByRole("button", { name: "Uzávěrka" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /^Vystavené/ }).click();
  const prvni = page.getByText(/^FV\d{4}-\d{4}$/).first();
  await expect(prvni).toBeVisible({ timeout: 20_000 });
  const cislo = (await prvni.textContent())!.trim();

  await page.reload();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
  /* Hned po přenačtení se událost o přechodu občas ztratí – posluchač ještě
     nemusí být připojený. Proto se posílá, dokud se stránka neotevře. */
  const uzaverka = page.getByRole("button", { name: "Uzávěrka" });
  await expect
    .poll(async () => {
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "invoices" } })));
      return uzaverka.isVisible().catch(() => false);
    }, { timeout: 45_000, message: "Stránka Faktury se neotevřela." })
    .toBe(true);
  await expect(page.getByText(cislo, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
});

test("faktura, která se neuloží, zůstane rozepsaná v editoru", async ({ page }) => {
  test.setTimeout(150_000);
  await prihlasSe(page);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "invoices" } })));
  const novaFaktura = page.getByRole("button", { name: "Nová faktura" });
  await expect(novaFaktura).toBeVisible({ timeout: 30_000 });
  await novaFaktura.click();
  await expect(page.getByText("Nová faktura").first()).toBeVisible({ timeout: 30_000 });

  const polozka = `Nepovedený zápis ${Date.now().toString(36)}`;
  await page.getByPlaceholder("Název položky").first().fill(polozka);
  await page.locator('input[type="number"]').nth(1).fill("777");

  /* Shodí se jen zápisy faktur. Rozepsaná faktura nesmí zmizet – účetní
     doklad, který se ztratí mezi kliknutím a chybou, je to nejhorší, co
     může aplikace udělat. */
  await page.route(/\/rest\/v1\/invoices/, (route) =>
    route.request().method() === "GET" ? route.continue() : route.abort("failed"),
  );
  await page.getByRole("button", { name: "Uložit koncept" }).first().click();

  // Chyba se ukáže a rozepsaná položka zůstane na obrazovce.
  await expect(page.getByText(/nepodařilo uložit/i).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByPlaceholder("Název položky").first()).toHaveValue(polozka);

  // Po obnovení spojení jde uložit znovu, bez opisování.
  await page.unroute(/\/rest\/v1\/invoices/);
  await page.getByRole("button", { name: "Uložit koncept" }).first().click();
  await expect(page.getByText("Koncept uložen").first()).toBeVisible({ timeout: 30_000 });

  /* Úklid: koncepty z testů nemají v servisu zůstat. V testovacím servisu
     žádné jiné koncepty nejsou, tak se smažou všechny. */
  await page.getByRole("button", { name: /^Koncepty/ }).first().click();
  for (let i = 0; i < 10; i++) {
    const radek = page.getByText(/^FV\d{4}-\d{4}$|^Bez čísla$/).first();
    if ((await radek.count()) === 0) break;
    await radek.click();
    const nabidka = page.getByRole("button", { name: /Další akce|Více akcí|Více/ }).first();
    if ((await nabidka.count()) === 0) break;
    await nabidka.click();
    await page.getByText("Smazat koncept").first().click();
    const potvrzeni = page.getByRole("button", { name: /^Smazat/ }).last();
    if (await potvrzeni.isVisible().catch(() => false)) await potvrzeni.click();
    await expect(page.getByText("Koncept smazán").first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(800);
  }
});
