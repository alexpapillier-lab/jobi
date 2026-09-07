/**
 * Kontrola nastavení plateb (Stripe) – po „dni D“.
 *
 * Odpovídá na jedinou otázku: **sedí to, co je nastavené u Stripe, s tím, co
 * čeká aplikace a co slibuje ceník na webu?** Postup nastavení je
 * v `docs/PLATBY_DEN_D.md`, tenhle skript ho jen zkontroluje.
 *
 * Zásady:
 *   - **Nic nemění.** Do Stripe jde jedno GET volání na ceny a jedno na
 *     webhooky, nikam jinam. Do databáze nesahá vůbec.
 *   - **Tajemství nikdy nevypisuje.** Ověřuje jen, že existují a mají správný
 *     tvar (`sk_…`/`rk_…`, `whsec_…`); hodnota se nikde neobjeví ani zkrácená.
 *   - **Jde spustit i bez klíčů.** Co nejde ověřit, se vypíše jako
 *     „nelze ověřit“ i s tím, co k tomu chybí – místo pádu.
 *
 * Použití:
 *   npm run platby:kontrola                       – co jde bez klíče od Stripe
 *   STRIPE_SECRET_KEY=rk_test_… npm run platby:kontrola
 *   npm run platby:kontrola -- --offline          – jen soubory, žádná síť
 *
 * Klíč se dá dát i do `.env`. Doporučeně **restricted key** (`rk_…`) s právem
 * jen číst ceny a webhooky – skript víc nepotřebuje a ukradený klíč pak nic
 * nesvede.
 *
 * Návratový kód: 0 = v pořádku (i s upozorněními), 1 = nalezen rozpor.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const KOREN = join(dirname(fileURLToPath(import.meta.url)), "..");
const OFFLINE = process.argv.includes("--offline");

// ---------------------------------------------------------------------------
// Výpis
// ---------------------------------------------------------------------------

const nalezy = { ok: 0, pozor: [], chyba: [], neover: [] };

const ok = (t) => { nalezy.ok++; console.log(`  OK      ${t}`); };
const chyba = (t) => { nalezy.chyba.push(t); console.log(`  CHYBA   ${t}`); };
const pozor = (t) => { nalezy.pozor.push(t); console.log(`  POZOR   ${t}`); };
const neover = (t) => { nalezy.neover.push(t); console.log(`  ?       ${t}`); };
const nadpis = (t) => console.log(`\n${t}\n${"-".repeat(t.length)}`);

/** Kč z haléřů, jak je drží Stripe. */
const kc = (halere) => halere == null ? "—" : `${(halere / 100).toLocaleString("cs-CZ")} Kč`;

// ---------------------------------------------------------------------------
// Vstupy: .env, PLANS ze zdrojáku, ceník z webu
// ---------------------------------------------------------------------------

/** Načte .env z kořene. Bez dotenv a bez pádu, když soubor není. */
function nactiEnv() {
  const env = { ...process.env };
  try {
    for (const radek of readFileSync(join(KOREN, ".env"), "utf8").split("\n")) {
      const m = radek.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    // .env nemusí existovat – proměnné pak musí přijít z prostředí
  }
  return env;
}

/**
 * Tarify a příplatky ze `supabase/functions/_shared/stripe.ts`.
 *
 * Čte se zdroják, ne kopie: kdyby se tabulka `PLANS` v aplikaci změnila
 * a tenhle skript měl svůj vlastní seznam, kontrola by potvrzovala nastavení
 * proti něčemu, co už nikde neplatí.
 */
function nactiTarify() {
  const zdroj = readFileSync(join(KOREN, "supabase/functions/_shared/stripe.ts"), "utf8");

  const blok = (jmeno) => {
    const zacatek = zdroj.indexOf(`export const ${jmeno}`);
    if (zacatek < 0) throw new Error(`Ve stripe.ts chybí ${jmeno}.`);
    const konec = zdroj.indexOf("\n};", zacatek);
    return zdroj.slice(zacatek, konec);
  };

  const plany = {};
  for (const radek of blok("PLANS").split("\n")) {
    const m = radek.match(/^\s*(jobi_[a-z_]+):\s*\{(.*)\},?\s*$/);
    if (!m) continue;
    const telo = m[2];
    const cislo = (pole) => Number(telo.match(new RegExp(`${pole}:\\s*(\\d+)`))?.[1] ?? NaN);
    const text = (pole) => telo.match(new RegExp(`${pole}:\\s*"([^"]+)"`))?.[1] ?? null;
    plany[m[1]] = {
      label: text("label"),
      tier: text("tier"),
      interval: text("interval"),
      branchesIncluded: cislo("branchesIncluded"),
      smsIncluded: cislo("smsIncluded"),
    };
  }

  const priplatky = {};
  for (const radek of blok("ADDONS").split("\n")) {
    const m = radek.match(/^\s*(jobi_[a-z_]+):\s*\{(.*)\},?\s*$/);
    if (!m) continue;
    priplatky[m[1]] = {
      sms: Number(m[2].match(/sms:\s*(\d+)/)?.[1] ?? 0),
      branches: Number(m[2].match(/branches:\s*(\d+)/)?.[1] ?? 0),
      interval: m[1].endsWith("_yearly") ? "year" : "month",
    };
  }

  const sleva = Number(
    readFileSync(join(KOREN, "src/lib/billing.ts"), "utf8").match(/SLEVA_ROCNE\s*=\s*(\d+)/)?.[1] ?? NaN,
  );

  return { plany, priplatky, sleva };
}

/** Číslo z ceny na webu: „od 2&nbsp;490&nbsp;Kč“ → 249000 haléřů. */
function castkaZWebu(text) {
  if (!text) return null;
  const cislice = text.replace(/&nbsp;| /g, " ").match(/(\d[\d\s]*)/);
  if (!cislice) return null;
  return Number(cislice[1].replace(/\s/g, "")) * 100;
}

/**
 * Ceník z `web/index.html`. Web je to, co vidí zákazník, takže je v otázce
 * částek zdrojem pravdy – Stripe se srovnává proti němu, ne naopak.
 */
function nactiCenikZWebu() {
  const html = readFileSync(join(KOREN, "web/index.html"), "utf8");
  const cenik = { tarify: {}, priplatky: {}, vCene: {} };

  for (const m of html.matchAll(/<article[^>]*data-plan="(starter|business|enterprise)"[\s\S]*?<\/article>/g)) {
    const karta = m[0];
    cenik.tarify[m[1]] = {
      month: castkaZWebu(karta.match(/class="pricing-amount pricing-monthly"[^>]*>([^<]*)</)?.[1]),
      year: castkaZWebu(karta.match(/class="pricing-amount pricing-yearly"[^>]*>([^<]*)</)?.[1]),
      od: /class="pricing-amount pricing-monthly"[^>]*>\s*od\s/.test(karta),
    };
  }

  const radek = (nazev) => {
    const m = html.match(new RegExp(`<tr><td>${nazev}</td>([\\s\\S]*?)</tr>`));
    if (!m) return null;
    return [...m[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map((x) => x[1]);
  };

  const sms = radek("SMS zákazníkům");
  if (sms) {
    cenik.priplatky.sms = castkaZWebu(sms[0]);
    cenik.priplatky.smsZprav = Number(sms[0].replace(/&nbsp;| /g, " ").match(/za\s+(\d+)\s+zpráv/)?.[1] ?? NaN);
    cenik.vCene.sms = ["starter", "business", "enterprise"].reduce((acc, tier, i) => {
      const zpravy = sms[i].replace(/&nbsp;| /g, " ").match(/(\d+)\s+zpráv/);
      // U Starteru je v buňce příplatek „+199 Kč/měs za 100 zpráv“, ne počet v ceně.
      acc[tier] = /Kč/.test(sms[i]) ? 0 : Number(zpravy?.[1] ?? NaN);
      return acc;
    }, {});
  }

  const pobocka = radek("Pobočka navíc");
  if (pobocka) cenik.priplatky.branch = castkaZWebu(pobocka.find((b) => /Kč/.test(b)));

  const vCene = radek("Pobočky v ceně");
  if (vCene) {
    cenik.vCene.branches = { starter: Number(vCene[0]), business: Number(vCene[1]), enterprise: Number(vCene[2]) };
  }

  return cenik;
}

// ---------------------------------------------------------------------------
// Stripe – jen čtení
// ---------------------------------------------------------------------------

/** Tvar klíče. Hodnota se nikam nevypisuje, vrací se jen popis. */
function tvarKlice(hodnota) {
  if (!hodnota) return { je: false };
  const v = hodnota.trim();
  const m = v.match(/^(sk|rk)_(test|live)_[A-Za-z0-9]{10,}$/);
  if (!m) return { je: true, platny: false };
  return { je: true, platny: true, rezim: m[2], omezeny: m[1] === "rk" };
}

async function stripeGet(klic, cesta, dotaz = {}) {
  const url = new URL(`https://api.stripe.com/v1${cesta}`);
  for (const [k, v] of Object.entries(dotaz)) url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${klic}`, "Stripe-Version": "2024-06-20" },
    signal: AbortSignal.timeout(20000),
  });
  const telo = await res.json().catch(() => null);
  if (!res.ok) {
    const e = new Error(telo?.error?.message ?? `HTTP ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return telo;
}

// ---------------------------------------------------------------------------
// Kontroly
// ---------------------------------------------------------------------------

/** 1. Ceník na webu proti tabulce PLANS – tohle jde bez jakéhokoli klíče. */
function kontrolaWebuProtiKodu({ plany, priplatky, sleva }, cenik) {
  nadpis("1. Ceník na webu proti tarifům v kódu");
  const chybNaZacatku = nalezy.chyba.length;

  for (const [klic, def] of Object.entries(plany)) {
    const web = cenik.tarify[def.tier];
    if (!web) { chyba(`Ceník na webu nemá kartu pro tarif ${def.label} (${def.tier}).`); continue; }
    const castka = def.interval === "month" ? web.month : web.year;
    if (castka == null) { chyba(`Ceník na webu nemá ${def.interval === "month" ? "měsíční" : "roční"} cenu tarifu ${def.label}.`); continue; }
    ok(`${klic} → ceník na webu ${kc(castka)}`);
  }

  // Roční cena musí sedět se slevou, kterou slibuje přepínač na webu
  // i obrazovka Předplatné (SLEVA_ROCNE v src/lib/billing.ts).
  for (const [tier, web] of Object.entries(cenik.tarify)) {
    if (web.month == null || web.year == null) continue;
    const ocekavano = Math.round(web.month * 12 * (100 - sleva) / 100);
    if (web.year !== ocekavano) {
      pozor(`Roční cena ${tier} na webu je ${kc(web.year)}, ale ${sleva} % z dvanácti měsíců dává ${kc(ocekavano)}.`);
    } else {
      ok(`Roční ${tier} = 12 × měsíční − ${sleva} % (${kc(web.year)})`);
    }
  }

  // Co web slibuje „v ceně“, musí zapisovat webhook – jinak zákazník zaplatí
  // za tři sta SMS a dostane sto.
  for (const [klic, def] of Object.entries(plany)) {
    if (def.interval !== "month") continue;
    const pobocky = cenik.vCene.branches?.[def.tier];
    if (pobocky != null && pobocky !== def.branchesIncluded) {
      chyba(`Web slibuje u ${def.label} ${pobocky} pobočky v ceně, PLANS zapisuje ${def.branchesIncluded}.`);
    }
    const sms = cenik.vCene.sms?.[def.tier];
    if (sms != null && Number.isFinite(sms) && sms !== def.smsIncluded) {
      chyba(`Web slibuje u ${def.label} ${sms} SMS v ceně, PLANS zapisuje ${def.smsIncluded}.`);
    }
  }
  if (cenik.priplatky.smsZprav && cenik.priplatky.smsZprav !== priplatky.jobi_sms_addon_monthly?.sms) {
    chyba(`Web slibuje balíček ${cenik.priplatky.smsZprav} SMS, ADDONS dává ${priplatky.jobi_sms_addon_monthly?.sms}.`);
  }
  if (nalezy.chyba.length === chybNaZacatku) ok("Počty poboček i SMS v ceně sedí s tabulkou PLANS.");
}

/** 2. Ceny ve Stripe: existují, mají správný lookup key, měnu, období a částku. */
async function kontrolaCen(cenyPodleKlice, { plany, priplatky, sleva }, cenik, zdroj) {
  nadpis(`2. Ceny ve Stripe (zdroj: ${zdroj})`);

  for (const [klic, def] of Object.entries(plany)) {
    const cena = cenyPodleKlice.get(klic);
    if (!cena || cena.amount == null) {
      chyba(`Ve Stripe chybí aktivní cena s lookup key „${klic}“ (${def.label} ${def.interval === "month" ? "měsíčně" : "ročně"}).`);
      continue;
    }
    const potize = [];
    if (cena.currency && cena.currency.toLowerCase() !== "czk") potize.push(`měna ${cena.currency.toUpperCase()} místo CZK`);
    if (cena.interval && cena.interval !== def.interval) potize.push(`období ${cena.interval} místo ${def.interval}`);
    const naWebu = def.interval === "month" ? cenik.tarify[def.tier]?.month : cenik.tarify[def.tier]?.year;
    if (naWebu != null && naWebu !== cena.amount) {
      // U Enterprise je na webu „od …“, ale ta částka je pořád ta, kterou
      // zákazník uvidí v Checkoutu – individuální cena se řeší jinou cenou
      // nebo slevovým kódem, ne rozdílem proti ceníku.
      const od = cenik.tarify[def.tier]?.od ? " (web uvádí „od“, v Checkoutu se přesto naúčtuje cena ze Stripe)" : "";
      potize.push(`na webu ${kc(naWebu)}, ve Stripe ${kc(cena.amount)}${od}`);
    }
    if (potize.length) chyba(`${klic}: ${potize.join("; ")}.`);
    else ok(`${klic} = ${kc(cena.amount)} ${cena.interval ? `/ ${cena.interval === "month" ? "měsíc" : "rok"}` : ""}`);
  }

  for (const [klic, def] of Object.entries(priplatky)) {
    const cena = cenyPodleKlice.get(klic);
    if (!cena || cena.amount == null) {
      chyba(`Ve Stripe chybí aktivní cena s lookup key „${klic}“ (příplatek).`);
      continue;
    }
    const mesicni = def.sms ? cenik.priplatky.sms : cenik.priplatky.branch;
    if (def.interval === "month" && mesicni != null && mesicni !== cena.amount) {
      chyba(`${klic}: na webu ${kc(mesicni)}, ve Stripe ${kc(cena.amount)}.`);
      continue;
    }
    if (def.interval === "year" && mesicni != null) {
      // Roční cena příplatku na webu není. Ověří se aspoň proti slibované
      // slevě – rozdíl je věc k rozhodnutí, ne chyba nastavení.
      const ocekavano = Math.round(mesicni * 12 * (100 - sleva) / 100);
      if (Math.abs(cena.amount - ocekavano) > 100) {
        pozor(`${klic} = ${kc(cena.amount)}; z měsíční ceny se slevou ${sleva} % by vyšlo ${kc(ocekavano)}. Web roční cenu příplatku neuvádí.`);
        continue;
      }
    }
    ok(`${klic} = ${kc(cena.amount)}`);
  }

  const navic = [...cenyPodleKlice.keys()].filter((k) => k.startsWith("jobi_") && !(k in plany) && !(k in priplatky));
  if (navic.length) pozor(`Ve Stripe jsou ceny s lookup key, o kterých aplikace neví: ${navic.join(", ")}. Webhook by z nich neuměl zapnout moduly.`);
}

/** 3. Webhook: adresa, události, zapnutý stav. Jen se Stripe klíčem. */
async function kontrolaWebhooku(klic, ocekavanaUrl) {
  nadpis("3. Webhook ve Stripe");
  const POVINNE = [
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.payment_failed",
  ];

  let data;
  try {
    data = (await stripeGet(klic, "/webhook_endpoints", { limit: 100 })).data ?? [];
  } catch (e) {
    if (e.status === 403) neover(`Klíč nemá právo číst webhooky (${e.message}). Přidejte mu čtení „Webhook endpoints“, nebo zkontrolujte ručně.`);
    else neover(`Webhooky se nepodařilo načíst: ${e.message}`);
    return;
  }

  const nase = data.filter((w) => (w.url ?? "").endsWith("/functions/v1/billing-webhook"));
  if (nase.length === 0) {
    chyba(`Ve Stripe není žádný webhook na ${ocekavanaUrl}. Bez něj se zaplacené předplatné nikdy nepromění v přístup.`);
    return;
  }
  if (nase.length > 1) pozor(`Webhooků na billing-webhook je ${nase.length}. Každá událost dorazí vícekrát; zbytečné endpointy smažte.`);

  for (const w of nase) {
    if (w.url !== ocekavanaUrl) chyba(`Webhook míří na ${w.url}, čekala se adresa ${ocekavanaUrl}.`);
    else ok(`Adresa ${w.url}`);
    if (w.status && w.status !== "enabled") chyba(`Webhook ${w.url} je ve stavu „${w.status}“ – Stripe na něj nic neposílá.`);
    const udalosti = w.enabled_events ?? [];
    if (udalosti.includes("*")) {
      pozor("Webhook odebírá všechny události. Funguje to, ale zbytečně: aplikace zpracuje čtyři a zbytek jen zaloguje.");
      continue;
    }
    const chybi = POVINNE.filter((u) => !udalosti.includes(u));
    if (chybi.length) chyba(`Webhooku chybí události: ${chybi.join(", ")}.`);
    else ok(`Události: ${POVINNE.join(", ")}`);
    const navic = udalosti.filter((u) => !POVINNE.includes(u) && u !== "checkout.session.completed");
    if (navic.length) pozor(`Webhook odebírá i události, které aplikace nezpracuje: ${navic.join(", ")}.`);
  }
}

/**
 * 4. Tajemství. Nikde se nevypisuje hodnota – jen jestli existuje a má tvar.
 *
 * Jestli tajemství vidí i **nasazená** funkce, se pozná z její odpovědi:
 * bez `STRIPE_WEBHOOK_SECRET` vrací billing-webhook 503, s ním 400 („neplatný
 * podpis“). Nikam se tím nezapisuje a hodnota se nedozví ani skript.
 */
async function kontrolaTajemstvi(env, supabaseUrl) {
  nadpis("4. Tajemství");

  const sk = tvarKlice(env.STRIPE_SECRET_KEY);
  if (!sk.je) neover("STRIPE_SECRET_KEY tady není (v .env ani v prostředí). Pro kontrolu Stripe ho skript potřebuje; do Supabase patří přes `supabase secrets set`.");
  else if (!sk.platny) chyba("STRIPE_SECRET_KEY má nečekaný tvar – čeká se sk_test_…, sk_live_…, rk_test_… nebo rk_live_….");
  else ok(`STRIPE_SECRET_KEY: tvar v pořádku, režim ${sk.rezim === "test" ? "TEST" : "OSTRÝ"}${sk.omezeny ? ", omezený klíč (rk_)" : ", plný klíč (sk_) – pro kontrolu stačí omezený"}`);

  const whsec = env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!whsec) neover("STRIPE_WEBHOOK_SECRET tady není. Tvar se nedá zkontrolovat; jestli ho vidí nasazená funkce, se zjistí níž.");
  else if (!/^whsec_[A-Za-z0-9]{16,}$/.test(whsec)) chyba("STRIPE_WEBHOOK_SECRET má nečekaný tvar – čeká se whsec_….");
  else ok("STRIPE_WEBHOOK_SECRET: tvar v pořádku");

  if (OFFLINE || !supabaseUrl) {
    neover("Nasazené funkce se nekontrolovaly (--offline nebo chybí VITE_SUPABASE_URL).");
    return;
  }

  // billing-webhook: 503 = tajemství chybí, 400 = tajemství je a podpis nesedí.
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/billing-webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(20000),
    });
    if (res.status === 503) chyba("Nasazený billing-webhook hlásí, že nemá STRIPE_WEBHOOK_SECRET. Nastavte ho a funkci přenasaďte.");
    else if (res.status === 400) ok("Nasazený billing-webhook má STRIPE_WEBHOOK_SECRET a odmítá nepodepsané volání.");
    else if (res.status === 404) chyba("billing-webhook není nasazený (404). Adresa webhooku ve Stripe by mířila do prázdna.");
    else pozor(`billing-webhook odpověděl ${res.status} – čekalo se 400 (podpis nesedí) nebo 503 (chybí tajemství).`);
  } catch (e) {
    neover(`billing-webhook se nepodařilo zavolat: ${e.message}`);
  }
}

/** Ceník z nasazené funkce billing-prices – ověří i to, že klíč vidí server. */
async function cenikZFunkce(supabaseUrl, anonKey) {
  const res = await fetch(`${supabaseUrl}/functions/v1/billing-prices`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    body: "{}",
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 503) return { chybiKlic: true };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const mapa = new Map();
  for (const p of [...(data.plans ?? []), ...(data.addons ?? [])]) {
    if (p.amount != null) mapa.set(p.lookup_key, { amount: p.amount, currency: p.currency, interval: p.interval ?? null });
  }
  return { mapa };
}

// ---------------------------------------------------------------------------
// Běh
// ---------------------------------------------------------------------------

const env = nactiEnv();
const supabaseUrl = (env.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "");
const webhookUrl = supabaseUrl ? `${supabaseUrl}/functions/v1/billing-webhook` : "(neznámá – chybí VITE_SUPABASE_URL)";

console.log("Kontrola nastavení plateb (Stripe). Nic se nemění, jen čte.");
if (OFFLINE) console.log("Režim --offline: kontrolují se jen soubory v repozitáři.");

const tarify = nactiTarify();
const cenik = nactiCenikZWebu();

kontrolaWebuProtiKodu(tarify, cenik);

const sk = tvarKlice(env.STRIPE_SECRET_KEY);
let ceny = null;
let zdrojCen = null;
/** Nadpis kapitoly o cenách se vypisuje jen jednou, ať už ji vyřídila kterákoli větev. */
let cenyVyrizeno = false;

if (!OFFLINE && sk.je && sk.platny) {
  try {
    const data = (await stripeGet(env.STRIPE_SECRET_KEY.trim(), "/prices", { active: "true", limit: 100 })).data ?? [];
    ceny = new Map();
    for (const c of data) {
      if (!c.lookup_key) continue;
      ceny.set(c.lookup_key, { amount: c.unit_amount, currency: c.currency, interval: c.recurring?.interval ?? null });
    }
    zdrojCen = `Stripe API, režim ${sk.rezim === "test" ? "TEST" : "OSTRÝ"}`;
  } catch (e) {
    nadpis("2. Ceny ve Stripe");
    neover(`Ceny se nepodařilo načíst ze Stripe: ${e.message}`);
    cenyVyrizeno = true;
  }
} else if (!OFFLINE && supabaseUrl && env.VITE_SUPABASE_ANON_KEY) {
  // Bez klíče se ceník dá přečíst přes nasazenou funkci: ta klíč má a vrací
  // jen částky, ne tajemství. Chybějící cena se pozná podle `amount: null`.
  try {
    const v = await cenikZFunkce(supabaseUrl, env.VITE_SUPABASE_ANON_KEY);
    if (v.chybiKlic) {
      nadpis("2. Ceny ve Stripe");
      chyba("Nasazená funkce billing-prices hlásí, že nemá STRIPE_SECRET_KEY. Ceny se zkontrolovat nedají a aplikace platby nenabídne.");
      cenyVyrizeno = true;
    } else {
      ceny = v.mapa;
      zdrojCen = "nasazená funkce billing-prices (bez klíče u vás)";
    }
  } catch (e) {
    nadpis("2. Ceny ve Stripe");
    neover(`Ceník z funkce billing-prices se nepodařilo načíst: ${e.message}`);
    cenyVyrizeno = true;
  }
}

if (ceny) await kontrolaCen(ceny, tarify, cenik, zdrojCen);
else if (!cenyVyrizeno) {
  nadpis("2. Ceny ve Stripe");
  neover("Ceny se nekontrolovaly. Spusťte `STRIPE_SECRET_KEY=rk_test_… npm run platby:kontrola`, nebo nechte skript číst ceník přes nasazenou funkci (potřebuje VITE_SUPABASE_URL a VITE_SUPABASE_ANON_KEY).");
}

if (!OFFLINE && sk.je && sk.platny) await kontrolaWebhooku(env.STRIPE_SECRET_KEY.trim(), webhookUrl);
else {
  nadpis("3. Webhook ve Stripe");
  neover(`Nastavení webhooku umí přečíst jen Stripe API. Bez STRIPE_SECRET_KEY zkontrolujte ručně: Developers → Webhooks → ${webhookUrl}, události customer.subscription.created/.updated/.deleted a invoice.payment_failed.`);
}

await kontrolaTajemstvi(env, supabaseUrl);

// ---------------------------------------------------------------------------

nadpis("Souhrn");
console.log(`  v pořádku: ${nalezy.ok}   chyb: ${nalezy.chyba.length}   upozornění: ${nalezy.pozor.length}   neověřeno: ${nalezy.neover.length}`);
if (nalezy.chyba.length) {
  console.log("\nChyby k opravě:");
  for (const t of nalezy.chyba) console.log(`  - ${t}`);
}
if (nalezy.neover.length) {
  console.log("\nCo se nepodařilo ověřit:");
  for (const t of nalezy.neover) console.log(`  - ${t}`);
}
console.log(`\nPostup nastavení: docs/PLATBY_DEN_D.md`);
process.exit(nalezy.chyba.length ? 1 : 0);
