import { test, expect, request as novaZadost, type APIRequestContext, type Page } from "@playwright/test";
import { prihlasSe, SERVIS, testovaciJmeno, zalozZakazku } from "./pomocnici";

/**
 * Čísla ve Statistikách proti databázi.
 *
 * `statistiky.spec.ts` ověřuje, že stránka reaguje (přibude zakázka, změní se
 * období). Tenhle test jde po samotných číslech – podle nich majitel dílny
 * staví ceny a rozděluje prémie, takže „skoro správně“ tu nestačí.
 *
 * Ověřené případy odpovídají tomu, co se v ostrých datech opravdu rozcházelo:
 *   1) stornovaná zakázka se počítala do tržeb (7 550 Kč u iSwapu),
 *   2) pevná sleva vyšší než cena oprav se vykazovala celá a marži hnala
 *      hluboko pod nulu,
 *   3) nezastavené stopky rostly do konce období a nafoukly hodiny technika,
 *   4) v kartách svítilo „za vybrané období tu zatím nic není“ i nad plnými
 *      Statistikami.
 *
 * Test se schválně nevěší na absolutní čísla servisu: E2E servis je společný
 * a data v něm přibývají i z jiných testů. Vlastní zakázky si proto vyčleňuje
 * unikátním názvem zařízení a čte je přes rozpad (`p_drill_typ = 'device'`),
 * takže na souběžné zápisy nesahá.
 *
 * POZOR: opravy jsou v migraci `20260912170000_statistiky_cisla_sedi.sql`.
 * Dokud nedojede (`npm run db:migrate`), počítá ostrá databáze postaru a test
 * se sám přeskočí s vysvětlením – zeleně by tvrdil, že čísla sedí, i když
 * nesedí.
 */
test.describe.configure({ mode: "serial" });

type Relace = { url: string; apikey: string; token: string; uid: string };

const stav: {
  relace?: Relace;
  api?: APIRequestContext;
  /** Unikátní název zařízení – klíč rozpadu, kterým se test odděluje od cizích dat. */
  zarizeni?: string;
  zakazky: string[];
  usek?: string;
} = { zakazky: [] };

function obsahTokenu(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
}

/**
 * Přihlásí se v prohlížeči a odchytí z odchozích požadavků klíč projektu
 * i token přihlášeného. Token se nebere z localStorage – jeho formát se mezi
 * verzemi supabase-js mění, hlavičky požadavků ne.
 */
async function prihlasSeAOdchytRelaci(page: Page): Promise<Relace> {
  const zachyt: { url?: string; apikey?: string; token?: string } = {};
  page.on("request", (r) => {
    if (!r.url().includes("/rest/v1/")) return;
    const h = r.headers();
    if (h["apikey"]) zachyt.apikey = h["apikey"];
    const auth = h["authorization"];
    if (auth?.startsWith("Bearer ")) zachyt.token = auth.slice("Bearer ".length);
    zachyt.url = new URL(r.url()).origin;
  });

  await prihlasSe(page);
  await expect
    .poll(() => (zachyt.token ? String(obsahTokenu(zachyt.token).role ?? "") : null), {
      timeout: 30_000,
      message: "Z aplikace nepřišel požadavek s tokenem přihlášeného uživatele.",
    })
    .toBe("authenticated");

  return { url: zachyt.url!, apikey: zachyt.apikey!, token: zachyt.token!, uid: String(obsahTokenu(zachyt.token!).sub) };
}

function hlavicky(): Record<string, string> {
  return {
    apikey: stav.relace!.apikey,
    Authorization: `Bearer ${stav.relace!.token}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
}

async function cti<T = Record<string, unknown>>(cesta: string): Promise<T[]> {
  const o = await stav.api!.get(`${stav.relace!.url}/rest/v1/${cesta}`, { headers: hlavicky() });
  expect(o.status(), `GET ${cesta}: ${await o.text()}`).toBeLessThan(300);
  return (await o.json()) as T[];
}

async function zapis(zpusob: "POST" | "PATCH", cesta: string, telo: unknown): Promise<unknown[]> {
  const adresa = `${stav.relace!.url}/rest/v1/${cesta}`;
  const nastaveni = { headers: hlavicky(), data: telo as never };
  const o = zpusob === "POST" ? await stav.api!.post(adresa, nastaveni) : await stav.api!.patch(adresa, nastaveni);
  expect(o.status(), `${zpusob} ${cesta}: ${await o.text()}`).toBeLessThan(300);
  const t = await o.text();
  try {
    const j = JSON.parse(t);
    return Array.isArray(j) ? j : [j];
  } catch {
    return [];
  }
}

type Kpi = {
  totalTickets: number;
  totalRevenue: number;
  totalCosts: number;
  totalDiscounts: number;
  profit: number;
  marginPct: number;
  averageTicketPrice: number;
  averageTicketDurationDays: number;
};

/** KPI jen za zakázky s naším názvem zařízení – rozpad, jaký dělá i klik ve stránce. */
async function kpiZaMojeZakazky(): Promise<Kpi> {
  const o = await stav.api!.post(`${stav.relace!.url}/rest/v1/rpc/statistiky_prehled`, {
    headers: hlavicky(),
    data: {
      p_service_ids: [SERVIS.id],
      p_drill_typ: "device",
      p_drill_hodnota: stav.zarizeni,
      p_tz: "Europe/Prague",
    } as never,
  });
  expect(o.status(), `statistiky_prehled: ${await o.text()}`).toBeLessThan(300);
  return (await o.json()).kpi as Kpi;
}

async function technici(): Promise<Array<{ userId: string | null; odpracovanoHodin: number; bezicichUseku: number }>> {
  const o = await stav.api!.post(`${stav.relace!.url}/rest/v1/rpc/statistiky_technici`, {
    headers: hlavicky(),
    data: { p_service_ids: [SERVIS.id] } as never,
  });
  expect(o.status(), `statistiky_technici: ${await o.text()}`).toBeLessThan(300);
  return (await o.json()) as Array<{ userId: string | null; odpracovanoHodin: number; bezicichUseku: number }>;
}

const mojeHodiny = async (): Promise<number> =>
  (await technici()).find((t) => t.userId === stav.relace!.uid)?.odpracovanoHodin ?? 0;

/**
 * Je v databázi migrace s opravami? Pozná se podle klíče `bezicichUseku`,
 * který stará verze `statistiky_technici` neposílá. Bez ní se testy
 * přeskočí – jinak by hlásily chybu v kódu tam, kde chybí jen nasazení.
 */
async function migraceDojela(): Promise<boolean> {
  const o = await stav.api!.post(`${stav.relace!.url}/rest/v1/rpc/statistiky_technici`, {
    headers: hlavicky(),
    data: { p_service_ids: [SERVIS.id] } as never,
  });
  if (o.status() >= 300) return false;
  const radky = (await o.json()) as Array<Record<string, unknown>>;
  return Array.isArray(radky) && radky.length > 0 && "bezicichUseku" in radky[0];
}

const PRESKOCIT = "Databáze ještě nemá migraci 20260912170000_statistiky_cisla_sedi.sql (npm run db:migrate).";

test.beforeAll(async () => {
  stav.api = await novaZadost.newContext();
  stav.zarizeni = testovaciJmeno("Zařízení čísla");
});

/**
 * Úklid je povinný, ne slušnost: rozdělaný úsek práce drží unikátní index
 * na jednom běžícím úseku na člověka a zablokoval by stopky ostatním testům.
 * Zakázky se ruší měkce (`deleted_at`), stejně jako z Koše v aplikaci.
 */
test.afterAll(async () => {
  if (stav.relace && stav.api) {
    if (stav.usek) {
      await zapis("PATCH", `ticket_work_sessions?id=eq.${stav.usek}`, { ended_at: new Date().toISOString() }).catch(() => {});
    }
    for (const id of stav.zakazky) {
      await zapis("PATCH", `tickets?id=eq.${id}`, { deleted_at: new Date().toISOString() }).catch(() => {});
    }
  }
  await stav.api?.dispose();
});

test("stornovaná zakázka zůstane v počtu, ale zmizí z tržeb", async ({ page }) => {
  test.setTimeout(240_000);
  stav.relace = await prihlasSeAOdchytRelaci(page);
  test.skip(!(await migraceDojela()), PRESKOCIT);

  // Dvě zakázky se stejným (unikátním) zařízením – rozpad je pak vezme obě.
  await zalozZakazku(page, { zakaznik: testovaciJmeno("Storno"), zarizeni: stav.zarizeni! });
  await zalozZakazku(page, { zakaznik: testovaciJmeno("Sleva"), zarizeni: stav.zarizeni! });

  const nalezene = await cti<{ id: string; title: string }>(
    `tickets?service_id=eq.${SERVIS.id}&title=eq.${encodeURIComponent(stav.zarizeni!)}&select=id,title`,
  );
  expect(nalezene.length, "Založené zakázky se nenašly přes REST.").toBe(2);
  stav.zakazky = nalezene.map((t) => t.id);
  const [prvni, druha] = stav.zakazky;

  // Ceny se dopisují přes REST: formulář provedené opravy nabízí pole ceny
  // jen u oprav navázaných na model, a test má být o číslech, ne o klikání.
  await zapis("PATCH", `tickets?id=eq.${prvni}`, {
    performed_repairs: [{ name: "Výměna displeje (E2E)", price: 1000, costs: 400 }],
  });
  // Druhá zakázka má pevnou slevu VYŠŠÍ než cena oprav – přesně tenhle případ
  // se v databázi nevykazoval oříznutý.
  await zapis("PATCH", `tickets?id=eq.${druha}`, {
    performed_repairs: [{ name: "Výměna baterie (E2E)", price: 2000, costs: 500 }],
    discount_type: "amount",
    discount_value: 5000,
  });

  const pred = await kpiZaMojeZakazky();
  expect(pred.totalTickets).toBe(2);
  // 1 000 z první + 0 z druhé (sleva ji smázla na nulu, ne pod nulu).
  expect(pred.totalRevenue).toBe(1000);
  // Sleva se strhne nejvýš do ceny oprav: 2 000, ne zapsaných 5 000.
  expect(pred.totalDiscounts).toBe(2000);
  // Marže = tržba − náklady: (1000−400) + (0−500).
  expect(pred.profit).toBe(100);

  // Storno první zakázky. Stav „cancelled“ je v E2E servisu „Zrušeno“.
  await zapis("PATCH", `tickets?id=eq.${prvni}`, { status: "cancelled" });

  const po = await kpiZaMojeZakazky();
  expect(po.totalTickets, "Storno musí zůstat v počtu – ta práce se odvedla.").toBe(2);
  expect(po.totalRevenue, "Za stornovanou zakázku servis nedostal nic.").toBe(0);
  expect(po.totalCosts).toBe(500);
  expect(po.profit).toBe(-500);
  // Žádné dělení nulou: bez tržby je marže i průměrná cena nula, ne NaN.
  expect(po.marginPct).toBe(0);
  expect(po.averageTicketPrice).toBe(0);
});

test("nezastavené stopky nenafouknou hodiny technika", async ({ page }) => {
  test.setTimeout(180_000);
  stav.relace = await prihlasSeAOdchytRelaci(page);
  test.skip(!(await migraceDojela()), PRESKOCIT);
  expect(stav.zakazky.length, "Zakázky z prvního testu chybí.").toBeGreaterThan(0);

  const pred = await mojeHodiny();

  // Úsek spuštěný před pěti dny, který nikdo nezastavil. Dřív se počítal až
  // do konce období – z několika minut práce byla stovka hodin.
  const zacatek = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
  const vlozeny = (await zapis("POST", "ticket_work_sessions", {
    service_id: SERVIS.id,
    ticket_id: stav.zakazky[0],
    user_id: stav.relace.uid,
    started_at: zacatek,
  })) as Array<{ id: string }>;
  stav.usek = vlozeny[0]?.id;
  expect(stav.usek, "Úsek práce se nezaložil.").toBeTruthy();

  try {
    const po = await mojeHodiny();
    const pribylo = po - pred;
    expect(pribylo, "Zapomenutý úsek se nesmí počítat celý (5 dní = 120 h).").toBeLessThanOrEqual(12.01);
    expect(pribylo).toBeGreaterThan(11.9);

    const radek = (await technici()).find((t) => t.userId === stav.relace!.uid);
    expect(radek?.bezicichUseku, "Stránka musí poznat, že úsek nemá konec.").toBeGreaterThanOrEqual(1);
  } finally {
    // Běžící úsek nesmí přežít test ani při pádu – blokoval by stopky všem.
    await zapis("PATCH", `ticket_work_sessions?id=eq.${stav.usek}`, { ended_at: new Date().toISOString() });
    stav.usek = undefined;
  }

  const po = await mojeHodiny();
  expect((await technici()).find((t) => t.userId === stav.relace!.uid)?.bezicichUseku ?? 0).toBe(0);
  expect(Number.isFinite(po)).toBe(true);
});

test("hláška o prázdném období nesvítí nad plnými statistikami", async ({ page }) => {
  test.setTimeout(180_000);
  await prihlasSe(page);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: "statistics" } })));
  await expect(page.getByText("Celkem zakázek").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".stats-skeleton")).toHaveCount(0, { timeout: 60_000 });

  const prazdno = page.getByText(/Za vybrané období tu zatím nic není/);
  // V kartách se jednotlivé zakázky vůbec nestahují (čísla chodí hotová ze
  // serveru), takže se hláška nesmí řídit tím, kolik jich je v paměti.
  await expect(prazdno).toBeHidden();

  // Období, ve kterém servis ještě neexistoval – tam hláška patří.
  await page.getByRole("button", { name: "Vlastní", exact: true }).click();
  await page.getByRole("textbox", { name: "Od", exact: true }).fill("2019-01-01");
  await page.getByRole("textbox", { name: "Do", exact: true }).fill("2019-01-31");
  await expect(page.locator(".stats-skeleton")).toHaveCount(0, { timeout: 60_000 });
  await expect(prazdno).toBeVisible({ timeout: 30_000 });
});
