import { test, expect, type Page } from "@playwright/test";
import { SERVIS, TECHNIK, prihlasSe, testovaciJmeno, zalozZakazku, zavriDetail } from "./pomocnici";

/**
 * Chat týmu.
 *
 * PROČ TENHLE TEST EXISTUJE
 * Chat stojí na realtime, RLS a počítání nepřečtených na serveru – tři věci,
 * které se rozbijí tiše: zpráva odejde, ale druhému nedorazí, nebo se
 * bublina nerozsvítí. Test jde přes dva lidi ve dvou prohlížečích: majitel
 * pošle do kanálu servisu zprávu se zmínkou zakázky, technik vidí červené
 * číslo, zprávu přečte (číslo zmizí), zakázku si přes „Přebírám“ vezme a
 * zmínka mu otevře detail. Pak soukromá zpráva zpět a hledání.
 */
test.describe.configure({ mode: "serial" });

const razitko = Date.now().toString(36).toUpperCase();
const stav: { kod?: string } = {};

const bublina = (page: Page) => page.getByRole("button", { name: /^Chat/ }).first();
const panel = (page: Page) => page.getByRole("complementary", { name: "Chat týmu" });

async function otevriChat(page: Page): Promise<void> {
  if (!(await panel(page).isVisible().catch(() => false))) await bublina(page).click();
  await expect(panel(page)).toBeVisible({ timeout: 15_000 });
}

async function prepniKanal(page: Page, nazev: string | RegExp): Promise<void> {
  const p = panel(page);
  await p.getByRole("button", { name: /Přepnout kanál/ }).click();
  const kanaly = p.getByRole("listbox", { name: "Kanály" });
  await expect(kanaly).toBeVisible();
  await kanaly.getByRole("option", { name: nazev }).first().click();
  await expect(kanaly).toBeHidden();
}

test("majitel napíše do kanálu servisu zprávu se zmínkou zakázky", async ({ page }) => {
  test.setTimeout(180_000);
  await prihlasSe(page);
  stav.kod = await zalozZakazku(page, { zakaznik: testovaciJmeno("Chat"), zarizeni: "iPhone (chat)", popis: "Zakázka pro chat" });

  await otevriChat(page);
  await prepniKanal(page, new RegExp(SERVIS.nazev));
  const pole = panel(page).getByRole("textbox", { name: "Text zprávy" });
  await pole.click();
  await pole.type(`#${stav.kod}`);
  const navrhy = panel(page).getByRole("listbox", { name: "Návrhy zmínek" });
  await expect(navrhy).toBeVisible({ timeout: 15_000 });
  await navrhy.getByRole("option", { name: new RegExp(stav.kod!) }).first().click();
  await pole.type(` prosím převzít ${razitko}`);
  await pole.press("Enter");
  const log = panel(page).getByRole("log");
  await expect(log.getByText(`prosím převzít ${razitko}`, { exact: false })).toBeVisible({ timeout: 20_000 });
  await expect(log.getByRole("button", { name: `#${stav.kod}` })).toBeVisible();
});

test("technik vidí nepřečtenou, přečte ji, zakázku převezme a zmínka otevře detail", async ({ page }) => {
  test.setTimeout(180_000);
  page.setDefaultNavigationTimeout(30_000);
  await prihlasSe(page, "technik");
  // Bublina hlásí nepřečtené dřív, než se panel vůbec otevře.
  await expect(page.getByRole("button", { name: /^Chat, \d+ nepřečten/ })).toBeVisible({ timeout: 30_000 });
  await otevriChat(page);
  await prepniKanal(page, new RegExp(SERVIS.nazev));
  const log = panel(page).getByRole("log");
  const zprava = log.locator(`text=prosím převzít ${razitko}`).first();
  await expect(zprava).toBeVisible({ timeout: 20_000 });
  // Přečteno – bublina bez čísla.
  await expect(page.getByRole("button", { name: "Chat", exact: true })).toBeVisible({ timeout: 20_000 });

  // V kanálu jsou i zprávy z minulých běhů – „Přebírám“ musí být z TÉHLE zprávy.
  const bublinaZpravy = zprava.locator("xpath=ancestor::*[.//button[starts-with(normalize-space(.), 'Přebírám')]][1]");
  await bublinaZpravy.getByRole("button", { name: /^Přebírám/ }).click();
  // Zmínka otevře detail; tam je zakázka přidělená a „Přidělit mně“ už není.
  await bublinaZpravy.getByRole("button", { name: `#${stav.kod}` }).click();
  const karta = page.locator("#detail-technik");
  await expect(karta).toBeVisible({ timeout: 30_000 });
  await expect(karta.getByRole("combobox", { name: "Přidělený technik" })).toHaveValue(/.+/, { timeout: 20_000 });
  await expect(karta.getByRole("button", { name: "Přidělit mně" })).toHaveCount(0);
  await zavriDetail(page).catch(() => undefined);

  // Soukromá zpráva majiteli.
  await otevriChat(page);
  await prepniKanal(page, /E2E majitel/);
  const pole = panel(page).getByRole("textbox", { name: "Text zprávy" });
  await pole.fill(`Hotovo, DM ${razitko}`);
  await pole.press("Enter");
  await expect(panel(page).getByRole("log").getByText(`Hotovo, DM ${razitko}`)).toBeVisible({ timeout: 20_000 });
});

test("majitel dostane soukromou zprávu, najde ji hledáním a připne", async ({ page }) => {
  test.setTimeout(180_000);
  await prihlasSe(page);
  await expect(page.getByRole("button", { name: /^Chat, \d+ nepřečten/ })).toBeVisible({ timeout: 30_000 });
  await otevriChat(page);
  await prepniKanal(page, new RegExp(TECHNIK.prezdivka));
  const log = panel(page).getByRole("log");
  const dm = log.getByText(`Hotovo, DM ${razitko}`);
  await expect(dm).toBeVisible({ timeout: 20_000 });

  // Hledání přes všechny kanály.
  await panel(page).getByRole("button", { name: "Hledat ve zprávách" }).click();
  // Pole je <input type="search"> – role searchbox, ne textbox; stejný popisek má i tlačítko.
  await panel(page).locator('input[aria-label="Hledat ve zprávách"]').fill(razitko);
  const vysledky = panel(page).getByRole("log", { name: "Výsledky hledání" });
  await expect(vysledky.getByText(`Hotovo, DM ${razitko}`)).toBeVisible({ timeout: 20_000 });
  await expect(vysledky.getByText(`prosím převzít ${razitko}`, { exact: false })).toBeVisible();
  await panel(page).getByRole("button", { name: "Zavřít hledání" }).click();

  // Připnout smí majitel; připnutá zpráva se ukáže nahoře v panelu.
  // Akce se ukazují jen po najetí na TUTO zprávu; první tlačítko v panelu by patřilo starší zprávě.
  const bublinaDm = dm.locator("xpath=ancestor::*[.//button[@aria-label='Připnout zprávu' or @aria-label='Odepnout zprávu']][1]");
  await bublinaDm.hover();
  await bublinaDm.getByRole("button", { name: "Připnout zprávu" }).click();
  // Připnutá zpráva je v panelu dvakrát: v seznamu a v proužku nahoře. Po
  // odepnutí zůstane jen v seznamu – starší připnuté zprávy z minulých běhů
  // tím nejsou dotčené, proto se počítá text, ne tlačítka.
  const text = panel(page).getByText(`Hotovo, DM ${razitko}`);
  await expect(text).toHaveCount(2, { timeout: 15_000 });
  await panel(page).getByRole("button", { name: "Odepnout", exact: true }).first().click();
  await expect(text).toHaveCount(1, { timeout: 15_000 });
});
