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
  // refreshSession jako jinde v aplikaci – v desktopu getSession() často
  // vrátí prošlý token a funkce pak odpoví 401.
  const { data: obnovena } = await supabase.auth.refreshSession();
  return obnovena?.session?.access_token
    ?? (await supabase.auth.getSession()).data?.session?.access_token
    ?? null;
}

/** Zavolá document-pdf. `nedostupne` bez důvodu = funkce není nastavená. */
export async function vytvorPdfNaServeru(serviceId: string, html: string, nazev: string): Promise<{ ok: true; pdf: Blob } | { ok: false; duvod?: string }> {
  if (!supabase || !supabaseAnonKey) return { ok: false, duvod: "Chybí konfigurace Supabase" };
  const token = await jwt();
  if (!token) return { ok: false, duvod: "Nejste přihlášeni" };

  const r = await supabaseFetch(`${supabaseUrl}/functions/v1/document-pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: supabaseAnonKey },
    body: JSON.stringify({ serviceId, html, fileName: nazev }),
  });
  if (r.status === 503) return { ok: false };
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
  // browserPrint vypnuté: stránku tu kreslí headless Chromium jako na
  // desktopu, ne Safari na iOS, takže platí pevný rámec A4.
  const html = await buildDocumentHtmlForWeb(docType, serviceId, data, { browserPrint: false });
  const nazev = `${nazevPdfProTisk(docType, data)}.pdf`;
  const v = await vytvorPdfNaServeru(serviceId, html, nazev);
  if (!v.ok) return { stav: "nedostupne", duvod: v.duvod };
  stahnoutSoubor(v.pdf, nazev, "application/pdf");
  return { stav: "hotovo", nazev };
}
