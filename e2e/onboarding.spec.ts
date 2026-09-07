import { test, expect, type Page } from "@playwright/test";
import { zalozZakazku, vidZakazku, zavriDetail, pockejNaZapisSnimku } from "./pomocnici";

/**
 * První hodina nového zákazníka.
 *
 * Jediná cesta, kterou projde úplně každý, kdo si Jobi zkusí: registrace →
 * založení servisu → karta „První kroky“ → první zakázka → faktura → tisk →
 * odkaz pro zákazníka. Ostatní sady jezdí v servisu, který má za sebou měsíce
 * provozu (ceník, sklad, stavy, firemní údaje), takže o prázdném servisu
 * nevědí nic – a přitom právě tam se rozhoduje, jestli si člověk Jobi koupí.
 *
 * Testy jdou skutečnou cestou přes prohlížeč a ostrý Supabase. Žádné
 * zkratky přes servisní klíč: kdyby se rozbila registrace nebo zavádění
 * výchozích stavů, musí to poznat právě tenhle soubor.
 *
 * **Po sobě uklízí.** Servisy zakládané testem se v `afterAll` mažou přes
 * `service-delete-own`; účet jich smí mít tři a jeden zapomenutý zbytek by
 * zablokoval další běhy. Účet smazat nejde – aplikace na to rozhraní nemá –
 * a zůstává v Auth. Proto tahle sada nepatří do CI (viz vlastní config).
 */
test.describe.configure({ mode: "serial" });

/** Podle téhle předpony se pozná, co po testu smět smazat. */
const PREDPONA = "E2E onboarding";

/**
 * Heslo si volající vygeneruje sám a předá prostředím – v souboru žádné
 * není. Bez něj se testy přeskočí: registrace s hádatelným heslem by v ostré
 * databázi nechala účet, ke kterému se dostane kdokoli.
 */
const HESLO = process.env.E2E_ONBOARDING_PASSWORD ?? "";

/** Adresa je vždycky na `@jobi.test` – doména nikam nevede, takže žádný e-mail neodejde. */
const UCET = `e2e-onboarding-${Date.now().toString(36)}@jobi.test`;

/** Název servisu založeného z aplikace; z něj se odvodí zkratka a čísla zakázek. */
const NAZEV_SERVISU = `${PREDPONA} ${Date.now().toString(36)}`;

let servisId = "";
/** Zkratka, kterou si servis odvodil z názvu. Čísla zakázek začínají tímhle. */
let zkratka = "";
/** Servis založený přímo edge funkcí – simuluje přerušené zakládání. */
let servisPrerusenyId = "";
let kodZakazky = "";
let odkazDoPortalu = "";

const zakaznik = `Zakaznik ${Date.now().toString(36)}`;

test.beforeEach(() => {
  test.skip(
    !HESLO,
    "Chybí E2E_ONBOARDING_PASSWORD. Spusťte: E2E_ONBOARDING_PASSWORD=\"$(openssl rand -base64 24)\" npm run test:e2e:onboarding",
  );
});

/* ------------------------------------------------------------------ */
/* Spojení se Supabase                                                 */
/* ------------------------------------------------------------------ */

/**
 * Adresa a klíče, se kterými aplikace mluví se Supabase.
 *
 * Test je nemá odkud vzít – anon klíč se zapéká při buildu a na `window`
 * není. Odposlechnou se z požadavků, které aplikace sama dělá. Stejný postup
 * jako v `servisy.spec.ts`; díky němu může test uklidit i po pádu uprostřed.
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
    // Jen autorizace přihlášeného člověka: před přihlášením posílá klient
    // v hlavičce anon klíč a s tím by se volání tvářilo jako nepřihlášené.
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
 * servis zákazníka. Maže se jen to, co se jmenuje podle `PREDPONA`, a jméno
 * se bere ze serveru, ne z proměnné testu.
 */
async function smazServis(page: Page, p: Pripojeni, id: string, nazev: string): Promise<void> {
  if (!nazev.startsWith(PREDPONA)) throw new Error(`Odmítnuto: „${nazev}“ nezaložil tenhle test.`);
  const res = await page.request.post(`${p.origin}/functions/v1/service-delete-own`, {
    headers: { "Content-Type": "application/json", apikey: p.apikey!, Authorization: p.authorization! },
    data: { serviceId: id },
  });
  expect(res.status(), `Servis „${nazev}“ se nepodařilo smazat: ${await res.text()}`).toBe(200);
}

/* ------------------------------------------------------------------ */
/* Kroky nového zákazníka                                              */
/* ------------------------------------------------------------------ */

/** Přihlášení účtem, který si tenhle soubor v prvním testu zaregistroval. */
async function prihlasSeJakoNovacek(page: Page): Promise<void> {
  if (servisId) {
    // Bez tohohle by aplikace po přihlášení mohla otevřít jiný servis účtu
    // (test přerušeného zakládání jich zakládá víc).
    await page.addInitScript(
      ([klic, id]) => localStorage.setItem(klic, id),
      ["jobsheet_active_service_id_v1", servisId],
    );
  }
  await page.goto("/");
  const email = page.locator('input[type="email"]').first();
  await expect(email).toBeVisible({ timeout: 30_000 });
  await email.fill(UCET);
  await page.locator('input[type="password"]').first().fill(HESLO);
  await page.getByRole("button", { name: "Přihlásit se" }).click();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 60_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
}

/** Otevře stránku aplikace a počká, až se opravdu ukáže. */
async function naStranku(page: Page, stranka: string, znak: () => Promise<boolean>): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.evaluate(
          (p) => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: p } })),
          stranka,
        );
        return znak();
      },
      { timeout: 45_000, message: `Stránka „${stranka}“ se neotevřela.` },
    )
    .toBe(true);
}

/** Otevře Nastavení a přes hledání se proklikne do podsekce. */
async function otevriNastaveni(page: Page, dotaz: string, podsekce: string): Promise<void> {
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "settings" } })),
  );
  const hledani = page.getByPlaceholder("Hledat v nastavení…");
  await expect(hledani).toBeVisible({ timeout: 30_000 });
  await hledani.fill(dotaz);
  await page.getByRole("button", { name: new RegExp(podsekce) }).first().click();
}

/**
 * Text, který je na obrazovce doopravdy vidět.
 *
 * Schované stránky zůstávají připojené v DOM, takže `innerText` celého body
 * by tahal i to, co uživatel nevidí – a hledání „NaN“ by hlásilo cizí
 * obrazovku. Bere se proto jen viditelná část hlavního obsahu.
 */
async function viditelnyText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const koren = document.querySelector("main") ?? document.body;
    const viditelne = [...koren.querySelectorAll<HTMLElement>(":scope > *")].filter((e) => e.offsetParent !== null);
    return (viditelne.length > 0 ? viditelne : [koren as HTMLElement]).map((e) => e.innerText).join("\n");
  });
}

test.afterAll(async ({ browser }) => {
  if (!HESLO || (!servisId && !servisPrerusenyId)) return;
  // Uklidit se musí i po pádu uprostřed: účet smí mít nejvýš tři vlastní
  // servisy, takže jeden zapomenutý zbytek zablokuje všechny další běhy.
  const page = await browser.newPage();
  try {
    const pripojeni = odposlechniSupabase(page);
    await prihlasSeJakoNovacek(page);
    const zbyle = (await seznamServisu(page, pripojeni)).filter((s) => s.service_name.startsWith(PREDPONA));
    for (const s of zbyle) await smazServis(page, pripojeni, s.service_id, s.service_name);
  } finally {
    await page.close();
  }
});

/* ------------------------------------------------------------------ */

test("registrace pustí nového majitele rovnou na založení servisu", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Nemám účet – vytvořit nový" }).click();

  await page.locator('input[type="email"]').first().fill(UCET);
  const hesla = page.locator('input[type="password"]');
  await hesla.nth(0).fill(HESLO);
  await hesla.nth(1).fill(HESLO);
  await page.getByRole("button", { name: "Registrovat se" }).click();

  /*
   * Prázdná aplikace bez jediného tlačítka byla přesně to, co nového
   * zákazníka dřív odrovnalo: účet měl, servis mu ale mohl založit jen
   * majitel Jobi. Tady se musí ukázat obrazovka „Založte si servis“.
   */
  await expect(page.getByRole("heading", { name: "Založte si servis" })).toBeVisible({ timeout: 60_000 });

  await page.getByPlaceholder("např. Servis Novák").fill(NAZEV_SERVISU);
  await page.getByRole("button", { name: "Založit servis" }).click();
  await expect(page.getByText(`Servis „${NAZEV_SERVISU}“ je připravený`).first()).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 60_000 });

  servisId = (await page.evaluate(() => localStorage.getItem("jobsheet_active_service_id_v1"))) ?? "";
  expect(servisId, "Aplikace se do nově založeného servisu nepřepnula.").toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );

  /*
   * Karta „První kroky“ je jediné, co v prázdné aplikaci navádí. Musí být
   * vidět hned a musí být poznat, že se nesplnila sama od sebe.
   */
  await expect(page.getByText("První kroky").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Vyplňte údaje firmy").first()).toBeVisible();
  await expect(page.getByText("Založte první zakázku").first()).toBeVisible();
  // Zkratku si servis odvodil sám při zakládání, takže jeden krok je hotový
  // hned – seznam nesmí tvrdit, že je hotové všechno ani že nic.
  await expect(page.getByText(/\d+ z 6/).first()).toBeVisible();
});

test("prázdné obrazovky nového servisu neukazují NaN a poradí, čím začít", async ({ page }) => {
  await prihlasSeJakoNovacek(page);

  const obrazovky: { stranka: string; znak: () => Promise<boolean> }[] = [
    // Ceník oprav žije na stránce Zařízení.
    { stranka: "devices", znak: () => page.getByLabel("Hledat opravu").first().isVisible().catch(() => false) },
    { stranka: "inventory", znak: () => page.getByRole("button", { name: "Naskladnit" }).isVisible().catch(() => false) },
    { stranka: "customers", znak: () => page.getByPlaceholder("Vyhledávání zákazníků…").first().isVisible().catch(() => false) },
    // Nadpisy stránek nejsou <h1>, jen prvek s třídou z návrhu.
    { stranka: "statistics", znak: () => page.locator(".ui-page-header__title", { hasText: "Statistiky" }).first().isVisible().catch(() => false) },
    { stranka: "invoices", znak: () => page.getByRole("button", { name: "Nová faktura" }).first().isVisible().catch(() => false) },
  ];

  const chyby: string[] = [];
  for (const o of obrazovky) {
    await naStranku(page, o.stranka, o.znak);
    const text = await viditelnyText(page);
    /*
     * „NaN“ a „Infinity“ na obrazovce nového servisu jsou klasika: průměrná
     * doba opravy nebo úspěšnost se počítá dělením počtem zakázek, a ten je
     * nula. „undefined“ je totéž o řádek výš – chybějící údaj, který se
     * vypsal místo prázdna.
     */
    for (const vzor of ["NaN", "Infinity", "undefined"]) {
      if (text.includes(vzor)) chyby.push(`${o.stranka}: na obrazovce je „${vzor}“`);
    }
  }
  expect(chyby, chyby.join("\n")).toEqual([]);

  // Sklad nemá jen mlčet – nový servis musí z prázdné obrazovky poznat, co dál.
  await naStranku(page, "inventory", () => page.getByRole("button", { name: "Naskladnit" }).isVisible().catch(() => false));
  await page.getByRole("button", { name: "Naskladnit" }).click();
  const naskladneni = page.getByText(/Ve skladu zatím není žádný produkt/).first();
  await expect(naskladneni, "Naskladnění v prázdném skladu neporadí, že se má nejdřív založit produkt.").toBeVisible({
    timeout: 20_000,
  });
  await page.keyboard.press("Escape");
});

test("nový servis má hned použitelné stavy zakázek a čísla podle své zkratky", async ({ page }) => {
  await prihlasSeJakoNovacek(page);

  /*
   * Zkratka je jádro celé věci: je z ní číslo zakázky a to už zpětně nikdo
   * nepřepíše – je na dokladech, které zákazník drží v ruce. „SRV“ je nouzová
   * zkratka pro servis, o kterém se nic neví.
   */
  await otevriNastaveni(page, "zkratka", "Údaje firmy");
  const poleZkratka = page.getByPlaceholder("Zkratka").first();
  await expect(poleZkratka).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() => poleZkratka.inputValue(), { timeout: 30_000, message: "Nový servis nemá zkratku." })
    .toMatch(/^[A-Z0-9]{2,6}$/);
  zkratka = await poleZkratka.inputValue();
  expect(zkratka, "Nový servis dostal nouzovou zkratku SRV.").not.toBe("SRV");

  // První zakázka: číslo musí začínat zkratkou servisu, ne „SRV“.
  await naStranku(page, "orders", () => page.getByRole("button", { name: "+ Nová zakázka" }).isVisible().catch(() => false));
  kodZakazky = await zalozZakazku(page, {
    zakaznik,
    zarizeni: "iPhone 13 (onboarding)",
    popis: "Rozbitý displej",
    zkratka,
    nechatOtevrene: true,
  });
  expect(kodZakazky.startsWith(zkratka)).toBe(true);
  expect(kodZakazky.startsWith("SRV")).toBe(false);

  /*
   * Stavy zakázek zavádí edge funkce až při prvním otevření servisu. Kdyby
   * se to nepovedlo, zakázka by se sice založila, ale nedala by se posunout
   * dál – tedy z aplikace by nešlo dělat to hlavní.
   */
  // Přepínač stavu v hlavičce otevřeného detailu; v seznamu za ním je stejný,
  // jenže ten leží pod ztmavením a klik by do něj jen narážel.
  const hlavicka = page
    .getByText(new RegExp(`^${zakaznik} · `))
    .first()
    .locator("xpath=ancestor::*[.//button[contains(., 'Přijato')]][1]");
  const stav = hlavicka.getByRole("button", { name: /Přijato/ }).first();
  await expect(stav, "Nová zakázka nemá výchozí stav – servis nemá zavedené stavy zakázek.").toBeVisible({
    timeout: 30_000,
  });
  await stav.click();
  await expect(page.getByRole("button", { name: "Dokončeno", exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press("Escape");
  await zavriDetail(page);

  // Přes přenačtení: číslo přidělila databáze, ne obrazovka.
  await page.reload();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 60_000 });
  await expect(vidZakazku(page, kodZakazky).first()).toBeVisible({ timeout: 30_000 });
});

test("první produkt si počáteční zásobu opravdu odnese do databáze", async ({ page }) => {
  await prihlasSeJakoNovacek(page);
  await naStranku(page, "inventory", () => page.getByRole("button", { name: "Naskladnit" }).isVisible().catch(() => false));

  const produkt = `Displej E2E ${Date.now().toString(36)}`;

  // „Nový produkt“ je v hlavičce i uprostřed prázdného seznamu – obojí dělá totéž.
  await page.getByRole("button", { name: "Nový produkt" }).first().click();
  await page.getByLabel("Nepřiřazovat k zařízení").check();
  await page.getByPlaceholder("Název produktu…").fill(produkt);
  await page.getByPlaceholder("Sklad (ks)").fill("5");
  // Přesně, ne podřetězcem: vedle je ještě „Nákupní cena (Kč)“.
  await page.getByPlaceholder("Cena (Kč)", { exact: true }).fill("1990");
  await page.getByRole("button", { name: "Přidat produkt" }).click();

  /*
   * Zadaných pět kusů se dřív tiše ztrácelo: bez skladu neměly kam jít,
   * produkt se založil s nulou a nikdo se to nedozvěděl. Proto se kontroluje
   * až stav po přenačtení – to, co je na obrazovce, ještě nic neznamená.
   */
  await expect(page.getByText("Produkt přidán").first()).toBeVisible({ timeout: 30_000 });
  await pockejNaZapisSnimku(page, "jobi_sklad_neulozeno_v1");

  /**
   * Kolik kusů má produkt podle databáze.
   *
   * Čte se z dialogu Naskladnění („Aktuální zásoba: N ks“), ne ze seznamu:
   * v seznamu se počet vykresluje ve dvou rozvrženích a vedle je i cena,
   * takže hledání čísla v řádku najde pokaždé něco jiného. A vždycky až po
   * přenačtení stránky – to, co je na obrazovce, ještě neznamená uloženo.
   */
  const zasobaPoPrenacteni = async (): Promise<number> => {
    await page.reload();
    await naStranku(page, "inventory", () => page.getByRole("button", { name: "Naskladnit" }).isVisible().catch(() => false));
    await page.getByRole("button", { name: "Naskladnit" }).click();
    const dialog = page.getByRole("dialog", { name: "Naskladnění" });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await dialog.getByPlaceholder("Začněte psát název nebo SKU produktu…").fill(produkt);
    const nalez = dialog.getByText(/Aktuální zásoba:\s*\d+\s*ks/).first();
    await expect(nalez, "Produkt se v naskladnění nenašel.").toBeVisible({ timeout: 20_000 });
    return Number((await nalez.innerText()).match(/(\d+)\s*ks/)?.[1] ?? -1);
  };

  expect(await zasobaPoPrenacteni(), "Počáteční zásoba se po přenačtení ztratila.").toBe(5);

  /*
   * A odkud se ta zásoba vzala: nový servis nemá v ostré databázi ani jeden
   * sklad (výchozí zakládá trigger, na který se spolehnout nedá), takže si ho
   * aplikace musela založit sama. Kdyby to neudělala, kusy by neměly kam jít.
   */
  const podnadpis = page.locator(".ui-page-header__subtitle").first();
  const kolikSkladu = Number((await podnadpis.innerText()).match(/(\d+)\s*sklad/)?.[1] ?? 0);
  expect(kolikSkladu, "Kusy se uložily, ale servis nemá sklad – to nedává smysl.").toBeGreaterThan(0);

  /*
   * A tlačítko „Naskladnit“: v prázdném servisu do teď jen otevíralo dialog,
   * ve kterém se nedalo nic najít. Teď má produkt najít a přidat mu kusy –
   * a ty musí přežít přenačtení, ne zůstat jen na obrazovce.
   */
  const dialog = page.getByRole("dialog", { name: "Naskladnění" });
  await dialog.getByRole("button", { name: "Upravit zásobu" }).first().click();
  await dialog.getByLabel("Změna počtu kusů").fill("3");
  await dialog.getByRole("button", { name: "Potvrdit změnu" }).click();
  await expect(page.getByText(/Přidáno 3 ks/).first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Zavřít" }).last().click();
  await pockejNaZapisSnimku(page, "jobi_sklad_neulozeno_v1");

  expect(await zasobaPoPrenacteni(), "Naskladnění se neuložilo – po přenačtení je zásoba jiná.").toBe(8);
});

test("z první zakázky vznikne nabídka, odkaz pro zákazníka i faktura", async ({ page }) => {
  await prihlasSeJakoNovacek(page);
  await vidZakazku(page, kodZakazky).first().click();

  await expect(page.getByText("Cenová nabídka").first()).toBeVisible({ timeout: 30_000 });
  await page.getByPlaceholder("Vlastní položka").fill("Výměna displeje");
  await page.getByPlaceholder("Kč", { exact: true }).fill("3500");
  await page.getByRole("button", { name: "Přidat", exact: true }).click();
  await page.getByRole("button", { name: "Poslat ke schválení" }).click();
  await expect(page.getByText(/Čeká na schválení/).first()).toBeVisible({ timeout: 30_000 });

  // Odkaz pro zákazníka vzniká až tady; do teď zakázka žádný token nemá.
  const kotva = page.locator('a[href^="https://appjobi.com/z/"]').first();
  await expect(kotva, "Nový servis nedokáže poslat zákazníkovi odkaz na stav zakázky.").toBeVisible({ timeout: 30_000 });
  odkazDoPortalu = (await kotva.getAttribute("href")) ?? "";
  expect(odkazDoPortalu).toMatch(/^https:\/\/appjobi\.com\/z\/\?t=.+/);

  /*
   * Faktura je první doklad, na kterém jsou vidět firemní údaje i číselná
   * řada. Nový servis nemá v Nastavení dokladů nic vyplněného, takže se
   * zároveň ověřuje, že řada existuje sama od sebe.
   */
  await page.getByRole("button", { name: /Vystavit fakturu/ }).first().click();
  await expect(page.getByText("Nová faktura")).toBeVisible({ timeout: 45_000 });
  await page.getByPlaceholder("Název položky").first().fill("Výměna displeje");
  await page.locator('input[type="number"]').nth(1).fill("3500");
  await page.getByRole("button", { name: "Vystavit", exact: true }).click();

  const cislo = page.getByText(/FV\d{4}-\d{4}/).first();
  await expect(cislo, "Faktura nedostala číslo z řady – nový servis nemá nastavení dokladů.").toBeVisible({
    timeout: 45_000,
  });
  expect(((await cislo.textContent()) ?? "").match(/FV\d{4}-\d{4}/)?.[0]).toMatch(/^FV\d{4}-\d{4}$/);
});

test("zákazník uvidí na svém odkazu zakázku i nabídku", async ({ browser }) => {
  expect(odkazDoPortalu, "Odkaz do portálu z předchozího testu chybí.").toBeTruthy();
  // Portál běží na appjobi.com, ne na vývojovém serveru – zákazník ho otevře
  // na telefonu přesně takhle.
  const mobil = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "cs-CZ" });
  const portal = await mobil.newPage();
  try {
    await portal.goto(odkazDoPortalu);
    await expect(portal.getByText(kodZakazky).first()).toBeVisible({ timeout: 60_000 });
    await expect(portal.getByText("Cenová nabídka").first()).toBeVisible({ timeout: 30_000 });
    // Název servisu je to jediné, podle čeho zákazník pozná, od koho odkaz je.
    await expect(portal.getByText(new RegExp(NAZEV_SERVISU.slice(0, 12))).first()).toBeVisible({ timeout: 30_000 });
    const text = await portal.evaluate(() => document.body.innerText);
    expect(text, "Na portálu nového servisu je „undefined“ nebo „NaN“.").not.toMatch(/NaN|undefined/);
  } finally {
    await mobil.close();
  }
});

test("zakázkový list se ve webové verzi vytiskne s údaji, ne s prázdnými místy", async ({ page }) => {
  /*
   * Tisk v prohlížeči skládá HTML jádrem JobiDocs a posílá ho do skrytého
   * iframu. Tiskový dialog v testu nemá kdo potvrdit, takže se odchytí to
   * podstatné – co by se vytisklo. `srcdoc` se nastavuje před vložením do
   * stránky, proto stačí podchytit zápis do vlastnosti.
   */
  await page.addInitScript(() => {
    const puvodni = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "srcdoc");
    if (!puvodni?.set) return;
    Object.defineProperty(HTMLIFrameElement.prototype, "srcdoc", {
      configurable: true,
      get() { return puvodni.get?.call(this); },
      set(v: string) {
        (window as unknown as { __tisk?: string }).__tisk = v;
        // Tiskový dialog by test zablokoval. Vypne se dřív, než ho appka zavolá:
        // posluchač se registruje před tím, kterým si otevření hlídá webPrint.
        this.addEventListener("load", () => {
          try { (this as HTMLIFrameElement).contentWindow!.print = () => {}; } catch { /* jiný původ */ }
        }, { once: true });
        puvodni.set!.call(this, v);
      },
    });
  });

  await prihlasSeJakoNovacek(page);
  await vidZakazku(page, kodZakazky).first().click();
  // Nabídka tisku z hlavičky detailu; v řádku seznamu pod ztmavením je další.
  const hlavickaDetailu = page
    .getByText(new RegExp(`^${zakaznik} · `))
    .first()
    .locator("xpath=ancestor::*[.//button[contains(., 'Tisk')]][1]");
  await hlavickaDetailu.getByRole("button", { name: /^Tisk/ }).first().click();
  const radek = page.getByRole("menu").getByText("Zakázkový list", { exact: true }).locator("xpath=ancestor::div[1]");
  await radek.getByRole("button", { name: "Tisk" }).click();

  const html = await new Promise<string>((resolve, reject) => {
    const konec = Date.now() + 45_000;
    const zkus = async () => {
      const v = await page.evaluate(() => (window as unknown as { __tisk?: string }).__tisk ?? null);
      if (v) return resolve(v);
      if (Date.now() > konec) return reject(new Error("Tisk zakázkového listu nic nevykreslil."));
      setTimeout(() => void zkus(), 250);
    };
    void zkus();
  });

  const bezZnacek = html.replace(/<[^>]*>/g, " ");
  expect(bezZnacek).toContain(kodZakazky);
  expect(bezZnacek).toContain(NAZEV_SERVISU);
  expect(bezZnacek).toContain(zakaznik);
  /*
   * Prázdná varianta je ta zákeřná: dokud servis nemá vyplněné IČO a adresu,
   * nesmí se místo nich tisknout „undefined“ ani „null“. Zákazník si ten
   * papír odnese domů.
   */
  expect(bezZnacek, "Do zakázkového listu se tisknou chybějící údaje jako „undefined“.").not.toMatch(
    /undefined|\bnull\b|NaN/,
  );
});

test("obsazený e-mail se odmítne česky a poradí přihlásit se", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Nemám účet – vytvořit nový" }).click();
  await page.locator('input[type="email"]').first().fill(UCET);
  const hesla = page.locator('input[type="password"]');
  await hesla.nth(0).fill(HESLO);
  await hesla.nth(1).fill(HESLO);
  await page.getByRole("button", { name: "Registrovat se" }).click();

  /*
   * Supabase odpovídá „User already registered“. Anglická věta je špatně sama
   * o sobě, ale hlavně z ní není poznat, co dělat dál – a člověk zkouší
   * registraci znovu místo přihlášení.
   */
  const hlaska = page.getByText(/už existuje/).first();
  await expect(hlaska, "Obsazený e-mail se hlásí anglicky nebo nesrozumitelně.").toBeVisible({ timeout: 45_000 });
  await expect(hlaska).toContainText("Přihlaste se");
  // A že se do aplikace nedostal: účet se nepřepsal, zůstává přihlašovací obrazovka.
  await expect(page.getByRole("button", { name: "Registrovat se" })).toBeVisible();
});

test("přerušené zakládání servisu nenechá v databázi servis bez zkratky", async ({ page }) => {
  const pripojeni = odposlechniSupabase(page);
  await prihlasSeJakoNovacek(page);
  const predtim = (await seznamServisu(page, pripojeni)).length;

  // Servis bez názvu se nesmí založit vůbec – jinak by v seznamu přibyl
  // řádek bez jména a počítal se do limitu tří servisů na účet.
  const bezNazvu = await page.request.post(`${pripojeni.origin}/functions/v1/service-create`, {
    headers: { "Content-Type": "application/json", apikey: pripojeni.apikey!, Authorization: pripojeni.authorization! },
    data: { name: "   " },
  });
  expect(bezNazvu.status()).toBe(400);
  expect(await bezNazvu.text()).toContain("Zadejte název servisu");
  expect((await seznamServisu(page, pripojeni)).length, "Odmítnuté zakládání po sobě nechalo servis.").toBe(predtim);

  /*
   * A teď to podstatné: zakládání servisu jsou dva kroky. Edge funkce vytvoří
   * servis, teprve pak klient dopisuje zkratku do nastavení. Když se mezitím
   * zavře okno nebo vypadne síť, zůstane v databázi servis bez zkratky – a
   * jeho zakázky by se jmenovaly „SRV…“, což se zpětně nepřepíše.
   *
   * Volání edge funkce napřímo je právě ten poloviční stav. Servis z něj
   * musí i tak číslovat po sobě: `service-create` si zapisuje název do
   * firemních údajů a zkratka se z něj umí odvodit.
   */
  const nazevPreruseny = `${PREDPONA} preruseny ${Date.now().toString(36)}`;
  const odpoved = await page.request.post(`${pripojeni.origin}/functions/v1/service-create`, {
    headers: { "Content-Type": "application/json", apikey: pripojeni.apikey!, Authorization: pripojeni.authorization! },
    data: { name: nazevPreruseny },
  });
  expect(odpoved.status(), `service-create selhalo: ${await odpoved.text()}`).toBe(200);
  servisPrerusenyId = ((await odpoved.json()) as { service_id?: string }).service_id ?? "";
  expect(servisPrerusenyId).toBeTruthy();

  /* Ne `page.evaluate`: skript z přihlášení se pouští při KAŽDÉ navigaci a
     po reloadu by aktivní servis přepsal zpátky. Další `addInitScript` běží
     až po něm, takže vyhraje ten poslední zápis. */
  await page.addInitScript(
    ([klic, id]) => localStorage.setItem(klic, id),
    ["jobsheet_active_service_id_v1", servisPrerusenyId],
  );
  await page.reload();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 60_000 });
  // Zakázku nejde založit dřív, než servis dostane výchozí stavy zakázek.
  await page.waitForLoadState("networkidle").catch(() => {});

  const kod = await zalozZakazku(page, {
    zakaznik: `Zakaznik preruseny ${Date.now().toString(36)}`,
    zarizeni: "iPad (přerušené zakládání)",
    // Zkratka se odvodí z názvu „E2E onboarding preruseny …“; test nesmí
    // předepisovat jakou, jen že to není nouzové SRV.
    zkratka: "[A-Z0-9]{2,6}",
  });
  expect(kod, "Servis z přerušeného zakládání čísluje zakázky „SRV…“.").not.toMatch(/^SRV/);
});
