import { test, expect, type Page, type Locator } from "@playwright/test";
import { SERVIS, TECHNIK, heslo, prihlasSe } from "./pomocnici";

/**
 * Přepínání účtů na sdíleném počítači s PINem.
 *
 * PROČ TENHLE TEST EXISTUJE
 * Přepnutí sahá na přihlášení samotné: odloží relaci jednoho člověka,
 * nasadí relaci druhého a celou aplikaci znovu načte. Když se to rozbije,
 * nikdo si toho v jednotkových testech nevšimne – knihovna je jen obal nad
 * `auth.setSession`. Tady se ověřuje celá cesta: PIN se uloží, druhý účet
 * se přihlásí heslem a první zůstane přihlášený na pozadí, špatný PIN
 * neprojde a odpočítá pokus, správný přepne zpět. Účet bez PINu se otevře
 * heslem a PIN si nastaví až po přihlášení – kdo PIN má, o něj nepřijde.
 * Zámek obrazovky nejde zavřít jinak než PINem.
 *
 * Jede proti ostrému Supabase s testovacími účty; PINy se na konci zase
 * zruší, aby stav účtů nezůstal změněný.
 */
test.describe.configure({ mode: "serial" });

const PIN = "4321";
const PIN_TECHNIK = "8765";

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

/**
 * E-mail přihlášeného z uložené relace Supabase (localStorage nebo
 * sessionStorage podle volby „Zapamatovat“). Dřív se četl z nabídky pod
 * tlačítkem „Účet“, ale ta se při opakovaném dotazování občas zavřela
 * dřív, než se stihla přečíst.
 */
async function prihlasenyEmail(page: Page): Promise<string> {
  return page.evaluate(() => {
    for (const uloziste of [localStorage, sessionStorage]) {
      for (let i = 0; i < uloziste.length; i++) {
        const k = uloziste.key(i) ?? "";
        if (k.startsWith("sb-") && k.endsWith("-auth-token")) {
          try { return String(JSON.parse(uloziste.getItem(k) ?? "{}")?.user?.email ?? ""); } catch { return ""; }
        }
      }
    }
    return "";
  });
}

async function otevriPrepinac(page: Page): Promise<Locator> {
  // Značka na staré stránce: po přepnutí se aplikace celá znovu načte a
  // značka zmizí. Podle e-mailu v úložišti se reload poznat nedá – relace
  // se přepne dřív, než stránka odejde.
  await page.evaluate(() => { (window as unknown as { __predPrepnutim?: boolean }).__predPrepnutim = true; });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobi:prepnout-ucet")));
  const dialog = page.getByRole("dialog", { name: "Přepnout účet" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function cekejNaPrihlaseni(page: Page, email: string): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __predPrepnutim?: boolean }).__predPrepnutim ?? null).catch(() => null), { timeout: 60_000 })
    .toBeNull();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => prihlasenyEmail(page), { timeout: 30_000 }).toBe(email);
}

async function zaparkovane(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    (JSON.parse(localStorage.getItem("jobi_zaparkovane_ucty_v1") ?? "[]") as Array<{ email: string }>).map((u) => u.email),
  );
}

test("druhý účet se přidá heslem, PIN si nastaví až po přihlášení a první se vrátí PINem", async ({ page }) => {
  test.setTimeout(240_000);
  await prihlasSe(page);
  await nastavPin(page, PIN);

  // Technik heslem – jen e-mail a heslo. PIN nemá, takže přijde krok „Nastavte si PIN“.
  const dialog = await otevriPrepinac(page);
  await dialog.getByRole("button", { name: "Přidat účet…" }).click();
  await expect(dialog.getByLabel("Nový PIN", { exact: true })).toHaveCount(0);
  await dialog.getByLabel("E-mail").fill(TECHNIK.email);
  await dialog.getByLabel("Heslo").fill(heslo("technik"));
  await dialog.getByRole("button", { name: "Přihlásit a přepnout" }).click();
  // Technik po minulém (třeba spadlém) běhu PIN mít může i nemusí: bez něj
  // přijde krok „Nastavte si PIN“, s ním se rovnou přepne. Oba případy jsou
  // správně; deterministicky to ověřuje až druhý test.
  const krokPinu = dialog.getByText("Nastavte si PIN");
  if (await krokPinu.waitFor({ state: "visible", timeout: 15_000 }).then(() => true).catch(() => false)) {
    await dialog.getByLabel("Nový PIN", { exact: true }).fill(PIN_TECHNIK);
    await dialog.getByLabel("Nový PIN znovu").fill("0000");
    await dialog.getByRole("button", { name: "Uložit PIN a pokračovat" }).click();
    await expect(dialog.getByRole("alert")).toContainText("neshoduje");
    await dialog.getByLabel("Nový PIN znovu").fill(PIN_TECHNIK);
    await dialog.getByRole("button", { name: "Uložit PIN a pokračovat" }).click();
  }
  await cekejNaPrihlaseni(page, TECHNIK.email);
  expect(await zaparkovane(page)).toEqual([SERVIS.email]);
  // Ať je PIN technika známý bez ohledu na to, kudy přišel.
  await nastavPin(page, PIN_TECHNIK);

  // Zpět na majitele: špatný PIN odpočítá pokus, správný přepne.
  const dialog2 = await otevriPrepinac(page);
  await dialog2.getByRole("button", { name: new RegExp(SERVIS.email) }).click();
  const pin = dialog2.getByLabel("PIN", { exact: true });
  await pin.fill("0000");
  await expect(dialog2.getByRole("alert")).toContainText("Nesprávný PIN. Zbývá 4 pokusy.");
  await pin.fill(PIN);
  await cekejNaPrihlaseni(page, SERVIS.email);
  expect(await zaparkovane(page)).toEqual([TECHNIK.email]);

  // PIN, který si technik nastavil po přihlášení, platí – naťukaný na klávesnici.
  const dialog3 = await otevriPrepinac(page);
  await dialog3.getByRole("button", { name: new RegExp(TECHNIK.email) }).click();
  for (const c of PIN_TECHNIK) await dialog3.getByRole("button", { name: c, exact: true }).click();
  await cekejNaPrihlaseni(page, TECHNIK.email);

  // Technik s PINem zpět k majiteli a majitel znovu přidá technika heslem:
  // účet PIN už má, žádný krok s PINem se neukáže a PIN zůstane starý.
  const dialog4 = await otevriPrepinac(page);
  await dialog4.getByRole("button", { name: new RegExp(SERVIS.email) }).click();
  await dialog4.getByLabel("PIN", { exact: true }).fill(PIN);
  await cekejNaPrihlaseni(page, SERVIS.email);
  await page.evaluate(() => localStorage.removeItem("jobi_zaparkovane_ucty_v1"));
  const dialog5 = await otevriPrepinac(page);
  await dialog5.getByRole("button", { name: "Přidat účet…" }).click();
  await dialog5.getByLabel("E-mail").fill(TECHNIK.email);
  await dialog5.getByLabel("Heslo").fill(heslo("technik"));
  await dialog5.getByRole("button", { name: "Přihlásit a přepnout" }).click();
  await cekejNaPrihlaseni(page, TECHNIK.email);
  const dialog6 = await otevriPrepinac(page);
  await dialog6.getByRole("button", { name: new RegExp(SERVIS.email) }).click();
  await dialog6.getByLabel("PIN", { exact: true }).fill(PIN);
  await cekejNaPrihlaseni(page, SERVIS.email);
  const dialog7 = await otevriPrepinac(page);
  await dialog7.getByRole("button", { name: new RegExp(TECHNIK.email) }).click();
  await dialog7.getByLabel("PIN", { exact: true }).fill(PIN_TECHNIK);
  await cekejNaPrihlaseni(page, TECHNIK.email);

  // Úklid: oba bez PINu.
  await zrusPin(page);
  const dialog8 = await otevriPrepinac(page);
  await dialog8.getByRole("button", { name: new RegExp(SERVIS.email) }).click();
  await dialog8.getByLabel("PIN", { exact: true }).fill(PIN);
  await cekejNaPrihlaseni(page, SERVIS.email);
  await zrusPin(page);
});

test("účet na pozadí bez PINu se otevře heslem; zapomenutý PIN jde nahradit", async ({ page }) => {
  test.setTimeout(240_000);
  await prihlasSe(page);
  await nastavPin(page, PIN);

  // Technik heslem, PIN si nastaví, pak si ho zruší a přepne se zpět – zůstane na pozadí bez PINu.
  const dialog = await otevriPrepinac(page);
  await dialog.getByRole("button", { name: "Přidat účet…" }).click();
  await dialog.getByLabel("E-mail").fill(TECHNIK.email);
  await dialog.getByLabel("Heslo").fill(heslo("technik"));
  await dialog.getByRole("button", { name: "Přihlásit a přepnout" }).click();
  await expect(dialog.getByText("Nastavte si PIN")).toBeVisible({ timeout: 30_000 });
  await dialog.getByLabel("Nový PIN", { exact: true }).fill(PIN_TECHNIK);
  await dialog.getByLabel("Nový PIN znovu").fill(PIN_TECHNIK);
  await dialog.getByRole("button", { name: "Uložit PIN a pokračovat" }).click();
  await cekejNaPrihlaseni(page, TECHNIK.email);
  await zrusPin(page);
  const dialog2 = await otevriPrepinac(page);
  await dialog2.getByRole("button", { name: new RegExp(SERVIS.email) }).click();
  await dialog2.getByLabel("PIN", { exact: true }).fill(PIN);
  await cekejNaPrihlaseni(page, SERVIS.email);

  // Technik bez PINu: místo klávesnice rovnou heslo, po přihlášení povinný PIN.
  const dialog3 = await otevriPrepinac(page);
  await dialog3.getByRole("button", { name: new RegExp(TECHNIK.email) }).click();
  await expect(dialog3.getByText("Tento účet ještě nemá PIN")).toBeVisible();
  await expect(dialog3.getByLabel("E-mail")).toHaveValue(TECHNIK.email);
  await dialog3.getByLabel("Heslo").fill(heslo("technik"));
  await dialog3.getByRole("button", { name: "Přihlásit a přepnout" }).click();
  await expect(dialog3.getByText("Nastavte si PIN")).toBeVisible({ timeout: 30_000 });
  await dialog3.getByLabel("Nový PIN", { exact: true }).fill(PIN_TECHNIK);
  await dialog3.getByLabel("Nový PIN znovu").fill(PIN_TECHNIK);
  await dialog3.getByRole("button", { name: "Uložit PIN a pokračovat" }).click();
  await cekejNaPrihlaseni(page, TECHNIK.email);
  expect(await zaparkovane(page)).toEqual([SERVIS.email]);

  // Zapomenutý PIN majitele: „Nevíte PIN? Přihlásit heslem“ → heslo → nový PIN.
  const dialog4 = await otevriPrepinac(page);
  await dialog4.getByRole("button", { name: new RegExp(SERVIS.email) }).click();
  await dialog4.getByRole("button", { name: /Nevíte PIN/ }).click();
  await expect(dialog4.getByLabel("E-mail")).toHaveValue(SERVIS.email);
  await dialog4.getByLabel("Heslo").fill(heslo("owner"));
  await dialog4.getByRole("button", { name: "Přihlásit a přepnout" }).click();
  await expect(dialog4.getByText("Nastavte si PIN")).toBeVisible({ timeout: 30_000 });
  await dialog4.getByLabel("Nový PIN", { exact: true }).fill("1111");
  await dialog4.getByLabel("Nový PIN znovu").fill("1111");
  await dialog4.getByRole("button", { name: "Uložit PIN a pokračovat" }).click();
  await cekejNaPrihlaseni(page, SERVIS.email);

  // Nový PIN majitele platí; úklid obou PINů.
  await zrusPin(page);
  const dialog5 = await otevriPrepinac(page);
  await dialog5.getByRole("button", { name: new RegExp(TECHNIK.email) }).click();
  await dialog5.getByLabel("PIN", { exact: true }).fill(PIN_TECHNIK);
  await cekejNaPrihlaseni(page, TECHNIK.email);
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
