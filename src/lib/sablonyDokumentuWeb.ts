/**
 * Šablony dokumentů ve webové verzi – úložiště pro editor JobiDocs.
 *
 * Editor šablon (jobidocs/src/editor) je jeden a sdílený s desktopovým
 * JobiDocs. Ten čte a ukládá přes svůj místní server; tady se totéž dělá
 * přímo v Supabase pod přihlášeným uživatelem Jobi, takže platí RLS:
 * zapisovat smí majitel, správce a člen s oprávněním „Dokumenty“
 * (`can_manage_documents`) – stejně jako dnes.
 *
 * Musí se chovat jako desktop (jobidocs/api/documentsStore.ts), jinak by
 * šablona uložená na webu vypadala v JobiDocs jinak:
 * - šablony leží v `service_document_settings.config.v2`, ostatní klíče
 *   configu (autoPrint, warrantyCertificate, …) zůstávají beze změny;
 * - verze řádku (sloupec `version`, zvyšuje ho trigger) hlídá souběžné
 *   úpravy: kdo ukládá ze starší verze, dostane konflikt (409) a vybere si,
 *   jestli načte cizí verzi, nebo ji přepíše;
 * - logo, razítko a hlavičkový papír se při uložení zkusí nahrát do bucketu
 *   `service-document-assets` (stejné cesty jako desktop). Když bucket
 *   není nebo zápis neprojde, zůstanou v configu jako data: URL – tak to
 *   v produkci dnes je, bucket zakládá až migrace 20261012100000.
 *
 * Proti desktopu je zápis bezpečnější: místo „načti, porovnej, přepiš“ se
 * aktualizuje jen řádek s očekávanou verzí, takže se dvě uložení ve stejné
 * chvíli nemohou přepsat potichu.
 *
 * Supabase klient, tisk a hlášky se předávají zvenčí, aby šel modul
 * otestovat bez prohlížeče (sablonyDokumentuWeb.test.ts).
 */
import { documentsFromConfig, normalizeDocuments, renderDocument, serviceFromCompanyData, templateFor, type DocType, type DocumentsV2 } from "../../jobidocs/core/index";
import { loadRecentWithClient, type KlientPoslednichDokladu } from "../../jobidocs/api/recent";
import { chybaKonfliktu, type BrandAssetKind, type Context, type DocumentsStorage, type LoadedDocuments, type PrintRequest, type SavedDocuments, type ServiceEntry } from "../../jobidocs/src/storage/types";
import type { DocumentData } from "./documentData";
import { nazevPdfProTisk } from "./nazevPdf";
import { spustWebovyDokument, type DruhHlasky } from "./tiskDokumentu";

export const TABULKA_SABLON = "service_document_settings";
export const BUCKET_ZNACKY = "service-document-assets";

/* ------------------------------------------------------------------------- */
/* Klient                                                                     */
/* ------------------------------------------------------------------------- */

export type ChybaDb = { message: string; code?: string };
export type VysledekDb = { data: unknown; error: ChybaDb | null };

/** Řetězitelný dotaz – podmnožina PostgrestFilterBuilderu, kterou tu potřebujeme. */
export type DotazDb = PromiseLike<VysledekDb> & {
  select(sloupce: string): DotazDb;
  eq(sloupec: string, hodnota: unknown): DotazDb;
  maybeSingle(): PromiseLike<VysledekDb>;
};

export type KlientSablon = {
  from(tabulka: string): {
    select(sloupce: string): DotazDb;
    update(zmena: Record<string, unknown>): DotazDb;
    insert(radek: Record<string, unknown>): DotazDb;
  };
  storage: {
    from(bucket: string): {
      upload(cesta: string, telo: Blob, volby: { contentType: string; upsert: boolean }): PromiseLike<{ error: unknown }>;
      getPublicUrl(cesta: string): { data: { publicUrl: string } };
    };
  };
};

/* ------------------------------------------------------------------------- */
/* Čtení a zápis šablon                                                       */
/* ------------------------------------------------------------------------- */

type Rec = Record<string, unknown>;
type Radek = { config: Rec; version: number; updated_at: string | null };

/**
 * Řádek nastavení dokumentů. `null` = servis ještě žádný nemá.
 * Chyba čtení se NESMÍ zaměnit za „nic tam není“ – zápis by pak přepsal
 * cizí config (viz documentSettings.ts).
 */
async function nactiRadek(klient: KlientSablon, serviceId: string): Promise<Radek | null> {
  const { data, error } = await klient.from(TABULKA_SABLON).select("config, version, updated_at").eq("service_id", serviceId).maybeSingle();
  if (error) throw new Error(`Šablony se nepodařilo načíst: ${error.message}`);
  if (!data) return null;
  const r = data as { config?: unknown; version?: unknown; updated_at?: unknown };
  return {
    config: r.config && typeof r.config === "object" ? (r.config as Rec) : {},
    version: typeof r.version === "number" ? r.version : 1,
    updated_at: typeof r.updated_at === "string" ? r.updated_at : null,
  };
}

/** Šablony servisu, jak je čte desktop (`loadDocuments`) – bez řádku výchozí šablony s verzí 0. */
export async function nactiSablony(klient: KlientSablon, serviceId: string, canManage: boolean): Promise<LoadedDocuments> {
  const radek = await nactiRadek(klient, serviceId);
  if (!radek) return { documents: normalizeDocuments(documentsFromConfig(null)), version: 0, updated_at: null, source: "default", canManage, online: true };
  return { documents: normalizeDocuments(documentsFromConfig(radek.config)), version: radek.version, updated_at: radek.updated_at, source: "supabase", canManage, online: true };
}

/** Nový config: šablony do `v2`, všechno ostatní (autoPrint, warrantyCertificate, …) zůstává. */
export function configSeSablonami(predchozi: Rec | null | undefined, documents: DocumentsV2): Rec {
  return { ...(predchozi ?? {}), v2: documents };
}

const PRIPONY: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/gif": "gif", "image/webp": "webp" };

/** data: URL → Blob. `null`, když to není base64 data: URL. */
export function dataUrlNaBlob(dataUrl: string): { blob: Blob; mime: string } | null {
  const m = /^data:([\w/+.-]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  const binarni = atob(m[2]);
  const bajty = new Uint8Array(binarni.length);
  for (let i = 0; i < binarni.length; i++) bajty[i] = binarni.charCodeAt(i);
  return { blob: new Blob([bajty], { type: m[1] }), mime: m[1] };
}

/** Nahraje jeden soubor značky; `null` = nepovedlo se (chybí bucket, RLS…), zůstane data: URL. */
async function nahrajSoubor(klient: KlientSablon, cesta: string, dataUrl: string): Promise<string | null> {
  const soubor = dataUrlNaBlob(dataUrl);
  if (!soubor) return null;
  try {
    const { error } = await klient.storage.from(BUCKET_ZNACKY).upload(cesta, soubor.blob, { contentType: soubor.mime, upsert: true });
    if (error) return null;
    return klient.storage.from(BUCKET_ZNACKY).getPublicUrl(cesta).data?.publicUrl ?? null;
  } catch {
    return null;
  }
}

/**
 * Logo, razítko a hlavičkový papír jako data: URL → soubory v bucketu, v configu
 * zůstane adresa. Cesty a `?v=` jsou stejné jako v JobiDocs (documentsStore.ts),
 * aby se obě aplikace přepisovaly navzájem, a ne hromadily soubory.
 */
export async function nahrajObrazkyZnacky(klient: KlientSablon, serviceId: string, docs: DocumentsV2, ted: number = Date.now()): Promise<DocumentsV2> {
  const brand = { ...docs.brand };
  const logo = brand.logoUrl;
  if (logo?.startsWith("data:image/")) {
    const mime = /^data:(image\/\w+)/.exec(logo)?.[1] ?? "image/png";
    const url = await nahrajSoubor(klient, `${serviceId}/logo.${PRIPONY[mime] ?? "png"}`, logo);
    if (url) brand.logoUrl = `${url}?v=${ted}`;
  }
  const razitko = brand.stampUrl;
  if (razitko?.startsWith("data:image/")) {
    const mime = /^data:(image\/\w+)/.exec(razitko)?.[1] ?? "image/png";
    const url = await nahrajSoubor(klient, `${serviceId}/stamp.${PRIPONY[mime] ?? "png"}`, razitko);
    if (url) brand.stampUrl = `${url}?v=${ted}`;
  }
  const papir = brand.letterheadPdfUrl;
  if (papir?.startsWith("data:application/pdf")) {
    const url = await nahrajSoubor(klient, `${serviceId}/letterhead.pdf`, papir);
    if (url) brand.letterheadPdfUrl = `${url}?v=${ted}`;
  }
  return { ...docs, brand };
}

const BEZ_OPRAVNENI = "Nemáte oprávnění měnit nastavení dokumentů.";

/**
 * Uloží šablony s kontrolou verze.
 *
 * `ifVersion` = verze, ze které editor vycházel; bez ní (volba „Přepsat“) se
 * přepíše aktuální verze. Obrázky se nahrávají až po kontrole verze – při
 * konfliktu by se jinak v úložišti přepsalo logo, které pak nikdo neuloží.
 */
export async function ulozSablony(klient: KlientSablon, serviceId: string, docs: DocumentsV2, ifVersion?: number): Promise<SavedDocuments> {
  const radek = await nactiRadek(klient, serviceId);
  if (radek && ifVersion != null && radek.version !== ifVersion) throw chybaKonfliktu(radek.version, radek.updated_at);
  if (!radek && ifVersion != null && ifVersion > 0) {
    // Řádek, ze kterého editor vycházel, mezitím zmizel (smazaný servis, obnova zálohy).
    throw new Error("Nastavení dokumentů servisu se nepodařilo najít. Načtěte šablony znovu.");
  }

  const documents = await nahrajObrazkyZnacky(klient, serviceId, normalizeDocuments(docs));
  const config = configSeSablonami(radek?.config, documents);

  if (radek) {
    // Zapíše se jen řádek, který má pořád verzi, kterou jsme právě četli.
    const { data, error } = await klient.from(TABULKA_SABLON).update({ config }).eq("service_id", serviceId).eq("version", radek.version).select("version, updated_at");
    if (error) throw new Error(error.code === "42501" ? BEZ_OPRAVNENI : `Uložení selhalo: ${error.message}`);
    const ulozeno = Array.isArray(data) ? (data[0] as { version?: number; updated_at?: string } | undefined) : undefined;
    if (!ulozeno) {
      // Nic se nezapsalo: buď mezitím uložil někdo jiný (verze se změnila),
      // nebo zápis tiše odmítla RLS (verze zůstala).
      const ted = await nactiRadek(klient, serviceId);
      if (ted && ted.version !== radek.version) throw chybaKonfliktu(ted.version, ted.updated_at);
      throw new Error(`${BEZ_OPRAVNENI} (Nebo servis nemá platné předplatné.)`);
    }
    return { ok: true, version: typeof ulozeno.version === "number" ? ulozeno.version : radek.version + 1, updated_at: ulozeno.updated_at ?? null, documents, savedTo: "supabase" };
  }

  const { data, error } = await klient.from(TABULKA_SABLON).insert({ service_id: serviceId, config }).select("version, updated_at");
  if (error) {
    // Řádek mezitím založil někdo jiný (unikátní service_id).
    if (error.code === "23505") {
      const ted = await nactiRadek(klient, serviceId);
      throw chybaKonfliktu(ted?.version ?? 1, ted?.updated_at ?? null);
    }
    throw new Error(error.code === "42501" ? BEZ_OPRAVNENI : `Uložení selhalo: ${error.message}`);
  }
  const vlozeno = Array.isArray(data) ? (data[0] as { version?: number; updated_at?: string } | undefined) : undefined;
  return { ok: true, version: vlozeno?.version ?? 1, updated_at: vlozeno?.updated_at ?? null, documents, savedTo: "supabase" };
}

/* ------------------------------------------------------------------------- */
/* Obrázky značky z prohlížeče                                                */
/* ------------------------------------------------------------------------- */

/** Logo a razítko jsou na papíře pár centimetrů – víc než 1000 px nemá smysl (jako pdfServer.ts). */
export const MAX_STRANA_ZNACKY = 1000;
/** Menší soubory se nepřekódovávají – zmenšení by nic neušetřilo. */
const MIN_BAJTU_KE_ZMENSENI = 120 * 1024;
/** Hlavičkový papír se nezmenšuje; větší PDF by nafouklo každý tisk. */
export const MAX_BAJTU_PAPIRU = 10 * 1024 * 1024;

/** Zmenšení na nejvýš `max` px delší strany (nikdy nezvětšuje). */
export function rozmeryPoZmenseni(sirka: number, vyska: number, max: number = MAX_STRANA_ZNACKY): { sirka: number; vyska: number } {
  const meritko = Math.min(1, max / Math.max(sirka, vyska, 1));
  return { sirka: Math.max(1, Math.round(sirka * meritko)), vyska: Math.max(1, Math.round(vyska * meritko)) };
}

function souborNaDataUrl(file: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error ?? new Error("Soubor se nepodařilo přečíst."));
    r.readAsDataURL(file);
  });
}

/**
 * Obrázek k vykreslení. createImageBitmap neumí SVG (Chrome, Firefox) a starší
 * Safari ho s Blobem nemá vůbec – pak přes <img>.
 */
async function nactiObrazek(file: File): Promise<{ zdroj: CanvasImageSource; sirka: number; vyska: number; uvolni: () => void }> {
  if (typeof createImageBitmap === "function" && file.type !== "image/svg+xml") {
    try {
      const bmp = await createImageBitmap(file);
      return { zdroj: bmp, sirka: bmp.width, vyska: bmp.height, uvolni: () => bmp.close?.() };
    } catch {
      /* zkusí se <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("Soubor není obrázek, který prohlížeč umí otevřít."));
      img.src = url;
    });
    // SVG bez rozměrů má naturalWidth 0 – vykreslí se do čtverce.
    const sirka = img.naturalWidth || MAX_STRANA_ZNACKY;
    const vyska = img.naturalHeight || MAX_STRANA_ZNACKY;
    return { zdroj: img, sirka, vyska, uvolni: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

/**
 * Soubor vybraný v prohlížeči → hodnota do značky (data: URL).
 *
 * Logo a razítko se zmenší na nejvýš 1000 px delší strany. Průhledný
 * obrázek se uloží jako WebP (Chrome, Firefox), kde ho prohlížeč neumí
 * zakódovat (Safari), jako PNG; neprůhledný jako JPEG. Malý soubor
 * v rozumném rozlišení zůstane, jak je. Hlavičkový papír musí být PDF.
 */
export async function pripravObrazekZnacky(file: File, kind: BrandAssetKind): Promise<string> {
  if (kind === "letterhead") {
    if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) throw new Error("Hlavičkový papír musí být PDF.");
    if (file.size > MAX_BAJTU_PAPIRU) throw new Error("PDF je větší než 10 MB.");
    const url = await souborNaDataUrl(file);
    // Některé systémy hlásí PDF jako application/octet-stream.
    return url.replace(/^data:[^;]*;/, "data:application/pdf;");
  }
  if (file.type && !file.type.startsWith("image/")) throw new Error("Vyberte obrázek (PNG, JPEG, WebP nebo SVG).");

  const obr = await nactiObrazek(file);
  try {
    const svg = file.type === "image/svg+xml";
    const bezZmeny = !svg && /^image\/(png|jpeg|webp)$/.test(file.type) && file.size < MIN_BAJTU_KE_ZMENSENI && Math.max(obr.sirka, obr.vyska) <= MAX_STRANA_ZNACKY;
    if (bezZmeny) return await souborNaDataUrl(file);

    // SVG se vykreslí rovnou v cílové velikosti, ať je ostré.
    const cil = svg ? rozmeryPoZmenseni(obr.sirka * 100, obr.vyska * 100) : rozmeryPoZmenseni(obr.sirka, obr.vyska);
    const platno = document.createElement("canvas");
    platno.width = cil.sirka;
    platno.height = cil.vyska;
    const ctx = platno.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Prohlížeč neumí obrázek zpracovat.");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(obr.zdroj, 0, 0, cil.sirka, cil.vyska);

    const pruhledny = file.type !== "image/jpeg" && maPruhlednost(ctx, cil.sirka, cil.vyska);
    if (!pruhledny) return platno.toDataURL("image/jpeg", 0.88);
    const webp = platno.toDataURL("image/webp", 0.9);
    // Safari WebP nezakóduje a vrátí PNG – to je v pořádku.
    return webp.startsWith("data:image/webp") ? webp : platno.toDataURL("image/png");
  } finally {
    obr.uvolni();
  }
}

/** Má obrázek průhledné body? Vzorkuje se každý 97. pixel (jako pdfServer.ts). */
function maPruhlednost(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const d = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < d.length; i += 4 * 97) if (d[i] < 250) return true;
  return false;
}

/* ------------------------------------------------------------------------- */
/* Úložiště pro editor                                                        */
/* ------------------------------------------------------------------------- */

export type ZavislostiWebu = {
  klient: KlientSablon;
  services: ServiceEntry[];
  activeServiceId: string | null;
  /** Údaje firmy pro náhled (Jobi je drží v localStorage, viz companyData.ts). */
  companyData: () => Record<string, unknown> | null;
  /** Smí uživatel šablony měnit (majitel, správce, člen s can_manage_documents). */
  canManage: boolean;
  /** Tiskový dialog prohlížeče nad HTML (webPrint.printHtmlInBrowser). */
  tiskHtml: (html: string, nazev: string) => Promise<void>;
  /** PDF ze serveru (pdfServer.vytvorPdfNaServeru); bez něj se PDF dělá tiskovým dialogem. */
  pdfZeServeru?: (serviceId: string, html: string, nazev: string) => Promise<{ ok: true; pdf: Blob } | { ok: false; duvod?: string }>;
  stahnout: (pdf: Blob, nazev: string) => void;
  /** Fotky skutečné zakázky do dokumentu jako data (podepsaneFotky). */
  pripravFotky?: (data: DocumentData) => Promise<DocumentData>;
  hlaska: (text: string, druh: DruhHlasky) => void;
  /** Po uložení – webový tisk má hned použít novou šablonu (webPrint.zapomenSablonyProWeb). */
  poUlozeni?: (serviceId: string) => void;
  /** Náhrada obrázků v testech; jinak pripravObrazekZnacky. */
  pripravObrazek?: (file: File, kind: BrandAssetKind) => Promise<string>;
};

function htmlUkazky(req: PrintRequest, data: DocumentData, browserPrint: boolean): string {
  const docs = req.documents;
  return renderDocument({ template: templateFor(docs, req.docType), data, brand: docs.brand, theme: docs.theme, options: { mode: "print", browserPrint } });
}

/** Zkušební tisk / PDF ukázky – stejná cesta jako tisk ze zakázky (tiskDokumentu.spustWebovyDokument). */
async function tiskUkazky(z: ZavislostiWebu, rezim: "print" | "export", req: PrintRequest): Promise<void> {
  const nazevUkazky = (docType: DocType, data: DocumentData) => `${nazevPdfProTisk(docType, data)}-ukazka`;
  const nedostupne = async () => {
    throw new Error("Ve webové verzi není k dispozici.");
  };
  await spustWebovyDokument(rezim, req.docType, req.serviceId, req.previewData as DocumentData, {
    // Desktopová větev se tu nepoužije.
    jobiDocsBezi: async () => false,
    tisk: nedostupne,
    exportPdf: nedostupne,
    vyberCilovySoubor: async () => null,
    // Tiskne se rozpracovaná šablona z editoru, ne ta uložená v databázi.
    tiskVProhlizeci: (docType, _sid, data) => z.tiskHtml(htmlUkazky(req, data, true), nazevUkazky(docType, data)),
    exportPdfVProhlizeci: z.pdfZeServeru
      ? async (docType, sid, data) => {
          const nazev = `${nazevUkazky(docType, data)}.pdf`;
          const v = await z.pdfZeServeru!(sid, htmlUkazky(req, data, false), nazev);
          if (!v.ok) return { stav: "nedostupne", duvod: v.duvod };
          z.stahnout(v.pdf, nazev);
          return { stav: "hotovo", nazev };
        }
      : undefined,
    pripravFotky: z.pripravFotky ?? (async (d) => d),
    hlaska: z.hlaska,
    hotovyExport: (nazev) => z.hlaska(`PDF staženo: ${nazev}`, "success"),
    telemetrie: () => {},
    ted: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
  });
}

/** Úložiště pro editor šablon ve webové verzi Jobi. */
export function vytvorWeboveUloziste(z: ZavislostiWebu): DocumentsStorage {
  return {
    kind: "web",
    context: async (): Promise<Context> => ({ services: z.services, activeServiceId: z.activeServiceId, companyData: z.companyData(), canManageDocuments: z.canManage }),
    load: (serviceId) => nactiSablony(z.klient, serviceId, z.canManage),
    async save(serviceId, documents, ifVersion) {
      // Bez oprávnění by zápis tiše odmítla RLS – radši rovnou srozumitelně.
      if (!z.canManage) throw new Error(BEZ_OPRAVNENI);
      const r = await ulozSablony(z.klient, serviceId, documents, ifVersion);
      z.poUlozeni?.(serviceId);
      return r;
    },
    prepareBrandAsset: (file, kind) => (z.pripravObrazek ?? pripravObrazekZnacky)(file, kind),
    recent: (serviceId, docType) => loadRecentWithClient(z.klient as unknown as KlientPoslednichDokladu, serviceId, docType, serviceFromCompanyData(z.companyData())),
    async testPrint(req) {
      await tiskUkazky(z, "print", req);
      return null;
    },
    async savePdf(req) {
      await tiskUkazky(z, "export", req);
      return null;
    },
  };
}

