#!/usr/bin/env node
/**
 * Syntetický hlídač produkce.
 *
 * Projde hlavní cestu Jobi zvenčí, jako by byl zákazník a servis, a když
 * dvakrát po sobě neprojde, pošle e-mail majiteli aplikace. Vzniklo po
 * nasazení, které rozbilo zákaznický portál (každá akce vracela 500) a nikdo
 * by se to nedozvěděl – přišlo se na to náhodou při testech.
 *
 *   node scripts/hlidac/hlidac.mjs                 # jen zkontroluj a vypiš
 *   node scripts/hlidac/hlidac.mjs --nahlasit      # při poruše pošli e-mail
 *   node scripts/hlidac/hlidac.mjs --nahlasit --nanecisto   # e-mail jen nasucho
 *   node scripts/hlidac/hlidac.mjs --pauza=3000    # kratší pauza mezi pokusy
 *
 * Prostředí:
 *   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY  – z .env nebo z prostředí
 *   E2E_PASSWORD                               – heslo účtu e2e@jobi.test
 *   HLIDAC_HESLO_SOUBOR                        – nebo cesta k souboru s heslem
 *   HLIDAC_SECRET                              – tajemství pro alerts-check
 *                                                (jen s --nahlasit)
 *
 * JEDEN NEÚSPĚCH NENÍ PORUCHA. Runner GitHubu občas na pár sekund ztratí síť
 * a Supabase má vlastní krátká zaškobrtnutí. Kdyby se hlásil první neúspěch,
 * chodily by e-maily, které při ručním ověření vypadají v pořádku – a to je
 * nejrychlejší způsob, jak si hlídače člověk odfiltruje do koše. Proto se
 * celý běh po neúspěchu za chvíli ZOPAKUJE OD ZAČÁTKU (nové přihlášení, nová
 * zakázka) a hlásí se jen to, co spadlo v OBOU pokusech.
 *
 * Proč druhý pokus ve stejném běhu a ne až za dalších 15 minut: porucha se má
 * ohlásit do pár minut. Čekáním na další běh by se doba do e-mailu
 * zdvojnásobila, a hlavně by si hlídač musel mezi běhy někde držet stav –
 * cache GitHub Actions se čistí a tabulka na to v databázi není.
 */

import { readFileSync } from "node:fs";
import { KONTROLY, uklid, SERVIS_ID, ZAKAZANE_SERVISY } from "./kontroly.mjs";
import { nactiEnv } from "../zatez/spolecne.mjs";

const args = process.argv.slice(2);
const maPrepinac = (jmeno) => args.includes(`--${jmeno}`);
const hodnota = (jmeno, vychozi) => {
  const a = args.find((x) => x.startsWith(`--${jmeno}=`));
  return a ? a.slice(jmeno.length + 3) : vychozi;
};

/** Pauza mezi prvním a druhým pokusem. Delší než běžný výpadek sítě runneru. */
const PAUZA_MS = Number(hodnota("pauza", process.env.HLIDAC_PAUZA_MS ?? 20_000));
const NAHLASIT = maPrepinac("nahlasit");
const NANECISTO = maPrepinac("nanecisto");

// ---------------------------------------------------------------------------

function heslo() {
  const soubor = hodnota("heslo-soubor", process.env.HLIDAC_HESLO_SOUBOR);
  if (soubor) return readFileSync(soubor, "utf8").trim();
  const z = process.env.E2E_PASSWORD;
  if (!z) {
    throw new Error(
      "Chybí heslo k účtu e2e@jobi.test. Nastav E2E_PASSWORD, nebo HLIDAC_HESLO_SOUBOR " +
        "s cestou k souboru. Hlídač schválně nemá tichý fallback: kontrola, která se bez " +
        "přihlášení tváří, že prošla, je horší než žádná.",
    );
  }
  return z;
}

/**
 * Jeden úplný pokus. Vrací výsledky všech kontrol a stav (kvůli úklidu).
 * Nikdy nevyhazuje kvůli spadlé kontrole – jen kvůli chybě v samotném hlídači.
 */
async function pokus(cislo, env) {
  const stav = {
    url: env.VITE_SUPABASE_URL.replace(/\/+$/, ""),
    anon: env.VITE_SUPABASE_ANON_KEY,
    heslo: heslo(),
    zakazka: null,
    zakazkaSmazana: false,
  };
  const vysledky = [];
  /*
   * Kontroly, po kterých nemá smysl pokračovat: spadlé i ty, které se kvůli
   * nim přeskočily. Přeskočení se musí dědit dál – když spadne přihlášení,
   * nespustí se „založení zakázky“, a tím pádem ani „otevření portálu“, které
   * na založení navazuje. Bez dědění se portál rozběhl nad zakázkou, která
   * nevznikla, a spadl na „Cannot read properties of null“ – hlášená porucha
   * pak byla v hlídači, ne v aplikaci.
   */
  const nedostupne = new Set();

  try {
    for (const kontrola of KONTROLY) {
      if (kontrola.zavisiNa && nedostupne.has(kontrola.zavisiNa)) {
        // Přeskočená kontrola není rozbitá. Kdyby se hlásila taky, přišel by
        // při nedostupném přihlášení e-mail o šesti poruchách místo o jedné.
        nedostupne.add(kontrola.id);
        vysledky.push({ id: kontrola.id, stav: "preskoceno", zprava: `závisí na „${kontrola.zavisiNa}“` });
        continue;
      }
      const zacatek = Date.now();
      try {
        const zprava = await kontrola.spust(stav);
        vysledky.push({ id: kontrola.id, stav: "ok", zprava: zprava ?? "", ms: Date.now() - zacatek });
      } catch (e) {
        nedostupne.add(kontrola.id);
        vysledky.push({ id: kontrola.id, stav: "spadlo", zprava: e?.message ?? String(e), ms: Date.now() - zacatek });
      }
    }
  } finally {
    // Úklid VŽDY, i když hlídač spadl uprostřed na něčem nečekaném.
    const zbytek = await uklid(stav).catch((e) => `úklid selhal: ${e?.message ?? e}`);
    if (zbytek) vysledky.push({ id: "uklid", stav: "spadlo", zprava: zbytek });
  }

  vypisPokus(cislo, vysledky);
  return vysledky;
}

function vypisPokus(cislo, vysledky) {
  console.log(`\n— pokus ${cislo} —`);
  for (const v of vysledky) {
    const znak = v.stav === "ok" ? "ok      " : v.stav === "preskoceno" ? "přeskoč." : "SPADLO  ";
    console.log(`  ${znak} ${v.id.padEnd(14)} ${v.zprava}`);
  }
}

const spadle = (vysledky) => vysledky.filter((v) => v.stav === "spadlo");

// ---------------------------------------------------------------------------
// Hlášení. Jde stejnou cestou jako hlídač chyb: edge funkce `alerts-check`
// si sáhne pro adresu majitele (secret ALERT_EMAIL, jinak root owner), pošle
// to přes Resend a zapíše do `alert_events`, takže platí i stejné tlumení –
// stejný druh poplachu nepřijde znovu dřív než za šest hodin. Vlastní
// odesílání e-mailů tady schválně není: druhá infrastruktura na e-maily je
// druhé místo, kde se dá zapomenout klíč.

async function nahlas(env, selhani, pokusy) {
  const tajemstvi = process.env.HLIDAC_SECRET?.trim();
  if (!tajemstvi) {
    console.error("::error::Chybí HLIDAC_SECRET, poplach se nemá jak odeslat. Postup je v docs/HLIDAC_PROVOZU.md.");
    return false;
  }
  const beh = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null;

  const odpoved = await fetch(`${env.VITE_SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/alerts-check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret: tajemstvi,
      source: "hlidac",
      dryRun: NANECISTO,
      pokusy,
      behUrl: beh,
      selhani: selhani.map((v) => ({ id: v.id, zprava: v.zprava })),
    }),
    signal: AbortSignal.timeout(20_000),
  }).catch((e) => ({ ok: false, status: 0, text: async () => e?.message ?? String(e) }));

  const text = await odpoved.text();
  if (!odpoved.ok) {
    console.error(`::error::Poplach se nepodařilo odeslat: alerts-check ${odpoved.status} ${text.slice(0, 300)}`);
    return false;
  }
  console.log(`Poplach odeslán do alerts-check: ${text.slice(0, 300)}`);
  return true;
}

// ---------------------------------------------------------------------------

async function main() {
  if (ZAKAZANE_SERVISY.includes(SERVIS_ID)) throw new Error("Hlídač je nastavený na ostrý servis. Zastaveno.");
  const env = nactiEnv();
  const zacatek = Date.now();
  console.log(`Hlídač provozu – ${new Date().toISOString()}, servis ${SERVIS_ID}`);

  let vysledky = await pokus(1, env);
  let pokusy = 1;

  if (spadle(vysledky).length > 0) {
    console.log(`\nPrvní pokus našel ${spadle(vysledky).length} selhání. Čekám ${Math.round(PAUZA_MS / 1000)} s a zkouším znovu – jeden neúspěch může být výpadek sítě běhu.`);
    await new Promise((r) => setTimeout(r, PAUZA_MS));
    const druhy = await pokus(2, env);
    pokusy = 2;

    const spadloDvakrat = new Set(spadle(druhy).map((v) => v.id));
    const kolisani = spadle(vysledky).filter((v) => !spadloDvakrat.has(v.id));
    if (kolisani.length > 0) {
      // Vypsat, ale nehlásit. Kdyby se kolísání ozývalo pořád, je vidět
      // v záznamech běhů a je to vlastní zjištění, ne poplach.
      console.log(`\nKolísání (spadlo jen napoprvé, podruhé prošlo): ${kolisani.map((v) => v.id).join(", ")}`);
    }
    vysledky = druhy;
  }

  const poplach = spadle(vysledky);
  const trvani = ((Date.now() - zacatek) / 1000).toFixed(1);

  if (poplach.length === 0) {
    console.log(`\nVšechno v pořádku (${trvani} s, ${pokusy} pokus${pokusy > 1 ? "y" : ""}).`);
    return 0;
  }

  console.log(`\nPORUCHA: ${poplach.map((v) => v.id).join(", ")} – spadlo ${pokusy}× po sobě (${trvani} s).`);
  for (const v of poplach) console.log(`  ${v.id}: ${v.zprava}`);

  if (NAHLASIT) {
    const odeslano = await nahlas(env, poplach, pokusy);
    // Neodeslaný poplach je horší než porucha sama: hlídač mlčí. Job musí
    // spadnout, ať aspoň GitHub pošle upozornění o neúspěšném běhu.
    if (!odeslano) return 2;
  } else {
    console.log("(bez --nahlasit se e-mail neposílá)");
  }
  return 1;
}

main().then(
  (kod) => process.exit(kod),
  (e) => {
    console.error(`::error::Hlídač sám spadl: ${e?.stack ?? e}`);
    process.exit(3);
  },
);
