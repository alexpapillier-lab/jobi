import { test, expect, type Page, type Browser } from "@playwright/test";
import { prihlasSe, radekZakazky, TECHNIK, testovaciJmeno, zalozZakazku } from "./pomocnici";

/**
 * Dva lidé na jednom servisu ve stejnou chvíli.
 *
 * V servisu na pultu se to děje pořád: na příjmu někdo zakládá zakázku a
 * v dílně jiný mění stav té předchozí. Když se změny nepropíšou, dva lidé si
 * přepisují práci a nikdo si toho nevšimne. Testy proto jedou ve dvou oknech
 * naráz a kontrolují, že to, co udělá jeden, druhý uvidí bez obnovení stránky.
 */
test.describe.configure({ mode: "serial" });

/** Druhé okno jako samostatný prohlížeč – vlastní přihlášení i úložiště. */
async function druhyClovek(browser: Browser, kdo: "owner" | "technik"): Promise<Page> {
  const kontext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "cs-CZ" });
  const page = await kontext.newPage();
  await prihlasSe(page, kdo);
  return page;
}

test("technik uvidí zakázku, kterou právě založil majitel", async ({ page, browser }) => {
  await prihlasSe(page, "owner");
  const technik = await druhyClovek(browser, "technik");
  try {
    const kod = await zalozZakazku(page, { zakaznik: testovaciJmeno("Souběh"), zarizeni: "Notebook (souběh)" });
    // Technik nic neobnovuje – zakázka mu má přijít sama.
    await expect(technik.getByText(kod, { exact: true })).toBeVisible({ timeout: 30_000 });
  } finally {
    await technik.context().close();
  }
});

test("změna stavu od jednoho se propíše druhému", async ({ page, browser }) => {
  await prihlasSe(page, "owner");
  const technik = await druhyClovek(browser, "technik");
  try {
    const kod = await zalozZakazku(page, { zakaznik: testovaciJmeno("Stav"), zarizeni: "Tiskárna (souběh)" });
    await expect(technik.getByText(kod, { exact: true })).toBeVisible({ timeout: 30_000 });

    // Stav mění technik – má na to právo can_change_ticket_status.
    await radekZakazky(technik, kod).getByRole("button", { name: /Přijato/ }).first().click();
    await technik.getByRole("button", { name: "Diagnostika", exact: true }).first().click();
    await expect(radekZakazky(technik, kod).getByRole("button", { name: /Diagnostika/ })).toBeVisible({ timeout: 20_000 });

    // U majitele se stav musí změnit taky, bez obnovení stránky.
    await expect(radekZakazky(page, kod).getByRole("button", { name: /Diagnostika/ })).toBeVisible({ timeout: 30_000 });
  } finally {
    await technik.context().close();
  }
});

test("oprava přidaná majitelem přežije změnu stavu od technika", async ({ page, browser }) => {
  // Dřív se opravy ukládaly až při zavření detailu. Když mezitím technik
  // změnil stav, realtime přepsal rozepsané opravy verzí z databáze a ve
  // skladu zůstala rezervace na opravu, kterou zakázka už neměla.
  await prihlasSe(page, "owner");
  const technik = await druhyClovek(browser, "technik");
  try {
    const kod = await zalozZakazku(page, { zakaznik: testovaciJmeno("Oprava"), zarizeni: "Tablet (souběh)" });
    await expect(technik.getByText(kod, { exact: true })).toBeVisible({ timeout: 30_000 });

    // Majitel otevře detail a přidá opravu; detail nechá otevřený.
    await page.getByText(kod, { exact: true }).click();
    await expect(page.getByText("Provedené opravy").first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Manuálně zadat" }).first().click();
    await page.getByPlaceholder("Napište název opravy...").first().fill("Výměna skla (souběh)");
    await page.getByRole("button", { name: "Přidat opravu" }).first().click();
    await expect(page.getByText("Výměna skla (souběh)").first()).toBeVisible();

    // Technik mezitím změní stav ze seznamu.
    await radekZakazky(technik, kod).getByRole("button", { name: /Přijato/ }).first().click();
    await technik.getByRole("button", { name: "Diagnostika", exact: true }).first().click();
    await expect(radekZakazky(technik, kod).getByRole("button", { name: /Diagnostika/ })).toBeVisible({ timeout: 20_000 });

    // Majiteli přišla změna stavu, ale oprava nezmizela.
    await expect(page.getByRole("button", { name: /Diagnostika/ }).first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    await expect(page.getByText("Výměna skla (souběh)").first()).toBeVisible();

    // A je i v databázi: technik ji vidí, když si detail otevře.
    await technik.getByText(kod, { exact: true }).click();
    await expect(technik.getByText("Výměna skla (souběh)").first()).toBeVisible({ timeout: 20_000 });
  } finally {
    await technik.context().close();
  }
});

test("dva lidé zakládají zakázky naráz a čísla se nesrazí", async ({ page, browser }) => {
  await prihlasSe(page, "owner");
  const technik = await druhyClovek(browser, "technik");
  try {
    // Nejčastější situace na příjmu: dva pulty, dvě zakázky ve stejnou chvíli.
    const [kodA, kodB] = await Promise.all([
      zalozZakazku(page, { zakaznik: testovaciJmeno("Naráz A"), zarizeni: "Telefon A" }),
      zalozZakazku(technik, { zakaznik: testovaciJmeno("Naráz B"), zarizeni: "Telefon B" }),
    ]);
    expect(kodA).not.toBe(kodB);
    // Každý musí vidět i tu druhou zakázku.
    await expect(page.getByText(kodB, { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(technik.getByText(kodA, { exact: true })).toBeVisible({ timeout: 30_000 });
  } finally {
    await technik.context().close();
  }
});

test("technik nevidí, co mu servis nedal", async ({ page }) => {
  await prihlasSe(page, "technik");
  // Navigace událostí, ne klikem – postranní lišta se při najetí rozbalí
  // přes obsah a tlačítko se posune.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "settings" } })));
  await expect(page.getByText("Statusy zakázek").first()).toBeVisible({ timeout: 20_000 });
  // Owner panel a Předplatné patří majiteli, ne členovi týmu. Kdyby se
  // podmínka v nastavení rozbila, technik by viděl fakturační údaje servisu.
  await expect(page.getByRole("button", { name: "Owner", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Předplatné", exact: true })).toHaveCount(0);
  // Že jsme opravdu technik a ne majitel, ověříme z přihlášené relace –
  // přezdívka je v postranní liště, která je ve výchozím stavu sbalená.
  const email = await page.evaluate(() => {
    const klic = Object.keys(localStorage).find((k) => k.includes("auth-token"));
    return klic ? JSON.parse(localStorage.getItem(klic) as string)?.user?.email : null;
  });
  expect(email).toBe(TECHNIK.email);
});
