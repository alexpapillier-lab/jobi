import { test, expect } from "@playwright/test";
import { prihlasSe, testovaciJmeno, zalozZakazku, zavriDetail, vidZakazku } from "./pomocnici";

/**
 * Spolehlivost ukládání: co uživatel zadá, musí skončit v databázi – i když
 * v tu chvíli vypadne spojení.
 *
 * Bez tohohle testu se výpadek sítě dá vyzkoušet jen ručně (vytáhnout wifi
 * ve správnou vteřinu), takže se nezkoušel nikdy. Playwright umí síť vypnout
 * přesně mezi kliknutím a zápisem, což je právě ten okamžik, kdy se dřív
 * data ztrácela.
 */
test.describe.configure({ mode: "serial" });

const zakaznik = testovaciJmeno("E2E spolehlivost");
const zarizeni = "iPad (E2E spolehlivost)";
/* Pevný název, ne náhodný: seznam náhradních zařízení je nastavení servisu,
   takže by každý běh testu nechal v nastavení další řádek navíc. Test si ho
   před přidáním smaže a na konci uklidí. */
const nahradni = "Náhradní pro test fronty (E2E)";
let kod = "";

/** Otevře detail zakázky ze seznamu a vrátí kartu náhradního zařízení.
 *  Tlačítka „Upravit" jsou v detailu i u oprav, proto se vždy pracuje
 *  uvnitř téhle karty. */
async function otevriDetail(page: import("@playwright/test").Page) {
  await vidZakazku(page, kod).first().click();
  const karta = page.locator("#detail-zapujcka");
  await expect(karta).toBeVisible({ timeout: 20_000 });
  return karta;
}

/** Kolik řádků v otevřené sekci má název testovacího zařízení. */
async function pocetTestovacichZarizeni(page: import("@playwright/test").Page): Promise<number> {
  const pole = page.locator('input[aria-label="Zařízení"]');
  const n = await pole.count();
  let nalezeno = 0;
  for (let i = 0; i < n; i++) if ((await pole.nth(i).inputValue()) === nahradni) nalezeno += 1;
  return nalezeno;
}

/** Otevřená sekce Nastavení → Náhradní zařízení: smaže řádky z minulých běhů. */
async function smazTestovaciZarizeni(page: import("@playwright/test").Page) {
  // Bez tohohle by se počítalo v seznamu, který se teprve načítá – a úklid
  // by „prošel" nad prázdnou stránkou.
  await expect(page.locator('[data-config-nacteno="1"]')).toBeVisible({ timeout: 20_000 });
  const pole = page.locator('input[aria-label="Zařízení"]');
  for (let i = (await pole.count()) - 1; i >= 0; i--) {
    if ((await pole.nth(i).inputValue()) !== nahradni) continue;
    await pole.nth(i).locator("xpath=following-sibling::button[normalize-space()='Smazat']").click();
    await page.waitForTimeout(800);
  }
  await expect.poll(() => pocetTestovacichZarizeni(page), { timeout: 20_000 }).toBe(0);
}

test("zakázka pro test spolehlivosti", async ({ page }) => {
  await prihlasSe(page);
  kod = await zalozZakazku(page, { zakaznik, zarizeni });
  expect(kod).toMatch(/^E2E\d+/);
});

test("náhradní zařízení z nastavení je vidět v zakázce bez restartu aplikace", async ({ page }) => {
  test.setTimeout(120_000);
  await prihlasSe(page);

  // Nastavení → Zakázky → Náhradní zařízení
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "settings" } })));
  const hledani = page.getByPlaceholder("Hledat v nastavení…");
  await expect(hledani).toBeVisible({ timeout: 20_000 });
  await hledani.fill("náhradní zařízení");
  await page.getByRole("button", { name: /Náhradní zařízení/ }).first().click();
  await hledani.fill("");

  const nove = page.getByLabel("Nové zařízení");
  await expect(nove).toBeVisible({ timeout: 20_000 });
  await smazTestovaciZarizeni(page);
  await nove.fill(nahradni);
  await page.getByLabel("Nové sériové číslo").fill("SN-E2E-1");
  await page.getByRole("button", { name: "Přidat", exact: true }).click();
  await expect
    .poll(() => pocetTestovacichZarizeni(page), { timeout: 20_000, message: "Zařízení se v seznamu neobjevilo." })
    .toBe(1);

  /* Bez přenačtení stránky zpět na zakázky: stránka Zakázky zůstává celou
     dobu připojená, takže tohle je přesně situace, kdy se nový seznam dřív
     neprojevil a v detailu nebylo co vybrat. */
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "orders" } })));
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 20_000 });
  const karta = await otevriDetail(page);

  await karta.getByRole("button", { name: "Půjčit náhradní zařízení" }).click();
  const vyber = karta.getByLabel("Vybrat ze seznamu servisu");
  await expect(vyber).toBeVisible({ timeout: 20_000 });
  await expect(vyber.locator("option", { hasText: nahradni })).toHaveCount(1);
});

test("půjčení zadané při výpadku sítě se neztratí a uloží se samo", async ({ page, context }) => {
  test.setTimeout(150_000);
  await prihlasSe(page);
  const karta = await otevriDetail(page);

  await karta.getByRole("button", { name: "Půjčit náhradní zařízení" }).click();
  await karta.getByLabel("Vybrat ze seznamu servisu").selectOption({ label: `${nahradni} · SN-E2E-1` });
  await expect(karta.getByRole("button", { name: "Uložit půjčení" })).toBeEnabled();

  // Síť dolů přesně před zápisem – přesně tohle dřív skončilo hláškou
  // „Půjčení zařízení se nepodařilo uložit" a zadané údaje zmizely.
  await context.setOffline(true);
  await karta.getByRole("button", { name: "Uložit půjčení" }).click();

  const ukazatel = page.locator("[data-neulozene-zmeny]");
  await expect(ukazatel).toBeVisible({ timeout: 30_000 });
  // Údaje zůstaly na kartě, ne že by se vrátily na prázdno.
  await expect(karta.getByText(nahradni).first()).toBeVisible();

  await context.setOffline(false);
  // Fronta se ozve sama (návrat sítě, pak interval). Nic se neklikalo.
  await expect(ukazatel).toHaveCount(0, { timeout: 90_000 });

  // Až po přenačtení je jisté, že hodnota je v databázi, ne jen v paměti.
  await page.reload();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
  const karta2 = await otevriDetail(page);
  await expect(karta2.getByText(nahradni).first()).toBeVisible({ timeout: 20_000 });
  await zavriDetail(page);
});

test("fronta neuložených změn přežije zavření aplikace", async ({ page, context }) => {
  test.setTimeout(150_000);
  await prihlasSe(page);
  const karta = await otevriDetail(page);

  const poznamka = `Stav pri pujceni ${Date.now().toString(36)}`;
  await karta.getByRole("button", { name: "Upravit", exact: true }).click();
  await karta.getByLabel(/Poznámka \(stav zařízení/).fill(poznamka);

  await context.setOffline(true);
  await karta.getByRole("button", { name: "Uložit půjčení" }).click();
  await expect(page.locator("[data-neulozene-zmeny]")).toBeVisible({ timeout: 30_000 });

  // Aplikace se „zavře" i s neuloženou změnou: fronta je v localStorage.
  const ulozene = await page.evaluate(() => localStorage.getItem("jobi_neulozene_zmeny_v1"));
  expect(ulozene ?? "").toContain(poznamka);

  // Nový běh aplikace při obnovené síti změnu dopíše sám, bez zásahu uživatele.
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
  await expect(page.locator("[data-neulozene-zmeny]")).toHaveCount(0, { timeout: 90_000 });

  await page.reload();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
  const karta3 = await otevriDetail(page);
  await expect(karta3.getByText(poznamka).first()).toBeVisible({ timeout: 20_000 });
  await zavriDetail(page);
});

test("úprava zakázky při výpadku sítě se doplní sama a nepřepíše se zpět", async ({ page }) => {
  test.setTimeout(180_000);
  await prihlasSe(page);
  await vidZakazku(page, kod).first().click();
  await expect(page.locator("#detail-zapujcka")).toBeVisible({ timeout: 20_000 });

  const novyPopis = `Závada po výpadku ${Date.now().toString(36)}`;

  /* Shodí se jen zápisy zakázek. Čtení funguje dál, takže se pozná i to,
     že se místní změna nepřepíše starými daty ze serveru. */
  await page.route(/\/rest\/v1\/tickets/, (route) =>
    route.request().method() === "GET" ? route.continue() : route.abort("failed"),
  );

  // „Upravit" je i u jednotlivých oprav; tohle je to v hlavičce detailu.
  await page.locator('button[title="Upravit zakázku"]:visible').first().click();
  const popis = page.getByPlaceholder("Výměna displeje, výměna baterie, diagnostika").first();
  await expect(popis).toBeVisible({ timeout: 20_000 });
  await popis.fill(novyPopis);
  await page.locator('button[title="Uložit změny"]:visible').first().click();

  const ukazatel = page.locator("[data-neulozene-zmeny]");
  await expect(ukazatel).toBeVisible({ timeout: 30_000 });
  await expect(ukazatel).toContainText("čeká na uložení");

  await page.unroute(/\/rest\/v1\/tickets/);
  await expect(ukazatel).toHaveCount(0, { timeout: 90_000 });

  await page.reload();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
  await vidZakazku(page, kod).first().click();
  await expect(page.getByText(novyPopis).first()).toBeVisible({ timeout: 20_000 });
  await zavriDetail(page);
});

test("interní komentář se uloží a po nepovedeném zápisu zůstane rozepsaný", async ({ page }) => {
  test.setTimeout(150_000);
  await prihlasSe(page);
  await vidZakazku(page, kod).first().click();
  const pole = page.getByPlaceholder("Napiš interní komentář k zakázce…");
  await expect(pole).toBeVisible({ timeout: 20_000 });

  const komentar = `Domluveno se zákazníkem ${Date.now().toString(36)}`;
  await pole.fill(komentar);
  await page.getByRole("button", { name: "Přidat komentář" }).click();
  await expect(page.getByText(komentar).first()).toBeVisible({ timeout: 20_000 });

  // Až po přenačtení je jisté, že komentář je v databázi.
  await page.reload();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
  await vidZakazku(page, kod).first().click();
  await expect(page.getByText(komentar).first()).toBeVisible({ timeout: 20_000 });

  /* Komentář, který se nezapíše, se nesmí ztratit z pole – jinak si ho
     člověk musí pamatovat a napsat znovu. */
  await page.route(/\/rest\/v1\/ticket_comments/, (route) =>
    route.request().method() === "GET" ? route.continue() : route.abort("failed"),
  );
  const nepovedeny = `Tenhle se nezapíše ${Date.now().toString(36)}`;
  const pole2 = page.getByPlaceholder("Napiš interní komentář k zakázce…");
  await pole2.fill(nepovedeny);
  await page.getByRole("button", { name: "Přidat komentář" }).click();
  await expect(page.getByText("Nepodařilo se uložit komentář.").first()).toBeVisible({ timeout: 30_000 });
  await expect(pole2).toHaveValue(nepovedeny);

  await page.unroute(/\/rest\/v1\/ticket_comments/);
  await page.getByRole("button", { name: "Přidat komentář" }).click();
  await expect(page.getByText(nepovedeny).first()).toBeVisible({ timeout: 20_000 });
  await zavriDetail(page);
});

test("úklid: testovací náhradní zařízení se z nastavení smaže", async ({ page }) => {
  await prihlasSe(page);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "settings" } })));
  const hledani = page.getByPlaceholder("Hledat v nastavení…");
  await expect(hledani).toBeVisible({ timeout: 20_000 });
  await hledani.fill("náhradní zařízení");
  await page.getByRole("button", { name: /Náhradní zařízení/ }).first().click();
  await hledani.fill("");
  await expect(page.getByLabel("Nové zařízení")).toBeVisible({ timeout: 20_000 });
  await smazTestovaciZarizeni(page);
});
