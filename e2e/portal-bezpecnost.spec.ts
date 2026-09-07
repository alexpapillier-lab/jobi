import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prihlasSe, testovaciJmeno, zalozZakazku, zavriDetail, vidZakazku, nahodnyTelefon } from "./pomocnici";

/**
 * Zákaznický portál z pohledu útočníka.
 *
 * Portál je jediná část Jobi otevřená komukoli s odkazem a bez přihlášení.
 * Token je jediné oprávnění a za ním jsou osobní údaje, ceny a podpis
 * převzetí. `portal.spec.ts` ověřuje, že šťastná cesta funguje; tenhle soubor
 * se ptá na opak: co se stane, když někdo token uhodne, zkrátí, prodlouží,
 * pošle nesmysl nebo zkusí přes portál změnit cenu.
 *
 * Testuje se proti OSTRÉ edge funkci, ale výhradně nad zakázkou, kterou si
 * test sám založí v E2E testovacím servisu. Odkazy ostrých servisů se
 * neotevírají.
 *
 * Vykreslování (XSS) se schválně testuje nad podvrženou odpovědí a nad
 * statikou z repozitáře: jde o to, co udělá `web/z/portal.js` s textem, který
 * mu někdo pošle, ne o to, co je zrovna nasazené.
 */
test.describe.configure({ mode: "serial" });

const FUNKCE = "https://ijtvcgolsdsrquqbvjrz.supabase.co/functions/v1/portal-ticket";
const WEB = path.resolve(fileURLToPath(new URL("../web", import.meta.url)));

const zakaznik = testovaciJmeno("Portál bezpečnost");
const telefon = nahodnyTelefon();
const SERIOVE = "SN-E2E-TAJNE-9";
let odkaz = "";
let token = "";
let kod = "";

/** Token z odkazu, který dostane zákazník. */
function tokenZOdkazu(url: string): string {
  return new URL(url).searchParams.get("t") ?? "";
}

// ---------------------------------------------------------------------------
// Příprava: zakázka s citlivými údaji a odkaz na ni
// ---------------------------------------------------------------------------

test("servis založí zakázku s citlivými údaji a vytvoří odkaz", async ({ page }) => {
  test.setTimeout(150_000);
  await prihlasSe(page);
  kod = await zalozZakazku(page, {
    zakaznik,
    telefon,
    seriove: SERIOVE,
    zarizeni: "iPhone (bezpečnost)",
    popis: "Rozbitý displej",
    nechatOtevrene: true,
  });

  // Odkaz vzniká až s nabídkou – do té doby zakázka žádný token nemá.
  await expect(page.getByText("Cenová nabídka").first()).toBeVisible({ timeout: 20_000 });
  await page.getByPlaceholder("Vlastní položka").fill("Výměna displeje");
  await page.getByPlaceholder("Kč", { exact: true }).fill("3500");
  await page.getByRole("button", { name: "Přidat", exact: true }).click();
  await page.getByRole("button", { name: "Poslat ke schválení" }).click();

  const kotva = page.locator('a[href^="https://appjobi.com/z/"]').first();
  await expect(kotva).toBeVisible({ timeout: 30_000 });
  odkaz = (await kotva.getAttribute("href")) ?? "";
  token = tokenZOdkazu(odkaz);
  expect(token.length, "token musí být dlouhý – je to jediné heslo k zakázce").toBeGreaterThanOrEqual(32);
  await zavriDetail(page);
});

// ---------------------------------------------------------------------------
// Co jde ven
// ---------------------------------------------------------------------------

test("odpověď neobsahuje nic z vnitřku servisu", async ({ request }) => {
  const odpoved = await request.get(`${FUNKCE}?t=${encodeURIComponent(token)}`);
  expect(odpoved.status()).toBe(200);
  const telo = await odpoved.text();
  const data = JSON.parse(telo);

  // Přesný seznam polí. Nové pole v odpovědi je rozhodnutí o tom, co uvidí
  // kdokoli s odkazem – proto se sem musí dopsat ručně.
  expect(Object.keys(data).sort()).toEqual(["ok", "payment", "service", "ticket"]);
  expect(Object.keys(data.ticket).sort()).toEqual([
    "code",
    "createdAt",
    "deviceLabel",
    "discount",
    "estimatedPrice",
    "expectedCompletionAt",
    "handbackMethod",
    "handoffMethod",
    "intakeSignatureUrl",
    "intakeSignedAt",
    "performedRepairs",
    "photos",
    "photosBefore",
    "quote",
    "requestedRepair",
    "status",
    "totalPrice",
  ]);

  // A totéž po hodnotách: jméno zákazníka, telefon ani sériové číslo tam
  // nesmí být ani schované v nějakém poli, kterého si nikdo nevšiml.
  expect(telo).not.toContain(zakaznik);
  expect(telo).not.toContain(telefon);
  expect(telo).not.toContain(SERIOVE);
  // Nákupní cena a technik u položek oprav – zákazník nesmí vidět marži.
  for (const polozka of data.ticket.performedRepairs as Array<Record<string, unknown>>) {
    expect(Object.keys(polozka).sort()).toEqual(["name", "price"]);
  }
  for (const polozka of data.ticket.quote.items as Array<Record<string, unknown>>) {
    expect(Object.keys(polozka).sort()).toEqual(["name", "price"]);
  }
  // Ze stavu jde ven jen „uzavřeno / neuzavřeno“, ne interní název a barva.
  expect(Object.keys(data.ticket.status)).toEqual(["isFinal"]);
});

test("odpověď se nekešuje", async ({ request }) => {
  // Za tokenem jsou osobní údaje – proxy ani prohlížeč je nemají držet.
  const odpoved = await request.get(`${FUNKCE}?t=${encodeURIComponent(token)}`);
  expect(odpoved.headers()["cache-control"]).toContain("no-store");
});

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------

test("zkrácený, prodloužený i cizí token dostanou TOTOŽNOU odpověď", async ({ request }) => {
  // Kdyby se odpovědi lišily stavem, tělem nebo hláškou, dal by se portál
  // použít na zjišťování, které zakázky existují.
  const varianty: Record<string, string> = {
    zkraceny: token.slice(0, -1),
    prodlouzeny: `${token}A`,
    zmenenyZnak: `X${token.slice(1)}`,
    prazdny: "",
    mezery: "   ",
    neexistujici: "a".repeat(32),
    hvezdicka: "*",
    procento: "%",
    prilisDlouhy: "a".repeat(65),
    presNaHranici: "a".repeat(64),
  };

  const odpovedi: Array<{ nazev: string; stav: number; telo: string }> = [];
  for (const [nazev, hodnota] of Object.entries(varianty)) {
    const o = await request.get(`${FUNKCE}?t=${encodeURIComponent(hodnota)}`, { failOnStatusCode: false });
    odpovedi.push({ nazev, stav: o.status(), telo: await o.text() });
  }

  for (const o of odpovedi) {
    expect(o.stav, `${o.nazev} musí vrátit 404`).toBe(404);
    expect(o.telo, `${o.nazev} musí mít stejné tělo`).toBe('{"error":"Odkaz není platný."}');
  }
});

test("chybí-li parametr t úplně, odpověď je stejná", async ({ request }) => {
  const o = await request.get(FUNKCE, { failOnStatusCode: false });
  expect(o.status()).toBe(404);
  expect(await o.text()).toBe('{"error":"Odkaz není platný."}');
});

// ---------------------------------------------------------------------------
// Odolnost
// ---------------------------------------------------------------------------

test("nesmyslný požadavek nikdy nevrátí vnitřek aplikace", async ({ request }) => {
  const nesmysly: Array<{ nazev: string; data: string }> = [
    { nazev: "rozbitý JSON", data: "{tohle neni json" },
    { nazev: "prázdné tělo", data: "" },
    { nazev: "pole místo objektu", data: "[1,2,3]" },
    { nazev: "null", data: "null" },
    { nazev: "číslo", data: "123" },
    { nazev: "bez akce", data: JSON.stringify({ t: token }) },
    { nazev: "cizí akce", data: JSON.stringify({ t: token, action: "delete" }) },
    { nazev: "akce jako objekt", data: JSON.stringify({ t: token, action: { x: 1 } }) },
    { nazev: "obří poznámka", data: JSON.stringify({ t: token, action: "approve", note: "A".repeat(500_000) }) },
    { nazev: "obří token", data: JSON.stringify({ t: "A".repeat(200_000), action: "approve" }) },
  ];

  for (const { nazev, data } of nesmysly) {
    const o = await request.post(FUNKCE, {
      data,
      headers: { "content-type": "application/json" },
      failOnStatusCode: false,
    });
    const telo = await o.text();
    // Nesmí spadnout na 500 s textem výjimky. Hláška jako
    // „clientIp is not defined“ nebo chyba z databáze prozradí cizímu
    // člověku vnitřek aplikace i názvy sloupců.
    expect([400, 404, 409, 429], `${nazev} skončilo ${o.status()}: ${telo}`).toContain(o.status());
    expect(telo, `${nazev} prozradilo vnitřek`).not.toMatch(/is not defined|undefined|SyntaxError|TypeError|at \w+ \(/);
    expect(telo, `${nazev} prozradilo názvy sloupců`).not.toMatch(/portal_token|service_id|quote_status|tickets/);
  }
});

test("nepovolené metody skončí na 405", async ({ request }) => {
  for (const metoda of ["delete", "put", "patch"] as const) {
    const o = await request[metoda](`${FUNKCE}?t=${encodeURIComponent(token)}`, { failOnStatusCode: false });
    expect(o.status(), `${metoda} musí být odmítnuta`).toBe(405);
  }
});

test("z těla požadavku se nedá přepsat cena ani stav", async ({ request }) => {
  // Portál běží pod service_role, takže databázový trigger
  // `enforce_ticket_basic_update_permissions` se na něj nevztahuje
  // (auth.uid() je null). Jediné, co drží, je to, že funkce z těla čte
  // pouze `t`, `action`, `note` a `signature`.
  const pred = await (await request.get(`${FUNKCE}?t=${encodeURIComponent(token)}`)).json();

  await request.post(FUNKCE, {
    data: {
      t: token,
      action: "pickup",
      quote_amount: 1,
      totalPrice: 1,
      estimated_price: 1,
      status: "done",
      performed_repairs: [{ name: "podvrh", price: 1 }],
      customer_phone: "+420000000000",
    },
    failOnStatusCode: false,
  });

  const po = await (await request.get(`${FUNKCE}?t=${encodeURIComponent(token)}`)).json();
  expect(po.ticket.totalPrice).toBe(pred.ticket.totalPrice);
  expect(po.ticket.estimatedPrice).toBe(pred.ticket.estimatedPrice);
  expect(po.ticket.performedRepairs).toEqual(pred.ticket.performedRepairs);
  expect(po.ticket.status).toEqual(pred.ticket.status);
});

test("vyzvednutí ani schválení nejde potvrdit dvakrát", async ({ request }) => {
  // Přeposlaný odkaz, dvojklik nebo opakované odeslání nesmí v zakázce
  // udělat dvě různá vyzvednutí téhož zařízení.
  const prvni = await request.post(FUNKCE, { data: { t: token, action: "pickup" }, failOnStatusCode: false });
  // Portál má trvalý limit na volajícího; při běhu celé sady se vyčerpá a test
  // by pak padal na 429 místo na chování, které má hlídat.
  test.skip(prvni.status() === 429, "Vyčerpaný limit portálu (120/min z adresy).");
  const druhy = await request.post(FUNKCE, { data: { t: token, action: "pickup" }, failOnStatusCode: false });
  test.skip(druhy.status() === 429, "Vyčerpaný limit portálu (120/min z adresy).");
  // První potvrzení mohlo proběhnout už v předchozím testu – podstatné je,
  // že po prvním úspěchu je každý další pokus odmítnutý.
  expect([200, 409]).toContain(prvni.status());
  expect(druhy.status(), "druhé potvrzení musí být odmítnuto").toBe(409);

  // Nabídku schválíme a hned zkusíme zamítnout. Kdyby druhý zápis prošel,
  // v zakázce by byly quote_approved i quote_rejected zároveň.
  const schvaleni = await request.post(FUNKCE, { data: { t: token, action: "approve" }, failOnStatusCode: false });
  expect([200, 409]).toContain(schvaleni.status());
  const zamitnuti = await request.post(FUNKCE, { data: { t: token, action: "reject" }, failOnStatusCode: false });
  expect(zamitnuti.status(), "zamítnout už rozhodnutou nabídku nejde").toBe(409);
  const znovu = await request.post(FUNKCE, { data: { t: token, action: "approve" }, failOnStatusCode: false });
  test.skip(znovu.status() === 429, "Vyčerpaný limit portálu (120/min z adresy).");
  expect(znovu.status(), "schválit dvakrát nejde").toBe(409);

  const po = await (await request.get(`${FUNKCE}?t=${encodeURIComponent(token)}`)).json();
  expect(po.ticket.quote.status).toBe("approved");
});

// ---------------------------------------------------------------------------
// XSS ve vykreslování
//
// Nad podvrženou odpovědí a statikou z repozitáře: testuje se, co udělá
// `web/z/portal.js` s textem, který mu někdo pošle.
// ---------------------------------------------------------------------------

const TYPY: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

/** Statické soubory portálu z repozitáře, na adrese, kterou dostane zákazník. */
async function servirujStatiku(page: Page): Promise<void> {
  await page.route(/^https:\/\/appjobi\.com\//, async (route) => {
    const url = new URL(route.request().url());
    let rel = url.pathname.replace(/^\/+/, "");
    if (rel === "" || rel.endsWith("/")) rel += "index.html";
    const soubor = path.resolve(WEB, rel);
    if (!soubor.startsWith(WEB + path.sep) || !fs.existsSync(soubor)) {
      await route.fulfill({ status: 404, contentType: "text/plain", body: "nenalezeno" });
      return;
    }
    await route.fulfill({
      status: 200,
      headers: { "content-type": TYPY[path.extname(soubor)] ?? "application/octet-stream" },
      body: fs.readFileSync(soubor),
    });
  });
}

test("skript v poznámce, jménu ani zařízení se nespustí", async ({ browser }) => {
  const kontext = await browser.newContext({ locale: "cs-CZ" });
  const stranka = await kontext.newPage();
  const vyskocilo: string[] = [];
  stranka.on("dialog", async (d) => {
    vyskocilo.push(d.message());
    await d.dismiss();
  });
  const chyby: string[] = [];
  stranka.on("pageerror", (e) => chyby.push(String(e)));

  const UTOK = '<script>alert("xss")</script><img src=x onerror=alert("xss2")>';
  try {
    await servirujStatiku(stranka);
    // Odpověď funkce je podvržená – do ostré databáze se nesahá.
    await stranka.route(/portal-ticket/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({
          ok: true,
          ticket: {
            code: `E2E${UTOK}`,
            createdAt: "2026-09-01T08:00:00.000Z",
            expectedCompletionAt: null,
            deviceLabel: `iPhone ${UTOK}`,
            requestedRepair: `Rozbitý displej ${UTOK}`,
            status: { isFinal: false },
            photosBefore: [],
            photos: [],
            performedRepairs: [{ name: `Oprava ${UTOK}`, price: 3500 }],
            discount: null,
            totalPrice: 3500,
            estimatedPrice: null,
            quote: { amount: 3500, items: [{ name: UTOK, price: 3500 }], note: UTOK, status: "sent", sentAt: null, decidedAt: null },
            intakeSignedAt: null,
            intakeSignatureUrl: null,
            handoffMethod: null,
            handbackMethod: null,
          },
          service: { name: `Servis ${UTOK}`, branch: UTOK, openingHours: UTOK, phone: UTOK, email: UTOK, website: UTOK, addressStreet: UTOK, addressCity: UTOK, addressZip: UTOK, bankAccount: null, iban: null },
          payment: null,
        }),
      });
    });

    await stranka.goto("https://appjobi.com/z/?t=nezalezi-je-to-podvrzene");
    await expect(stranka.getByText("Cenová nabídka").first()).toBeVisible({ timeout: 30_000 });

    // Nic se nespustilo a do stránky se nedostal žádný cizí <script> ani
    // <img onerror> – text se vykreslil jako text.
    expect(vyskocilo, "portál spustil skript z odpovědi").toEqual([]);
    expect(chyby).toEqual([]);
    const vlozene = await stranka.evaluate(() => ({
      skripty: [...document.querySelectorAll("script")].filter((s) => /alert\(/.test(s.textContent ?? "")).length,
      obrazky: document.querySelectorAll("img[onerror]").length,
    }));
    expect(vlozene).toEqual({ skripty: 0, obrazky: 0 });
    // A zároveň se text opravdu zobrazil, jen neškodně.
    await expect(stranka.getByText(UTOK, { exact: false }).first()).toBeVisible();
  } finally {
    await kontext.close();
  }
});

// ---------------------------------------------------------------------------
// Odvolání přístupu
// ---------------------------------------------------------------------------

test("po smazání zakázky do koše odkaz přestane platit", async ({ page, request }) => {
  test.setTimeout(150_000);
  // Před smazáním odkaz ještě platí – jinak by test níž prošel i omylem.
  expect((await request.get(`${FUNKCE}?t=${encodeURIComponent(token)}`, { failOnStatusCode: false })).status()).toBe(200);

  await prihlasSe(page);
  await vidZakazku(page, kod).first().click();
  await page.getByRole("button", { name: "Další akce" }).first().click();
  await page.getByText("Smazat zakázku").first().click();
  await page.getByRole("button", { name: "Smazat", exact: true }).click();
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 30_000 });
  await expect(vidZakazku(page, kod)).toHaveCount(0, { timeout: 30_000 });

  // Stejná odpověď jako u neznámého tokenu – navenek se nesmí poznat,
  // že zakázka existovala a skončila v koši.
  const o = await request.get(`${FUNKCE}?t=${encodeURIComponent(token)}`, { failOnStatusCode: false });
  expect(o.status()).toBe(404);
  expect(await o.text()).toBe('{"error":"Odkaz není platný."}');

  // A zapisovat do ní taky nejde. 429 znamená vyčerpaný limit portálu
  // (sada střílí hodně požadavků z jedné adresy) – to není chování, které
  // tenhle test hlídá, takže se v tom případě jen přeskočí zbytek.
  for (const action of ["approve", "reject", "sign", "pickup"]) {
    const zapis = await request.post(FUNKCE, { data: { t: token, action }, failOnStatusCode: false });
    test.skip(zapis.status() === 429, "Vyčerpaný limit portálu (120/min z adresy).");
    expect(zapis.status(), `${action} do smazané zakázky`).toBe(404);
  }
});

// ---------------------------------------------------------------------------
// Limit požadavků
//
// Schválně za přepínačem: sada střílí stovky požadavků na ostrou funkci a na
// minutu vyčerpá limit pro celou adresu, takže by shodila testy za sebou.
// Pouští se ručně: `E2E_PORTAL_LIMIT=1 npx playwright test portal-bezpecnost`.
// ---------------------------------------------------------------------------

test("limit požadavků zavře hádání tokenů", async ({ request }) => {
  test.skip(!process.env.E2E_PORTAL_LIMIT, "Střílí stovky požadavků na ostrou funkci – jen ručně.");
  test.setTimeout(120_000);

  // Hádání tokenů: každý pokus má jiný token, takže limit na token se nikdy
  // nespustí. Musí ho zavřít trvalý limit na otisk volajícího.
  const pokusy = await Promise.all(
    Array.from({ length: 300 }, (_, i) =>
      request.get(`${FUNKCE}?t=${String(i).padStart(32, "b")}`, { failOnStatusCode: false }).then((o) => o.status()),
    ),
  );
  expect(pokusy.filter((s) => s === 429).length, "hádání tokenů musí narazit na limit").toBeGreaterThan(0);
  expect(pokusy.filter((s) => s === 404).length, "limit nesmí být tak nízký, že portál nefunguje").toBeGreaterThan(50);

  // Limit se nedá obejít podvrženou hlavičkou s cizí adresou: před funkcí
  // stojí Cloudflare a `cf-connecting-ip` si přepisuje samo, `x-forwarded-for`
  // se čte od konce.
  for (const hlavicka of ["x-forwarded-for", "x-real-ip", "true-client-ip"]) {
    const o = await request.get(`${FUNKCE}?t=${"c".repeat(32)}`, {
      headers: { [hlavicka]: "9.9.9.9" },
      failOnStatusCode: false,
    });
    expect(o.status(), `${hlavicka} nesmí limit obejít`).toBe(429);
  }
});
