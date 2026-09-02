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
