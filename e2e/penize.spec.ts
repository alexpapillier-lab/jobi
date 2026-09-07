import { test, expect, type Page } from "@playwright/test";
import { prihlasSe, testovaciJmeno } from "./pomocnici";

/**
 * Peníze: co je na obrazovce, musí být i na papíře.
 *
 * Součty faktury počítá aplikace (`src/lib/invoiceMath.ts`), doklad ale
 * vykresluje jádro JobiDocs (`jobidocs/core`) z podkladů, které mu Jobi
 * pošle – a to jsou z části čísla uložená v databázi (řádky faktury), ne
 * ta, co má editor v paměti. Právě tady se dřív rozcházel haléř: uživatel
 * viděl v editoru jednu částku, zákazník dostal na dokladu jinou.
 *
 * Test proto přečte součty rovnou z obrazovky a hledá je v náhledu dokladu,
 * který se vykresluje toutéž cestou jako tisk z prohlížeče
 * (`src/lib/webPrint.ts`). Nic se nepočítá dvakrát – porovnávají se dva
 * skutečné výstupy aplikace.
 *
 * Doklad je schválně namíchaný tak, aby na něm bylo všechno, co se umí
 * rozejít: tři sazby DPH, klasika 3× 333,33 s 21 % (999,99 Kč, ani o haléř
 * víc), sleva jako záporná položka a zbytek, který se zaokrouhluje na
 * celé koruny.
 *
 * Jednotkovou obdobou je `src/lib/penize.test.ts` – ta projede stovky
 * náhodných dokladů, tenhle test ověří, že to platí i v běžící aplikaci
 * s daty, která prošla databází.
 */
test.describe.configure({ mode: "serial" });

const zakaznik = testovaciJmeno("Penize");

/** Položky dokladu i s cenou řádku, která se u nich musí objevit. */
const POLOZKY = [
  { nazev: "Výměna displeje", mnozstvi: "3", cena: "333.33", dph: "21", radek: "999,99 Kč" },
  { nazev: "Kniha návodů", mnozstvi: "1", cena: "250", dph: "12", radek: "250,00 Kč" },
  { nazev: "Poštovné", mnozstvi: "1", cena: "99", dph: "0", radek: "99,00 Kč" },
  // Sleva se na faktuře dělá záporným řádkem – a hlavně na ní stojí to,
  // že se záporné částky zaokrouhlují stejně jako kladné.
  { nazev: "Sleva zákazníkovi", mnozstvi: "1", cena: "-200", dph: "21", radek: "-200,00 Kč" },
  /* Půldruhé hodiny po 100,05 Kč je 150,08 Kč. Neopatrné zaokrouhlení dá
     150,07 Kč – a přesně takhle se dřív do databáze ukládala cena řádku,
     zatímco hlavička faktury počítala se 150,08 Kč. Na papíře pak položky
     nesečetly svůj vlastní součet. */
  { nazev: "Práce technika", mnozstvi: "1.5", cena: "100.05", dph: "21", radek: "150,08 Kč" },
];

/** Mezery v částkách chodí v několika podobách; na porovnání je srovnáme na jednu. */
const bezMezer = (s: string) => s.replace(/[\s\u00a0\u202f]+/g, " ").trim();

/**
 * Součty z patičky editoru jako dvojice popisek → částka.
 *
 * Čte se přesně to, co má uživatel před očima, včetně čárky a mezer –
 * porovnávat čísla po přepočtu by zamlčelo právě ten rozdíl, kvůli kterému
 * test existuje.
 */
async function soucty(page: Page): Promise<Record<string, string>> {
  const radky = page.locator("tfoot tr");
  const out: Record<string, string> = {};
  for (let i = 0; i < (await radky.count()); i++) {
    const bunky = radky.nth(i).locator("td");
    if ((await bunky.count()) !== 2) continue;
    const popisek = bezMezer(await bunky.nth(0).innerText());
    const castka = bezMezer(await bunky.nth(1).innerText());
    if (popisek && castka) out[popisek] = castka;
  }
  return out;
}

let cisloFaktury = "";
let soucteVApp: Record<string, string> = {};

test("faktura s několika sazbami a slevou se v editoru sečte na haléř", async ({ page }) => {
  test.setTimeout(120_000);
  await prihlasSe(page);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "invoices" } })));

  const novaFaktura = page.getByRole("button", { name: "Nová faktura" });
  await expect(novaFaktura).toBeVisible({ timeout: 30_000 });
  await novaFaktura.click();
  await expect(page.getByText("Nová faktura").first()).toBeVisible({ timeout: 30_000 });

  // Bez odběratele fakturu nejde vystavit.
  await page.getByPlaceholder("Začněte psát jméno, firmu, telefon, e-mail nebo IČO").fill(zakaznik);

  for (const [i, p] of POLOZKY.entries()) {
    if (i > 0) await page.getByRole("button", { name: "Přidat položku" }).click();
    await page.getByLabel(`Název položky ${i + 1}`).fill(p.nazev);
    await page.getByLabel("Množství").nth(i).fill(p.mnozstvi);
    await page.getByLabel("Cena za jednotku").nth(i).fill(p.cena);
    await page.getByLabel("Sazba DPH").nth(i).selectOption(p.dph);
  }

  /* Cena řádku se počítá stejným vzorcem jako součet pod tabulkou.
     3 × 333,33 je 999,99 – ne 1 000,00, jak by vyšlo z neopatrného
     zaokrouhlení mezivýsledku. */
  const radky = page.locator("tbody tr");
  for (const [i, p] of POLOZKY.entries()) {
    const cena = bezMezer(await radky.nth(i).locator("td").nth(5).innerText());
    expect(cena, `řádek „${p.nazev}“ má jinou cenu`).toBe(p.radek);
  }

  soucteVApp = await soucty(page);
  // Základ 999,99 + 250 + 99 − 200 + 150,08 = 1 299,07; v základní sazbě
  // 210,00 − 42,00 + 31,52 = 199,52, ve snížené 30,00 z 250.
  expect(soucteVApp["Základ"], "základ dokladu").toBe("1 299,07 Kč");
  expect(soucteVApp["DPH 21 %"], "daň v základní sazbě").toBe("199,52 Kč");
  expect(soucteVApp["DPH 12 %"], "daň ve snížené sazbě").toBe("30,00 Kč");
  /* Nulová sazba se v rekapitulaci ukazuje taky – osvobozený základ na
     dokladu být musí, i když je daň nula. */
  expect(soucteVApp["DPH 0 %"], "osvobozený základ zmizel z rekapitulace").toBe("0,00 Kč");
  /* 1 299,07 + 229,52 = 1 528,59 → účtuje se 1 529 Kč a chybějících
     41 haléřů musí mít na dokladu vlastní řádek, ne se tiše ztratit. */
  expect(soucteVApp["Zaokrouhlení"], "zaokrouhlení se z dokladu ztratilo").toBe("0,41 Kč");
  expect(soucteVApp["Celkem"], "celkem k úhradě").toBe("1 529,00 Kč");

  await page.getByRole("button", { name: "Vystavit", exact: true }).click();

  /* Číslo se hledá u odběratele tohoto testu, ne jako první „FV…“ na stránce:
     za detailem je vidět i seznam faktur, kde bývá jako první doklad z jiné
     sady – test pak porovnával součty s cizí fakturou. Bere se nejmenší prvek,
     který obsahuje jméno odběratele i číslo, tedy karta právě vystaveného
     dokladu. */
  await expect
    .poll(async () => await page.evaluate((jmeno) => {
      let nejmensi: string | null = null;
      let delka = Number.MAX_SAFE_INTEGER;
      for (const el of Array.from(document.querySelectorAll("body *"))) {
        const t = el.textContent ?? "";
        if (!t.includes(jmeno)) continue;
        const m = t.match(/FV\d{4}-\d{4}/);
        if (m && t.length < delka) { nejmensi = m[0]; delka = t.length; }
      }
      return nejmensi;
    }, zakaznik), { timeout: 30_000, message: "číslo právě vystavené faktury se nenašlo" })
    .toMatch(/^FV\d{4}-\d{4}$/);
  cisloFaktury = (await page.evaluate((jmeno) => {
    let nejmensi: string | null = null;
    let delka = Number.MAX_SAFE_INTEGER;
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const t = el.textContent ?? "";
      if (!t.includes(jmeno)) continue;
      const m = t.match(/FV\d{4}-\d{4}/);
      if (m && t.length < delka) { nejmensi = m[0]; delka = t.length; }
    }
    return nejmensi;
  }, zakaznik)) ?? "";
  expect(cisloFaktury).toMatch(/^FV\d{4}-\d{4}$/);
});

test("náhled dokladu ukazuje tytéž částky jako aplikace", async ({ page }) => {
  test.setTimeout(120_000);
  expect(cisloFaktury, "předchozí test nevystavil fakturu").toMatch(/^FV\d{4}-\d{4}$/);

  await prihlasSe(page);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "invoices" } })));
  await expect(page.getByRole("button", { name: "Uzávěrka" })).toBeVisible({ timeout: 30_000 });

  await page.getByText(cisloFaktury, { exact: true }).first().click();

  /* Tisk ▾ → Náhled. Ve webové verzi se doklad vykreslí jádrem JobiDocs
     do blob URL – přesně tím kódem, který jde i do tiskového dialogu. */
  await page.getByRole("button", { name: "Tisk" }).first().click();
  await page.getByRole("menuitem", { name: "Náhled" }).click();

  const telo = page.frameLocator('iframe[title="Náhled PDF"]').locator("body");
  await expect(telo, "náhled dokladu se nevykreslil").toContainText(cisloFaktury, { timeout: 30_000 });
  const text = bezMezer(await telo.innerText());

  // 1. Součet, který zákazník platí, musí sedět doslova.
  expect(text, "Celkem k úhradě na dokladu neodpovídá aplikaci").toContain(soucteVApp["Celkem"]);
  /* 2. Zaokrouhlení má na dokladu vlastní pojmenovaný řádek. Bez něj by
        položky nedaly součet a účetní hledá chybějící haléř. */
  expect(text, "zaokrouhlení nemá na dokladu vlastní řádek").toContain("Zaokrouhlení");
  expect(text, "částka zaokrouhlení na dokladu chybí").toContain(soucteVApp["Zaokrouhlení"]);

  /* 3. Rekapitulaci DPH tiskne doklad jen plátci; když ji tiskne, musí
        v ní být tytéž částky, jaké byly v editoru. */
  if (text.includes("Základ daně")) {
    for (const [popisek, castka] of Object.entries(soucteVApp)) {
      if (popisek === "Celkem" || popisek === "Zaokrouhlení") continue;
      expect(text, `na dokladu chybí ${popisek} ${castka}`).toContain(castka);
    }
  }

  // 4. Řádky dokladu jsou ty, které uživatel zadal – i ta záporná sleva.
  for (const p of POLOZKY) {
    expect(text, `na dokladu chybí položka „${p.nazev}“`).toContain(p.nazev);
    expect(text, `položka „${p.nazev}“ má na dokladu jinou cenu`).toContain(p.radek);
  }

  // 5. A nic strojového: české částky s čárkou, žádné NaN ani undefined.
  expect(text, "na dokladu je NaN").not.toMatch(/NaN/);
  expect(text, "na dokladu je undefined").not.toMatch(/undefined/i);
  expect(text, "na dokladu je částka s desetinnou tečkou").not.toMatch(/\d\.\d\d\s*Kč/);
});
