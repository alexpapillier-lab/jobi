import { test, expect, type Page } from "@playwright/test";

/**
 * Vizuální kontrola tištěných dokumentů.
 *
 * Testy v `dokumenty.spec.ts` hlídají obsah – že v dokladu nechybí částka
 * a že se vejde na stránku. Nevidí ale, jak doklad vypadá: že se dva bloky
 * nepřekryly, že logo nezmizelo, že se tabulka nerozjela. To pozná až
 * porovnání obrázku s předlohou.
 *
 * Předlohy jsou vázané na systém, protože macOS a Linux vykreslují písmo
 * jinak. Proto se tenhle soubor v CI přeskakuje a pouští se před vydáním
 * na počítači, kde vznikly. Nové předlohy: `npm run test:e2e -- --update-snapshots
 * e2e/dokumenty-vzhled.spec.ts`, a pak se na ně podívat očima, než se
 * zapíšou do repozitáře.
 */
test.skip(!!process.env.CI, "Předlohy jsou vázané na systém; v CI se vzhled nekontroluje.");

const TYPY = [
  "zakazkovy_list",
  "zarucni_list",
  "diagnosticky_protokol",
  "prijemka_reklamace",
  "vydejka_reklamace",
  "faktura",
  "smlouva_zapujcka",
] as const;

async function otevriDokument(page: Page, typ: string, varianta: string) {
  await page.goto(`/e2e/dokumenty/nahled.html?typ=${typ}&varianta=${varianta}`);
  await expect
    .poll(
      () => page.evaluate(() => (document.getElementById("ramec") as HTMLIFrameElement | null)?.contentDocument?.documentElement?.dataset?.fit ?? ""),
      { timeout: 30_000 },
    )
    .toBe("done");
}

for (const typ of TYPY) {
  test(`${typ} vypadá jako předloha`, async ({ page }) => {
    test.setTimeout(60_000);
    await otevriDokument(page, typ, "short");
    // Malá tolerance kvůli vyhlazování písma; posunutý blok nebo zmizelé
    // logo je řádově větší rozdíl.
    await expect(page.locator("#ramec")).toHaveScreenshot(`${typ}.png`, { maxDiffPixelRatio: 0.01 });
  });
}

test("dokument s hodně daty se nerozpadne", async ({ page }) => {
  test.setTimeout(60_000);
  await otevriDokument(page, "zakazkovy_list", "long");
  await expect(page.locator("#ramec")).toHaveScreenshot("zakazkovy_list-dlouhy.png", { maxDiffPixelRatio: 0.01 });
});
