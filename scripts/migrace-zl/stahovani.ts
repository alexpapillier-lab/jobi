/**
 * Stahování ze Zakázkového listu přes Playwright – přihlášení, seznamy
 * zakázek a reklamací, detail jedné zakázky, export zákazníků.
 *
 * Postup i selektory jsou převzaté z `zakazkovylist-bot` (hodinový bot
 * na provize, v provozu od 2025) a z `scrape_all.js`, kterým se 3. 9. 2026
 * stáhlo 3 590 zakázek a 120 reklamací bez chyby. Nové je jen: výběr
 * pobočky podle názvu (bot ji měl natvrdo), opakování a nové přihlášení
 * při vypršené relaci, a pokus o stažení exportu zákazníků (neověřeno).
 *
 * Funkce `vytahniDetail` a `vytahniSeznam` běží v prohlížeči (page.evaluate),
 * proto nesmí sahat na nic mimo sebe – Playwright je posílá jako text.
 */
import fs from "node:fs";
import type { Browser, BrowserContext, Page } from "playwright";

/** Adresa ZL. Přepsat jde jen kvůli zkoušce proti atrapě na localhostu (ZL_ZKUSEBNI_ADRESA). */
export const ZL = process.env.ZL_ZKUSEBNI_ADRESA || "https://app.zakazkovylist.cz";

export type Log = (zprava: string) => void;

export type Seznam = { druh: "order" | "claim"; url: string; parametrStrany: string; odkaz: string; detail: string };
export const SEZNAM_ZAKAZEK: Seznam = { druh: "order", url: `${ZL}/orders/`, parametrStrany: "ordersDatagrid-datagrid-page", odkaz: "/order/detail/", detail: `${ZL}/order/detail/` };
export const SEZNAM_REKLAMACI: Seznam = { druh: "claim", url: `${ZL}/complaints/`, parametrStrany: "complaintsDatagrid-datagrid-page", odkaz: "/complaint/detail/", detail: `${ZL}/complaint/detail/` };

export function urlStrany(s: Seznam, strana: number): string {
  return `${s.url}?${s.parametrStrany}=${strana}&ordersDatagrid-datagrid-perPage=50&complaintsDatagrid-datagrid-perPage=50`;
}

const pauza = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Obrázky, fonty a styly se neblokují kvůli vzhledu, ale kvůli rychlosti (4× méně dat). */
export async function odlehcenaStranka(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.route("**/*", (route) => {
    const t = route.request().resourceType();
    if (["image", "font", "media", "stylesheet"].includes(t)) void route.abort();
    else void route.continue();
  });
  return page;
}

/** Jsme na přihlašovací stránce? (relace vypršela nebo přihlášení neprošlo) */
export async function jePrihlaseni(page: Page): Promise<boolean> {
  if (/\/auth\/login|\/sign\/in/.test(page.url())) return true;
  return (await page.locator("#frm-loginForm").count()) > 0;
}

/** Bez přihlášení: načte přihlašovací stránku a ověří, že formulář má pořád stejné prvky. */
export async function overPrihlasovaciStranku(browser: Browser): Promise<{ ok: boolean; zprava: string }> {
  const context = await browser.newContext();
  try {
    const page = await odlehcenaStranka(context);
    await page.goto(`${ZL}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
    const chybi: string[] = [];
    for (const sel of ["#frm-loginForm", "#frm-loginForm-email", "#frm-loginForm-password"]) {
      if ((await page.locator(sel).count()) === 0) chybi.push(sel);
    }
    return chybi.length === 0
      ? { ok: true, zprava: `Přihlašovací stránka ${page.url()} má formulář, jaký bot čeká.` }
      : { ok: false, zprava: `Na ${page.url()} chybí ${chybi.join(", ")} – Zakázkový list změnil přihlášení, bot je potřeba upravit.` };
  } finally {
    await context.close();
  }
}

export type Prihlaseni = {
  email: string;
  heslo: string;
  /** Část názvu pobočky na stránce výběru pobočky; bez ní se vezme jediná, jinak se zeptá. */
  pobocka?: string | null;
  vyberPobocky?: (nazvy: string[]) => Promise<number>;
};

/**
 * Přihlášení 1:1 podle bota: psaní po znacích s pauzou a blur (formulář
 * má JS validaci, která rychlé `fill` nepustí), odeslání Enterem, pak
 * případně výběr pobočky (`/change-branch`, karty s nadpisem h5).
 */
export async function prihlasit(page: Page, p: Prihlaseni, log: Log): Promise<void> {
  await page.goto(`${ZL}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector("#frm-loginForm", { timeout: 15000 });

  await page.focus("#frm-loginForm-email");
  await page.keyboard.type(p.email, { delay: 30 });
  await page.locator("#frm-loginForm-email").blur();
  await pauza(200);
  await page.focus("#frm-loginForm-password");
  await page.keyboard.type(p.heslo, { delay: 30 });
  await page.locator("#frm-loginForm-password").blur();
  await pauza(500);
  await page.locator("#frm-loginForm-password").press("Enter");

  try {
    await page.waitForURL(/\/(change-branch|dashboard)/, { timeout: 25000 });
  } catch {
    if (await jePrihlaseni(page)) throw new Error("Přihlášení se nepovedlo – zkontrolujte e-mail a heslo do Zakázkového listu.");
    throw new Error(`Po přihlášení se nenačetl přehled (adresa ${page.url()}).`);
  }

  if (page.url().includes("/change-branch")) {
    await pauza(800);
    const nadpisy = page.locator("h5");
    await nadpisy.first().waitFor({ state: "visible", timeout: 15000 });
    const nazvy = (await nadpisy.allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean);
    let index = -1;
    if (p.pobocka) {
      const hledej = p.pobocka.toLowerCase();
      index = nazvy.findIndex((n) => n.toLowerCase().includes(hledej));
      if (index < 0) throw new Error(`Pobočka „${p.pobocka}“ není mezi: ${nazvy.join(" · ")}`);
    } else if (nazvy.length === 1) {
      index = 0;
    } else if (p.vyberPobocky) {
      index = await p.vyberPobocky(nazvy);
    } else {
      throw new Error(`Účet má víc poboček, zadejte --pobocka: ${nazvy.join(" · ")}`);
    }
    log(`Pobočka: ${nazvy[index]}`);
    const nadpis = nadpisy.nth(index);
    const navigace = page.waitForURL(/\/dashboard/, { timeout: 60000 });
    // Klikatelný je předek nadpisu – odkaz, tlačítko, nebo celá karta.
    for (const xpath of ["xpath=ancestor::a[1]", "xpath=ancestor::button[1]", "xpath=ancestor::*[contains(@class,'card')][1]"]) {
      const cil = nadpis.locator(xpath);
      if (await cil.count()) {
        await cil.click();
        break;
      }
    }
    await navigace;
  }
  if (!page.url().includes("/dashboard")) throw new Error(`Přihlášení neskončilo na přehledu (adresa ${page.url()}).`);
}

/** Běží v prohlížeči: čísla stran ze stránkování a řádky seznamu (kód + stav z posledního sloupce). */
export function vytahniSeznam(odkaz: string): { stran: number; radky: Array<{ kod: string; stav: string }> } {
  const cisla = [...document.querySelectorAll("div.col-pagination a")].map((a) => parseInt((a.textContent || "").trim(), 10)).filter((n) => Number.isFinite(n));
  const re = new RegExp(odkaz.replace(/\//g, "\\/") + "([^/?#]+)");
  const radky: Array<{ kod: string; stav: string }> = [];
  const videno = new Set<string>();
  document.querySelectorAll("table tbody tr").forEach((tr) => {
    const a = tr.querySelector(`a[href*="${odkaz}"]`);
    const m = a ? (a.getAttribute("href") || "").match(re) : null;
    if (!m || videno.has(m[1])) return;
    videno.add(m[1]);
    const td = tr.querySelector("td:last-child");
    let stav = "";
    if (td) {
      const btn = td.querySelector("button, [role='button']");
      if (btn && btn.textContent) stav = btn.textContent.trim();
      const sel = td.querySelector("select") as HTMLSelectElement | null;
      if (!stav && sel && sel.selectedOptions && sel.selectedOptions[0]) stav = (sel.selectedOptions[0].textContent || "").trim();
      const span = td.querySelector("span, div");
      if (!stav && span && span.textContent) stav = span.textContent.trim();
    }
    radky.push({ kod: m[1], stav: stav.replace(/\s+/g, " ") });
  });
  // Odkazy mimo tabulku (kdyby se změnila kostra), ať o kód nepřijdeme.
  document.querySelectorAll(`a[href*="${odkaz}"]`).forEach((a) => {
    const m = (a.getAttribute("href") || "").match(re);
    if (m && !videno.has(m[1])) {
      videno.add(m[1]);
      radky.push({ kod: m[1], stav: "" });
    }
  });
  return { stran: cisla.length ? Math.max(...cisla) : 1, radky };
}

/**
 * Běží v prohlížeči: celý detail zakázky nebo reklamace (obě mají stejnou
 * kostru). Logika 1:1 ze `scrape_all.js`, ověřená na 3 700 detailech.
 * PIN se nesbírá nikdy.
 */
export function vytahniDetail(druh: string) {
  const clean = (s: string | null | undefined) => (s || "").replace(/\s+/g, " ").trim();

  // 1) Dvojice th/td ze všech tabulek (Zařízení, Zákazník, Zakázka, Technici…).
  const kv: Record<string, string> = {};
  document.querySelectorAll("table").forEach((table) => {
    table.querySelectorAll("tr").forEach((tr) => {
      const th = tr.querySelector("th");
      const td = tr.querySelector("td");
      if (th && td && tr.children.length === 2) {
        const label = clean(th.textContent);
        if (/^PIN/i.test(label)) return;
        kv[label] = clean(td.textContent);
      }
    });
  });

  // 2) Rozpisy oprav – hlavička „Položka opravy“ je v PRVNÍM řádku tabulky
  //    (u reklamace není v <thead>, ale jako první <tr> se samými <th>).
  const repairTables: Array<{ header: string; rows: string[][] }> = [];
  document.querySelectorAll("table").forEach((table) => {
    const all = [...table.querySelectorAll("tr")].map((tr) => [...tr.querySelectorAll("th,td")].map((c) => clean(c.textContent)));
    if (all.length === 0) return;
    const header = all[0].join(" ");
    if (!/Položka opravy/i.test(header)) return;
    repairTables.push({ header, rows: all.slice(1) });
  });

  // 3) Komentáře – datagrid s id obsahujícím „CommentsDatagrid-datagrid-tbody“.
  const comments: Array<{ author: string | null; createdAt: string | null; content: string }> = [];
  document.querySelectorAll('[id*="CommentsDatagrid-datagrid-tbody"] tr').forEach((tr) => {
    const spans = tr.querySelectorAll(".col-user span");
    const author = spans[0] ? clean(spans[0].textContent) : null;
    const createdAt = spans[1] ? clean(spans[1].textContent) : null;
    const content = clean(tr.querySelector(".col-content")?.textContent);
    if (author || content) comments.push({ author, createdAt, content });
  });

  // 4) Historie stavů – Bootstrap modal #logModal, v HTML je vždy (nic se neklikne).
  const statusHistory: Array<{ status: string; user: string; at: string }> = [];
  document.querySelectorAll("#logModal table tbody tr").forEach((tr) => {
    const tds = tr.querySelectorAll("td");
    if (tds.length < 3) return;
    statusHistory.push({ status: clean(tds[0].textContent), user: clean(tds[1].textContent), at: clean(tds[2].textContent) });
  });

  // 5) Titulek a odkazy na zákazníka, zařízení a (u reklamace) původní zakázku.
  const kod = (a: Element | null, re: RegExp) => (a ? ((a.getAttribute("href") || "").match(re) || [])[1] || null : null);
  const customerLink = document.querySelector('a[href*="/customer/detail/"]');
  const deviceLink = document.querySelector('a[href*="/device/detail/"]');
  const sourceOrderLink = druh === "claim" ? document.querySelector('a[href*="/order/detail/"]') : null;
  return {
    title: clean(document.querySelector("h1, h2")?.textContent || document.title),
    kv,
    repairTables,
    comments,
    statusHistory,
    customerCode: kod(customerLink, /\/customer\/detail\/([^/?#]+)/),
    customerName: customerLink ? clean(customerLink.textContent) : null,
    deviceCode: kod(deviceLink, /\/device\/detail\/([^/?#]+)/),
    sourceOrderCode: kod(sourceOrderLink, /\/order\/detail\/([^/?#]+)/),
  };
}

export type Detail = ReturnType<typeof vytahniDetail>;

/** Stránka detailu, která opravdu je detail (ne chybová stránka nebo prázdná kostra). */
export function jeDetail(d: Detail): boolean {
  return Object.keys(d.kv).length >= 3 || d.statusHistory.length > 0;
}

/**
 * Stáhne detail s opakováním (3 pokusy, prodlužovaná pauza). Když ZL
 * mezitím odhlásí, zavolá `znovuPrihlasit` a zkusí to znovu.
 */
export async function stahniDetail(page: Page, url: string, druh: "order" | "claim", znovuPrihlasit: () => Promise<void>): Promise<Detail> {
  let posledni: unknown = null;
  for (let pokus = 1; pokus <= 3; pokus++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: pokus === 1 ? 20000 : 40000 });
      if (await jePrihlaseni(page)) {
        await znovuPrihlasit();
        continue;
      }
      const d = await page.evaluate(vytahniDetail, druh);
      if (!jeDetail(d)) throw new Error("stránka nevypadá jako detail zakázky");
      return d;
    } catch (e) {
      posledni = e;
      await pauza(1500 * pokus);
    }
  }
  throw posledni instanceof Error ? posledni : new Error(String(posledni));
}

/** Jedna strana seznamu s opakováním a novým přihlášením. */
export async function stahniStranu(page: Page, s: Seznam, strana: number, znovuPrihlasit: () => Promise<void>): Promise<ReturnType<typeof vytahniSeznam>> {
  let posledni: unknown = null;
  for (let pokus = 1; pokus <= 3; pokus++) {
    try {
      await page.goto(urlStrany(s, strana), { waitUntil: "domcontentloaded", timeout: 30000 });
      if (await jePrihlaseni(page)) {
        await znovuPrihlasit();
        continue;
      }
      await pauza(300);
      return await page.evaluate(vytahniSeznam, s.odkaz);
    } catch (e) {
      posledni = e;
      await pauza(1500 * pokus);
    }
  }
  throw posledni instanceof Error ? posledni : new Error(String(posledni));
}

/**
 * Pokus o export zákazníků (v ZL: Zákazníci → Export zákazníků, CSV
 * s ID, názvem, telefonem, e-mailem, firmou, IČO a DIČ). NEOVĚŘENO
 * naživo – adresa seznamu i text tlačítka jsou odhad podle ostatních
 * seznamů ZL. Když se nepovede, vrátí null a zákazníci se sestaví
 * z údajů na zakázkách.
 */
export async function stahniExportZakazniku(page: Page, log: Log): Promise<string | null> {
  try {
    await page.goto(`${ZL}/customers/`, { waitUntil: "domcontentloaded", timeout: 30000 });
    if (await jePrihlaseni(page)) return null;
    const tlacitko = page.locator("a, button").filter({ hasText: /export/i }).first();
    if ((await tlacitko.count()) === 0) {
      log("Export zákazníků: na stránce Zákazníci jsem tlačítko Export nenašel.");
      return null;
    }
    const [stazeni] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), tlacitko.click()]);
    const cesta = await stazeni.path();
    return cesta ? fs.readFileSync(cesta, "utf8") : null;
  } catch (e) {
    log(`Export zákazníků se nepovedl (${(e instanceof Error ? e.message : String(e)).split("\n")[0]}) – zákazníci se vezmou ze zakázek.`);
    return null;
  }
}

/** Ceník z API ZL (`/api/rest/device-type/list` a `/{id}`), tokeny jen z proměnných prostředí. */
export async function stahniKatalog(tokeny: { applicationToken: string; brandToken: string }, log: Log): Promise<Record<string, unknown>> {
  const base = "https://zakazkovylist.cz/api/rest/device-type/";
  const get = async (cesta: string) => {
    let chyba: unknown = null;
    for (let pokus = 1; pokus <= 3; pokus++) {
      try {
        const r = await fetch(base + cesta, { headers: { ...tokeny, Accept: "application/json" }, signal: AbortSignal.timeout(30000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as unknown;
      } catch (e) {
        chyba = e;
        await pauza(1500 * pokus);
      }
    }
    throw chyba instanceof Error ? chyba : new Error(String(chyba));
  };
  const seznam = (await get("list")) as { response?: Record<string, { id: number }> } | Record<string, { id: number }>;
  const zarizeni = ("response" in seznam && seznam.response ? seznam.response : seznam) as Record<string, { id: number }>;
  const ids = Object.values(zarizeni).map((v) => v.id);
  log(`Ceník: ${ids.length} zařízení v katalogu, stahuji detaily…`);
  const out: Record<string, unknown> = {};
  let i = 0;
  const chyby: string[] = [];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (i < ids.length) {
        const id = ids[i++];
        try {
          out[String(id)] = await get(String(id));
        } catch (e) {
          chyby.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }),
  );
  if (chyby.length) log(`Ceník: ${chyby.length} zařízení se nestáhlo (${chyby.slice(0, 3).join(", ")}…)`);
  return out;
}
