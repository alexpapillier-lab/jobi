/**
 * Společné kousky pro zátěžové testy. Sám o sobě nic nespouští.
 *
 * Proč vlastní generátor a ne k6: k6 na stroji není a instalovat nástroj kvůli
 * čtyřem endpointům se nevyplatí. Node umí `fetch` i `Promise.all`, což na
 * měření odezvy pod souběžností stačí – měříme sítě a databáze, ne generátor.
 *
 * Proč se čas bere přes `performance.now()` a ne `Date.now()`: `Date.now()` má
 * rozlišení na milisekundy a může skočit při synchronizaci hodin. U odezev
 * kolem 100 ms by to bylo znát.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const KOREN = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Servisy, proti kterým se smí měřit. Není to kosmetika – zátěžový test proti
 * ostrému zákazníkovi by mu vyčerpal jeho vlastní limit 60 dotazů za minutu a
 * na jeho webu by se přestal zobrazovat ceník. Cokoli mimo tenhle seznam
 * skripty odmítnou, i když to někdo napíše na příkazovou řádku.
 */
export const POVOLENE_SLUGY = Object.freeze(["e2e-servis", "servis-novak"]);

export const POVOLENA_ID_SERVISU = Object.freeze([
  "882beee7-4564-4d10-8ac6-16dc19240b57", // E2E testovací servis
  "72de5c11-6c2d-486a-9a44-dd0a9060cf97", // ukázkový Servis Novák
  "bbc926bd-25ba-4da1-b528-92b6f1dee24d", // TEST2
]);

export function overSlug(slug) {
  if (!POVOLENE_SLUGY.includes(slug)) {
    throw new Error(
      `Slug „${slug}" není mezi testovacími (${POVOLENE_SLUGY.join(", ")}). ` +
        "Zátěž proti ostrému servisu by mu vyčerpala limit veřejného API.",
    );
  }
  return slug;
}

export function overServis(id) {
  if (!POVOLENA_ID_SERVISU.includes(id)) {
    throw new Error(`Servis ${id} není mezi testovacími. Měřit se smí jen na testovacích datech.`);
  }
  return id;
}

/** Načte .env z kořene projektu. Bez závislosti na dotenv – je to pět řádků. */
export function nactiEnv() {
  const env = { ...process.env };
  try {
    for (const radek of readFileSync(join(KOREN, ".env"), "utf8").split("\n")) {
      const m = radek.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    // .env nemusí existovat (CI), proměnné pak musí přijít z prostředí
  }
  if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
    throw new Error("Chybí VITE_SUPABASE_URL nebo VITE_SUPABASE_ANON_KEY (.env nebo prostředí).");
  }
  return env;
}

/** Percentil z neseřazeného pole. Lineární interpolace se nedělá – vzorků jsou stovky, na p95 to nehraje roli. */
export function percentil(hodnoty, p) {
  if (hodnoty.length === 0) return null;
  const s = [...hodnoty].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}

const ms = (v) => (v === null ? "–" : `${Math.round(v)}`);

/**
 * Jeden stupeň zátěže: `soubeznost` vláken tluče na endpoint, dokud nevyprší
 * `trvaniMs` nebo dokud se nepřekročí práh chybovosti.
 *
 * Vlákna nejsou opravdová vlákna – jsou to smyčky nad `await fetch`. Node má
 * jedno vlákno, ale I/O čeká na síti, ne na CPU, takže padesát souběžných
 * požadavků skutečně letí souběžně. Kdyby úzkým hrdlem byl generátor, poznalo
 * by se to podle toho, že odezva roste lineárně se souběžností – proto se
 * vždycky měří i propustnost, ne jen latence.
 */
export async function zmerStupen({
  nazev,
  soubeznost,
  trvaniMs = 30_000,
  // Alternativa k `trvaniMs`: skonči po N požadavcích. Je to kvůli endpointům
  // s limitem 60 dotazů za minutu – tam by třicetivteřinový stupeň měřil jen
  // rychlost, s jakou umí runtime vracet 429. Pevný počet pod limitem změří,
  // jak se chová skutečná odpověď při rostoucí souběžnosti.
  pocet = null,
  pozadavek,
  prahChyb = 0.03,
  zastavNa429 = true,
  // Které stavy se počítají jako správná odpověď. Výchozí je „všechno pod 400",
  // ale u sondy na neplatný token je 404 očekávaný výsledek, ne chyba.
  okStavy = null,
}) {
  const konec = performance.now() + trvaniMs;
  const casy = [];
  const stavy = new Map();
  let chyb = 0;
  let bajtu = 0;
  let stop = null;
  let vydano = 0;

  const start = performance.now();
  const jesteJe = () => (pocet === null ? performance.now() < konec : vydano < pocet);

  const vlakno = async () => {
    while (jesteJe() && stop === null) {
      vydano += 1;
      const t0 = performance.now();
      let stav;
      try {
        const odpoved = await pozadavek();
        stav = odpoved.status;
        bajtu += odpoved.bajtu ?? 0;
      } catch (e) {
        stav = `síť:${e?.cause?.code ?? e?.name ?? "chyba"}`;
      }
      casy.push(performance.now() - t0);
      stavy.set(stav, (stavy.get(stav) ?? 0) + 1);

      const chyba = typeof stav !== "number" || (okStavy ? !okStavy.includes(stav) : stav >= 400);
      if (chyba) chyb += 1;
      // Zastavujeme co nejdřív po překročení prahu, ne až na konci stupně –
      // smyslem je najít hranici, ne ji dlouho držet. Prvních deset vzorků se
      // ignoruje, aby jeden studený start nezastavil celý běh.
      if (stav === 429 && zastavNa429) stop = "429 (limit)";
      else if (casy.length >= 10 && chyb / casy.length > prahChyb) stop = `chybovost > ${Math.round(prahChyb * 100)} %`;
    }
  };

  await Promise.all(Array.from({ length: soubeznost }, vlakno));

  const trvalo = (performance.now() - start) / 1000;
  return {
    nazev,
    soubeznost,
    pozadavku: casy.length,
    sekund: trvalo,
    zaSekundu: casy.length / trvalo,
    median: percentil(casy, 50),
    p95: percentil(casy, 95),
    max: casy.length ? Math.max(...casy) : null,
    chybovost: casy.length ? chyb / casy.length : 0,
    stavy: Object.fromEntries([...stavy].sort((a, b) => b[1] - a[1])),
    kb: Math.round(bajtu / 1024),
    zastaveno: stop,
  };
}

/** Vypíše řádek stupně tak, aby se dal rovnou zkopírovat do docs/ZATEZ.md. */
export function vypisStupen(v) {
  const stavy = Object.entries(v.stavy).map(([k, n]) => `${k}×${n}`).join(" ");
  console.log(
    `| ${v.nazev} | ${v.soubeznost} | ${v.pozadavku} | ${v.zaSekundu.toFixed(1)} | ${ms(v.median)} | ${ms(v.p95)} | ` +
      `${ms(v.max)} | ${(v.chybovost * 100).toFixed(1)} % | ${stavy}${v.zastaveno ? ` — **stop: ${v.zastaveno}**` : ""} |`,
  );
}

export const HLAVICKA_TABULKY =
  "| Endpoint | Souběžně | Požadavků | req/s | medián ms | p95 ms | max ms | chybovost | stavy |\n" +
  "|---|---:|---:|---:|---:|---:|---:|---:|---|";

/**
 * Rampa 1 → 5 → 20 → 50. Mezi stupni se čeká, ať se minutové okno limitu
 * nepřelije z předchozího stupně do dalšího a čísla nebyla o limitu předtím.
 */
export const STUPNE = [1, 5, 20, 50];

/**
 * Počká na začátek další minuty. Okno limitu je `date_trunc('minute', now())`,
 * takže dva stupně ve stejné minutě sdílejí počítadlo a druhý z nich by měřil
 * zbytek limitu po prvním, ne sám sebe.
 */
export async function naCistouMinutu(tichý = false) {
  const zbyva = 60_000 - (Date.now() % 60_000) + 700;
  if (!tichý) console.log(`<!-- čekám ${(zbyva / 1000).toFixed(0)} s na čistou minutu limitu -->`);
  await new Promise((r) => setTimeout(r, zbyva));
}

export async function rampa({ nazev, pozadavek, stupne = STUPNE, trvaniMs, pocet, cistaMinuta = false, pauzaMs = 2000, ...zbytek }) {
  const vysledky = [];
  for (const soubeznost of stupne) {
    if (cistaMinuta) await naCistouMinutu();
    const v = await zmerStupen({ nazev, soubeznost, trvaniMs, pocet, pozadavek, ...zbytek });
    vypisStupen(v);
    vysledky.push(v);
    if (v.zastaveno) break;
    if (!cistaMinuta) await new Promise((r) => setTimeout(r, pauzaMs));
  }
  return vysledky;
}

/**
 * fetch, který přečte tělo (jinak se spojení nevrátí do poolu) a spočítá bajty.
 *
 * Timeout není kosmetika: jedno viselé spojení by zastavilo celé vlákno a
 * stupeň by nikdy neskončil. Radši ať se to započítá jako chyba – to je
 * ostatně informace sama o sobě.
 */
export async function zmerFetch(url, init, timeoutMs = 20_000) {
  const odpoved = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const telo = await odpoved.arrayBuffer();
  return { status: odpoved.status, bajtu: telo.byteLength, hlavicky: odpoved.headers };
}
