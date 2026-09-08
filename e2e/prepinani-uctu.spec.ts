import { test, expect, type Page } from "@playwright/test";
import { SERVIS, TECHNIK, heslo, prihlasSe } from "./pomocnici";

/**
 * Přepínání účtů na sdíleném počítači s PINem.
 *
 * PROČ TENHLE TEST EXISTUJE
 * Přepnutí sahá na přihlášení samotné: odloží relaci jednoho člověka,
 * nasadí relaci druhého a celou aplikaci znovu načte. Když se to rozbije,
 * nikdo si toho v jednotkových testech nevšimne – knihovna je jen obal nad
 * `auth.setSession`. Tady se ověřuje celá cesta: PIN se uloží, druhý účet
 * se přihlásí heslem a první zůstane zaparkovaný, špatný PIN neprojde a
 * odpočítá pokus, správný přepne zpět. Zámek obrazovky nejde zavřít jinak
 * než PINem.
 *
 * Jede proti ostrému Supabase s testovacími účty; PIN majitele se na konci
 * zase zruší, aby stav účtu nezůstal změněný.
 */
test.describe.configure({ mode: "serial" });

const PIN = "4321";

async function doProfilu(page: Page): Promise<void> {
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "settings", subsection: "profile_me" } })),
  );
  await expect(page.getByText("Sdílený počítač", { exact: true })).toBeVisible({ timeout: 30_000 });
}

async function nastavPin(page: Page, pin: string): Promise<void> {
  await doProfilu(page);
  await page.getByLabel("Nový PIN", { exact: true }).fill(pin);
  await page.getByLabel("Nový PIN znovu").fill(pin);
  await page.getByRole("button", { name: /^(Nastavit|Změnit)$/ }).click();
  await expect(page.getByText("PIN uložen")).toBeVisible({ timeout: 15_000 });
}

async function zrusPin(page: Page): Promise<void> {
  await doProfilu(page);
  await page.getByRole("button", { name: "Zrušit PIN" }).first().click();
  await page.getByRole("button", { name: "Zrušit PIN" }).last().click();
  await expect(page.getByText("PIN zrušen")).toBeVisible({ timeout: 15_000 });
}

/** E-mail přihlášeného je v nabídce pod tlačítkem „Účet“ v postranním panelu. */
async function prihlasenyEmail(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Účet" }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  const text = await menu.innerText();
  await page.keyboard.press("Escape");
  return (text.match(/\S+@\S+/) ?? [""])[0];
}

test("druhý účet se přidá heslem, první zůstane zaparkovaný a vrátí se PINem", async ({ page }) => {
  test.setTimeout(180_000);
  await prihlasSe(page);
  await nastavPin(page, PIN);

  // Přidání technika heslem – majitel se zaparkuje a aplikace naběhne jako technik.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobi:prepnout-ucet")));
  const dialog = page.getByRole("dialog", { name: "Přepnout účet" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Přidat účet…" }).click();
  await dialog.getByLabel("E-mail").fill(TECHNIK.email);
  await dialog.getByLabel("Heslo").fill(heslo("technik"));
  await dialog.getByRole("button", { name: "Přihlásit a přepnout" }).click();

  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => prihlasenyEmail(page), { timeout: 30_000 }).toBe(TECHNIK.email);
  const zaparkovani = await page.evaluate(() =>
    (JSON.parse(localStorage.getItem("jobi_zaparkovane_ucty_v1") ?? "[]") as Array<{ email: string }>).map((u) => u.email),
  );
  expect(zaparkovani).toEqual([SERVIS.email]);

  // Zpět na majitele: nejdřív špatný PIN (odpočítá pokus), pak správný.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobi:prepnout-ucet")));
  const dialog2 = page.getByRole("dialog", { name: "Přepnout účet" });
  await dialog2.getByRole("button", { name: new RegExp(SERVIS.email) }).click();
  const pin = dialog2.getByLabel("PIN", { exact: true });
  await pin.fill("0000");
  await expect(dialog2.getByRole("alert")).toContainText("Nesprávný PIN. Zbývá 4 pokusy.");
  await pin.fill(PIN);

  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => prihlasenyEmail(page), { timeout: 30_000 }).toBe(SERVIS.email);
  const zaparkovani2 = await page.evaluate(() =>
    (JSON.parse(localStorage.getItem("jobi_zaparkovane_ucty_v1") ?? "[]") as Array<{ email: string }>).map((u) => u.email),
  );
  expect(zaparkovani2).toEqual([TECHNIK.email]);

  await zrusPin(page);
});

test("zámek obrazovky nejde zavřít jinak než PINem", async ({ page }) => {
  test.setTimeout(150_000);
  await prihlasSe(page);
  await nastavPin(page, PIN);

  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobi:zamknout")));
  const zamek = page.getByRole("dialog", { name: "Obrazovka je zamčená" });
  await expect(zamek).toBeVisible();
  await expect(zamek.getByText("Kdo pokračuje?")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(zamek).toBeVisible();

  await zamek.getByRole("button", { name: new RegExp(SERVIS.email) }).click();
  const pin = zamek.getByLabel("PIN", { exact: true });
  await pin.fill("9999");
  await expect(zamek.getByRole("alert")).toContainText("Nesprávný PIN");
  await pin.fill(PIN);
  await expect(zamek).toBeHidden({ timeout: 15_000 });

  await zrusPin(page);
});
