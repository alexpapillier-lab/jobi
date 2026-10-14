/**
 * PDF dokumentu ze serveru pro webovou verzi.
 *
 * Prohlížeč umí PDF jen přes tiskový dialog. Tady se hotové HTML
 * dokumentu (totéž, co by šlo do dialogu) pošle edge funkci document-pdf,
 * ta ho nechá vykreslit v Cloudflare Browser Rendering a vrátí PDF, které
 * se rovnou stáhne pod správným názvem.
 *
 * Když funkce není nastavená (503 not_configured) nebo selže, vrací se
 * „nedostupné“ a volající spadne na tiskový dialog – uživatel vždycky
 * k PDF dojde, jen jednou pohodlněji.
 */
import { supabase, supabaseUrl, supabaseAnonKey, supabaseFetch } from "./supabaseClient";
import { buildDocumentHtmlForWeb, type WebPrintDocType } from "./webPrint";
import { nazevPdfProTisk } from "./nazevPdf";
import { stahnoutSoubor } from "./stahnoutSoubor";
import type { DocumentData } from "./documentData";

export type VysledekPdfZeServeru =
  | { stav: "hotovo"; nazev: string }
  | { stav: "nedostupne"; duvod?: string };

async function jwt(): Promise<string | null> {
  if (!supabase) return null;
  // Platný token se nepřeobnovuje (ušetří ~0,2 s). Obnova jen když vyprší do
  // minuty – v desktopu getSession() umí vrátit prošlý token a funkce pak
  // odpoví 401.
  const { data } = await supabase.auth.getSession();
  const s = data?.session;
  if (s?.access_token && (s.expires_at ?? 0) * 1000 > Date.now() + 60_000) return s.access_token;
  const { data: obnovena } = await supabase.auth.refreshSession();
  return obnovena?.session?.access_token ?? s?.access_token ?? null;
}

/** Nejdelší strana fotky v PDF – A4 při ~300 dpi. */
const MAX_STRANA_FOTKY = 1600;
/** Logo a razítko (průhledné PNG) jsou na papíře pár centimetrů – stačí méně. */
const MAX_STRANA_LOGA = 1000;
/** Menší obrázky se nechávají, jak jsou – zmenšení by nic neušetřilo. */
const MIN_BAJTU_KE_ZMENSENI = 120 * 1024;

/** Má obrázek průhledné body? Vzorkuje se každý 97. pixel – stačí to a je to rychlé. */
function maPruhlednost(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const d = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < d.length; i += 4 * 97) if (d[i] < 250) return true;
  return false;
}

/**
 * Zmenší velké obrázky vložené v HTML jako data: (logo, razítko, fotky).
 * Logo nahrané v plném rozlišení mívá stovky KB; dokument se tím zmenší
 * několikrát a na pomalém připojení odejde o sekundy dřív.
 * - neprůhledný obrázek → JPEG 0,85, nejdelší strana nejvýš 1600 px;
 * - průhledný (logo, razítko) → WebP s průhledností, kde to prohlížeč umí
 *   (Chromium, Firefox), jinak zmenšené PNG; nejdelší strana nejvýš 1000 px.
 * Nový obrázek se použije jen, když je menší. Když cokoli selže, zůstane
 * původní – PDF se kvůli tomu nesmí rozbít.
 */
export async function zmensiObrazkyVHtml(html: string): Promise<string> {
  if (typeof document === "undefined" || typeof createImageBitmap === "undefined") return html;
  const vzor = /data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)/g;
  const nahrady = new Map<string, string>();
  for (const m of html.matchAll(vzor)) {
    const cele = m[0];
    if (nahrady.has(cele) || m[2].length * 0.75 < MIN_BAJTU_KE_ZMENSENI) continue;
    try {
      const bajty = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bajty], { type: m[1] }));
      // Průhlednost se zjišťuje v plné velikosti, pak se teprve zmenšuje.
      const zkouska = document.createElement("canvas");
      zkouska.width = bmp.width;
      zkouska.height = bmp.height;
      const zctx = zkouska.getContext("2d", { willReadFrequently: true });
      if (!zctx) continue;
      zctx.drawImage(bmp, 0, 0);
      const pruhledny = m[1] !== "image/jpeg" && m[1] !== "image/jpg" && maPruhlednost(zctx, bmp.width, bmp.height);
      const meritko = Math.min(1, (pruhledny ? MAX_STRANA_LOGA : MAX_STRANA_FOTKY) / Math.max(bmp.width, bmp.height));
      const sirka = Math.max(1, Math.round(bmp.width * meritko));
      const vyska = Math.max(1, Math.round(bmp.height * meritko));
      const platno = document.createElement("canvas");
      platno.width = sirka;
      platno.height = vyska;
      const ctx = platno.getContext("2d");
      if (!ctx) continue;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bmp, 0, 0, sirka, vyska);
      bmp.close?.();
      let novy: string;
      if (pruhledny) {
        const webp = platno.toDataURL("image/webp", 0.9);
        // Safari WebP nezakóduje a vrátí PNG – pak zůstane zmenšené PNG.
        novy = webp.startsWith("data:image/webp") ? webp : platno.toDataURL("image/png");
      } else {
        novy = platno.toDataURL("image/jpeg", 0.85);
      }
      if (novy.length < cele.length) nahrady.set(cele, novy);
    } catch {
      /* obrázek zůstane původní */
    }
  }
  if (nahrady.size === 0) return html;
  return html.replace(vzor, (cele) => nahrady.get(cele) ?? cele);
}

/** Zavolá document-pdf. `nedostupne` bez důvodu = funkce není nastavená. */
export async function vytvorPdfNaServeru(serviceId: string, html: string, nazev: string): Promise<{ ok: true; pdf: Blob } | { ok: false; duvod?: string }> {
  if (!supabase || !supabaseAnonKey) return { ok: false, duvod: "Chybí konfigurace Supabase" };
  const token = await jwt();
  if (!token) return { ok: false, duvod: "Nejste přihlášeni" };

  const lehci = await zmensiObrazkyVHtml(html);
  const r = await supabaseFetch(`${supabaseUrl}/functions/v1/document-pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: supabaseAnonKey },
    body: JSON.stringify({ serviceId, html: lehci, fileName: nazev }),
  });
  if (r.status === 503) {
    // not_configured = funkce není zřízená (tiše do dialogu); jinak důvod ukázat.
    const d = await r.json().catch(() => ({})) as { error?: string };
    return d.error && d.error !== "not_configured" ? { ok: false, duvod: d.error } : { ok: false };
  }
  if (!r.ok) {
    const d = await r.json().catch(() => ({})) as { error?: string };
    return { ok: false, duvod: d.error ?? `Server odpověděl ${r.status}` };
  }
  return { ok: true, pdf: await r.blob() };
}

/**
 * Sestaví dokument, nechá ho převést na PDF na serveru a stáhne ho.
 * Fotky už musí být v `data` vložené (pripravFotky) – server k úložišti nemá relaci.
 */
export async function stahnoutDokumentJakoPdf(docType: WebPrintDocType, serviceId: string, data: DocumentData): Promise<VysledekPdfZeServeru> {
  const nazev = `${nazevPdfProTisk(docType, data)}.pdf`;
  const v = await pdfDokumentuNaServeru(docType, serviceId, data);
  if (!v.ok) return { stav: "nedostupne", duvod: v.duvod };
  stahnoutSoubor(v.pdf, nazev, "application/pdf");
  return { stav: "hotovo", nazev };
}

/**
 * PDF dokladu ze serveru jako Blob – pro tisk (stažení) i pro přílohu
 * e-mailu (faktura). Fotky už musí být v `data` vložené.
 */
export async function pdfDokumentuNaServeru(docType: WebPrintDocType, serviceId: string, data: DocumentData): Promise<{ ok: true; pdf: Blob; nazev: string } | { ok: false; duvod?: string }> {
  // browserPrint vypnuté: stránku tu kreslí headless Chromium jako na
  // desktopu, ne Safari na iOS, takže platí pevný rámec A4.
  const html = await buildDocumentHtmlForWeb(docType, serviceId, data, { browserPrint: false });
  const nazev = `${nazevPdfProTisk(docType, data)}.pdf`;
  const v = await vytvorPdfNaServeru(serviceId, html, nazev);
  return v.ok ? { ok: true, pdf: v.pdf, nazev } : v;
}

/** Blob → base64 bez prefixu data URL (příloha e-mailu). */
export function blobNaBase64(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(r.error ?? new Error("Čtení PDF selhalo"));
    r.readAsDataURL(b);
  });
}
