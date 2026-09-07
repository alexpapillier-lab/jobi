import { test, expect, type Page } from "@playwright/test";
import { SERVIS, prihlasSe, testovaciJmeno, vidZakazku, zalozZakazku } from "./pomocnici";

/**
 * Konec zkušebního období a placené moduly.
 *
 * Dvě chyby se tu platí draho a obě vypadají navenek nenápadně: zamčená
 * aplikace, do které se platící zákazník nedostane ke svým datům, a odemčená
 * aplikace, za kterou nikdo neplatí. Test proto jde po obou stranách.
 *
 * **Nároky testovacího servisu se nemění.** Musí zůstat trvalé, jinak
 * spadnou všechny ostatní testy. Vypršení se podstrčí odpovědí na dotaz na
 * `service_entitlements` (`page.route`) – aplikace nepozná rozdíl, protože
 * jinou cestou se to nedozví, a databáze zůstane, jak byla. Že se nároky
 * hlídají i na serveru, se ověřuje voláním rozhraní napřímo, ne přepisem
 * odpovědi.
 */

/** Dotaz aplikace na nároky servisu. Glob s hvězdičkou se o dotazovací část URL rozbije. */
const DOTAZ_NA_NAROKY = /\/rest\/v1\/service_entitlements/;

type Narok = { module: string; active: boolean; valid_until: string | null; quota: number | null };

function narok(module: string, valid_until: string | null = null, quota: number | null = null): Narok {
  return { module, active: true, valid_until, quota };
}

/** Podstrčí odpověď na nároky, ať se dá vyzkoušet stav, který v databázi nastat nesmí. */
async function podstrcNaroky(page: Page, naroky: Narok[]): Promise<void> {
  await page.route(DOTAZ_NA_NAROKY, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(naroky),
    }),
  );
}

function zaVterin(s: number): string {
  return new Date(Date.now() + s * 1000).toISOString();
}

/**
 * Nastavení → Firma → Předplatné.
 *
 * Do nastavení se skáče událostí aplikace a v nich se hledá – postranní lišta
 * se při najetí myší rozbalí přes obsah a klik do ní se mine (viz
 * nastaveni.spec.ts).
 */
async function otevriPredplatne(page: Page): Promise<void> {
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "settings" } })),
  );
  const hledani = page.getByPlaceholder("Hledat v nastavení…");
  await expect(hledani).toBeVisible({ timeout: 20_000 });
  await hledani.fill("předplatné");
  await page.getByRole("button", { name: /Předplatné/ }).first().click();
  await hledani.fill("");
}

/** Trvalé nároky testovacího servisu tak, jak jsou doopravdy v databázi. */
const TRVALE = ["access", "invoices", "accounting", "branches", "api_catalog", "api_inventory"].map((m) => narok(m));

/**
 * Adresa a klíče, se kterými aplikace mluví se Supabase – odposlechnuté
 * z jejích vlastních požadavků. Anon klíč se do balíčku zapéká při buildu
 * a na `window` není, takže jinak by test nemohl sáhnout na stejná rozhraní
 * jako aplikace. Stejný postup jako v `servisy.spec.ts`.
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
    // Před přihlášením posílá klient v hlavičce anon klíč; s tím by se volání
    // edge funkcí tvářilo jako nepřihlášené a 403 by nic nedokazovala.
    const auth = h["authorization"];
    if (auth && auth.replace(/^Bearer\s+/i, "") !== h["apikey"]) stav.authorization = auth;
  });
  return stav;
}

test.describe("Vypršení přístupu", () => {
  test("po konci zkušebního období se aplikace zamkne a řekne, co dál", async ({ page }) => {
    await prihlasSe(page);
    // Že se zakázky načetly, musí platit ještě před podstrčením – jinak by
    // test níž nedokázal, že o data servis nepřišel.
    await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible();

    await podstrcNaroky(page, [narok("access", zaVterin(-86_400)), narok("invoices", zaVterin(-86_400))]);
    await page.reload();

    await expect(page.getByRole("heading", { name: "Zkušební období skončilo" })).toBeVisible();
    // Zákazník musí vidět, co má dělat, a že o data nepřišel.
    await expect(page.getByText(/Zakázky, zákazníci i sklad zůstávají uložené/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Vybrat plán" }).or(page.getByRole("link", { name: "Napsat nám o plán" })),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Odhlásit se" })).toBeVisible();
    // Zamčeno znamená zamčeno: pod obrazovkou nesmí zůstat použitelná aplikace.
    await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toHaveCount(0);
  });

  test("po obnovení nároku je práce na svém místě", async ({ page }) => {
    await prihlasSe(page);
    const zakaznik = testovaciJmeno("Nárok");
    const kod = await zalozZakazku(page, { zakaznik, zarizeni: "iPhone 12" });

    await podstrcNaroky(page, [narok("access", zaVterin(-86_400))]);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Zkušební období skončilo" })).toBeVisible();

    // Nárok obnoven → aplikace se otevře a zakázka je tam, kde byla.
    await page.unroute(DOTAZ_NA_NAROKY);
    await podstrcNaroky(page, TRVALE);
    await page.reload();
    await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible();
    await expect(vidZakazku(page, kod).first()).toBeVisible({ timeout: 30_000 });
  });

  test("poslední den zkušebního období se pracuje dál, jen s varováním", async ({ page }) => {
    await prihlasSe(page);
    // Zbývá dvanáct hodin – tedy „1 den“. Aplikace se zamyká až po konci.
    await podstrcNaroky(page, [narok("access", zaVterin(12 * 3600)), narok("invoices", zaVterin(12 * 3600))]);
    await page.reload();

    await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible();
    await expect(page.getByText(/Zkušební období končí za 1 den/)).toBeVisible();
    await expect(page.getByText(/Data zůstanou uložená/)).toBeVisible();
  });

  /**
   * Servis s trvalými nároky nesmí nic odpočítávat. Proužek se zkušebním
   * obdobím se dřív ukazoval podle nejzazšího data ze všech modulů, takže
   * platícímu servisu s doplňkem na dobu určitou tvrdil, že se mu aplikace
   * za pár dní zamkne. Nezamkla; jen ho to strašilo.
   */
  test("doplněk na dobu určitou nedělá ze zaplaceného servisu zkušební", async ({ page }) => {
    await prihlasSe(page);
    await podstrcNaroky(page, [narok("access"), narok("invoices"), narok("sms", zaVterin(3 * 86_400), 300)]);
    await page.reload();
    await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible();

    // Nejdřív se počká, až obrazovka Předplatné doopravdy stojí na
    // podstrčených nárocích – bez toho by „nikde není zkušební období"
    // prošlo i v okamžiku, kdy se nároky ještě nenačetly.
    await otevriPredplatne(page);
    await expect(page.getByText("Aktivní bez omezení")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/300 zpráv/)).toBeVisible();
    await expect(page.getByText(/Zkušební období/)).toHaveCount(0);
  });

  /**
   * Výpadek při načítání nároků není konec předplatného. Dřív stačilo, aby
   * jeden dotaz spadl na uspaném spojení, a aplikace platícímu servisu
   * oznámila, že mu skončilo zkušební období, a zamkla ho mimo vlastní data.
   */
  test("výpadek při načítání nároků aplikaci nezamkne", async ({ page }) => {
    await prihlasSe(page);
    await page.route(DOTAZ_NA_NAROKY, (route) => route.abort("failed"));
    await page.reload();

    await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Zkušební období skončilo" })).toHaveCount(0);
  });
});

test.describe("Nároky se hlídají na serveru, ne jen v aplikaci", () => {
  test("bez modulu SMS neprojde odeslání ani voláním rozhraní napřímo", async ({ page }) => {
    const p = odposlechniSupabase(page);
    await prihlasSe(page);
    expect(p.origin, "Nezachytila se adresa Supabase.").toBeTruthy();
    expect(p.authorization, "Nezachytila se autorizace přihlášeného účtu.").toBeTruthy();

    // Testovací servis nemá modul `sms`. Aplikace tlačítko schová, ale to nic
    // neznamená – rozhoduje, co udělá server.
    const res = await page.request.post(`${p.origin}/functions/v1/sms-send`, {
      headers: { "Content-Type": "application/json", apikey: p.apikey!, Authorization: p.authorization! },
      data: { service_id: SERVIS.id, to: "+420777000000", body: "E2E" },
      failOnStatusCode: false,
    });
    expect(res.status(), "SMS bez nároku musí server odmítnout").toBe(403);
  });

  /**
   * Zkušební období se nesmí dát prodloužit z klienta. Kdyby to šlo, celé
   * předplatné by byla jen dekorace: stačí jeden dotaz z konzole prohlížeče.
   */
  test("nárok nejde z klienta založit ani přepsat", async ({ page }) => {
    const p = odposlechniSupabase(page);
    await prihlasSe(page);
    const hlavicky = { "Content-Type": "application/json", apikey: p.apikey!, Authorization: p.authorization! };

    const vlozeni = await page.request.post(`${p.origin}/rest/v1/service_entitlements`, {
      headers: hlavicky,
      data: { service_id: SERVIS.id, module: "consolidated", active: true, valid_until: null },
      failOnStatusCode: false,
    });
    expect(vlozeni.status(), "Založení nároku z klienta musí RLS odmítnout").toBeGreaterThanOrEqual(400);

    const zmena = await page.request.patch(
      `${p.origin}/rest/v1/service_entitlements?service_id=eq.${SERVIS.id}&module=eq.access`,
      { headers: hlavicky, data: { note: "E2E pokus o prodloužení" }, failOnStatusCode: false },
    );
    // PostgREST vrátí u zákazu buď 403, nebo 204 bez jediného změněného řádku.
    if (zmena.status() < 400) {
      const kontrola = await page.request.get(
        `${p.origin}/rest/v1/service_entitlements?service_id=eq.${SERVIS.id}&module=eq.access&select=note`,
        { headers: hlavicky },
      );
      const radky = (await kontrola.json()) as { note: string | null }[];
      expect(radky[0]?.note, "Poznámka nároku se z klienta přepsat nesmí").not.toBe("E2E pokus o prodloužení");
    }
  });
});

test.describe("Owner panel je jen pro majitele aplikace", () => {
  test("běžný účet nemá Owner v nastavení ani přes hledání", async ({ page }) => {
    await prihlasSe(page);
    // Do nastavení se skáče událostí aplikace, ne klikem do postranní lišty –
    // ta se při najetí myší rozbalí přes obsah (viz nastaveni.spec.ts).
    await page.evaluate(() =>
      window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "settings" } })),
    );
    const hledani = page.getByPlaceholder("Hledat v nastavení…");
    await expect(hledani).toBeVisible({ timeout: 20_000 });
    await hledani.fill("owner");
    await expect(page.getByRole("button", { name: "Owner", exact: true })).toHaveCount(0);
    await hledani.fill("");
  });

  /**
   * Schovaná položka v menu není hranice. Edge funkce, které spravují servisy
   * a nároky, musí běžný účet odmítnout – jinak by si každý zákazník mohl
   * zapnout moduly nebo si stáhnout data cizího servisu.
   *
   * Volají se schválně jen akce, které nic nemění: kdyby se ochrana rozbila,
   * test to má poznat, ne způsobit.
   */
  test("edge funkce pro správu servisů a nároků vracejí běžnému účtu 403", async ({ page }) => {
    const p = odposlechniSupabase(page);
    await prihlasSe(page);
    const hlavicky = { "Content-Type": "application/json", apikey: p.apikey!, Authorization: p.authorization! };

    const naroky = await page.request.post(`${p.origin}/functions/v1/entitlements-manage`, {
      headers: hlavicky,
      data: { action: "list" },
      failOnStatusCode: false,
    });
    expect(naroky.status(), "Výpis nároků všech servisů smí jen majitel aplikace").toBe(403);

    const export_ = await page.request.post(`${p.origin}/functions/v1/service-manage`, {
      headers: hlavicky,
      data: { action: "export", serviceId: SERVIS.id },
      failOnStatusCode: false,
    });
    expect(export_.status(), "Export dat servisu smí jen majitel aplikace").toBe(403);

    const chyby = await page.request.post(`${p.origin}/functions/v1/error-logs-list`, {
      headers: hlavicky,
      data: {},
      failOnStatusCode: false,
    });
    expect(chyby.status(), "Hlášení chyb všech servisů smí jen majitel aplikace").toBe(403);
  });
});

test("po odebrání ze servisu se neukáže zámek předplatného", async ({ page }) => {
  /*
   * Majitel odebral člověka ze servisu; v jeho prohlížeči zůstalo id toho
   * servisu. Nároky se pak nenačtou (RLS ho už nepustí) a aplikace mu hlásila
   * „Zkušební období skončilo“ u servisu bez názvu – vyhozený zaměstnanec tak
   * dostal zprávu, že má zaplatit. Testuje se servisem, do kterého testovací
   * účet nepatří; chová se to stejně jako po odebrání.
   */
  const CIZI = "bbc926bd-25ba-4da1-b528-92b6f1dee24d"; // TEST2 – e2e účet v něm není
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), ["jobsheet_active_service_id_v1", CIZI]);
  await prihlasSe(page);

  await expect(page.getByText("Zkušební období skončilo")).toHaveCount(0);
  // Aplikace se přepne do servisu, kde členem je, a jde v ní pracovat.
  await expect(page.getByRole("button", { name: "+ Nová zakázka" })).toBeVisible({ timeout: 45_000 });
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("jobsheet_active_service_id_v1")), { timeout: 30_000 })
    .not.toBe(CIZI);
});

