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
import { devWarn } from "./devLog";

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
 * Naposledy podepsaný odkaz, pokud ještě platí – bez čekání na síť.
 *
 * Existuje kvůli tomu, že seznam zakázek se překresluje často (realtime
 * události, každý zápis) a náhledy fotek se přitom odpojí a připojí znovu.
 * Kdyby si každý nový náhled začínal od uložené adresy a čekal na podpis,
 * pod rukama by se nikdy neustálil: podpis by dorazil až k náhledu, který
 * mezitím zmizel. Cache je společná pro celou aplikaci, tak se z ní čte
 * rovnou při vykreslení.
 */
export function podepsanaZCache(url: string): string | null {
  const cesta = cestaFotky(url);
  return cesta ? zCache(cesta, Date.now()) : null;
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
      if (error || !data?.signedUrl) {
        // Tiché selhání by znamenalo prázdné místo v zakázce a nikdo by
        // nevěděl proč – aspoň ve vývoji ať je v konzoli vidět důvod.
        devWarn("[podepsaneFotky] podpis se nepovedl:", cesta, error);
        return url;
      }
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
    if (error || !data) {
      devWarn("[podepsaneFotky] dávkový podpis se nepovedl:", cesty.length, error);
      return vysledek;
    }
    const platiDo = Date.now() + platnostSekund * 1000;
    for (const polozka of data) {
      // `path` se vrací tak, jak jsme ho poslali; u chybné položky je null.
      const cesta = polozka?.path ?? null;
      const podepsana = polozka?.signedUrl ?? null;
      if (!cesta || !podepsana) continue;
      cache.set(cesta, { url: podepsana, platiDo });
      for (const i of chybi.get(cesta) ?? []) vysledek[i] = podepsana;
    }
  } catch (e) {
    // Beze změny – zůstanou původní odkazy.
    devWarn("[podepsaneFotky] dávkový podpis spadl:", e);
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

async function blobNaDataUrl(blob: Blob): Promise<string> {
  // `FileReader` je jen v prohlížeči. Aby šla příprava dokumentu otestovat
  // (a aby fungovala i tam, kde DOM není), je tu záložní cesta přes ArrayBuffer.
  if (typeof FileReader === "function") {
    return await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(fr.error ?? new Error("Nepodařilo se přečíst obrázek"));
      fr.onload = () => resolve(String(fr.result));
      fr.readAsDataURL(blob);
    });
  }
  const bajty = new Uint8Array(await blob.arrayBuffer());
  let binarne = "";
  // Po částech, ať se u velké fotky nepřeteče zásobník argumentů.
  for (let i = 0; i < bajty.length; i += 8192) {
    binarne += String.fromCharCode(...bajty.subarray(i, i + 8192));
  }
  return `data:${blob.type || "image/jpeg"};base64,${btoa(binarne)}`;
}

/**
 * Připraví fotky pro dokument – každou stáhne a vloží jako `data:` URL.
 *
 * Dokument se vykresluje mimo aplikaci (JobiDocs je samostatný program,
 * tiskový dialog prohlížeče kreslí ze skrytého iframu) a při exportu se
 * z HTML dělá PDF. Odkaz by musel platit ještě v okamžiku vykreslení a do
 * uloženého PDF by se stejně nedostal – PDF si obsah odkazu nedotahuje.
 * Vložený obrázek platí vždycky.
 *
 * Fotka, kterou se nepodaří stáhnout, se z dokumentu vypustí. Dřív by na
 * jejím místě zůstal odkaz, který se v tiskovém náhledu tváří jako prázdné
 * místo a v PDF jako rozbitý obrázek – a nikdo by nepoznal, že tam měla být.
 */
/**
 * Nejdelší strana obrázku vloženého do dokumentu.
 *
 * Fotka z telefonu má klidně 4000 px a v dokumentu z ní je jedna stránka A4 –
 * na 300 dpi se do ní vejde ani ne 2500 px, takže větší obrázek nic nepřidá.
 * Bez zmenšení by přitom zakázka s osmi fotkami poslala do JobiDocs desítky
 * megabajtů v base64, tisk by se táhl a u limitu 50 MB by spadl úplně.
 */
const NEJVETSI_STRANA_PRO_DOKUMENT = 2000;

/**
 * Zmenší obrázek pro vložení do dokumentu. Bez plátna (test, jiné prostředí)
 * nebo při jakékoli potíži vrací původní data – radši větší dokument než
 * dokument bez fotky.
 */
async function zmensiProDokument(dataUrl: string): Promise<string> {
  if (typeof document === "undefined" || typeof Image === "undefined") return dataUrl;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("nelze načíst"));
      i.src = dataUrl;
    });
    const nejdelsi = Math.max(img.width, img.height);
    if (nejdelsi <= NEJVETSI_STRANA_PRO_DOKUMENT) return dataUrl;
    const pomer = NEJVETSI_STRANA_PRO_DOKUMENT / nejdelsi;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * pomer);
    canvas.height = Math.round(img.height * pomer);
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } catch {
    return dataUrl;
  }
}

export async function fotkyDoDokumentu(
  supabase: SupabaseClient | null,
  fotky: readonly string[],
  nacti?: (u: string) => Promise<Blob>
): Promise<string[]> {
  if (fotky.length === 0) return [];
  const hotove = await Promise.all(
    fotky.map(async (u) => {
      const d = await fotkaJakoDataUrl(supabase, u, nacti);
      return d.startsWith("data:") ? await zmensiProDokument(d) : null;
    })
  );
  return hotove.filter((u): u is string => u != null);
}
