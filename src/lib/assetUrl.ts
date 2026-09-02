/**
 * Cesta ke statickému souboru z public/ složky.
 *
 * Nešlo použít natvrdo "/logos/…": webová verze může běžet v podsložce
 * (appjobi.com/servis/), kde absolutní cesta míří mimo aplikaci.
 *
 * Cloudflare Pages navíc na neexistující cestu vrací index.html se stavem
 * 200 – takže se chyba neprojeví jako 404, ale jako HTML místo obrázku.
 * V AppLogo, který odpověď vkládá přes dangerouslySetInnerHTML, to
 * znamenalo vložení celého marketingového webu dovnitř aplikace.
 *
 * import.meta.env.BASE_URL je "/" pro desktop a "/servis/" pro build
 * do podsložky (viz JOBI_WEB_BASE ve vite.config.web.ts).
 */
export function assetUrl(path: string): string {
  const base = import.meta.env.BASE_URL || "/";
  return `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

/**
 * Je odpověď opravdu SVG?
 *
 * AppLogo vkládá staženy obsah přes dangerouslySetInnerHTML, takže se musí
 * ověřit, že nejde o HTML stránku. Cloudflare Pages totiž na chybějící cestu
 * vrací index.html se stavem 200 – bez téhle kontroly se do aplikace vložil
 * celý marketingový web.
 *
 * Pozor na to, že reálné SVG často nezačíná rovnou značkou <svg>, ale
 * XML deklarací a DOCTYPE. Kontrola na startsWith("<svg") proto odmítala
 * i platné soubory a logo se nevykreslilo vůbec.
 */
export function looksLikeSvg(text: string): boolean {
  if (/^\s*<!doctype\s+html/i.test(text)) return false;
  if (/^\s*<html[\s>]/i.test(text)) return false;
  return /<svg[\s>]/i.test(text);
}
