import { test, expect } from "@playwright/test";
import { prihlasSe } from "./pomocnici";

/**
 * Nastavení se musí pamatovat.
 *
 * Zobrazení zakázek se dřív po každém spuštění vracelo na výchozí, protože
 * se ukládalo, ale při dalším načtení ho přepsala starší kopie. Zákazník to
 * hlásil dvakrát a poznat to jde jedině tím, že se aplikace znovu načte.
 */
/** Nastavení → Aplikace → Rozhraní. Přes hledání, protože v levém sloupci
 *  je položka podle výšky okna pod přehybem a klik na ni nemusí projít. */
async function otevriRozhrani(page: import("@playwright/test").Page) {
  // Do nastavení se skáče událostí aplikace, ne klikem do postranní lišty:
  // ta se při najetí myší rozbalí přes obsah a tlačítko se posune jinam.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "settings" } })));
  const hledani = page.getByPlaceholder("Hledat v nastavení…");
  await expect(hledani).toBeVisible({ timeout: 20_000 });
  await hledani.fill("zobrazení zakázek");
  await page.getByRole("button", { name: /Rozhraní/ }).first().click();
  await hledani.fill("");
}

test("zvolené zobrazení zakázek přežije obnovení aplikace", async ({ page }) => {
  await prihlasSe(page);
  await otevriRozhrani(page);

  const skupina = page.getByRole("radiogroup", { name: "Zobrazení zakázek" });
  await expect(skupina).toBeVisible({ timeout: 20_000 });
  await skupina.getByRole("radio", { name: /Mřížka/ }).click();
  await expect(skupina.getByRole("radio", { name: /Mřížka/ })).toBeChecked();

  // Uložení jde přes síť; bez čekání by se stránka načetla dřív, než odejde.
  await page.waitForTimeout(2000);
  await page.reload();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });

  await otevriRozhrani(page);
  const poZnovunacteni = page.getByRole("radiogroup", { name: "Zobrazení zakázek" });
  await expect(poZnovunacteni.getByRole("radio", { name: /Mřížka/ })).toBeChecked({ timeout: 20_000 });

  // Uklidit po sobě, ať další běh začíná od výchozího stavu.
  await poZnovunacteni.getByRole("radio", { name: /Seznam/ }).click();
  await page.waitForTimeout(1500);
});

/** Otevře podsekci nastavení podle názvu (přes hledání, viz otevriRozhrani). */
async function otevriSekci(page: import("@playwright/test").Page, hledat: string, nazev: RegExp) {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "settings" } })));
  const hledani = page.getByPlaceholder("Hledat v nastavení…");
  await expect(hledani).toBeVisible({ timeout: 20_000 });
  await hledani.fill(hledat);
  await page.getByRole("button", { name: nazev }).first().click();
  await hledani.fill("");
}

test("výchozí hodinová sazba se uloží servisu a předvyplní se v zakázce", async ({ page }) => {
  test.setTimeout(150_000);
  await prihlasSe(page);
  await otevriSekci(page, "hodinová sazba", /Hodinová práce/);

  const sazba = page.getByLabel("Výchozí hodinová sazba v Kč za hodinu");
  await expect(sazba).toBeVisible({ timeout: 20_000 });
  const puvodni = await sazba.inputValue();

  await sazba.fill("950");
  // Ukládá se po opuštění pole – kliknutí jinam je součást chování.
  await sazba.blur();
  await expect(page.getByText(/Uloženo/i).first()).toBeVisible({ timeout: 20_000 });

  // Nastavení servisu sdílí celý tým, takže se musí načíst i po restartu.
  await page.reload();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
  /* Sekce se otevírá přes hledání a hodnota dojede z databáze; při plném
     běhu sady to trvá dýl, proto se v případě prázdna zkusí otevřít znovu. */
  await expect
    .poll(async () => {
      await otevriSekci(page, "hodinová sazba", /Hodinová práce/);
      return page.getByLabel("Výchozí hodinová sazba v Kč za hodinu").inputValue().catch(() => "");
    }, { timeout: 60_000, message: "Sazba se po restartu nenačetla." })
    .toBe("950");

  // A hlavně: projeví se tam, kde se používá.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "orders" } })));
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 20_000 });
  await page.getByText(/^E2E\d{6,}$/).first().click();
  await expect(page.getByText("Provedené opravy").first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Hodinová práce" }).first().click();
  await expect(page.getByLabel("Sazba (Kč/h)")).toHaveValue("950", { timeout: 20_000 });
  await page.keyboard.press("Escape");

  // Uklidit po sobě.
  await otevriSekci(page, "hodinová sazba", /Hodinová práce/);
  const zpet = page.getByLabel("Výchozí hodinová sazba v Kč za hodinu");
  await zpet.fill(puvodni);
  await zpet.blur();
  await page.waitForTimeout(1500);
});

test("na poslední položku v Nastavení jde doscrollovat i v nízkém okně", async ({ page }) => {
  /*
   * Sloupec sekcí měl výšku z `calc(100vh - …)`, jenže nad stránkou je ještě
   * lišta aplikace – sloupec tak končil pod spodní hranou okna a na poslední
   * položku („Fotka a přezdívka“) se nedalo doscrollovat ani kliknout.
   * Nízké okno je schválně: na velkém displeji se seznam vejde a chyba není vidět.
   */
  await page.setViewportSize({ width: 1280, height: 700 });
  await prihlasSe(page);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "settings" } })));
  await expect(page.getByPlaceholder("Hledat v nastavení…")).toBeVisible({ timeout: 20_000 });

  const mimoOkno = await page.evaluate(() => {
    const nav = document.querySelector('nav[data-tour="settings-categories"]');
    if (!nav) return "sloupec sekcí se nenašel";
    const r = nav.getBoundingClientRect();
    if (r.bottom > window.innerHeight + 1) return `sloupec přetéká pod okno o ${Math.round(r.bottom - window.innerHeight)} px`;
    nav.scrollTop = nav.scrollHeight;
    const posledni = Array.from(nav.querySelectorAll("button")).pop();
    if (!posledni) return "sloupec nemá žádnou položku";
    const pr = posledni.getBoundingClientRect();
    if (pr.bottom > window.innerHeight) return `poslední položka končí ${Math.round(pr.bottom - window.innerHeight)} px pod oknem`;
    return null;
  });
  expect(mimoOkno, String(mimoOkno)).toBeNull();

  // A dá se na ni i kliknout – tedy otevře svou sekci. Poznávacím znamením je
  // karta „Přidat servis pomocí pozvánky“, která je jen tady.
  await page.getByRole("button", { name: /Fotka a přezdívka/ }).first().click();
  await expect(page.getByText("Přidat servis pomocí pozvánky").first()).toBeVisible({ timeout: 15_000 });

  /*
   * A totéž při zvětšeném rozhraní. Velikost se dělá `zoom`em na `<html>`,
   * který míchá dvě soustavy souřadnic: bez přepočtu sloupec při 125 %
   * přetekl o 140 px pod okno. Zoom se sahá přímo na dokument, ne přes
   * Nastavení – předvolba se ukládá k účtu a zůstala by zapnutá i dalším
   * sadám (viz e2e/README.md).
   */
  for (const meritko of [1.1, 1.25]) {
    await page.evaluate((s) => {
      document.documentElement.style.setProperty("zoom", String(s));
      document.documentElement.style.setProperty("--ui-scale", String(s));
      window.dispatchEvent(new Event("resize"));
    }, meritko);
    await page.waitForTimeout(400);
    const chyba = await page.evaluate((s) => {
      const nav = document.querySelector('nav[data-tour="settings-categories"]');
      if (!nav) return "sloupec sekcí se nenašel";
      nav.scrollTop = nav.scrollHeight;
      const posledni = Array.from(nav.querySelectorAll("button")).pop();
      if (!posledni) return "sloupec nemá žádnou položku";
      // `getBoundingClientRect()` i `innerHeight` jsou v pixelech okna, takže
      // se porovnávají přímo – měřítko se do nich promítlo obojím stejně.
      const dole = posledni.getBoundingClientRect().bottom;
      return dole > window.innerHeight
        ? `při ${Math.round(s * 100)} % končí poslední položka ${Math.round(dole - window.innerHeight)} px pod oknem`
        : null;
    }, meritko);
    expect(chyba, String(chyba)).toBeNull();
  }
  await page.evaluate(() => {
    document.documentElement.style.removeProperty("zoom");
    document.documentElement.style.setProperty("--ui-scale", "1");
  });
});
