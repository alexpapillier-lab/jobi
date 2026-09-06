import { test, expect, type Page, type Browser } from "@playwright/test";
import { SERVIS, heslo, prihlasSe, testovaciJmeno, vidZakazku, zalozZakazku, zavriDetail } from "./pomocnici";

/**
 * Výpadky spojení na cestách, které je dosud neměly otestované.
 *
 * `spolehlivost.spec.ts` hlídá zakázku, sklad a ceník. Zbytek aplikace ale
 * zapisuje do databáze úplně stejně často: zákazník, reklamace, cenová
 * nabídka, kontrola po opravě, termín z kalendáře. Když v tu vteřinu vypadne
 * spojení, musí se změna buď doplnit sama z fronty neuložených změn, nebo
 * musí být na první pohled vidět, že uložená není. Tiché „hotovo“ nad
 * neuloženými daty je to nejhorší, co se může stát – uživatel zavře notebook
 * a druhý den se diví.
 *
 * Kromě toho se tu testují tři situace, po kterých se dřív rozdělaná práce
 * ztrácela úplně potichu: zavření okna, přepnutí servisu a odhlášení.
 */
test.describe.configure({ mode: "serial" });

const zakaznik = testovaciJmeno("Výpadek");
const zarizeni = "iPhone (E2E výpadky)";
let kod = "";

/** Cesty, na kterých se shazuje síť. Vždy regulární výraz – glob se o dotazovací část URL rozbije. */
const TICKETS = /\/rest\/v1\/tickets/;
const CUSTOMERS = /\/rest\/v1\/customers/;
const REKLAMACE = /\/rest\/v1\/warranty_claims/;

/** Shodí jen zápisy do jedné tabulky; čtení funguje dál, aplikace zůstane použitelná. */
async function shodZapisy(page: Page, kam: RegExp): Promise<void> {
  await page.route(kam, (route) =>
    route.request().method() === "GET" ? route.continue() : route.abort("failed"),
  );
}

async function obnovSit(page: Page, kam: RegExp): Promise<void> {
  await page.unroute(kam);
}

/** Proužek „N změn čeká na uložení“. */
function ukazatel(page: Page) {
  return page.locator("[data-neulozene-zmeny]");
}

/** Obsah fronty v localStorage – to, co přežije zavření aplikace. */
function frontaVUlozisti(page: Page): Promise<string> {
  return page.evaluate(() => localStorage.getItem("jobi_neulozene_zmeny_v1") ?? "");
}

/** Počká, až fronta doopravdy doběhne (ne jen zmizí z obrazovky). */
async function pockejNaVyprazdneni(page: Page): Promise<void> {
  await expect(ukazatel(page)).toHaveCount(0, { timeout: 90_000 });
  await expect.poll(() => frontaVUlozisti(page), { timeout: 30_000 }).toMatch(/^(\[\])?$/);
}

/** Otevře seznam zakázek a klikne na tu naši. */
async function otevriZakazku(page: Page): Promise<void> {
  await vidZakazku(page, kod).first().click();
  await expect(page.locator("#detail-zapujcka")).toBeVisible({ timeout: 20_000 });
}

/** Stránky se přepínají událostí – postranní lišta se při najetí myší rozbaluje přes obsah. */
async function naStranku(page: Page, stranka: string): Promise<void> {
  await page.evaluate(
    (s) => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: s } })),
    stranka,
  );
}

async function naZakazniky(page: Page): Promise<void> {
  await naStranku(page, "customers");
  await expect(page.getByPlaceholder("Vyhledávání zákazníků…")).toBeVisible({ timeout: 30_000 });
}

/** Otevře v adresáři našeho zákazníka. */
async function otevriZakaznika(page: Page): Promise<void> {
  await naZakazniky(page);
  await page.getByPlaceholder("Vyhledávání zákazníků…").fill(zakaznik);
  await page.locator(`:text-is("${zakaznik}"):visible`).first().click();
}

/**
 * Skupina „Bez termínu“ je v agendě sbalená, takže její řádky v DOM vůbec
 * nejsou. Bez rozbalení by test hledal tlačítko, které neexistuje.
 */
async function rozbalBezTerminu(page: Page): Promise<void> {
  const prepinac = page.locator("[data-agenda-group-toggle]").first();
  await expect(prepinac).toBeVisible({ timeout: 30_000 });
  if ((await prepinac.getAttribute("aria-expanded")) !== "true") await prepinac.click();
}

/**
 * Pole „Požadovaná oprava“ v otevřeném detailu.
 *
 * Okno Nová zakázka zůstává připojené v DOM i zavřené a má pole s podobným
 * významem – bez `:visible` se text zapíše do něj a test pak ověřuje
 * hodnotu, kterou nikdo neuložil.
 */
function poleZavady(page: Page) {
  return page.locator('input[placeholder="Popis požadované opravy"]:visible').first();
}

/**
 * Otevře nabídku účtu (odhlášení).
 *
 * Klik se opakuje, dokud nabídka opravdu není otevřená: postranní lišta se
 * při najetí myší rozbaluje a překresluje, takže první kliknutí občas
 * dopadne do překreslované lišty a stav přepínače se nezmění.
 */
async function otevriNabidkuUctu(page: Page): Promise<void> {
  const ucet = page.locator('[aria-label="Účet"]:visible').first();
  await expect(ucet).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(
      async () => {
        if ((await ucet.getAttribute("aria-expanded")) === "true") return true;
        await ucet.click({ timeout: 5000 }).catch(() => {});
        return (await ucet.getAttribute("aria-expanded")) === "true";
      },
      { timeout: 30_000, message: "Nabídka účtu se neotevřela." },
    )
    .toBe(true);
}

/**
 * Přepínač servisů. V široké liště je vedle názvu servisu, v úzké pod účtem –
 * zkusí se obojí. Vrací seznam položek servisů, které nejsou ten testovací.
 */
async function otevriSeznamServisu(page: Page): Promise<void> {
  /* Ve sbalené postranní liště přepínač servisů vůbec není – rozbalí se
     najetím myší. V úzkém okně (spodní lišta) je seznam servisů rovnou
     v nabídce účtu, tam se hover nekoná. */
  await page.locator('[aria-label="Hlavní navigace"]').first().hover().catch(() => {});
  const prepinac = page.locator('[aria-label^="Servis: "]').first();
  /* `isVisible()` se nedoptává – lišta se rozbaluje s prodlevou, takže by
     odpověděla „není“ dřív, než se přepínač vůbec vykreslí. */
  const jePrepinac = await prepinac
    .waitFor({ state: "visible", timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (jePrepinac) {
    await expect
      .poll(
        async () => {
          if ((await prepinac.getAttribute("aria-expanded")) === "true") return true;
          await prepinac.click({ timeout: 5000 }).catch(() => {});
          return (await prepinac.getAttribute("aria-expanded")) === "true";
        },
        { timeout: 30_000, message: "Nabídka servisů se neotevřela." },
      )
      .toBe(true);
    return;
  }
  await otevriNabidkuUctu(page);
}

/** Druhé okno jako samostatný prohlížeč – vlastní přihlášení i úložiště. */
async function druhyClovek(browser: Browser, kdo: "owner" | "technik"): Promise<Page> {
  const kontext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "cs-CZ" });
  const page = await kontext.newPage();
  await prihlasSe(page, kdo);
  return page;
}

test("zakázka a zákazník pro testy výpadků", async ({ page }) => {
  await prihlasSe(page);
  kod = await zalozZakazku(page, { zakaznik, zarizeni, popis: "Nejde nabíjet (E2E výpadky)" });
  expect(kod).toMatch(/^E2E\d+/);
  // Zákazník vzniká z příjmu; bez něj by neměl co upravovat test níž.
  await otevriZakaznika(page);
});

test("úprava zákazníka při výpadku se doplní sama", async ({ page }) => {
  test.setTimeout(180_000);
  await prihlasSe(page);
  await otevriZakaznika(page);

  await page.locator('button:text-is("Upravit"):visible').first().click();
  const mesto = `Ostrava ${Date.now().toString(36).slice(-5)}`;
  await page.getByLabel("Město").fill(mesto);
  await page.getByLabel("Informace").fill("Zapsáno při výpadku (E2E)");

  /* Dřív měl zákazník na uložení jediný pokus. Technik dopsal adresu, vypadla
     wifi, zůstal červený toast – a po zavření okna byly údaje pryč. */
  await shodZapisy(page, CUSTOMERS);
  await page.locator('button:has-text("Uložit"):visible').first().click();

  await expect(ukazatel(page)).toBeVisible({ timeout: 30_000 });
  await expect(ukazatel(page)).toContainText("čeká na uložení");
  expect(await frontaVUlozisti(page)).toContain(mesto);

  await obnovSit(page, CUSTOMERS);
  await pockejNaVyprazdneni(page);

  // Až po přenačtení je jisté, že hodnota je v databázi, ne jen na obrazovce.
  await page.reload();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
  await otevriZakaznika(page);
  await expect(page.locator(`:has-text("${mesto}"):visible`).last()).toBeVisible({ timeout: 20_000 });
});

test("kontrola po opravě zadaná při výpadku se neztratí", async ({ page }) => {
  test.setTimeout(180_000);
  await prihlasSe(page);
  await otevriZakazku(page);

  const kontrola = page.locator("#detail-kontrola");
  await expect(kontrola).toBeVisible({ timeout: 20_000 });
  await kontrola.getByRole("button", { name: "Načíst kontrolní seznam" }).click();
  // Seznam se ukládá s odkladem; než se shodí síť, musí být v databázi.
  await expect(kontrola.getByText(/ověřeno 0 z \d+/)).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(2000);

  await shodZapisy(page, TICKETS);
  await kontrola.getByRole("button", { name: /^Chyba – / }).first().click();
  const poznamka = kontrola.locator('input[aria-label^="Poznámka – "]').first();
  const text = `Praská při dotyku ${Date.now().toString(36)}`;
  await poznamka.fill(text);

  await expect(ukazatel(page)).toBeVisible({ timeout: 30_000 });
  await expect(ukazatel(page)).toContainText("čeká na uložení");

  await obnovSit(page, TICKETS);
  await pockejNaVyprazdneni(page);

  await page.reload();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
  await otevriZakazku(page);
  await expect(page.locator("#detail-kontrola").getByText(/s chybou/)).toBeVisible({ timeout: 20_000 });
  // Hodnota pole, ne text v DOM: React do něj píše `value`, obsah zůstává prázdný.
  await expect(page.locator('#detail-kontrola input[aria-label^="Poznámka – "]').first()).toHaveValue(text, {
    timeout: 20_000,
  });
  await zavriDetail(page);
});

test("cenová nabídka odeslaná při výpadku se uloží sama", async ({ page }) => {
  test.setTimeout(180_000);
  await prihlasSe(page);
  await otevriZakazku(page);

  await expect(page.getByText("Cenová nabídka").first()).toBeVisible({ timeout: 20_000 });
  const nazev = `Výměna konektoru ${Date.now().toString(36).slice(-4)}`;
  await page.getByPlaceholder("Vlastní položka").first().fill(nazev);
  await page.getByPlaceholder("Kč", { exact: true }).first().fill("1490");
  await page.getByRole("button", { name: "Přidat", exact: true }).first().click();
  await expect(page.getByLabel(`Cena položky ${nazev}`)).toBeVisible({ timeout: 20_000 });

  /* Rozpis nabídky žije jen ve stavu karty. Bez fronty stačilo zavřít detail
     a půlhodina cenění byla pryč – karta si položky napoprvé navrhne znovu
     z oprav a vlastní ceny přepíše. */
  await shodZapisy(page, TICKETS);
  await page.getByRole("button", { name: "Poslat ke schválení" }).click();

  await expect(ukazatel(page)).toBeVisible({ timeout: 30_000 });
  expect(await frontaVUlozisti(page)).toContain(nazev);
  // Položky zůstaly na obrazovce, nezmizely „úspěšným“ odesláním.
  await expect(page.getByLabel(`Cena položky ${nazev}`)).toBeVisible();

  await obnovSit(page, TICKETS);
  await pockejNaVyprazdneni(page);

  await page.reload();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
  await otevriZakazku(page);
  await expect(page.getByText(/Čeká na schválení/).first()).toBeVisible({ timeout: 20_000 });
  await zavriDetail(page);
});

test("termín z kalendáře zadaný při výpadku se neztratí", async ({ page }) => {
  test.setTimeout(180_000);
  await prihlasSe(page);
  await naStranku(page, "calendar");
  await rozbalBezTerminu(page);

  const zmenit = page.locator(`[aria-label="Změnit termín ${kod}"]`).first();
  await expect(zmenit).toBeVisible({ timeout: 30_000 });

  /* Termín se dřív při chybě zápisu vrátil na původní hodnotu a zůstala jen
     hláška. Zákazníkovi ho přitom technik do telefonu už slíbil. */
  await shodZapisy(page, TICKETS);
  await zmenit.click();
  const bublina = page.getByRole("dialog", { name: "Změnit termín" });
  await expect(bublina).toBeVisible({ timeout: 20_000 });
  await bublina.getByRole("button", { name: "Zítra 10:00" }).click();

  await expect(ukazatel(page)).toBeVisible({ timeout: 30_000 });
  await expect(ukazatel(page)).toContainText("čeká na uložení");

  await obnovSit(page, TICKETS);
  await pockejNaVyprazdneni(page);

  await page.reload();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
  await naStranku(page, "calendar");
  await rozbalBezTerminu(page);
  const radek = page.locator(`[aria-label="Změnit termín ${kod}"]`).first();
  await expect(radek).toBeVisible({ timeout: 30_000 });
  // Zakázka s termínem už nepatří do skupiny „Bez termínu“.
  const skupina = await radek.locator("xpath=ancestor::section[1]").getAttribute("aria-label");
  expect(skupina ?? "").not.toContain("Bez termínu");
});

test("reklamace rozepsaná při výpadku se doplní sama", async ({ page }) => {
  test.setTimeout(180_000);
  await prihlasSe(page);

  const jmeno = testovaciJmeno("Reklamace výpadek");
  await page.getByRole("button", { name: "+ Nová reklamace" }).click();
  await page.getByRole("button", { name: "Reklamace bez propojení na zakázku" }).click();
  await page.getByPlaceholder("Jméno zákazníka").fill(jmeno);
  await page.getByPlaceholder("např. iPhone 13, notebook").fill("Tablet (výpadek)");
  await page.getByRole("button", { name: "Vytvořit reklamaci" }).click();
  await expect(page.getByText(jmeno).first()).toBeVisible({ timeout: 30_000 });

  await page.getByText(jmeno).first().click();
  await page.locator('button[title="Upravit reklamaci"]:visible').first().click();
  const duvod = page.getByPlaceholder("Poznámka / důvod reklamace");
  await expect(duvod).toBeVisible({ timeout: 20_000 });
  const text = `Vrátil se potřetí, zákazník trvá na výměně ${Date.now().toString(36)}`;
  await duvod.fill(text);

  /* Do teď měla reklamace na uložení jeden pokus: při výpadku zůstal jen
     červený toast a napsaný protokol viselo v paměti okna. */
  await shodZapisy(page, REKLAMACE);
  await page.locator('button[title="Uložit změny"]:visible').first().click();

  await expect(ukazatel(page)).toBeVisible({ timeout: 30_000 });
  expect(await frontaVUlozisti(page)).toContain(text);

  await obnovSit(page, REKLAMACE);
  await pockejNaVyprazdneni(page);

  await page.reload();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
  await page.getByRole("button", { name: /^Reklamace/ }).first().click();
  await page.getByText(jmeno).first().click();
  await expect(page.getByText(text).first()).toBeVisible({ timeout: 20_000 });
});

test("díl, který se do objednávky nezapsal, na obrazovce nezůstane", async ({ page }) => {
  test.setTimeout(180_000);
  const POLOZKY = /\/rest\/v1\/inventory_purchase_order_items/;
  await prihlasSe(page);

  /* Sklad se otevírá událostí; po přenačtení nemusí být posluchač hned
     připojený, proto se navigace opakuje. */
  await expect
    .poll(
      async () => {
        await naStranku(page, "inventory");
        return page.getByRole("group", { name: "Část skladu" }).isVisible().catch(() => false);
      },
      { timeout: 60_000, message: "Sklad se neotevřel." },
    )
    .toBe(true);

  await page.getByRole("button", { name: /^Produkty/ }).first().click();
  await page.getByLabel("Hledat produkt").fill("AUDIT");
  await page.getByRole("button", { name: "Objednat" }).first().click();
  await expect(page.getByText(/přidán do návrhu/i).first()).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: /^Objednávky/ }).first().click();
  await page.getByText(/^OBJ/).first().click();
  const mnozstvi = page.locator('input[aria-label="Množství"]');
  await expect(mnozstvi.first()).toBeVisible({ timeout: 20_000 });
  const pred = await mnozstvi.count();

  /* Položky objednávky se ukládají jako celý seznam (smazat a vložit znovu),
     takže je nejde poslat do fronty – opakování by je zdvojilo. O to
     důležitější je, aby se řádek, který v databázi neskončil, nedělal
     uloženým: hláška zmizí a člověk objednávku odešle dodavateli bez dílu. */
  await shodZapisy(page, POLOZKY);
  await page.getByPlaceholder("Hledat produkt podle názvu, SKU nebo kódu u dodavatele…").fill("AUDIT");
  await page.locator("button.ui-menu-item").first().click();
  await expect(page.getByText(/Položky se nepodařilo uložit/).first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => mnozstvi.count(), { timeout: 20_000 }).toBe(pred);

  // A databáze na tom je stejně – po přenačtení nesmí řádek přibýt ani zmizet.
  await obnovSit(page, POLOZKY);
  await page.reload();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
  await expect
    .poll(
      async () => {
        await naStranku(page, "inventory");
        return page.getByRole("group", { name: "Část skladu" }).isVisible().catch(() => false);
      },
      { timeout: 60_000 },
    )
    .toBe(true);
  await page.getByRole("button", { name: /^Objednávky/ }).first().click();
  await page.getByText(/^OBJ/).first().click();
  await expect(page.locator('input[aria-label="Množství"]').first()).toBeVisible({ timeout: 20_000 });
  expect(await page.locator('input[aria-label="Množství"]').count()).toBe(pred);
});

test("zavřené okno s rozdělanou prací o nic nepřijde", async ({ page, context }) => {
  test.setTimeout(180_000);
  await prihlasSe(page);
  await otevriZakazku(page);

  const popisek = `Zavřeno s rozdělanou prací ${Date.now().toString(36)}`;
  await shodZapisy(page, TICKETS);
  await page.locator('button[title="Upravit zakázku"]:visible').first().click();
  const popis = poleZavady(page);
  await expect(popis).toBeVisible({ timeout: 20_000 });
  await popis.fill(popisek);
  await page.locator('button[title="Uložit změny"]:visible').first().click();
  await expect(ukazatel(page)).toBeVisible({ timeout: 30_000 });

  /* Okno se zavře i s neuloženou změnou. `pagehide` zkusí odeslat, co jde,
     ale odcházející stránka požadavek nemusí dokončit – proto fronta bydlí
     v localStorage a další běh aplikace ji dopíše. */
  expect(await frontaVUlozisti(page)).toContain(popisek);
  await page.close();

  const nove = await context.newPage();
  await nove.goto("/");
  await expect(nove.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
  // Nic se neklikalo: nové okno frontu odešle samo.
  await pockejNaVyprazdneni(nove);

  await nove.reload();
  await expect(nove.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
  await vidZakazku(nove, kod).first().click();
  await expect(nove.getByText(popisek).first()).toBeVisible({ timeout: 20_000 });
});

test("přepnutí servisu s rozdělanou prací nezapíše nic do cizího servisu", async ({ page }) => {
  test.setTimeout(180_000);
  await prihlasSe(page);
  await otevriZakazku(page);

  const popisek = `Rozdělané při přepnutí ${Date.now().toString(36)}`;
  await shodZapisy(page, TICKETS);
  await page.locator('button[title="Upravit zakázku"]:visible').first().click();
  await poleZavady(page).fill(popisek);
  await page.locator('button[title="Uložit změny"]:visible').first().click();
  await expect(ukazatel(page)).toBeVisible({ timeout: 30_000 });
  // Zápis je ve frontě, takže detail jde zavřít – rozdělané úpravy by ho nepustily.
  await zavriDetail(page);

  await otevriSeznamServisu(page);
  const jinyServis = page.locator(`[data-servis]:visible:not([data-servis="${SERVIS.id}"])`);
  const pocet = await jinyServis.count();
  test.skip(pocet === 0, "Účet nemá druhý servis, přepnutí nejde vyzkoušet.");

  await jinyServis.first().click();
  // Přepnutí je hotové, teprve když se přestal ukazovat testovací servis.
  await expect(page.locator(`[aria-label="Servis: ${SERVIS.nazev}"]`)).toHaveCount(0, { timeout: 20_000 });
  // Síť je pořád dole, takže se do cizího servisu nemůže nic zapsat ani
  // omylem; fronta si přitom drží servis, kterému změna patří.
  await expect(ukazatel(page)).toBeVisible({ timeout: 20_000 });
  const fronta = await frontaVUlozisti(page);
  expect(fronta).toContain(popisek);
  expect(fronta).toContain(SERVIS.id);

  // Zpátky do testovacího servisu a teprve pak síť nahoru.
  await otevriSeznamServisu(page);
  await page.locator(`[data-servis="${SERVIS.id}"]:visible`).first().click();
  await expect(page.locator(`[aria-label="Servis: ${SERVIS.nazev}"]`).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 30_000 });

  await obnovSit(page, TICKETS);
  await pockejNaVyprazdneni(page);

  await page.reload();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
  await vidZakazku(page, kod).first().click();
  await expect(page.getByText(popisek).first()).toBeVisible({ timeout: 20_000 });
  await zavriDetail(page);
});

test("odhlášení s rozdělanou prací o ni nepřipraví", async ({ page }) => {
  test.setTimeout(180_000);
  await prihlasSe(page);
  await otevriZakazku(page);

  const popisek = `Rozdělané při odhlášení ${Date.now().toString(36)}`;
  await shodZapisy(page, TICKETS);
  await page.locator('button[title="Upravit zakázku"]:visible').first().click();
  await poleZavady(page).fill(popisek);
  await page.locator('button[title="Uložit změny"]:visible').first().click();
  await expect(ukazatel(page)).toBeVisible({ timeout: 30_000 });
  await zavriDetail(page);

  await otevriNabidkuUctu(page);
  await page.getByRole("button", { name: "Odhlásit se" }).click();
  await expect(page.locator('input[type="email"]').first()).toBeVisible({ timeout: 30_000 });

  /* Na přihlašovací obrazovce musí být vidět, že něco čeká – jinak odhlášený
     člověk vypne počítač s pocitem, že je hotovo. */
  await expect(ukazatel(page)).toBeVisible({ timeout: 20_000 });

  // Síť je zpátky, ale odhlášený klient nemá čím zápis podepsat. Ruční
  // „Zkusit uložit hned“ to musí poznat a čekající změnu nechat být:
  // odhlášený zápis RLS zahodí a databáze na to odpoví bez chyby, takže
  // fronta si ho dřív odškrtla jako uložený a data zmizela.
  await obnovSit(page, TICKETS);
  await ukazatel(page).getByRole("button").first().click();
  await page.getByRole("button", { name: /Zkusit uložit hned|Zkouším/ }).click();
  await page.waitForTimeout(4000);
  await expect(ukazatel(page)).toBeVisible();
  expect(await frontaVUlozisti(page)).toContain(popisek);

  // Po přihlášení téhož člověka se změna dopíše sama.
  await page.evaluate((id) => localStorage.setItem("jobsheet_active_service_id_v1", id), SERVIS.id);
  await page.locator('input[type="email"]').first().fill(SERVIS.email);
  await page.locator('input[type="password"]').first().fill(heslo("owner"));
  await page.getByRole("button", { name: "Přihlásit se" }).click();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
  await pockejNaVyprazdneni(page);

  await page.reload();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
  await vidZakazku(page, kod).first().click();
  await expect(page.getByText(popisek).first()).toBeVisible({ timeout: 20_000 });
  await zavriDetail(page);
});

test("souběžná úprava se ohlásí a rozepsaný text nezmizí", async ({ page, browser }) => {
  test.setTimeout(240_000);

  /* Majitel nedostává živé aktualizace – přesně stav, kvůli kterému se
     optimistické zamykání dělá. Se zapnutým realtime by mu nová verze
     zakázky přišla sama a konflikt by nikdy nenastal. */
  await page.routeWebSocket(/\/realtime\/v1\//, () => {});
  await prihlasSe(page, "owner");
  const technik = await druhyClovek(browser, "technik");
  try {
    await otevriZakazku(page);
    const mojeVerze = `Píše majitel ${Date.now().toString(36)}`;
    await page.locator('button[title="Upravit zakázku"]:visible').first().click();
    await poleZavady(page).fill(mojeVerze);

    // Technik mezitím tutéž zakázku uloží – verze v databázi povyroste.
    await vidZakazku(technik, kod).first().click();
    await expect(technik.locator("#detail-zapujcka")).toBeVisible({ timeout: 20_000 });
    await technik.locator('button[title="Upravit zakázku"]:visible').first().click();
    await poleZavady(technik).fill(`Píše technik ${Date.now().toString(36)}`);
    await technik.locator('button[title="Uložit změny"]:visible').first().click();
    await expect(technik.locator('button[title="Upravit zakázku"]:visible').first()).toBeVisible({ timeout: 30_000 });

    // Majitel uloží nad starou verzí. Musí se to dozvědět – a jeho text
    // musí zůstat ve formuláři. Dřív ho aplikace přepsala verzí ze serveru
    // a nad hláškou „zkontrolujte a uložte znovu“ nebylo co kontrolovat.
    await page.locator('button[title="Uložit změny"]:visible').first().click();
    await expect(page.getByText(/mezitím upravil někdo jiný/).first()).toBeVisible({ timeout: 30_000 });
    await expect(poleZavady(page)).toHaveValue(mojeVerze);

    // Detail zůstal v úpravách – je co uložit podruhé.
    await expect(page.locator('button[title="Uložit změny"]:visible').first()).toBeVisible();
    /* Než se klikne podruhé, musí se stihnout vykreslit zakázka načtená po
       konfliktu – teprve s její `version` má druhé uložení šanci projít. */
    await page.waitForTimeout(2000);

    // Druhé uložení už projde: detail vyskočí z režimu úprav a text je v databázi.
    await page.locator('button[title="Uložit změny"]:visible').first().click();
    await expect(page.locator('button[title="Upravit zakázku"]:visible').first()).toBeVisible({ timeout: 30_000 });

    await technik.reload();
    await expect(technik.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
    await vidZakazku(technik, kod).first().click();
    await expect(technik.getByText(mojeVerze).first()).toBeVisible({ timeout: 20_000 });
  } finally {
    await technik.context().close();
  }
});
