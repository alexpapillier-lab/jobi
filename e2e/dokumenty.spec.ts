import { test, expect, type Page } from "@playwright/test";

/**
 * Vzhled tištěných dokumentů.
 *
 * Doklady vykresluje jádro JobiDocs (`jobidocs/core`) – to samé používá
 * desktopová aplikace při tisku i webová verze v tiskovém dialogu. Co
 * projde tady, dostane zákazník i na papíře.
 *
 * Testuje se přes náhledovou stránku `e2e/dokumenty/nahled.html`, která
 * dokument vykreslí do rámu o rozměru A4. Do produkčního buildu se
 * nedostane – Vite staví jen `index.html` v kořeni.
 *
 * Data jsou ukázková ze samotného jádra, ve třech variantách: běžná
 * zakázka, „hodně všeho“ (dlouhé texty, spousta položek) a skoro prázdná.
 * Prázdná varianta je ta zákeřná: právě tam se dřív tiskly „undefined“
 * a „NaN“.
 */

const TYPY = [
  "zakazkovy_list",
  "zarucni_list",
  "diagnosticky_protokol",
  "prijemka_reklamace",
  "vydejka_reklamace",
  "faktura",
  "smlouva_zapujcka",
] as const;

const VARIANTY = ["short", "long", "empty"] as const;

/** Otevře náhled a počká, až jádro dopočítá rozvržení stránky. */
async function otevriDokument(page: Page, typ: string, varianta: string) {
  await page.goto(`/e2e/dokumenty/nahled.html?typ=${typ}&varianta=${varianta}`);
  const ramec = page.frameLocator("#ramec");
  // Jádro po dopočítání písma a stránkování nastaví na <html> značku.
  await expect
    .poll(
      () => page.evaluate(() => (document.getElementById("ramec") as HTMLIFrameElement | null)?.contentDocument?.documentElement?.dataset?.fit ?? ""),
      { timeout: 30_000, message: `Dokument ${typ}/${varianta} se nedopočítal.` },
    )
    .toBe("done");
  return ramec;
}

/** Údaje, které jádro po dopočítání vystaví na <html> dokumentu. */
async function rozvrzeni(page: Page): Promise<{ stran: number; preteklo: boolean; pismo: number }> {
  return page.evaluate(() => {
    const d = (document.getElementById("ramec") as HTMLIFrameElement).contentDocument!.documentElement.dataset;
    return { stran: Number(d.pages ?? "0"), preteklo: d.overflow === "1", pismo: Number(d.fontSize ?? "0") };
  });
}

for (const typ of TYPY) {
  for (const varianta of VARIANTY) {
    test(`${typ} (${varianta}) se vykreslí bez děr v textu`, async ({ page }) => {
      test.setTimeout(90_000);
      const ramec = await otevriDokument(page, typ, varianta);
      const text = await ramec.locator("body").innerText();

      /* Tohle jsou stopy chybějících dat, které se dřív tiskly zákazníkovi:
         „undefined", „NaN", „null" nebo prázdná cena. */
      expect(text, "v dokumentu je undefined").not.toMatch(/undefined/i);
      expect(text, "v dokumentu je NaN").not.toMatch(/NaN/);
      expect(text, "v dokumentu je [object Object]").not.toContain("[object Object]");
      expect(text, "v dokumentu je osamocené null").not.toMatch(/(^|\s)null(\s|$)/i);
      /* Před každou „Kč" musí být číslice. Prázdná cena („ Kč") znamená,
         že se částka nevykreslila. Právní věty typu „20 Kč za den" tím
         projdou, protože číslici před sebou mají. */
      const prazdneCastky = [...text.matchAll(/Kč/g)].filter(
        (m) => !/\d[\s\u00a0\u202f]?$/.test(text.slice(Math.max(0, (m.index ?? 0) - 3), m.index)),
      );
      expect(prazdneCastky.length, "v dokumentu je částka bez čísla").toBe(0);

      // Něco tam být musí – prázdná stránka je taky chyba.
      expect(text.trim().length).toBeGreaterThan(40);
    });

    test(`${typ} (${varianta}) se vejde na stránku`, async ({ page }) => {
      test.setTimeout(90_000);
      await otevriDokument(page, typ, varianta);
      const { stran, preteklo, pismo } = await rozvrzeni(page);

      // Přetečení znamená, že se text nevešel a je oříznutý.
      expect(preteklo, "obsah přetekl stránku").toBe(false);
      expect(stran).toBeGreaterThanOrEqual(1);
      // Zmenšování písma má strop; pod ním je doklad nečitelný.
      expect(pismo).toBeGreaterThanOrEqual(7);
      /* Doklady, které se podepisují u pultu, musí být na jedné stránce –
         dvě stránky znamenají druhý podpis a další papír. Diagnostický
         protokol s fotkami se na jednu stránku vejít nemusí. */
      if (varianta === "short") {
        const naJednu = typ === "zakazkovy_list" || typ === "smlouva_zapujcka" || typ === "zarucni_list";
        expect(stran).toBeLessThanOrEqual(naJednu ? 1 : 2);
      }
    });
  }
}

test("částky na dokladech jsou české, ne strojové", async ({ page }) => {
  test.setTimeout(90_000);
  for (const typ of ["zakazkovy_list", "faktura"] as const) {
    const ramec = await otevriDokument(page, typ, "short");
    const text = await ramec.locator("body").innerText();
    const castky = text.match(/\d[\d\s  ]*[,.]\d\d\s*Kč/g) ?? [];
    expect(castky.length, `${typ}: na dokladu nejsou žádné částky`).toBeGreaterThan(0);
    for (const c of castky) {
      // Desetinná tečka na českém dokladu nemá co dělat.
      expect(c, `${typ}: částka „${c}" má desetinnou tečku`).not.toMatch(/\.\d\d\s*Kč/);
    }
  }
});
