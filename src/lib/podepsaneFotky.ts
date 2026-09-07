/**
 * Podepsané odkazy na fotky zařízení a podpisy zákazníků.
 *
 * PROČ TO JE:
 * Bucket `diagnostic-photos` byl založený jako veřejný (`storage.buckets.public
 * = true`). Veřejná cesta `/storage/v1/object/public/…` politiky RLS vůbec
 * nevyhodnocuje – vyřídí ji Storage sama. Takže i po tom, co se čtení omezilo
 * na členy servisu (migrace 20260909140000), byla každá fotka zařízení
 * a každý podpis převzetí ke stažení bez přihlášení, stačilo mít odkaz.
 * A odkaz se do světa dostane snadno: je uložený v databázi, chodí do
 * zákaznického portálu, do exportu dat i do tiskového HTML.
 *
 * JAK TO FUNGUJE TEĎ:
 * V databázi zůstává URL ve veřejném tvaru, ale **není to už oprávnění, jen
 * identifikátor** – nese v sobě cestu v bucketu. Před každým zobrazením se
 * z ní cesta vytáhne a podepíše (`createSignedUrl`), takže odkaz platí jen
 * krátce a vydá ho jen ten, kdo na fotku má právo:
 *  - v aplikaci podepisuje přihlášený uživatel svým tokenem, takže se uplatní
 *    RLS – na cizí servis podpis nedostane,
 *  - v portálu a v exportu podepisuje edge funkce pod `service_role` až po
 *    tom, co ověří token zakázky.
 *
 * Díky tomu, že se v databázi nic nepřepisuje, nebylo potřeba sahat na data
 * ostrých servisů a přepnutí bucketu na neveřejný je jediný krok navíc.
 *
 * KDYŽ SE PODEPSAT NEPOVEDE (offline, vypršelá relace) vrací se původní URL.
 * Dokud je bucket veřejný, fotka se ukáže jako dřív; po přepnutí se neukáže,
 * ale aplikace nespadne a uživatel dostane obrázek s chybou místo prázdna.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export const BUCKET_FOTEK = "diagnostic-photos";

/**
 * Jak dlouho platí podepsaný odkaz.
 *
 * Hodina je kompromis: kratší doba by rozbila dlouhý tisk a otevřený portál
 * (obrázek, který se ještě nestihl stáhnout, by po vypršení nedojel), delší
 * by z odkazu zase udělala skoro to, co byla veřejná URL.
 */
export const PLATNOST_SEKUND = 3600;

/**
 * Kolik před vypršením se odkaz obnovuje.
 *
 * Bez rezervy by se odkaz podepsaný o milisekundu dřív, než ho prohlížeč
 * použije, dal do `<img src>` už jako prošlý.
 */
export const REZERVA_MS = 60_000;

type Zaznam = { url: string; platiDo: number };

/** Cesta v bucketu → naposledy podepsaný odkaz. Sdílená pro celou aplikaci. */
const cache = new Map<string, Zaznam>();

/** Rozdělané podpisy, ať se tatáž cesta nepodepisuje z pěti náhledů pětkrát. */
const rozdelane = new Map<string, Promise<string>>();

/**
 * Cesta v bucketu `diagnostic-photos`, nebo `null`, když odkaz do našeho
 * úložiště nevede (staré base64 `data:` URL, cizí adresa).
 *
 * Poznává tři tvary, protože všechny tři se v datech i v paměti aplikace
 * vyskytují najednou:
 *  - `…/object/public/diagnostic-photos/<cesta>` – co je uložené v databázi,
 *  - `…/object/sign/diagnostic-photos/<cesta>?token=…` – co už jednou prošlo
 *    podepsáním (třeba když se maže fotka, kterou uživatel vidí),
 *  - holá cesta `<service_id>/<ticket_id>/<uuid>.jpg` bez domény.
 */
export function cestaFotky(url: string): string | null {
  if (typeof url !== "string") return null;
  const s = url.trim();
  if (!s || s.startsWith("data:")) return null;

  if (!/^https?:\/\//i.test(s)) {
    // Holá cesta. Query string sem nepatří a lomítko na začátku taky ne.
    const cista = s.replace(/^\/+/, "").split("?")[0];
    return cista.includes("/") ? decodeURIComponent(cista) : null;
  }

  try {
    const u = new URL(s);
    const m = u.pathname.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/diagnostic-photos\/(.+)$/);
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

/** Vede odkaz do našeho bucketu? (Jinak jde o base64 nebo cizí adresu.) */
export function jeOdkazNaFotku(url: string): boolean {
  return cestaFotky(url) != null;
}

/** Id servisu z cesty – první složka. Podpisy z portálu leží v `signatures/`. */
export function servisZCesty(cesta: string): string | null {
  const prvni = cesta.split("/")[0];
  return prvni && prvni !== "signatures" ? prvni : null;
}

/** Zahodí zapamatované odkazy. Volá se při odhlášení a v testech. */
export function zapomenPodpisy(): void {
  cache.clear();
  rozdelane.clear();
}

/** Platný záznam z cache, nebo `null`. Vyhozeno i to, co vyprší do rezervy. */
function zCache(cesta: string, ted: number): string | null {
  const z = cache.get(cesta);
  if (!z) return null;
  if (z.platiDo - REZERVA_MS <= ted) {
    cache.delete(cesta);
    return null;
  }
  return z.url;
}

/**
 * Podepíše jeden odkaz. Odkazy mimo náš bucket vrací beze změny.
 *
 * Souběžná volání pro tutéž cestu sdílejí jeden požadavek – detail zakázky
 * vykreslí deset náhledů naráz a bez tohohle by šlo deset požadavků.
 */
export async function podepsFotku(
  supabase: SupabaseClient | null,
  url: string,
  platnostSekund = PLATNOST_SEKUND
): Promise<string> {
  const cesta = cestaFotky(url);
  if (!cesta || !supabase) return url;

  const hotove = zCache(cesta, Date.now());
  if (hotove) return hotove;

  const bezi = rozdelane.get(cesta);
  if (bezi) return bezi;

  const p = (async () => {
    try {
      const { data, error } = await supabase.storage.from(BUCKET_FOTEK).createSignedUrl(cesta, platnostSekund);
      if (error || !data?.signedUrl) return url;
      cache.set(cesta, { url: data.signedUrl, platiDo: Date.now() + platnostSekund * 1000 });
      return data.signedUrl;
    } catch {
      // Offline nebo vypršelá relace. Vrátit původní odkaz je lepší než hodit
      // výjimku doprostřed vykreslování detailu zakázky.
      return url;
    } finally {
      rozdelane.delete(cesta);
    }
  })();
  rozdelane.set(cesta, p);
  return p;
}

/**
 * Podepíše víc odkazů najednou (jeden požadavek na všechny, co chybí v cache).
 *
 * Pořadí odpovídá vstupu, aby se dal výsledek použít rovnou místo pole URL.
 */
export async function podepsFotky(
  supabase: SupabaseClient | null,
  urls: readonly string[],
  platnostSekund = PLATNOST_SEKUND
): Promise<string[]> {
  if (!supabase || urls.length === 0) return [...urls];

  const ted = Date.now();
  const vysledek = [...urls];
  const chybi = new Map<string, number[]>(); // cesta → indexy ve výsledku

  urls.forEach((url, i) => {
    const cesta = cestaFotky(url);
    if (!cesta) return;
    const hotove = zCache(cesta, ted);
    if (hotove) {
      vysledek[i] = hotove;
      return;
    }
    const seznam = chybi.get(cesta) ?? [];
    seznam.push(i);
    chybi.set(cesta, seznam);
  });

  if (chybi.size === 0) return vysledek;

  const cesty = [...chybi.keys()];
  try {
    const { data, error } = await supabase.storage.from(BUCKET_FOTEK).createSignedUrls(cesty, platnostSekund);
    if (error || !data) return vysledek;
    const platiDo = Date.now() + platnostSekund * 1000;
    for (const polozka of data) {
      // `path` se vrací tak, jak jsme ho poslali; u chybné položky je null.
      const cesta = polozka?.path ?? null;
      const podepsana = polozka?.signedUrl ?? null;
      if (!cesta || !podepsana) continue;
      cache.set(cesta, { url: podepsana, platiDo });
      for (const i of chybi.get(cesta) ?? []) vysledek[i] = podepsana;
    }
  } catch {
    // Beze změny – zůstanou původní odkazy.
  }
  return vysledek;
}

/**
 * Stáhne obrázek a vrátí ho jako `data:` URL.
 *
 * Pro tisk a export do PDF: dokument se skládá z HTML a vykresluje jinde
 * (JobiDocs běží jako samostatná aplikace, tiskový dialog prohlížeče kreslí
 * ze skrytého iframu). Odkaz, který mezitím vyprší, by v dokumentu nechal
 * prázdné místo – a v uloženém PDF by chyběl nadobro, protože PDF si obsah
 * odkazu nestahuje. Proto se obrázek vloží dovnitř.
 */
export async function fotkaJakoDataUrl(
  supabase: SupabaseClient | null,
  url: string,
  nacti: (u: string) => Promise<Blob> = vychoziNacti
): Promise<string> {
  if (url.startsWith("data:")) return url;
  const odkaz = await podepsFotku(supabase, url);
  try {
    const blob = await nacti(odkaz);
    return await blobNaDataUrl(blob);
  } catch {
    // Nepovedlo se stáhnout – ať se aspoň zkusí odkaz. Dokud je bucket
    // veřejný, vykreslí se; potom zůstane prázdné místo, ale tisk proběhne.
    return odkaz;
  }
}

async function vychoziNacti(u: string): Promise<Blob> {
  const r = await fetch(u);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.blob();
}

function blobNaDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(fr.error ?? new Error("Nepodařilo se přečíst obrázek"));
    fr.onload = () => resolve(String(fr.result));
    fr.readAsDataURL(blob);
  });
}
