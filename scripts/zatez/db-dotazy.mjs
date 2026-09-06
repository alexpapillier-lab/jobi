/**
 * Zátěž databázových dotazů, které aplikace dělá při běžné práci.
 *
 *   E2E_PASSWORD='…' node scripts/zatez/db-dotazy.mjs
 *   E2E_PASSWORD='…' node scripts/zatez/db-dotazy.mjs --stupne 1,5,20 --sekundy 15
 *
 * Bez `E2E_PASSWORD` se přeskočí – bez přihlášení projde RLS jen prázdno a
 * měřili bychom rychlost, s jakou databáze umí vrátit nulu řádků.
 *
 * Jde se přímo na PostgREST (`/rest/v1/...`), ne přes supabase-js. Důvod:
 * chceme čas odpovědi serveru, ne čas, který k tomu klientská knihovna
 * přidá. Dotazy jsou ale okopírované z aplikace včetně seznamu sloupců a
 * řazení – jinak by se měřilo něco jiného, než co uživatel opravdu spustí.
 *
 * Co se měří (a kde to v aplikaci je):
 *   - seznam zakázek, první stránka 1000 řádků   → src/pages/Orders.tsx
 *   - seznam zakázek, všechny stránky            → src/lib/fetchAllPages.ts
 *   - detail jedné zakázky podle id              → src/pages/Orders.tsx (refetchTicketById)
 *   - statistiky za období, serverová agregace   → src/lib/statistikyServer.ts (RPC statistiky_prehled)
 *   - statistiky postaru (všechny zakázky)       → src/pages/Statistics.tsx, záložní cesta
 *   - seznam skladu                              → src/lib/inventoryDb.ts
 *
 * Nic se nezapisuje – jsou to samé SELECTy a jedna RPC, která taky jen čte.
 */

import { nactiEnv, overServis, rampa, zmerFetch, HLAVICKA_TABULKY } from "./spolecne.mjs";

const arg = (jmeno, vychozi) => {
  const i = process.argv.indexOf(`--${jmeno}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : vychozi;
};

const env = nactiEnv();
const HESLO = env.E2E_PASSWORD;
if (!HESLO) {
  console.log("# Chybí E2E_PASSWORD – databázová část se přeskakuje.");
  console.log("# Postup, jak heslo získat, je v e2e/README.md. Veřejná rozhraní se dají měřit i bez něj:");
  console.log("#   node scripts/zatez/verejne-api.mjs");
  process.exit(0);
}

const URL_DB = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const SERVIS = overServis(arg("servis", "882beee7-4564-4d10-8ac6-16dc19240b57"));
const stupne = arg("stupne", "1,5,20,50").split(",").map(Number);
const trvaniMs = Number(arg("sekundy", "30")) * 1000;

// Přesně ten seznam sloupců, který si tahá Orders.tsx. Zkrátit by znamenalo
// měřit lehčí dotaz, než jaký appka opravdu posílá.
const SLOUPCE_ZAKAZKY =
  "id,service_id,code,title,status,notes,customer_id,customer_name,customer_phone,customer_email," +
  "customer_address_street,customer_address_city,customer_address_zip,customer_company,customer_ico," +
  "customer_info,device_serial,device_passcode,device_condition,device_accessories,device_note," +
  "external_id,handoff_method,handback_method,estimated_price,performed_repairs,test_checklist,loaner," +
  "diagnostic_text,diagnostic_photos,diagnostic_photos_before,discount_type,discount_value," +
  "created_at,updated_at,version,branch_id";

const SLOUPCE_SKLADU =
  "id,name,price,purchase_price,sku,description,image_url,category_id,model_ids,repair_ids," +
  "created_at,public_visible";

async function prihlas() {
  const o = await fetch(`${URL_DB}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "e2e@jobi.test", password: HESLO }),
  });
  const telo = await o.json();
  if (!o.ok || !telo.access_token) throw new Error(`Přihlášení selhalo (HTTP ${o.status}): ${telo.error_description ?? telo.msg ?? ""}`);
  return telo.access_token;
}

const token = await prihlas();
const H = { apikey: ANON, Authorization: `Bearer ${token}`, "Accept-Profile": "public" };
const rest = (cesta) => `${URL_DB}/rest/v1/${cesta}`;

/** Kolik zakázek servis má – bez toho se čísla nedají porovnat s jiným servisem. */
async function pocetZakazek() {
  const o = await fetch(rest(`tickets?select=id&service_id=eq.${SERVIS}&deleted_at=is.null`), {
    headers: { ...H, Prefer: "count=exact", Range: "0-0" },
  });
  await o.arrayBuffer();
  return Number((o.headers.get("content-range") ?? "/0").split("/")[1]);
}

const celkem = await pocetZakazek();
console.log(`# Databázové dotazy – servis ${SERVIS}, ${celkem} zakázek (bez koše)`);
console.log(`# Rampa ${stupne.join(" → ")}, ${trvaniMs / 1000} s na stupeň\n`);

// Jedno existující id na měření detailu
const prvni = await fetch(rest(`tickets?select=id&service_id=eq.${SERVIS}&deleted_at=is.null&limit=1`), { headers: H });
const [{ id: ID_ZAKAZKY } = {}] = await prvni.json();
if (!ID_ZAKAZKY) throw new Error("Testovací servis nemá žádnou zakázku, detail se nedá změřit.");

const dotazSeznamu = (od, doo) =>
  zmerFetch(
    rest(`tickets?select=${SLOUPCE_ZAKAZKY}&service_id=eq.${SERVIS}&deleted_at=is.null&order=created_at.desc,id.desc`),
    { headers: { ...H, Range: `${od}-${doo}` } },
  );

/** Postupné stránkování jako `fetchAllPages` – měří se celá cesta, ne jedna stránka. */
async function vsechnyStranky() {
  let od = 0;
  let bajtu = 0;
  for (;;) {
    const o = await fetch(
      rest(`tickets?select=${SLOUPCE_ZAKAZKY}&service_id=eq.${SERVIS}&deleted_at=is.null&order=created_at.desc,id.desc`),
      { headers: { ...H, Range: `${od}-${od + 999}` } },
    );
    const telo = await o.json();
    bajtu += JSON.stringify(telo).length;
    if (!Array.isArray(telo) || telo.length < 1000) return { status: o.status, bajtu };
    od += 1000;
  }
}

const pred = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString();
const ted = new Date().toISOString();

const scenare = [
  {
    nazev: "seznam zakázek – 1. stránka (1000 řádků)",
    pozadavek: () => dotazSeznamu(0, 999),
  },
  {
    nazev: "seznam zakázek – stránka po 50 (co by stačilo)",
    pozadavek: () => dotazSeznamu(0, 49),
  },
  {
    nazev: "seznam zakázek – všechny stránky (fetchAllPages)",
    pozadavek: vsechnyStranky,
  },
  {
    nazev: "detail zakázky podle id",
    pozadavek: () =>
      zmerFetch(rest(`tickets?select=${SLOUPCE_ZAKAZKY}&id=eq.${ID_ZAKAZKY}&service_id=eq.${SERVIS}`), { headers: H }),
  },
  {
    nazev: "statistiky za rok – RPC statistiky_prehled",
    pozadavek: () =>
      zmerFetch(rest("rpc/statistiky_prehled"), {
        method: "POST",
        headers: { ...H, "Content-Type": "application/json" },
        body: JSON.stringify({
          p_service_ids: [SERVIS],
          p_od: pred,
          p_do: ted,
          p_branch_id: null,
          p_drill_typ: null,
          p_drill_hodnota: null,
          p_drill_rok: null,
          p_drill_mesic: null,
          p_prev_od: null,
          p_prev_do: null,
          p_tz: "Europe/Prague",
        }),
      }),
  },
  {
    nazev: "seznam skladu",
    pozadavek: () =>
      zmerFetch(rest(`inventory_products?select=${SLOUPCE_SKLADU}&service_id=eq.${SERVIS}&order=order_index,created_at`), { headers: H }),
  },
];

console.log(HLAVICKA_TABULKY);
const vse = [];
for (const s of scenare) {
  vse.push(...(await rampa({ ...s, stupne, trvaniMs })));
  await new Promise((r) => setTimeout(r, 2000));
}

console.log("\n## Kde se to zlomilo\n");
const zlomy = vse.filter((v) => v.zastaveno);
for (const v of zlomy) console.log(`- ${v.nazev} @ ${v.soubeznost} souběžně: ${v.zastaveno}`);
if (zlomy.length === 0) console.log("- nikde – všechny stupně dojely bez chyb");
