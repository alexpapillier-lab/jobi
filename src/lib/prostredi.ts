/**
 * Proti kterému prostředí aplikace běží.
 *
 * Staging je kopie produkce bez osobních údajů (docs/STAGING.md) – vypadá
 * stejně, má stejné servisy i zakázky. Bez viditelného označení by se snadno
 * stalo, že člověk zkouší „na stagingu“ a přitom kliká v produkci, nebo
 * naopak. Proto v režimu staging (npm run dev:staging, dev:web:staging,
 * tauri:dev:staging) ukážeme štítek a přidáme [STAGING] do titulku okna.
 *
 * Hodnota jde z VITE_JOBI_PROSTREDI v .env.staging; v produkčním buildu
 * proměnná není a nic se nezobrazí.
 */
export const PROSTREDI: string = (import.meta.env.VITE_JOBI_PROSTREDI as string | undefined) ?? "";

export function jeStaging(): boolean {
  return PROSTREDI === "staging";
}

const PREDPONA_TITULKU = "[STAGING] ";

/** Štítek STAGING a předpona titulku. Mimo staging nedělá nic. */
export function oznacProstredi(): void {
  if (!jeStaging() || typeof document === "undefined") return;

  const stitek = document.createElement("div");
  stitek.textContent = "STAGING";
  stitek.setAttribute("aria-hidden", "true");
  stitek.setAttribute("data-prostredi", "staging");
  Object.assign(stitek.style, {
    position: "fixed",
    top: "0",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: "2147483647",
    pointerEvents: "none",
    background: "#c2410c",
    color: "#fff",
    font: "700 11px/1 system-ui, -apple-system, sans-serif",
    letterSpacing: "0.08em",
    padding: "4px 10px",
    borderRadius: "0 0 6px 6px",
    opacity: "0.9",
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(stitek);

  // Aplikace titulek mění (název servisu, stránka) – předponu vracíme po každé změně.
  const upravTitulek = () => {
    if (!document.title.startsWith(PREDPONA_TITULKU)) document.title = PREDPONA_TITULKU + document.title;
  };
  upravTitulek();
  const cil = document.querySelector("title") ?? document.head;
  new MutationObserver(upravTitulek).observe(cil, { childList: true, subtree: true, characterData: true });
}
