import { test, expect, request as novaZadost, type APIRequestContext, type Page } from "@playwright/test";
import { prihlasSe, SERVIS } from "./pomocnici";

/**
 * Pobočky do hloubky: co zvládne člen omezený na jednu pobočku, když obejde
 * aplikaci a mluví přímo s REST rozhraním.
 *
 * Proč to není jen další sonda v scripts/rls-probe.sql: sondy se vydávají za
 * uživatele uvnitř databáze (`set_config` + `set role`). Tohle jde skutečnou
 * cestou – přihlášení v prohlížeči, opravdový token, brána a PostgREST –
 * takže chytí i to, co by v databázi sedělo, ale přes rozhraní by se rozešlo
 * (chybějící grant, RPC vystavené anonovi, jiná role u tokenu).
 *
 * Sedm děr z migrace 20260912100000 (hloubkový test modulu):
 *   1) omezený člen si sám přepsal domovskou pobočku,
 *   2) člen BEZ domovské pobočky viděl všechno,
 *   3) statistiky měly stejnou díru,
 *   4) dokumenty zakázky šlo vložit i k cizí zakázce,
 *   5) totéž historie reklamace,
 *   6) SMS konverzaci cizí zakázky šlo archivovat i smazat,
 *   7) rezervace dílů šly přes REST na cizí zakázku.
 * Navíc: sklad cizí pobočky šel přejmenovat a přehodit, a po přesunu zakázky
 * zůstal běžící úsek práce viset otevřený.
 *
 * Test si v E2E servisu založí druhou pobočku, technika na ni na chvíli zamkne
 * a na konci mu práva i domovskou pobočku vrátí do původního stavu.
 */
test.describe.configure({ mode: "serial" });

const POBOCKA = { nazev: "Pobočka hloubka", zkratka: "PH" };

type Relace = { url: string; apikey: string; token: string; uid: string };

/** Stav sdílený mezi testy – zakládá první test, uklízí afterAll. */
const stav: {
  majitel?: Relace;
  technik?: Relace;
  api?: APIRequestContext;
  hlavniPobocka?: string;
  novaPobocka?: string;
  zakazkaCizi?: string;
  zakazkaVlastni?: string;
  dokument?: string;
  konverzace?: string;
  rezervace?: string;
  reklamaceCizi?: string;
  sklad?: string;
  produkt?: string;
  kodCizi?: string;
  kodVlastni?: string;
  zakazkaPresun?: string;
  puvodniPrava?: Record<string, boolean>;
  puvodniDomovska?: string | null;
} = {};

/**
 * Přihlásí se v prohlížeči a odchytí z požadavků aplikace klíč projektu
 * i token přihlášeného člověka.
 *
 * Token se nebere z localStorage: jeho formát se mezi verzemi supabase-js
 * mění (holé JSON vs. „base64-…"), zatímco hlavičky odchozích požadavků jsou
 * stejné pořád. Navíc je jistota, že token opravdu prošel aplikací.
 */
async function prihlasSeAOdchytRelaci(page: Page, kdo: "owner" | "technik"): Promise<Relace> {
  const zachyt: { url?: string; apikey?: string; token?: string } = {};
  page.on("request", (r) => {
    if (!r.url().includes("/rest/v1/")) return;
    const h = r.headers();
    const auth = h["authorization"];
    if (h["apikey"]) zachyt.apikey = h["apikey"];
    if (auth?.startsWith("Bearer ")) zachyt.token = auth.slice("Bearer ".length);
    zachyt.url = new URL(r.url()).origin;
  });

  await prihlasSe(page, kdo);
  // Anonymní klíč má v tokenu role „anon"; čeká se na token přihlášeného.
  await expect
    .poll(() => (zachyt.token ? rolePodleTokenu(zachyt.token) : null), {
      timeout: 30_000,
      message: "Z aplikace nepřišel žádný požadavek s tokenem přihlášeného uživatele.",
    })
    .toBe("authenticated");

  const naklad = obsahTokenu(zachyt.token!);
  return { url: zachyt.url!, apikey: zachyt.apikey!, token: zachyt.token!, uid: String(naklad.sub) };
}

function obsahTokenu(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
}
function rolePodleTokenu(token: string): string | null {
  try {
    return String(obsahTokenu(token).role ?? "");
  } catch {
    return null;
  }
}

function hlavicky(r: Relace): Record<string, string> {
  return {
    apikey: r.apikey,
    Authorization: `Bearer ${r.token}`,
    "Content-Type": "application/json",
    // Bez „return=representation" vrací PostgREST u zápisu prázdné tělo a
    // z odpovědi by nešlo poznat, kolika řádků se změna dotkla.
    Prefer: "return=representation",
  };
}

/** GET přes REST. Vrací pole řádků, které dotyčný opravdu vidí. */
async function cti<T = Record<string, unknown>>(r: Relace, cesta: string): Promise<T[]> {
  const o = await stav.api!.get(`${r.url}/rest/v1/${cesta}`, { headers: hlavicky(r) });
  expect(o.status(), `GET ${cesta}`).toBeLessThan(300);
  return (await o.json()) as T[];
}

/** Zápis přes REST. Vrací stav a tělo, ať se dá rozlišit odmítnutí od „nula řádků". */
async function zapis(
  r: Relace,
  zpusob: "POST" | "PATCH" | "DELETE",
  cesta: string,
  telo?: unknown,
): Promise<{ stav: number; radky: unknown[]; text: string }> {
  const adresa = `${r.url}/rest/v1/${cesta}`;
  const nastaveni = { headers: hlavicky(r), data: telo as never };
  const o =
    zpusob === "POST"
      ? await stav.api!.post(adresa, nastaveni)
      : zpusob === "PATCH"
        ? await stav.api!.patch(adresa, nastaveni)
        : await stav.api!.delete(adresa, nastaveni);
  const text = await o.text();
  let radky: unknown[] = [];
  try {
    const j = JSON.parse(text);
    if (Array.isArray(j)) radky = j;
  } catch {
    /* chybová odpověď není pole */
  }
  return { stav: o.status(), radky, text };
}

/** Volání RPC pod danou identitou. */
async function rpc(r: Relace, jmeno: string, argumenty: unknown): Promise<{ stav: number; text: string }> {
  const o = await stav.api!.post(`${r.url}/rest/v1/rpc/${jmeno}`, { headers: hlavicky(r), data: argumenty as never });
  return { stav: o.status(), text: await o.text() };
}

test.beforeAll(async () => {
  stav.api = await novaZadost.newContext();
});

test.afterAll(async () => {
  // Úklid běží i po spadlém testu: technik musí zůstat takový, jaký byl, a
  // v ostrém servisu nesmí zbýt zakázky ani pobočka navíc.
  const m = stav.majitel;
  if (m) {
    if (stav.technik && stav.puvodniPrava) {
      await rpc(m, "set_member_capabilities", {
        p_service_id: SERVIS.id,
        p_user_id: stav.technik.uid,
        p_capabilities: stav.puvodniPrava,
      });
      await rpc(m, "set_member_home_branch", {
        p_service_id: SERVIS.id,
        p_user_id: stav.technik.uid,
        p_branch_id: stav.puvodniDomovska ?? null,
      });
    }
    const uklid = async (popis: string, o: Promise<{ stav: number; text: string }>) => {
      const v = await o;
      // Tichý úklid je důvod, proč se v ostrém servisu hromadí zbytky testů.
      if (v.stav >= 300) console.warn(`Úklid selhal – ${popis}: ${v.stav} ${v.text.slice(0, 200)}`);
    };
    for (const [tabulka, id] of [
      ["ticket_documents", stav.dokument],
      ["sms_conversations", stav.konverzace],
      ["inventory_reservations", stav.rezervace],
    ] as const) {
      if (id) await uklid(tabulka, zapis(m, "DELETE", `${tabulka}?id=eq.${id}`));
    }
    for (const id of [stav.zakazkaCizi, stav.zakazkaVlastni, stav.zakazkaPresun]) {
      if (!id) continue;
      await uklid("úseky práce", zapis(m, "DELETE", `ticket_work_sessions?ticket_id=eq.${id}`));
      /* Zakázka se přes REST natvrdo smazat nedá – politika pro DELETE na
         tickets neexistuje a je to tak správně (maže se do koše). Testovací
         zakázky se proto uklízejí stejnou cestou jako v aplikaci. */
      await uklid("zakázka do koše", rpc(m, "soft_delete_ticket", { p_ticket_id: id }));
    }
    if (stav.novaPobocka) await uklid("pobočka", zapis(m, "DELETE", `branches?id=eq.${stav.novaPobocka}`));
  }
  await stav.api?.dispose();
});

test("příprava: druhá pobočka a technik zamčený na ni", async ({ page }) => {
  test.setTimeout(180_000);
  stav.majitel = await prihlasSeAOdchytRelaci(page, "owner");
  const m = stav.majitel;

  const pobocky = await cti<{ id: string; is_default: boolean; name: string }>(
    m,
    `branches?service_id=eq.${SERVIS.id}&select=id,name,is_default`,
  );
  stav.hlavniPobocka = (pobocky.find((p) => p.is_default) ?? pobocky[0]).id;
  expect(stav.hlavniPobocka, "E2E servis nemá žádnou pobočku").toBeTruthy();

  // Zbytek po spadlém běhu: pobočka se stejným názvem by shodila kontrolu limitu.
  for (const p of pobocky.filter((p) => p.name === POBOCKA.nazev)) {
    await zapis(m, "DELETE", `branches?id=eq.${p.id}`);
  }
  const nova = await zapis(m, "POST", "branches", {
    service_id: SERVIS.id,
    name: POBOCKA.nazev,
    code: POBOCKA.zkratka,
  });
  expect(nova.stav, `Pobočku se nepodařilo založit: ${nova.text}`).toBeLessThan(300);
  stav.novaPobocka = (nova.radky[0] as { id: string }).id;

  /* Dvě zakázky: jedna na hlavní pobočce (pro technika cizí), jedna na jeho.
     Číslo se dává ručně – zakládá ho aplikace přes RPC, přes holý REST by
     zakázka zůstala bez čísla a v rozhraní by nebylo podle čeho hledat. */
  const razitko = Date.now().toString(36).toUpperCase();
  for (const [klic, pobocka, znacka] of [
    ["zakazkaCizi", stav.hlavniPobocka, "C"],
    ["zakazkaVlastni", stav.novaPobocka, "V"],
  ] as const) {
    const kod = `E2EHL${razitko}${znacka}`;
    const z = await zapis(m, "POST", "tickets", {
      service_id: SERVIS.id,
      code: kod,
      title: "Hloubkový test poboček",
      status: "received",
      customer_name: "Hloubka",
      branch_id: pobocka,
    });
    expect(z.stav, `Zakázku se nepodařilo založit: ${z.text}`).toBeLessThan(300);
    stav[klic] = (z.radky[0] as { id: string }).id;
    stav[klic === "zakazkaCizi" ? "kodCizi" : "kodVlastni"] = kod;
  }

  /* Technik potřebuje vlastní kontext: v tom majitelově je už přihlášená
     relace a přihlašovací formulář by se vůbec neukázal. Kontext se hned
     zavírá, odchycený token platí dál. */
  const kontextTechnika = await page.context().browser()!.newContext({
    baseURL: test.info().project.use.baseURL,
    locale: "cs-CZ",
  });
  stav.technik = await prihlasSeAOdchytRelaci(await kontextTechnika.newPage(), "technik");
  await kontextTechnika.close();
  const clenstvi = await cti<{ capabilities: Record<string, boolean>; home_branch_id: string | null }>(
    m,
    `service_memberships?service_id=eq.${SERVIS.id}&user_id=eq.${stav.technik.uid}&select=capabilities,home_branch_id`,
  );
  stav.puvodniPrava = clenstvi[0].capabilities ?? {};
  stav.puvodniDomovska = clenstvi[0].home_branch_id;

  // Právo na sklad tu není náhodou: bez něj by sklad cizí pobočky zastavila
  // kontrola práv a o pobočce by test nic neřekl. Na konci se vrací zpět.
  const prava = await rpc(m, "set_member_capabilities", {
    p_service_id: SERVIS.id,
    p_user_id: stav.technik.uid,
    p_capabilities: { ...stav.puvodniPrava, branch_only: true, can_edit_inventory: true },
  });
  expect(prava.stav, `Práva technika nešla nastavit: ${prava.text}`).toBeLessThan(300);
  const domov = await rpc(m, "set_member_home_branch", {
    p_service_id: SERVIS.id,
    p_user_id: stav.technik.uid,
    p_branch_id: stav.novaPobocka,
  });
  expect(domov.stav, `Domovská pobočka technika nešla nastavit: ${domov.text}`).toBeLessThan(300);

  // Řádky u cizí zakázky, na které se pak technik zkusí sáhnout.
  const doklad = await zapis(m, "POST", "ticket_documents", {
    service_id: SERVIS.id,
    ticket_id: stav.zakazkaCizi,
    doc_type: "diagnostic_protocol",
    storage_path: `e2e/hloubka-${Date.now()}.pdf`,
    content_hash: "e2e",
  });
  expect(doklad.stav, `Dokument u zakázky nešel založit: ${doklad.text}`).toBeLessThan(300);
  stav.dokument = (doklad.radky[0] as { id: string }).id;

  const konverzace = await zapis(m, "POST", "sms_conversations", {
    service_id: SERVIS.id,
    ticket_id: stav.zakazkaCizi,
    customer_phone: "+420777000111",
  });
  expect(konverzace.stav, `SMS konverzace nešla založit: ${konverzace.text}`).toBeLessThan(300);
  stav.konverzace = (konverzace.radky[0] as { id: string }).id;

  const produkty = await cti<{ id: string }>(m, `inventory_products?service_id=eq.${SERVIS.id}&select=id&limit=1`);
  stav.produkt = produkty[0]?.id;
  expect(stav.produkt, "V E2E servisu není žádný produkt – rezervace se nedají otestovat").toBeTruthy();
  const rezervace = await zapis(m, "POST", "inventory_reservations", {
    service_id: SERVIS.id,
    product_id: stav.produkt,
    ticket_id: stav.zakazkaCizi,
    qty: 1,
  });
  expect(rezervace.stav, `Rezervace nešla založit: ${rezervace.text}`).toBeLessThan(300);
  stav.rezervace = (rezervace.radky[0] as { id: string }).id;

  const reklamace = await cti<{ id: string }>(
    m,
    `warranty_claims?service_id=eq.${SERVIS.id}&branch_id=eq.${stav.hlavniPobocka}&select=id&limit=1`,
  );
  stav.reklamaceCizi = reklamace[0]?.id;

  const sklady = await cti<{ id: string; branch_id: string | null }>(
    m,
    `inventory_warehouses?service_id=eq.${SERVIS.id}&select=id,branch_id`,
  );
  stav.sklad = sklady.find((s) => s.branch_id === stav.hlavniPobocka)?.id ?? sklady[0]?.id;
});

test("1) domovskou pobočku si omezený člen nepřepíše ani přes RPC", async () => {
  const t = stav.technik!;
  // Přesně tohle šlo pustit z konzole prohlížeče a celé omezení tím padlo.
  const naCizi = await rpc(t, "set_member_home_branch", {
    p_service_id: SERVIS.id,
    p_user_id: t.uid,
    p_branch_id: stav.hlavniPobocka,
  });
  expect(naCizi.stav, `Omezený člen si přepsal domovskou pobočku: ${naCizi.text}`).toBeGreaterThanOrEqual(400);

  // Zrušit si ji je stejný útok jinou cestou: bez domovské pobočky viděl dřív všechno.
  const naZadnou = await rpc(t, "set_member_home_branch", {
    p_service_id: SERVIS.id,
    p_user_id: t.uid,
    p_branch_id: null,
  });
  expect(naZadnou.stav, `Omezený člen si zrušil domovskou pobočku: ${naZadnou.text}`).toBeGreaterThanOrEqual(400);

  const domov = await cti<{ home_branch_id: string }>(
    stav.majitel!,
    `service_memberships?service_id=eq.${SERVIS.id}&user_id=eq.${t.uid}&select=home_branch_id`,
  );
  expect(domov[0].home_branch_id).toBe(stav.novaPobocka);
});

test("2) a 3) člen bez domovské pobočky nevidí nic – ani v datech, ani ve statistikách", async () => {
  const m = stav.majitel!;
  const t = stav.technik!;
  const vrat = await rpc(m, "set_member_home_branch", {
    p_service_id: SERVIS.id,
    p_user_id: t.uid,
    p_branch_id: null,
  });
  expect(vrat.stav).toBeLessThan(300);

  try {
    // Dřív tenhle stav znamenal „neomezovat" – a nastane sám, když se smaže
    // pobočka, na kterou byl člen navázaný.
    const zakazky = await cti(t, `tickets?service_id=eq.${SERVIS.id}&select=id&limit=5`);
    expect(zakazky, "Člen bez domovské pobočky vidí zakázky celého servisu").toHaveLength(0);

    const statistiky = await rpc(t, "statistiky_prehled", { p_service_ids: [SERVIS.id] });
    expect(statistiky.stav, `Statistiky selhaly: ${statistiky.text}`).toBeLessThan(300);
    const celkem = JSON.parse(statistiky.text)?.kpi?.totalTickets;
    expect(celkem, "Statistiky nevrátily počet zakázek – test by nic neměřil").not.toBeUndefined();
    expect(Number(celkem), "Statistiky ukázaly členovi bez domovské pobočky celý servis").toBe(0);
  } finally {
    const zpet = await rpc(m, "set_member_home_branch", {
      p_service_id: SERVIS.id,
      p_user_id: t.uid,
      p_branch_id: stav.novaPobocka,
    });
    expect(zpet.stav).toBeLessThan(300);
  }
});

test("4) až 7) k zakázce cizí pobočky nejde připsat dokument, historii, SMS ani rezervaci", async () => {
  const t = stav.technik!;
  const cizi = stav.zakazkaCizi!;

  // Nejdřív pro pořádek: zakázka z cizí pobočky pro něj neexistuje.
  expect(await cti(t, `tickets?id=eq.${cizi}&select=id`)).toHaveLength(0);

  // 4) dokumenty zakázky
  const dokument = await zapis(t, "POST", "ticket_documents", {
    service_id: SERVIS.id,
    ticket_id: cizi,
    doc_type: "ticket_list",
    storage_path: "hack/hack.pdf",
    content_hash: "hack",
  });
  expect(dokument.stav, `Dokument k cizí zakázce prošel: ${dokument.text}`).toBeGreaterThanOrEqual(400);
  const prepisDokumentu = await zapis(t, "PATCH", `ticket_documents?id=eq.${stav.dokument}`, {
    storage_path: "hack/prepsano.pdf",
  });
  expect(prepisDokumentu.radky, "Dokument cizí zakázky šel přepsat").toHaveLength(0);

  // 5) historie reklamace
  if (stav.reklamaceCizi) {
    const historie = await zapis(t, "POST", "warranty_claim_history", {
      service_id: SERVIS.id,
      warranty_claim_id: stav.reklamaceCizi,
      action: "updated",
    });
    expect(historie.stav, `Zápis do historie cizí reklamace prošel: ${historie.text}`).toBeGreaterThanOrEqual(400);
  }

  // 6) SMS konverzace – archivace i smazání jdou naslepo, zákazníkovi by tím
  //    zmizela historie zpráv.
  const archiv = await zapis(t, "PATCH", `sms_conversations?id=eq.${stav.konverzace}`, { archived: true });
  expect(archiv.radky, "SMS konverzace cizí zakázky šla archivovat").toHaveLength(0);
  const smazani = await zapis(t, "DELETE", `sms_conversations?id=eq.${stav.konverzace}`);
  expect(smazani.radky, "SMS konverzace cizí zakázky šla smazat").toHaveLength(0);
  expect(
    await cti(stav.majitel!, `sms_conversations?id=eq.${stav.konverzace}&select=id`),
    "SMS konverzace cizí zakázky zmizela",
  ).toHaveLength(1);

  // 7) rezervace dílů – skladová RPC pobočku hlídají, REST je obcházel.
  const novaRezervace = await zapis(t, "POST", "inventory_reservations", {
    service_id: SERVIS.id,
    product_id: stav.produkt,
    ticket_id: cizi,
    qty: 1,
  });
  expect(novaRezervace.stav, `Rezervace na cizí zakázku prošla: ${novaRezervace.text}`).toBeGreaterThanOrEqual(400);
  const zmenaRezervace = await zapis(t, "PATCH", `inventory_reservations?id=eq.${stav.rezervace}`, { qty: 99 });
  expect(zmenaRezervace.radky, "Rezervace cizí zakázky šla změnit").toHaveLength(0);
  const zruseniRezervace = await zapis(t, "DELETE", `inventory_reservations?id=eq.${stav.rezervace}`);
  expect(zruseniRezervace.radky, "Rezervace cizí zakázky šla zrušit").toHaveLength(0);
});

test("sklad cizí pobočky nejde přejmenovat ani přehodit pod svou pobočku", async () => {
  const t = stav.technik!;
  test.skip(!stav.sklad, "E2E servis nemá sklad na hlavní pobočce.");

  // Technik má pro tenhle test právo na sklad, takže odmítnutí může přijít
  // jen od pobočky – jinak by test dokazoval něco jiného.
  const prejmenovani = await zapis(t, "PATCH", `inventory_warehouses?id=eq.${stav.sklad}`, { name: "HACK" });
  expect(prejmenovani.stav, `Sklad cizí pobočky šel přejmenovat: ${prejmenovani.text}`).toBeGreaterThanOrEqual(400);
  expect(prejmenovani.text).toContain("pobočce");

  const prehozeni = await zapis(t, "PATCH", `inventory_warehouses?id=eq.${stav.sklad}`, {
    branch_id: stav.novaPobocka,
  });
  expect(prehozeni.stav, `Sklad cizí pobočky šel přehodit: ${prehozeni.text}`).toBeGreaterThanOrEqual(400);
});

test("po přesunu zakázky se rozdělaný úsek práce zavře", async () => {
  const m = stav.majitel!;
  const t = stav.technik!;

  /* Přesouvá se zakázka založená jen pro tenhle test: kdyby se hýbalo tou
     z přípravy, technikovi by na jeho pobočce nezbylo nic a poslední test by
     neměl co hledat. */
  const zalozeni = await zapis(m, "POST", "tickets", {
    service_id: SERVIS.id,
    code: `${stav.kodVlastni}P`,
    title: "Hloubkový test poboček – přesun",
    status: "received",
    customer_name: "Hloubka",
    branch_id: stav.novaPobocka,
  });
  expect(zalozeni.stav, `Zakázku pro přesun nešlo založit: ${zalozeni.text}`).toBeLessThan(300);
  stav.zakazkaPresun = (zalozeni.radky[0] as { id: string }).id;

  const usek = await zapis(t, "POST", "ticket_work_sessions", {
    service_id: SERVIS.id,
    ticket_id: stav.zakazkaPresun,
    user_id: t.uid,
    started_at: new Date().toISOString(),
  });
  expect(usek.stav, `Úsek práce nešel založit: ${usek.text}`).toBeLessThan(300);
  const usekId = (usek.radky[0] as { id: string }).id;

  const presun = await zapis(m, "PATCH", `tickets?id=eq.${stav.zakazkaPresun}`, {
    branch_id: stav.hlavniPobocka,
  });
  expect(presun.stav, `Přesun zakázky selhal: ${presun.text}`).toBeLessThan(300);

  /* Technik na zakázku po přesunu nevidí, takže by svůj úsek nemohl ukončit
     ani smazat – čas by běžel dál a ve výkazu by zůstal otevřený napořád. */
  const [radek] = await cti<{ ended_at: string | null }>(m, `ticket_work_sessions?id=eq.${usekId}&select=ended_at`);
  expect(radek.ended_at, "Po přesunu zakázky zůstal úsek práce otevřený").not.toBeNull();
  expect(await cti(t, `ticket_work_sessions?id=eq.${usekId}&select=id`)).toHaveLength(0);
});

test("v aplikaci technik zakázku cizí pobočky nenajde", async ({ page }) => {
  test.setTimeout(180_000);
  /* Strop na čekání při navigaci: prihlasSe na konci čeká na „networkidle" a
     ten u přihlášeného technika nemusí nastat vůbec – aplikace drží otevřené
     spojení pro živé změny. Bez stropu by to čekání spolklo celý test. */
  page.setDefaultNavigationTimeout(30_000);
  await prihlasSe(page, "technik");
  /* Aplikace nechává schované stránky připojené, takže hledacích polí je
     v DOM víc než jedno; bez `:visible` locator hlásí porušení strict mode. */
  const hledani = page.locator('input[data-tour="orders-search"]:visible').first();
  await expect(hledani).toBeVisible({ timeout: 30_000 });

  /* Nejdřív vlastní zakázka: kdyby se rozbilo samotné hledání, druhá polovina
     testu by „prošla" jen proto, že nic nenajde nikdy. */
  await hledani.fill(stav.kodVlastni!);
  await expect(page.locator(`:text-is("${stav.kodVlastni}"):visible`).first()).toBeVisible({ timeout: 20_000 });

  // Zakázka cizí pobočky – databáze ji omezenému členovi nevydá.
  await hledani.fill(stav.kodCizi!);
  await expect(page.locator(`:text-is("${stav.kodCizi}"):visible`)).toHaveCount(0, { timeout: 20_000 });
});
