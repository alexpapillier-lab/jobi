import { test, expect } from "@playwright/test";
import { prihlasSe, testovaciJmeno, zalozZakazku } from "./pomocnici";

/**
 * Fotky zařízení se zobrazují jen na podepsaný odkaz.
 *
 * PROČ TENHLE TEST EXISTUJE
 * Bucket `diagnostic-photos` byl veřejný: fotka zařízení i podpis převzetí
 * šly stáhnout z holé adresy, bez přihlášení, natrvalo. Jsou to osobní údaje
 * zákazníků cizí dílny. Oprava má dvě půlky a obě se dají tiše ztratit:
 *
 *  1. Nikde se už nesmí vykreslit adresa `…/object/public/…`. Kdyby se někam
 *     vrátila, po přepnutí bucketu tam bude prázdné místo – a než si toho
 *     někdo všimne, bude fotka zase chvíli veřejná.
 *  2. Ta samá cesta bez podpisu musí skončit chybou. To je vlastnost úložiště,
 *     ne aplikace, ale je to jediný důkaz, že podpis něco opravdu hlídá.
 *
 * Test jede proti ostrému Supabase ve vlastním E2E servisu a pracuje jen
 * s fotkou, kterou si sám nahraje.
 */
test.describe.configure({ mode: "serial" });

const zakaznik = testovaciJmeno("Fotka");

/** 1×1 PNG – obsah je jedno, jde o cestu, ne o obrázek. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("fotka v detailu zakázky se vykresluje podepsaným odkazem", async ({ page }) => {
  test.setTimeout(150_000);
  await prihlasSe(page);
  await zalozZakazku(page, { zakaznik, zarizeni: "iPhone (fotky)", popis: "Zkouška podepsaných odkazů", nechatOtevrene: true });

  /* Fotky se nahrávají až k uložené zakázce (dřív nemá id, kam je zařadit).
     Vstup se hledá podle nadpisu sekce – v detailu jsou tři pole na soubory
     (přijímací fotky, fotky před, diagnostické) a pořadí se mění podle toho,
     co je zrovna vyplněné. */
  const sekce = page.getByText("Diagnostické fotografie", { exact: true }).locator("xpath=..");
  await expect(sekce).toBeVisible({ timeout: 30_000 });

  const fotka = sekce.locator('img[alt^="Diagnostika"]').first();
  /* Nahrání se občas nechytne (obrázek se před odesláním převádí přes plátno
     a při zaneprázdněném prohlížeči to umí selhat) – zkusí se podruhé. Tenhle
     test je o podepsaných odkazech, ne o spolehlivosti nahrávání; kdyby se
     nahrávání zlobilo pravidelně, patří to do vlastního testu. */
  for (let pokus = 0; pokus < 2; pokus++) {
    await sekce.locator('input[type="file"]').setInputFiles({ name: "zkouska.png", mimeType: "image/png", buffer: PNG });
    if (await fotka.isVisible({ timeout: 45_000 }).catch(() => false)) break;
  }
  await expect(fotka).toBeVisible({ timeout: 45_000 });

  // Adresa v <img src> musí být podepsaná. Kdyby to byla veřejná cesta,
  // fotka by po přepnutí bucketu zmizela – a do té doby by byla veřejná.
  await expect
    .poll(async () => (await fotka.getAttribute("src")) ?? "", {
      timeout: 30_000,
      message: "Fotka se pořád vykresluje veřejnou adresou, ne podepsaným odkazem.",
    })
    .toContain("/storage/v1/object/sign/diagnostic-photos/");
  const src = (await fotka.getAttribute("src")) ?? "";
  expect(src, "Podepsaný odkaz musí nést token.").toContain("token=");

  // Obrázek se opravdu načetl – samotné `src` by prošlo i s rozbitým odkazem.
  await expect
    .poll(() => fotka.evaluate((e: HTMLImageElement) => e.naturalWidth), {
      timeout: 30_000,
      message: "Podepsaný odkaz se nenačetl – fotka je v aplikaci prázdná.",
    })
    .toBeGreaterThan(0);

  // Táž cesta bez podpisu skončí chybou. Přesně tohle uvidí kdokoli, kdo si
  // po přepnutí bucketu zkusí otevřít holou adresu fotky.
  const bezPodpisu = src.split("?")[0];
  const odpoved = await page.request.get(bezPodpisu);
  expect(odpoved.status(), `Cesta bez podpisu vrátila ${odpoved.status()} – měla vrátit chybu.`).toBeGreaterThanOrEqual(400);

  // A rozbitý podpis taky.
  const sPodvrzenym = await page.request.get(`${bezPodpisu}?token=neplatny.token.abc`);
  expect(sPodvrzenym.status()).toBeGreaterThanOrEqual(400);

  // Zvětšený náhled bere odkaz z toho, co přišlo naposledy – taky podepsaný.
  await fotka.click();
  const zvetsena = page.getByRole("dialog", { name: "Zvětšit fotku" }).locator("img").first();
  await expect(zvetsena).toBeVisible({ timeout: 15_000 });
  expect((await zvetsena.getAttribute("src")) ?? "").toContain("/storage/v1/object/sign/diagnostic-photos/");
  await expect
    .poll(() => zvetsena.evaluate((e: HTMLImageElement) => e.naturalWidth), { timeout: 30_000 })
    .toBeGreaterThan(0);
  await page.keyboard.press("Escape");

  /* Nakonec projít všechny obrázky na stránce naráz. Detail zakázky má fotky
     na víc místech (přijímací fotky, fotky před opravou, diagnostické fotky,
     podpis převzetí) a stačí jedno zapomenuté, aby po přepnutí bucketu
     zůstalo v zakázce prázdné místo.

     Čeká se, protože při prvním vykreslení je v `src` schválně ještě uložená
     adresa – podepisuje se až potom. Podstatné je, že po ustálení veřejná
     adresa nezůstane nikde. */
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          [...document.querySelectorAll("img")]
            .map((i) => i.getAttribute("src") ?? "")
            .filter((s) => s.includes("/storage/v1/object/public/diagnostic-photos/")),
        ),
      { timeout: 30_000, message: "Někde se fotka pořád vykresluje veřejnou adresou." },
    )
    .toEqual([]);
});
