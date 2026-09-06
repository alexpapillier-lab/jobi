/**
 * Zátěž veřejných rozhraní (ta uvidí provoz z cizích webů).
 *
 *   node scripts/zatez/verejne-api.mjs                # celá rampa 1 → 5 → 20 → 50
 *   node scripts/zatez/verejne-api.mjs --stupne 1,5   # jen mírná zátěž
 *   node scripts/zatez/verejne-api.mjs --sekundy 10   # kratší stupně
 *
 * Měří: medián, p95 a maximum odezvy, propustnost a chybovost pro
 *   - GET public-catalog       (ceník; limit 60/min na IP)
 *   - GET public-catalog + ETag(304)  – co uvidí web, který cachuje
 *   - GET public-inventory     (sklad; limit 60/min na IP)
 *   - GET public-booking       (nastavení rezervací; BEZ limitu)
 *   - GET public-booking/embed.js (statický skript, bez databáze)
 *   - GET portal-ticket        (neplatný token → 404; čtení bez zápisu)
 *
 * Co se tu NEMĚŘÍ a proč:
 *   - POST public-booking: strop 10 rezervací za hodinu a hlavně by zakládal
 *     data v testovacím servisu, která by po mně někdo musel mazat.
 *   - portal-ticket s platným tokenem: GET zapisuje `portal_last_opened_at`
 *     a událost `opened`. Neplatný token jde přesně stejnou cestou (limit →
 *     index na portal_token) až po místo, kde by se zapisovalo, takže odezvu
 *     měří férově a nic po sobě nenechá. Je to navíc přesně ta cesta, kterou
 *     by šel někdo, kdo tokeny hádá.
 *
 * Běh sám o sobě zapíše řádky do `api_read_hits` (počítadlo limitu, jeden
 * řádek na servis/klíč/minutu/endpoint). Uklízí se samo po 30 dnech.
 */

import { nactiEnv, overSlug, rampa, zmerFetch, HLAVICKA_TABULKY } from "./spolecne.mjs";

const arg = (jmeno, vychozi) => {
  const i = process.argv.indexOf(`--${jmeno}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : vychozi;
};

const env = nactiEnv();
const BASE = `${env.VITE_SUPABASE_URL}/functions/v1`;
const HLAVICKY = { apikey: env.VITE_SUPABASE_ANON_KEY };

const stupne = arg("stupne", "1,5,20,50").split(",").map(Number);
const trvaniMs = Number(arg("sekundy", "30")) * 1000;
const SLUG = overSlug(arg("slug", "e2e-servis"));
const SLUG2 = overSlug(arg("slug2", "servis-novak"));

/** ETag si vytáhneme předem, ať 304 větev měří opravdu 304 a ne první 200. */
async function ziskejEtag(url) {
  const o = await fetch(url, { headers: HLAVICKY });
  await o.arrayBuffer();
  return o.headers.get("etag");
}

const gets = (url, extra = {}) => () => zmerFetch(url, { headers: { ...HLAVICKY, ...extra } });

console.log(`# Veřejná rozhraní – rampa ${stupne.join(" → ")}, ${trvaniMs / 1000} s na stupeň`);
console.log(`# Cíl: ${BASE}, servisy: ${SLUG}, ${SLUG2}\n`);

const etagCenik = await ziskejEtag(`${BASE}/public-catalog?service=${SLUG2}`);
console.log(`# ETag ceníku ${SLUG2}: ${etagCenik}\n`);

/**
 * Endpointy s limitem 60/min na IP. Třicetivteřinový stupeň by u nich měřil,
 * jak rychle runtime vrací 429, ne jak rychle odpovídá databáze – limit se
 * z jedné IP vyčerpá už při jednom vlákně (60 × ~400 ms = 24 s). Proto pevná
 * dávka 40 požadavků (pod limitem) a před každým stupněm čistá minuta.
 */
const S_LIMITEM = [
  { nazev: `catalog ${SLUG} (malý ceník, 3,8 kB)`, pozadavek: gets(`${BASE}/public-catalog?service=${SLUG}`) },
  { nazev: `catalog ${SLUG2} (větší ceník, 8,2 kB)`, pozadavek: gets(`${BASE}/public-catalog?service=${SLUG2}`) },
  {
    nazev: `catalog ${SLUG2} + ETag → 304`,
    pozadavek: gets(`${BASE}/public-catalog?service=${SLUG2}`, { "if-none-match": etagCenik ?? "" }),
  },
  { nazev: `inventory ${SLUG2} (4,9 kB)`, pozadavek: gets(`${BASE}/public-inventory?service=${SLUG2}`) },
];

/** Endpointy bez limitu čtení – tady má rampa smysl v plné délce. */
const BEZ_LIMITU = [
  { nazev: `booking GET nastavení ${SLUG2}`, pozadavek: gets(`${BASE}/public-booking?service=${SLUG2}`) },
  { nazev: "booking embed.js (bez databáze)", pozadavek: gets(`${BASE}/public-booking/embed.js?service=${SLUG2}`) },
  {
    // Náhodný token pokaždé: kdyby byl pořád stejný, chytil by se limit na
    // token v paměti instance a měřili bychom ten, ne databázi.
    nazev: "portal-ticket neplatný token → 404",
    pozadavek: () => zmerFetch(`${BASE}/portal-ticket?t=zatez${Math.random().toString(36).slice(2, 12)}`, { headers: HLAVICKY }),
    // 404 je tu správná odpověď, ne chyba – zastavit se má až na 429 nebo na síti
    okStavy: [404],
  },
];

const vse = [];

console.log("## Endpointy s limitem 60/min na IP (dávka 40 požadavků, čistá minuta před každým stupněm)\n");
console.log(HLAVICKA_TABULKY);
for (const s of S_LIMITEM) {
  vse.push(...(await rampa({ ...s, stupne, pocet: 40, cistaMinuta: true })));
}

console.log(`\n## Endpointy bez limitu čtení (plná rampa, ${trvaniMs / 1000} s na stupeň)\n`);
console.log(HLAVICKA_TABULKY);
for (const s of BEZ_LIMITU) {
  vse.push(...(await rampa({ ...s, stupne, trvaniMs })));
  await new Promise((r) => setTimeout(r, 3000));
}

console.log("\n## Kde se to zlomilo\n");
for (const v of vse.filter((v) => v.zastaveno)) {
  console.log(`- ${v.nazev} @ ${v.soubeznost} souběžně: ${v.zastaveno} (po ${v.pozadavku} požadavcích, ${v.sekund.toFixed(1)} s)`);
}
if (!vse.some((v) => v.zastaveno)) console.log("- nikde – všechny stupně dojely bez chyb");
