/**
 * Odezva aplikace při běžné práci: seznam zakázek, hledání, filtr, detail,
 * zákazníci, sklad, faktury, statistiky.
 *
 *   E2E_PASSWORD='…' node scripts/zatez/appka.mjs
 *   E2E_PASSWORD='…' node scripts/zatez/appka.mjs --url http://localhost:5194/ --opakovani 3
 *   E2E_PASSWORD='…' node scripts/zatez/appka.mjs --servis <uuid>   # jen testovací servisy
 *
 * Proti `prohlizec.mjs`, který měří načtení balíku až po přihlašovací
 * obrazovku, tenhle skript měří to, co dělá člověk **po** přihlášení – tedy
 * část, kde se čas škáluje s množstvím dat v servisu.
 *
 * Měří se dvě různé věci a nemají se plést:
 *   - **do vykreslení** – kdy se objeví to, kvůli čemu tam uživatel šel
 *     (první řádek seznamu, políčko hledání, tlačítko Uzávěrka);
 *   - **do konce načítání** – kdy dojede poslední dotaz do databáze. Seznam
 *     zakázek se od 6. 9. 2026 vykresluje z první stránky a zbytek dojíždí
 *     na pozadí, takže mezi těmi dvěma čísly je rozdíl na vteřiny.
 *
 * Čas se bere z `performance.now()` uvnitř stránky, ne z Playwrightu – ten by
 * měřil i čekání vlastního protokolu. Dotazy se počítají obalením `fetch`,
 * protože vědět „kolikrát se sáhlo do databáze" je u téhle stránky
 * užitečnější než milisekundy: přibývají s objemem dat.
 *
 * Měří se **na produkčním balíku** (`npm run build:web` + `vite preview`).
 * Dev server posílá stovky nezabalených modulů a React v něm běží v pomalém
 * režimu – čísla by neodpovídala ničemu, co uvidí uživatel.
 *
 * Skript sám nic nezapisuje. Jediná stopa je ta, kterou by nechalo i normální
 * otevření stránky Faktury: aplikace tam sama přeznačí faktury po splatnosti.
 * Proto se pouští jen proti testovacím servisům – hlídá to `overServis`.
 */

import { chromium } from "@playwright/test";
import { nactiEnv, overServis } from "./spolecne.mjs";

const arg = (jmeno, vychozi) => {
  const i = process.argv.indexOf(`--${jmeno}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : vychozi;
};

const env = nactiEnv();
const HESLO = env.E2E_PASSWORD;
if (!HESLO) {
  console.log("# Chybí E2E_PASSWORD – měření aplikace se přeskakuje (postup je v e2e/README.md).");
  process.exit(0);
}

const URL_APP = arg("url", "http://localhost:5194/");
const SERVIS = overServis(arg("servis", "882beee7-4564-4d10-8ac6-16dc19240b57"));
const OPAK = Number(arg("opakovani", "3"));
const UCET = arg("ucet", "e2e@jobi.test");

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const r0 = (n) => (Number.isFinite(n) ? Math.round(n) : "–");

/**
 * Sleduje dotazy do Supabase přímo v okně.
 *
 * Přes Playwright by to šlo taky, ale ten hlásí požadavky asynchronně a
 * „kolik jich je zrovna rozdělaných" by se z toho spolehlivě nepoznalo.
 */
const SLEDOVAC = () => {
  const w = (window.__zatez = { rozdelano: 0, posledni: performance.now(), pocet: 0, bajtu: 0, cesty: {} });
  const puvodni = window.fetch;
  window.fetch = async (...a) => {
    const url = String(typeof a[0] === "string" ? a[0] : a[0]?.url ?? "");
    const nas = url.includes("/rest/v1/") || url.includes("/functions/v1/");
    if (nas) {
      w.rozdelano += 1;
      w.pocet += 1;
      const cesta = url.split("/rest/v1/")[1]?.split("?")[0] ?? url.split("/functions/v1/")[1]?.split("?")[0] ?? "?";
      w.cesty[cesta] = (w.cesty[cesta] ?? 0) + 1;
    }
    try {
      const o = await puvodni(...a);
      if (nas) o.clone().arrayBuffer().then((b) => { w.bajtu += b.byteLength; }).catch(() => {});
      return o;
    } finally {
      if (nas) { w.rozdelano -= 1; w.posledni = performance.now(); }
    }
  };
};

/** Čeká, až není rozdělaný žádný dotaz a chvíli žádný nepřibude. */
const klidSite = (page, klid = 700, limit = 120_000) =>
  page.evaluate(
    async ([klid, limit]) => {
      const w = window.__zatez;
      const start = performance.now();
      for (;;) {
        if (w.rozdelano === 0 && performance.now() - w.posledni > klid) return true;
        if (performance.now() - start > limit) return false;
        await new Promise((r) => setTimeout(r, 40));
      }
    },
    [klid, limit],
  );

const znacka = (page) => page.evaluate(() => { window.__t0 = performance.now(); });
const odZnacky = (page) => page.evaluate(() => performance.now() - window.__t0);
const nuluj = (page) => page.evaluate(() => { const w = window.__zatez; w.pocet = 0; w.bajtu = 0; w.cesty = {}; w.posledni = performance.now(); });
const stav = (page) => page.evaluate(() => ({ pocet: window.__zatez.pocet, kb: Math.round(window.__zatez.bajtu / 1024), cesty: window.__zatez.cesty }));

async function pockej(page, locator, limit = 120_000) {
  await locator.first().waitFor({ state: "visible", timeout: limit });
  return odZnacky(page);
}

const naStranku = (page, jmeno) =>
  page.evaluate((p) => window.dispatchEvent(new CustomEvent("jobsheet:navigate", { detail: { page: p } })), jmeno);

async function jedenBeh(browser, vysledky) {
  // Vlastní kontext pokaždé – jinak by druhý běh měřil cache prohlížeče.
  const ctx = await browser.newContext({ locale: "cs-CZ", viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  await page.addInitScript(SLEDOVAC);
  // Účet bývá ve víc servisech; bez téhle volby by appka vzala první ze seznamu.
  await page.addInitScript(([k, id]) => localStorage.setItem(k, id), ["jobsheet_active_service_id_v1", SERVIS]);
  const zapis = (k, v) => { (vysledky[k] ??= []).push(v); };

  await page.goto(URL_APP);
  await page.locator('input[type="email"]').first().fill(UCET);
  await page.locator('input[type="password"]').first().fill(HESLO);

  // 1) Přihlášení → seznam zakázek
  await znacka(page);
  await nuluj(page);
  await page.getByRole("button", { name: "Přihlásit se" }).click();
  zapis("zakázky – kostra stránky", await pockej(page, page.getByRole("button", { name: "+ Nová zakázka" })));
  // Řádek se pozná podle čísla zakázky: zkratka servisu (může mít i číslici,
  // třeba „E2E") a za ní pořadové číslo.
  const prvniRadek = page.locator('[data-tour="orders-list"]').locator("text=/^[A-Z0-9]{2,8}\\d{4,}$/");
  zapis("zakázky – první řádek", await pockej(page, prvniRadek));
  await klidSite(page);
  zapis("zakázky – konec načítání", await odZnacky(page));
  const s1 = await stav(page);
  zapis("zakázky – dotazů", s1.pocet);
  zapis("zakázky – staženo kB", s1.kb);
  vysledky.__cesty = s1.cesty;

  // 2) Hledání – kolik stojí jeden úhoz (přefiltrovat a překreslit seznam)
  const hledani = page.getByPlaceholder("Vyhledávání…").first();
  await hledani.click();
  const uhozy = [];
  for (const zn of "Novák".split("")) {
    const t = await page.evaluate(() => performance.now());
    await page.keyboard.type(zn);
    // Dvě animační snímky = jistota, že prohlížeč překreslení opravdu dokončil.
    uhozy.push(await page.evaluate(async (t0) => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return performance.now() - t0;
    }, t));
  }
  zapis("hledání – nejdelší úhoz", Math.max(...uhozy));
  await hledani.fill("");
  await page.waitForTimeout(400);

  // 3) Filtr na dokončené
  await znacka(page);
  await page.getByText(/^Dokončené/).first().click();
  await page.waitForTimeout(0);
  zapis("filtr Dokončené", await odZnacky(page));
  await page.getByText(/^Vše/).first().click();
  await page.waitForTimeout(300);

  // 4) Otevření detailu první zakázky
  await znacka(page);
  await nuluj(page);
  await prvniRadek.first().click();
  zapis("detail – otevření", await pockej(page, page.getByRole("button", { name: /Upravit/ })).catch(() => NaN));
  await klidSite(page);
  zapis("detail – konec načítání", await odZnacky(page));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // 5) Zákazníci
  await znacka(page);
  await nuluj(page);
  await naStranku(page, "customers");
  zapis("zákazníci – kostra stránky", await pockej(page, page.getByPlaceholder("Vyhledávání zákazníků…")));
  await klidSite(page);
  zapis("zákazníci – konec načítání", await odZnacky(page));
  zapis("zákazníci – dotazů", (await stav(page)).pocet);

  // 6) Sklad
  await znacka(page);
  await nuluj(page);
  await naStranku(page, "inventory");
  await klidSite(page);
  zapis("sklad – konec načítání", await odZnacky(page));
  zapis("sklad – dotazů", (await stav(page)).pocet);

  // 7) Faktury
  await znacka(page);
  await nuluj(page);
  await naStranku(page, "invoices");
  zapis("faktury – kostra stránky", await pockej(page, page.getByRole("button", { name: "Uzávěrka" })).catch(() => NaN));
  await klidSite(page);
  zapis("faktury – konec načítání", await odZnacky(page));

  // 8) Statistiky – dokud se počítá, jsou v dlaždicích šedé obdélníky
  await znacka(page);
  await nuluj(page);
  await naStranku(page, "statistics");
  await page.getByText("Celkem zakázek").first().waitFor({ timeout: 120_000 }).catch(() => {});
  zapis("statistiky – kostra stránky", await odZnacky(page));
  await page.locator(".stats-skeleton").first().waitFor({ state: "detached", timeout: 120_000 }).catch(() => {});
  await klidSite(page);
  zapis("statistiky – konec načítání", await odZnacky(page));

  // 9) Zpět na zakázky – stránka zůstává připojená, měří se jen překreslení
  await znacka(page);
  await naStranku(page, "orders");
  zapis("návrat na zakázky", await pockej(page, prvniRadek));

  await ctx.close();
}

const browser = await chromium.launch();
const vysledky = {};
for (let i = 0; i < OPAK; i++) {
  process.stderr.write(`# běh ${i + 1}/${OPAK}\n`);
  await jedenBeh(browser, vysledky);
}
await browser.close();

console.log(`\n# Odezva aplikace – servis ${SERVIS}, ${OPAK} běhů\n`);
console.log("| Co | medián | min | max |");
console.log("|---|---:|---:|---:|");
for (const [k, v] of Object.entries(vysledky)) {
  if (k.startsWith("__")) continue;
  console.log(`| ${k} | ${r0(med(v))} | ${r0(Math.min(...v))} | ${r0(Math.max(...v))} |`);
}
console.log("\n# dotazy na seznamu zakázek podle tabulky");
console.log(JSON.stringify(vysledky.__cesty ?? {}));
