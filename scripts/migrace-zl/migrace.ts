#!/usr/bin/env node
/**
 * Migrace servisu ze Zakázkového listu do Jobi – jeden příkaz.
 *
 *   node migrace.ts              stáhne všechno a vyrobí CSV (= stahnout + prevest)
 *   node migrace.ts zkouska      bez přihlášení ověří, že přihlašovací stránka ZL vypadá, jak bot čeká
 *   node migrace.ts stahnout     jen stažení (průběžně ukládá, po pádu pokračuje)
 *   node migrace.ts prevest      jen převod už stažených dat na CSV + report.md
 *
 * Přihlašovací údaje: ZL_EMAIL a ZL_PASSWORD z prostředí, jinak se zeptá
 * (heslo se nevypisuje). Nikam se neukládají. Podrobnosti v README.md.
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { parseArgs } from "node:util";
import { preved, posledniPodleKodu, type ZlZaznam } from "./prevod.ts";
import {
  SEZNAM_REKLAMACI,
  SEZNAM_ZAKAZEK,
  odlehcenaStranka,
  overPrihlasovaciStranku,
  prihlasit,
  stahniDetail,
  stahniExportZakazniku,
  stahniKatalog,
  stahniStranu,
  type Seznam,
} from "./stahovani.ts";

const NAPOVEDA = `Migrace ze Zakázkového listu do Jobi

Použití: node migrace.ts [vse|zkouska|stahnout|prevest] [volby]

Volby:
  --vystup <složka>        kam ukládat (výchozí ./migrace-zl-vystup)
  --vstup <složka>         u „prevest“: odkud číst stažená data (výchozí = --vystup)
  --pobocka <text>         část názvu pobočky ZL, když jich má účet víc
  --od-strany <n>          seznam zakázek začít od strany n (po pádu uprostřed seznamu)
  --znovu-seznam           projet seznamy znovu, i když jsou z posledních 12 hodin
  --soubezne <n>           kolik detailů stahovat najednou (výchozí 3, max 6)
  --bez-reklamaci          reklamace nestahovat
  --bez-exportu-zakazniku  nezkoušet stáhnout export zákazníků ze ZL
  --zakaznici-csv <soubor> export zákazníků ze ZL stažený ručně (Zákazníci → Export)
  --katalog-json <soubor>  už stažený detail ceníku z API ZL
  --cenik-ze-zakazek       bez API sestavit hrubý ceník z provedených oprav
  --s-hesly                přenést i hesla / kódy obrazovky zařízení
  --viditelne              ukázat okno prohlížeče (ladění)
  -h, --help               tahle nápověda

Prostředí: ZL_EMAIL, ZL_PASSWORD, ZL_POBOCKA, ZL_APPLICATION_TOKEN + ZL_BRAND_TOKEN (ceník z API).`;

const { values: volby, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    vystup: { type: "string", default: "migrace-zl-vystup" },
    vstup: { type: "string" },
    pobocka: { type: "string" },
    "od-strany": { type: "string" },
    "znovu-seznam": { type: "boolean", default: false },
    soubezne: { type: "string", default: "3" },
    "bez-reklamaci": { type: "boolean", default: false },
    "bez-exportu-zakazniku": { type: "boolean", default: false },
    "zakaznici-csv": { type: "string" },
    "katalog-json": { type: "string" },
    "cenik-ze-zakazek": { type: "boolean", default: false },
    "s-hesly": { type: "boolean", default: false },
    viditelne: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

const prikaz = positionals[0] ?? "vse";
const VYSTUP = path.resolve(volby.vystup!);
const VSTUP = path.resolve(volby.vstup ?? volby.vystup!);

function log(zprava: string) {
  const radek = `[${new Date().toLocaleTimeString("cs-CZ")}] ${zprava}`;
  console.log(radek);
  try {
    fs.appendFileSync(path.join(VYSTUP, "stahovani.log"), radek + "\n", { mode: 0o600 });
  } catch {
    // log je jen pomůcka – složka ještě nemusí existovat
  }
}

/** Soubory s osobními údaji: složka jen pro vlastníka účtu v počítači. */
function pripravSlozku(dir: string) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}
function zapis(soubor: string, obsah: string) {
  fs.writeFileSync(soubor, obsah, { encoding: "utf8", mode: 0o600 });
}
function pridejRadek(soubor: string, zaznam: unknown) {
  fs.appendFileSync(soubor, JSON.stringify(zaznam) + "\n", { encoding: "utf8", mode: 0o600 });
}

/** Jen první řádek chyby – Playwright přidává dlouhý „Call log“. */
function kratkaChyba(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).split("\n")[0].trim();
}

function prectiNdjson(soubor: string): ZlZaznam[] {
  if (!fs.existsSync(soubor)) return [];
  const out: ZlZaznam[] = [];
  for (const radek of fs.readFileSync(soubor, "utf8").split("\n")) {
    if (!radek.trim()) continue;
    try {
      out.push(JSON.parse(radek) as ZlZaznam);
    } catch {
      // poslední řádek přerušený uprostřed zápisu – ten kód se stáhne znovu
    }
  }
  return out;
}

// ── dotazy v terminálu ──────────────────────────────────────────────────────

function zeptej(otazka: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(otazka, (o) => { rl.close(); resolve(o.trim()); }));
}

/** Heslo bez ozvěny na obrazovce (raw mód terminálu). */
function zeptejSkryte(otazka: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(otazka);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let s = "";
    const konec = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", naZnak);
      process.stdout.write("\n");
    };
    const naZnak = (data: string) => {
      for (const c of data) {
        if (c === "\r" || c === "\n") { konec(); resolve(s); return; }
        if (c === "\u0003") { konec(); process.exit(130); }
        if (c === "\u007f" || c === "\b") s = s.slice(0, -1);
        else s += c;
      }
    };
    stdin.on("data", naZnak);
  });
}

async function udaje(): Promise<{ email: string; heslo: string }> {
  let email = process.env.ZL_EMAIL ?? "";
  let heslo = process.env.ZL_PASSWORD ?? "";
  if ((!email || !heslo) && !process.stdin.isTTY) throw new Error("Chybí ZL_EMAIL / ZL_PASSWORD a nejde se zeptat (není terminál).");
  if (!email) email = await zeptej("E-mail do Zakázkového listu: ");
  if (!heslo) heslo = await zeptejSkryte("Heslo (nezobrazuje se): ");
  if (!email || !heslo) throw new Error("E-mail i heslo jsou potřeba.");
  return { email, heslo };
}

// ── Playwright ──────────────────────────────────────────────────────────────

async function spustProhlizec() {
  let pw: typeof import("playwright");
  try {
    pw = await import("playwright");
  } catch {
    throw new Error("Chybí Playwright. Ve složce skriptu spusťte: npm install && npx playwright install chromium");
  }
  try {
    return await pw.chromium.launch({ headless: !volby.viditelne });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (/Executable doesn't exist|install/i.test(m)) throw new Error("Chybí prohlížeč pro Playwright. Spusťte: npx playwright install chromium");
    throw e;
  }
}

async function zkouska() {
  const browser = await spustProhlizec();
  try {
    const v = await overPrihlasovaciStranku(browser);
    console.log(v.zprava);
    if (!v.ok) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

type StavSeznamu = { stran: number; hotoveStrany: number[]; kody: string[]; stavy: Record<string, string>; hotovo: string | null };

function souborSeznamu(s: Seznam) {
  return path.join(VYSTUP, s.druh === "order" ? "seznam-zakazek.json" : "seznam-reklamaci.json");
}
function souborZaznamu(s: Seznam) {
  return path.join(VYSTUP, s.druh === "order" ? "zakazky.ndjson" : "reklamace.ndjson");
}

async function stahnout() {
  pripravSlozku(VYSTUP);
  const { email, heslo } = await udaje();
  const pobocka = volby.pobocka ?? process.env.ZL_POBOCKA ?? null;
  const soubezne = Math.min(6, Math.max(1, parseInt(volby.soubezne!, 10) || 3));
  const browser = await spustProhlizec();
  const context = await browser.newContext({ acceptDownloads: true });

  process.on("SIGINT", () => {
    console.log("\nPřerušeno. Staženo zůstává ve složce – stejný příkaz pokračuje tam, kde to skončilo.");
    process.exit(130);
  });

  const hlavni = await odlehcenaStranka(context);
  const vyberPobocky = async (nazvy: string[]) => {
    if (!process.stdin.isTTY) throw new Error(`Účet má víc poboček, zadejte --pobocka: ${nazvy.join(" · ")}`);
    nazvy.forEach((n, i) => console.log(`  ${i + 1}) ${n}`));
    const o = parseInt(await zeptej("Kterou pobočku stáhnout? Číslo: "), 10);
    if (!(o >= 1 && o <= nazvy.length)) throw new Error("Neplatná volba pobočky.");
    return o - 1;
  };
  const prihlaseni = { email, heslo, pobocka, vyberPobocky };
  let zvolenaPobocka: string | null = pobocka;
  await prihlasit(hlavni, { ...prihlaseni, vyberPobocky: async (n) => { const i = await vyberPobocky(n); zvolenaPobocka = n[i]; return i; } }, log);
  log("Přihlášení v pořádku.");

  // Nové přihlášení při vypršené relaci – jen jedno najednou, ostatní počkají.
  let probihajici: Promise<void> | null = null;
  const znovuPrihlasit = async () => {
    if (!probihajici) {
      log("Relace vypršela, přihlašuji znovu…");
      probihajici = prihlasit(hlavni, { ...prihlaseni, pobocka: zvolenaPobocka }, log).finally(() => { probihajici = null; });
    }
    await probihajici;
  };

  const seznamy = volby["bez-reklamaci"] ? [SEZNAM_ZAKAZEK] : [SEZNAM_ZAKAZEK, SEZNAM_REKLAMACI];
  for (const s of seznamy) {
    const nazev = s.druh === "order" ? "zakázek" : "reklamací";
    // 1) seznam kódů – ukládá se po každé straně
    const soubor = souborSeznamu(s);
    let stav: StavSeznamu = fs.existsSync(soubor) ? JSON.parse(fs.readFileSync(soubor, "utf8")) : { stran: 0, hotoveStrany: [], kody: [], stavy: {}, hotovo: null };
    const cerstvy = stav.hotovo && Date.now() - new Date(stav.hotovo).getTime() < 12 * 3600 * 1000;
    if (cerstvy && !volby["znovu-seznam"] && !volby["od-strany"]) {
      log(`Seznam ${nazev}: použit uložený z ${new Date(stav.hotovo!).toLocaleString("cs-CZ")} (${stav.kody.length} kódů).`);
    } else {
      if (stav.hotovo) stav = { ...stav, hotoveStrany: [], hotovo: null };
      const hotove = new Set(stav.hotoveStrany);
      const kody = new Set(stav.kody);
      let strana = s.druh === "order" && volby["od-strany"] ? Math.max(1, parseInt(volby["od-strany"], 10) || 1) : 1;
      let stran = Math.max(stav.stran, 1);
      while (strana <= stran) {
        if (!hotove.has(strana)) {
          const v = await stahniStranu(hlavni, s, strana, znovuPrihlasit);
          stran = Math.max(stran, v.stran);
          for (const r of v.radky) {
            kody.add(r.kod);
            if (r.stav) stav.stavy[r.kod] = r.stav;
          }
          hotove.add(strana);
          stav = { ...stav, stran, hotoveStrany: [...hotove].sort((a, b) => a - b), kody: [...kody] };
          zapis(soubor, JSON.stringify(stav));
          if (strana % 10 === 0 || strana === stran) log(`Seznam ${nazev}: strana ${strana}/${stran}, ${kody.size} kódů`);
        }
        strana += 1;
      }
      stav = { ...stav, hotovo: new Date().toISOString() };
      zapis(soubor, JSON.stringify(stav));
      log(`Seznam ${nazev}: ${stav.kody.length} kódů na ${stav.stran} stranách.`);
    }

    // 2) detaily – každý hned na disk; hotové (bez chyby) se přeskočí
    const cil = souborZaznamu(s);
    const hotoveKody = new Set(posledniPodleKodu(prectiNdjson(cil)).filter((z) => !z.error).map((z) => z.code));
    const todo = stav.kody.filter((k) => !hotoveKody.has(k));
    log(`Detaily ${nazev}: ${hotoveKody.size} už staženo, ${todo.length} zbývá.`);
    let i = 0;
    let hotovo = 0;
    let chyb = 0;
    // Víc chyb za sebou = spadlo spojení nebo ZL; nemá smysl projíždět zbytek naprázdno.
    let chybZaSebou = 0;
    const MAX_ZA_SEBOU = 8;
    const start = Date.now();
    await Promise.all(
      Array.from({ length: Math.min(soubezne, todo.length) }, async () => {
        const page = await odlehcenaStranka(context);
        while (i < todo.length && chybZaSebou < MAX_ZA_SEBOU) {
          const kod = todo[i++];
          try {
            const d = await stahniDetail(page, s.detail + kod, s.druh, znovuPrihlasit);
            pridejRadek(cil, { code: kod, kind: s.druh, scrapedAt: new Date().toISOString(), ...d });
            chybZaSebou = 0;
          } catch (e) {
            chyb += 1;
            chybZaSebou += 1;
            const m = kratkaChyba(e);
            log(`  chyba ${kod}: ${m}`);
            pridejRadek(cil, { code: kod, kind: s.druh, scrapedAt: new Date().toISOString(), error: m });
          }
          hotovo += 1;
          if (hotovo % 25 === 0 || hotovo === todo.length) {
            const zaSekundu = hotovo / ((Date.now() - start) / 1000);
            log(`  ${nazev}: ${hotovo}/${todo.length}${chyb ? ` (${chyb} chyb)` : ""}, zbývá asi ${Math.ceil((todo.length - hotovo) / zaSekundu / 60)} min`);
          }
        }
        await page.close();
      }),
    );
    if (chybZaSebou >= MAX_ZA_SEBOU) {
      throw new Error(`${MAX_ZA_SEBOU} detailů za sebou se nestáhlo – nejspíš vypadlo připojení nebo Zakázkový list neodpovídá. Staženo zůstává, spusťte stejný příkaz znovu.`);
    }
  }

  // 3) export zákazníků (neověřená cesta – když selže, nevadí)
  if (!volby["bez-exportu-zakazniku"] && !volby["zakaznici-csv"]) {
    const exp = await stahniExportZakazniku(hlavni, log);
    if (exp) {
      zapis(path.join(VYSTUP, "zakaznici-export-zl.csv"), exp);
      log("Export zákazníků ze ZL stažen.");
    }
  }
  await browser.close();

  // 4) ceník z API – jen s tokeny
  const applicationToken = process.env.ZL_APPLICATION_TOKEN;
  const brandToken = process.env.ZL_BRAND_TOKEN;
  if (applicationToken && brandToken && !volby["katalog-json"]) {
    try {
      const katalog = await stahniKatalog({ applicationToken, brandToken }, log);
      zapis(path.join(VYSTUP, "katalog.json"), JSON.stringify(katalog));
      log(`Ceník: ${Object.keys(katalog).length} zařízení staženo.`);
    } catch (e) {
      log(`Ceník z API se nestáhl: ${kratkaChyba(e)}`);
    }
  }
}

/** První existující soubor – nové názvy, pak názvy ze starého scrape_all.js. */
function najdi(dir: string, ...jmena: string[]): string | null {
  for (const j of jmena) {
    const p = path.join(dir, j);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function prevest() {
  const zakazkySoubor = najdi(VSTUP, "zakazky.ndjson", "orders_export.ndjson");
  if (!zakazkySoubor) throw new Error(`Ve složce ${VSTUP} nejsou stažené zakázky (zakazky.ndjson). Nejdřív: node migrace.ts stahnout`);
  const reklamaceSoubor = najdi(VSTUP, "reklamace.ndjson", "claims_export.ndjson");
  const exportSoubor = volby["zakaznici-csv"] ? path.resolve(volby["zakaznici-csv"]) : najdi(VSTUP, "zakaznici-export-zl.csv");
  const katalogSoubor = volby["katalog-json"] ? path.resolve(volby["katalog-json"]) : najdi(VSTUP, "katalog.json");
  const seznam = (j: string) => {
    const p = najdi(VSTUP, j);
    return p ? (JSON.parse(fs.readFileSync(p, "utf8")) as StavSeznamu) : null;
  };
  const sz = seznam("seznam-zakazek.json");
  const sr = seznam("seznam-reklamaci.json");

  const v = preved({
    zakazky: prectiNdjson(zakazkySoubor),
    reklamace: reklamaceSoubor ? prectiNdjson(reklamaceSoubor) : [],
    exportZakazniku: exportSoubor ? fs.readFileSync(exportSoubor, "utf8") : null,
    katalog: katalogSoubor ? (JSON.parse(fs.readFileSync(katalogSoubor, "utf8")) as Record<string, unknown>) : null,
    cenikZeZakazek: volby["cenik-ze-zakazek"],
    sHesly: volby["s-hesly"],
    kodyVSeznamu: sz?.hotovo ? { zakazky: sz.kody.length, reklamace: sr?.kody.length ?? 0 } : null,
  });
  pripravSlozku(VYSTUP);
  for (const [jmeno, obsah] of Object.entries(v.soubory)) zapis(path.join(VYSTUP, jmeno), obsah);
  zapis(path.join(VYSTUP, "report.md"), v.report);
  log(`Hotovo: ${v.pocty.zakazek} zakázek, ${v.pocty.zakazniku} zákazníků, ${v.pocty.cenikRadku} řádků ceníku${v.pocty.chyb ? `, ${v.pocty.chyb} nestažených detailů` : ""}.`);
  log(`Soubory jsou v ${VYSTUP} – začněte report.md.`);
}

async function main() {
  if (volby.help) {
    console.log(NAPOVEDA);
    return;
  }
  if (prikaz === "zkouska") return zkouska();
  if (prikaz === "prevest") return prevest();
  if (prikaz === "stahnout") return stahnout();
  if (prikaz === "vse") {
    await stahnout();
    return prevest();
  }
  console.log(NAPOVEDA);
  process.exitCode = 2;
}

main().catch((e) => {
  console.error(`Chyba: ${kratkaChyba(e)}`);
  process.exit(1);
});
