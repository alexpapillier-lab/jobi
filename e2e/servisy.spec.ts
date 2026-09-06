import { test, expect, type Page } from "@playwright/test";
import { SERVIS, TECHNIK, prihlasSe, zalozZakazku } from "./pomocnici";

/**
 * Životní cyklus servisu: založení z aplikace, pozvánky do týmu, smazání.
 *
 * Jediná velká cesta, kterou dosud žádný test nehlídal – a přitom je to první
 * věc, kterou nový zákazník udělá, a poslední, kterou udělá ten, kdo končí.
 * Nejvíc tu jde o čísla zakázek: nový servis, který nemá zkratku, čísluje
 * „SRV…“, a to už nikdo zpětně nepřepíše – čísla jsou na dokladech, které
 * zákazník drží v ruce.
 *
 * Testy pracují **jen ve svém vlastním servisu**, který si v prvním testu
 * založí a v posledním smaže; do testovacího servisu sahá jediný test, a to
 * jen čtením (práva technika). Mazání má vlastní pojistku: `smazServis`
 * odmítne cokoli, co se nejmenuje podle `PREDPONA`.
 */
test.describe.configure({ mode: "serial" });

/** Podle téhle předpony se pozná, co po testu smět smazat. */
const PREDPONA = "E2E servisy";

/** Servis založený prvním testem; sdílí ho celý soubor. */
let novyServisId: string | null = null;
let novyServisNazev = "";
/** Zkratka, kterou si servis odvodil z názvu – z ní jsou čísla zakázek. */
let novyServisZkratka = "";

/**
 * Adresa a klíče, se kterými aplikace mluví se Supabase.
 *
 * Test je nemá odkud vzít – anon klíč se do balíčku zapéká při buildu a na
 * `window` není. Odposlechnou se proto z požadavků, které aplikace sama dělá.
 * Díky tomu může test sáhnout na stejná rozhraní jako aplikace: ověřit, že
 * servis opravdu zmizel ze seznamu, a po sobě uklidit i po pádu uprostřed.
 */
type Pripojeni = { origin?: string; apikey?: string; authorization?: string };

function odposlechniSupabase(page: Page): Pripojeni {
  const stav: Pripojeni = {};
  page.on("request", (r) => {
    const url = r.url();
    if (!url.includes("/rest/v1/") && !url.includes("/functions/v1/") && !url.includes("/auth/v1/")) return;
    const h = r.headers();
    if (!h["apikey"]) return;
    stav.origin = new URL(url).origin;
    stav.apikey = h["apikey"];
    // Autorizaci bere jen tu, která patří přihlášenému člověku: před
    // přihlášením posílá klient v hlavičce anon klíč, a s tím by se pak
    // volání edge funkcí tvářilo jako nepřihlášené.
    const auth = h["authorization"];
    if (auth && auth.replace(/^Bearer\s+/i, "") !== h["apikey"]) stav.authorization = auth;
  });
  return stav;
}

async function seznamServisu(page: Page, p: Pripojeni): Promise<{ service_id: string; service_name: string }[]> {
  expect(p.origin, "Nezachytila se adresa Supabase z požadavků aplikace.").toBeTruthy();
  expect(p.authorization, "Nezachytila se autorizace přihlášeného účtu.").toBeTruthy();
  const res = await page.request.post(`${p.origin}/functions/v1/services-list`, {
    headers: { "Content-Type": "application/json", apikey: p.apikey!, Authorization: p.authorization! },
    data: {},
  });
  expect(res.status(), "services-list neodpovědělo").toBe(200);
  const data = await res.json();
  return (data?.services ?? []) as { service_id: string; service_name: string }[];
}

/**
 * Smaže servis založený testem.
 *
 * Pojistka není zdvořilostní: kdyby se id někde popletlo, šlo by o ostrý
 * servis zákazníka. Maže se proto jen to, co se jmenuje podle `PREDPONA`, a
 * nikdy testovací servis, ve kterém jezdí všechny ostatní testy.
 */
async function smazServis(page: Page, p: Pripojeni, id: string, nazev: string): Promise<void> {
  if (!nazev.startsWith(PREDPONA)) throw new Error(`Odmítnuto: „${nazev}“ nezaložil tenhle test.`);
  if (id === SERVIS.id) throw new Error("Odmítnuto: to je testovací servis, ve kterém jezdí ostatní testy.");
  const res = await page.request.post(`${p.origin}/functions/v1/service-delete-own`, {
    headers: { "Content-Type": "application/json", apikey: p.apikey!, Authorization: p.authorization! },
    data: { serviceId: id },
  });
  expect(res.status(), `Servis „${nazev}“ se nepodařilo smazat: ${await res.text()}`).toBe(200);
}

/** Otevře Nastavení a přes hledání se proklikne do podsekce. */
async function otevriNastaveni(page: Page, dotaz: string, podsekce: string): Promise<void> {
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "settings" } })),
  );
  const hledani = page.getByPlaceholder("Hledat v nastavení…");
  await expect(hledani).toBeVisible({ timeout: 20_000 });
  await hledani.fill(dotaz);
  await page.getByRole("button", { name: new RegExp(podsekce) }).first().click();
}

/** Přihlášení rovnou do servisu založeného testem, ne do testovacího. */
async function prihlasSeDoNoveho(page: Page): Promise<void> {
  expect(novyServisId, "Servis se v prvním testu nezaložil.").toBeTruthy();
  // Musí se předběhnout skript z `prihlasSe`, který klíč nastaví jen tehdy,
  // když ještě není – proto se sem zapisuje první.
  await page.addInitScript(
    ([klic, id]) => localStorage.setItem(klic, id),
    ["jobsheet_active_service_id_v1", novyServisId!],
  );
  await prihlasSe(page);
}

test.afterAll(async ({ browser }) => {
  if (!novyServisId) return;
  // Uklidit se musí i po pádu uprostřed: účet smí mít nejvýš tři vlastní
  // servisy, takže jeden zapomenutý zbytek zablokuje všechny další běhy.
  const page = await browser.newPage();
  try {
    const pripojeni = odposlechniSupabase(page);
    await prihlasSe(page);
    const zbyle = (await seznamServisu(page, pripojeni)).filter(
      (s) => s.service_id === novyServisId && s.service_name.startsWith(PREDPONA),
    );
    for (const s of zbyle) await smazServis(page, pripojeni, s.service_id, s.service_name);
  } finally {
    await page.close();
  }
});

test("nový servis jde založit z aplikace a první zakázka má číslo podle zkratky", async ({ page }) => {
  test.setTimeout(240_000);
  const pripojeni = odposlechniSupabase(page);
  await prihlasSe(page);

  novyServisNazev = `${PREDPONA} ${Date.now().toString(36)}`;
  await otevriNastaveni(page, "nový servis", "Fotka a přezdívka");
  await page.getByPlaceholder("např. Servis Novák").fill(novyServisNazev);
  await page.getByRole("button", { name: "Založit servis" }).click();
  await expect(page.getByText(`Servis „${novyServisNazev}“ je připravený`).first()).toBeVisible({ timeout: 60_000 });

  // Aplikace se do nového servisu rovnou přepne – kdo ho zakládá, chce v něm
  // pokračovat, ne ho hledat v přepínači.
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("jobsheet_active_service_id_v1")), {
      timeout: 30_000,
      message: "Aplikace se do nově založeného servisu nepřepnula.",
    })
    .not.toBe(SERVIS.id);
  novyServisId = await page.evaluate(() => localStorage.getItem("jobsheet_active_service_id_v1"));
  expect(novyServisId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

  // Přes reload, ať se nečte stav, který zůstal v paměti po předchozím servisu.
  await page.reload();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });

  await otevriNastaveni(page, "zkratka", "Údaje firmy");
  const poleZkratka = page.getByPlaceholder("Zkratka").first();
  await expect(poleZkratka).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(() => poleZkratka.inputValue(), { timeout: 20_000, message: "Nový servis nemá zkratku." })
    .toMatch(/^[A-Z0-9]{2,6}$/);
  novyServisZkratka = await poleZkratka.inputValue();
  // Jádro celého testu: „SRV“ je nouzová zkratka pro servis, o kterém se nic
  // neví. Nový servis se má jmenovat po sobě už od první zakázky.
  expect(novyServisZkratka, "Nový servis dostal nouzovou zkratku SRV.").not.toBe("SRV");

  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "orders" } })),
  );
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 30_000 });
  const kod = await zalozZakazku(page, {
    zakaznik: `Zakaznik ${Date.now().toString(36)}`,
    zarizeni: "iPhone 12",
    zkratka: novyServisZkratka,
  });
  expect(kod.startsWith(novyServisZkratka)).toBe(true);
  expect(kod.startsWith("SRV")).toBe(false);

  // A že to není jen na obrazovce: po přenačtení musí mít zakázka pořád stejné
  // číslo, tedy že si ho takhle uložila databáze.
  await page.reload();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
  await expect(page.locator(`:text-is("${kod}"):visible`).first()).toBeVisible({ timeout: 30_000 });

  // Ať `pripojeni` není nepoužitá proměnná a zároveň se rovnou ověří, že se
  // odposlech povedl – bez něj by úklid v afterAll tiše neudělal nic.
  expect(pripojeni.origin, "Nezachytila se adresa Supabase.").toBeTruthy();
});

test("pozvánka se objeví v seznamu, jde zrušit a stejná adresa se nezdvojí", async ({ page }) => {
  test.setTimeout(240_000);
  await prihlasSeDoNoveho(page);

  const pozvany = `e2e-pozvany-${Date.now().toString(36)}@jobi.test`;

  await otevriNastaveni(page, "tým", "Tým");
  const pozvatClena = page.getByRole("button", { name: "Pozvat člena" });
  await expect(pozvatClena).toBeVisible({ timeout: 30_000 });

  await pozvatClena.click();
  await page.getByPlaceholder("email@example.cz").fill(pozvany);
  await page.getByRole("button", { name: "Pozvat", exact: true }).click();
  // Kód se rovnou kopíruje do schránky; v hlavičce hlášky je tak jako tak
  // „Pozvánka vytvořena“, ať se kopírování povedlo, nebo ne.
  await expect(page.getByText(/Pozvánka vytvořena|Pozvánka odeslána/).first()).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText("Čekající pozvánky").first()).toBeVisible({ timeout: 30_000 });
  // Schované stránky zůstávají v DOM, takže se počítá jen to, co je vidět.
  const radkyPozvanky = page.locator(`:text-is("${pozvany}"):visible`);
  await expect(radkyPozvanky).toHaveCount(1, { timeout: 30_000 });

  /*
   * Stejná adresa podruhé. Pozvánka se dá poslat znovu (kód mohl zapadnout
   * v e-mailu), ale v seznamu musí zůstat jedna – dvě pozvánky na jednu
   * adresu by znamenaly dva platné kódy do stejného servisu a zrušení jedné
   * by tu druhou nechalo žít.
   */
  await pozvatClena.click();
  await page.getByPlaceholder("email@example.cz").fill(pozvany);
  await page.getByRole("button", { name: "Pozvat", exact: true }).click();
  await expect(page.getByText(/Pozvánka vytvořena|Pozvánka odeslána/).first()).toBeVisible({ timeout: 45_000 });
  await expect(radkyPozvanky).toHaveCount(1, { timeout: 30_000 });

  // Zrušení pozvánky – tlačítko Smazat v jejím řádku, ne kdekoli na stránce.
  const radek = radkyPozvanky
    .first()
    .locator('xpath=ancestor::*[.//button[normalize-space()="Smazat"]][1]');
  await radek.getByRole("button", { name: "Smazat" }).click();
  await expect(page.getByText("Pozvánka smazána").first()).toBeVisible({ timeout: 30_000 });
  await expect(radkyPozvanky).toHaveCount(0, { timeout: 30_000 });

  // A že je opravdu pryč z databáze, ne jen ze seznamu na obrazovce.
  await page.reload();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
  await otevriNastaveni(page, "tým", "Tým");
  await expect(page.getByRole("button", { name: "Pozvat člena" })).toBeVisible({ timeout: 30_000 });
  await expect(radkyPozvanky).toHaveCount(0, { timeout: 30_000 });
});

test("člen bez práv nikoho nepozve", async ({ page }) => {
  test.setTimeout(180_000);
  test.skip(
    !process.env.E2E_PASSWORD_TECHNIK,
    "Bez E2E_PASSWORD_TECHNIK není druhý účet, kterým by šlo omezená práva vyzkoušet.",
  );

  // Technik je členem testovacího servisu, ne toho založeného tímhle souborem;
  // pracuje se tu jen čtením a jedním voláním, které musí skončit odmítnutím.
  const pripojeni = odposlechniSupabase(page);
  await prihlasSe(page, "technik");

  // V rozhraní sekce Tým vůbec není – člen nemá co spravovat přístupy.
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "settings" } })),
  );
  const hledani = page.getByPlaceholder("Hledat v nastavení…");
  await expect(hledani).toBeVisible({ timeout: 20_000 });
  await hledani.fill("tým");
  await expect(page.getByText("Nic nenalezeno").first()).toBeVisible({ timeout: 20_000 });
  await hledani.fill("");
  await expect(page.getByRole("button", { name: "Pozvat člena" })).toHaveCount(0);

  /*
   * Schované tlačítko není pravidlo. Kdyby ho někdo obešel (starší verze
   * aplikace, přímé volání), musí pozvánku odmítnout server – jinak by si
   * technik přizval kohokoli do cizího servisu.
   */
  expect(pripojeni.authorization, "Nezachytila se autorizace technika.").toBeTruthy();
  const res = await page.request.post(`${pripojeni.origin}/functions/v1/invite_create`, {
    headers: {
      "Content-Type": "application/json",
      apikey: pripojeni.apikey!,
      Authorization: pripojeni.authorization!,
    },
    data: {
      mode: "current",
      serviceId: SERVIS.id,
      email: `e2e-pozvany-${Date.now().toString(36)}@jobi.test`,
      role: "member",
    },
  });
  expect(res.status(), `invite_create pustilo člena dál: ${await res.text()}`).toBe(403);
  expect(TECHNIK.email).toContain("@jobi.test");
});

test("smazaný servis zmizí ze seznamu a nedá se do něj vrátit", async ({ page }) => {
  test.setTimeout(240_000);
  const pripojeni = odposlechniSupabase(page);
  await prihlasSeDoNoveho(page);
  const smazany = novyServisId!;

  // Maže se serverovým rozhraním, ne z aplikace: tlačítko „smazat servis“
  // zákazník záměrně nemá (rozhodnutí majitele – smazat servis smí, ale
  // nesmí to mít na dvě kliknutí vedle údajů firmy). Test proto ověřuje to
  // druhé, co je na mazání důležité: že se s tím aplikace vyrovná.
  //
  // Název se bere ze serveru, ne z proměnné testu: pojistka v `smazServis`
  // má hlídat, co k tomu id opravdu patří. Kdyby se `novyServisId` někde
  // odchýlilo, kontrola nad očekávaným názvem by ho pustila dál.
  const naServeru = (await seznamServisu(page, pripojeni)).find((s) => s.service_id === smazany);
  expect(naServeru, "Servis založený testem už v seznamu není.").toBeTruthy();
  await smazServis(page, pripojeni, smazany, naServeru!.service_name);

  // Přepínač čte seznam ze services-list; když v něm servis není, není ani tam.
  await expect
    .poll(async () => (await seznamServisu(page, pripojeni)).map((s) => s.service_id), {
      timeout: 30_000,
      message: "Smazaný servis je pořád v seznamu servisů.",
    })
    .not.toContain(smazany);
  novyServisId = null;

  // Podstrčené id smazaného servisu musí aplikace zahodit a otevřít některý
  // ze zbývajících, ne se zaseknout na prázdné obrazovce.
  await page.evaluate((id) => localStorage.setItem("jobsheet_active_service_id_v1", id), smazany);
  await page.reload();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("jobsheet_active_service_id_v1")), {
      timeout: 30_000,
      message: "Aplikace se vrátila do smazaného servisu.",
    })
    .not.toBe(smazany);
});
