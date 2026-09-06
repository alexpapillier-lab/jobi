import { test, expect, type Page, type Route } from "@playwright/test";
import { prihlasSe, SERVIS } from "./pomocnici";

/**
 * SMS chaty v aplikaci: co uživatel uvidí, když je balíček vyčerpaný.
 *
 * ODSUD NEODEJDE ANI JEDNA SMS. Twilio číslo je dnes neplatné a odesílání
 * stojí peníze, takže se edge funkce `sms-send` v těchhle testech nikdy
 * nezavolá doopravdy – `page.route` ji zachytí a odpoví místo ní. Pojistka
 * `zakazSit` navíc shodí test, kdyby se cokoli pokusilo sáhnout přímo na
 * api.twilio.com nebo api.resend.com.
 *
 * Testovací servis SMS zřízené nemá (číslo se kupuje a platí měsíčně), takže
 * se předstírá i telefonní číslo a nárok na modul – jinak by se obrazovka
 * SMS chatů vůbec nevykreslila. Data v databázi se přitom nemění: všechno
 * jsou odpovědi podstrčené v prohlížeči.
 *
 * Co se tu ověřuje doopravdy: že se hláška ze serveru dostane k uživateli
 * celá (ne jako „Chyba 402“) a že rozepsaný text zůstane v políčku, aby se
 * dal poslat znovu po přechodu na vyšší tarif.
 */

const CISLO_SERVISU = "+420700000000";
const KONVERZACE = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const TELEFON = "+420777123456";
const HLASKA_VYCERPANO =
  "Balíček SMS je vyčerpaný (300 z 300 za tento měsíc). Další zprávy půjdou odeslat po přechodu na vyšší tarif nebo od příštího měsíce.";

/** Odpoví jako PostgREST: `.maybeSingle()` chce objekt, běžný select pole. */
async function odpovez(route: Route, radky: unknown[]): Promise<void> {
  const accept = route.request().headers()["accept"] ?? "";
  const jeden = accept.includes("pgrst.object");
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify(jeden ? radky[0] ?? null : radky),
  });
}

/** Cokoli jiného než čtení (PATCH read_at, doplnění jména) jen odkývne. */
async function prazdneOk(route: Route): Promise<void> {
  await route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" }, body: "" });
}

/**
 * Tvrdá pojistka: kdyby se cokoli pokusilo obejít mock a jít rovnou
 * k poskytovateli, test spadne místo toho, aby poslal zprávu.
 */
async function zakazSit(page: Page, poruseni: string[]): Promise<void> {
  for (const vzor of ["**://api.twilio.com/**", "**://api.resend.com/**"]) {
    await page.route(vzor, async (route) => {
      poruseni.push(route.request().url());
      await route.abort();
    });
  }
}

/**
 * Předstírá zřízené SMS: telefonní číslo servisu, nárok na modul a jednu
 * konverzaci. Nároky se berou skutečné a jen se k nim přidá `sms` – kdyby
 * se podstrčily celé, přišel by servis v aplikaci o zbytek modulů.
 */
async function predstirejSms(page: Page): Promise<void> {
  await page.route(/\/rest\/v1\/service_phone_numbers/, (route) =>
    odpovez(route, [{ id: "e2e-sms", service_id: SERVIS.id, twilio_number: CISLO_SERVISU, active: true }]),
  );

  await page.route(/\/rest\/v1\/service_entitlements/, async (route) => {
    const odpoved = await route.fetch();
    let telo: unknown;
    try {
      telo = await odpoved.json();
    } catch {
      telo = [];
    }
    const radky = Array.isArray(telo) ? [...telo] : [];
    if (!radky.some((r) => (r as { module?: string }).module === "sms")) {
      radky.push({ module: "sms", active: true, valid_until: null, quota: 300 });
    }
    await route.fulfill({ response: odpoved, body: JSON.stringify(radky) });
  });

  await page.route(/\/rest\/v1\/sms_conversations/, async (route) => {
    if (route.request().method() !== "GET") return prazdneOk(route);
    await odpovez(route, [
      {
        id: KONVERZACE,
        service_id: SERVIS.id,
        customer_phone: TELEFON,
        customer_name: "E2E Vyčerpaný balíček",
        ticket_id: null,
        updated_at: new Date().toISOString(),
        archived: false,
      },
    ]);
  });

  await page.route(/\/rest\/v1\/sms_messages/, async (route) => {
    if (route.request().method() !== "GET") return prazdneOk(route);
    await odpovez(route, [
      {
        id: "11111111-1111-1111-1111-111111111111",
        conversation_id: KONVERZACE,
        direction: "inbound",
        body: "Dobry den, je uz zakazka hotova?",
        sent_at: new Date(Date.now() - 3_600_000).toISOString(),
        read_at: new Date().toISOString(),
        status: null,
      },
    ]);
  });
}

/**
 * Otevře SMS chaty a vybere předstíranou konverzaci.
 *
 * Na lištu se nejdřív najede myší: sbalená lišta se při najetí rozbalí a
 * tlačítka se přitom posunou. Klik bez najetí dopadne do místa, kde tlačítko
 * bylo před rozbalením, a nic se nestane.
 */
async function otevriChat(page: Page): Promise<void> {
  await page.locator('[aria-label="Hlavní navigace"]').first().hover();
  const polozka = page.getByRole("button", { name: "SMS chaty" }).first();
  await expect(polozka).toBeVisible();
  await page.waitForTimeout(700); // dokud lišta neustálí šířku
  await polozka.click();
  // Myš pryč z lišty, ať se zase sbalí – rozbalená leží přes seznam
  // konverzací a klik do něj by dopadl na ni.
  await page.mouse.move(900, 500);
  await page.waitForTimeout(700);
  await expect(page.getByText("E2E Vyčerpaný balíček").first()).toBeVisible();
  await page.getByText("E2E Vyčerpaný balíček").first().click();
  await expect(page.getByPlaceholder("Napište zprávu…")).toBeVisible();
}

test.describe("SMS chaty", () => {
  test("vyčerpaný balíček: uživatel uvidí celou hlášku a text mu zůstane", async ({ page }) => {
    const poruseni: string[] = [];
    await zakazSit(page, poruseni);
    await predstirejSms(page);

    // Odeslání se nikam neposílá – edge funkce odpoví přesně tím, co vrací
    // sms-send při vyčerpaném balíčku (402 + quota_exceeded).
    const pokusy: string[] = [];
    await page.route("**/functions/v1/sms-send", async (route) => {
      pokusy.push(route.request().postData() ?? "");
      await route.fulfill({
        status: 402,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ error: HLASKA_VYCERPANO, quota_exceeded: true, used: 300, limit: 300 }),
      });
    });

    await prihlasSe(page);
    await otevriChat(page);

    const policko = page.getByPlaceholder("Napište zprávu…");
    await policko.fill("Vaše zakázka je hotová, můžete si ji vyzvednout.");
    await page.getByRole("button", { name: "Odeslat" }).click();

    // Hláška o vyčerpaném balíčku musí dojít celá: uživatel z ní pozná, že
    // nemá klikat znovu, ale připlatit si nebo počkat na nový měsíc.
    await expect(page.getByText(/Balíček SMS je vyčerpaný/)).toBeVisible();
    await expect(page.getByText(/vyšší tarif/)).toBeVisible();

    // Rozepsaný text se vrátí do políčka – jinak by ho uživatel psal znovu.
    await expect(policko).toHaveValue("Vaše zakázka je hotová, můžete si ji vyzvednout.");

    /* A neodeslaná zpráva nesmí zůstat viset v chatu jako odeslaná – jinak
       by si servis myslel, že zákazník ví. Hledá se bublina (div); samotný
       text najde `getByText` i v políčku, kam se právě vrátil. */
    const bublina = page.getByText("Vaše zakázka je hotová, můžete si ji vyzvednout.", { exact: true }).and(page.locator("div"));
    await expect(bublina).toHaveCount(0);

    expect(pokusy, "aplikace poslala právě jeden požadavek na sms-send").toHaveLength(1);
    expect(poruseni, "nic nesmí jít přímo k poskytovateli").toEqual([]);
  });

  test("chyba poskytovatele se ukáže i s podrobností, ne jako holý kód", async ({ page }) => {
    const poruseni: string[] = [];
    await zakazSit(page, poruseni);
    await predstirejSms(page);

    await page.route("**/functions/v1/sms-send", (route) =>
      route.fulfill({
        status: 502,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ error: "Twilio error", detail: "Unreachable destination handset", code: 30003 }),
      }),
    );

    await prihlasSe(page);
    await otevriChat(page);

    await page.getByPlaceholder("Napište zprávu…").fill("Zkouška");
    await page.getByRole("button", { name: "Odeslat" }).click();

    await expect(page.getByText(/Unreachable destination handset/)).toBeVisible();
    expect(poruseni).toEqual([]);
  });

  test("zpráva, která projde, se ukáže v chatu", async ({ page }) => {
    const poruseni: string[] = [];
    await zakazSit(page, poruseni);
    await predstirejSms(page);

    await page.route("**/functions/v1/sms-send", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({
          message_id: "22222222-2222-2222-2222-222222222222",
          conversation_id: KONVERZACE,
          twilio_sid: "SM_e2e_test",
        }),
      }),
    );

    await prihlasSe(page);
    await otevriChat(page);

    const policko = page.getByPlaceholder("Napište zprávu…");
    await policko.fill("Zakazka je hotova, muzete si ji vyzvednout.");
    await page.getByRole("button", { name: "Odeslat" }).click();

    await expect(page.getByText("Zakazka je hotova, muzete si ji vyzvednout.")).toBeVisible();
    // Políčko se vyprázdní, ať se stejná zpráva neodešle dvakrát.
    await expect(policko).toHaveValue("");
    expect(poruseni).toEqual([]);
  });
});
