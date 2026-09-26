/**
 * Nová verze webu bez toho, aby si jí uživatel všiml.
 *
 * Po vydání (push na main → Cloudflare Pages) zůstávají otevřené záložky se
 * starou verzí. Ta si dřív nebo později sáhne pro modul, který na serveru
 * už není, a spadne na „nepodařilo se načíst“. Tady se to řeší ze tří stran:
 *
 *   1) Build zapíše otisk (`__JOBI_BUILD__`, viz vite.config.ts) do kódu
 *      i do `version.json` vedle index.html. Aplikace ho jednou za čas a
 *      při návratu do okna porovná se svým.
 *   2) Když je na serveru novější, obnoví se sama – ale jen v klidné
 *      chvíli: záložka je schovaná, nebo uživatel pár minut nic nedělal,
 *      není otevřený žádný dialog (detail zakázky, nová zakázka…) a fronta
 *      neuložených změn je prázdná. Jinak visí nenápadná lišta „Obnovit“.
 *   3) Kdyby stará záložka přesto narazila na chybějící modul, main.tsx ji
 *      po `vite:preloadError` jednou obnoví.
 *
 * Před obnovením si zapamatuje stránku, ať se uživatel vrátí, kde byl.
 * Desktop (Tauri) má vlastní aktualizace, tady se nic nedělá.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { neulozeneZmeny } from "./frontaZapisu";

export const AKTUALNI_BUILD: string = typeof __JOBI_BUILD__ === "string" && __JOBI_BUILD__ ? __JOBI_BUILD__ : "dev";

/** Jak často se ptát serveru (ms). */
export const INTERVAL_KONTROLY_MS = 5 * 60_000;
/** Nejmenší rozestup mezi dvěma kontrolami (návrat do okna, fokus). */
export const MIN_ROZESTUP_MS = 60_000;
/** Kolik klidu od poslední klávesy / kliknutí, než se viditelná záložka obnoví sama. */
export const KLID_PRED_OBNOVOU_MS = 3 * 60_000;
/** Jak často zkoušet, jestli už je bezpečné obnovit. */
export const INTERVAL_POKUSU_MS = 20_000;

const KLIC_NAVRATU = "jobi:po-obnove";

export function jeDesktop(): boolean {
  return typeof window !== "undefined" && !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
}

/** Kontrola má smysl jen v produkčním webovém buildu – ne v Tauri a ne u dev serveru. */
export function kontrolaMaSmysl(): boolean {
  if (typeof window === "undefined" || jeDesktop()) return false;
  if (AKTUALNI_BUILD === "dev") return false;
  return !import.meta.env.DEV;
}

/** Přečte otisk nasazené verze; null při chybě (offline, výpadek) – to není důvod nic dělat. */
export async function nactiNasazenyBuild(base = import.meta.env.BASE_URL): Promise<string | null> {
  try {
    const url = `${base.endsWith("/") ? base : `${base}/`}version.json?t=${Date.now()}`;
    const r = await fetch(url, { cache: "no-store", credentials: "omit" });
    if (!r.ok) return null;
    const j = (await r.json()) as { build?: unknown };
    return typeof j.build === "string" && j.build ? j.build : null;
  } catch {
    return null;
  }
}

export type StavProReload = {
  /** Záložka není vidět (jiná záložka, minimalizované okno). */
  skryta: boolean;
  /** Kolik ms uplynulo od poslední klávesy / kliknutí. */
  klidMs: number;
  /** Otevřený dialog – detail zakázky, nová zakázka, potvrzení… */
  dialog: boolean;
  /** Počet neuložených změn ve frontě. */
  neulozeno: number;
};

/**
 * Je bezpečné obnovit teď? Nikdy s neuloženými změnami a nikdy nad otevřeným
 * dialogem – i schovaná záložka může mít rozepsaný detail, ke kterému se
 * uživatel vrátí. Viditelná záložka navíc až po pár minutách klidu.
 */
export function jeCasNaReload(s: StavProReload, klidPredObnovouMs = KLID_PRED_OBNOVOU_MS): boolean {
  if (s.neulozeno > 0 || s.dialog) return false;
  return s.skryta || s.klidMs >= klidPredObnovouMs;
}

/** Zapamatuje stránku a obnoví záložku. */
export function obnovitNaStejneMisto(stranka: string): void {
  try {
    sessionStorage.setItem(KLIC_NAVRATU, JSON.stringify({ stranka, at: Date.now() }));
  } catch {
    /* privátní okno bez úložiště – prostě se otevře úvod */
  }
  window.location.reload();
}

/** Stránka, kde uživatel byl před obnovou (a klíč hned zahodí). Platí jen chvíli, ať nestraší po dnech. */
export function strankaPoObnove(): string | null {
  try {
    const raw = sessionStorage.getItem(KLIC_NAVRATU);
    if (!raw) return null;
    sessionStorage.removeItem(KLIC_NAVRATU);
    const o = JSON.parse(raw) as { stranka?: unknown; at?: unknown };
    if (typeof o.stranka !== "string" || typeof o.at !== "number") return null;
    return Date.now() - o.at < 5 * 60_000 ? o.stranka : null;
  } catch {
    return null;
  }
}

/**
 * Je na stránce rozdělaná práce? Dialogy (potvrzení, tisk…) a panely
 * označené `data-jobi-rozdelano` – detail zakázky a nová zakázka nejsou
 * dialogy v ARIA smyslu, ale reload nad nimi je stejně nepřípustný.
 */
export function jeOtevrenyDialog(): boolean {
  if (typeof document === "undefined") return false;
  return !!document.querySelector('[role="dialog"], [role="alertdialog"], dialog[open], [data-jobi-rozdelano]');
}

/**
 * Hook pro App: hlídá novou verzi, v klidné chvíli obnoví, jinak vrátí
 * `novaVerze`, ať jde ukázat lištu. `stranka()` říká, kam se po obnově vrátit.
 */
export function useAktualizaceWebu(stranka: () => string): { novaVerze: boolean; obnovit: () => void } {
  const [novaVerze, setNovaVerze] = useState(false);
  // 0 = „zatím nic“; skutečný čas se nastaví až v efektu (Date.now() do renderu nepatří).
  const posledniAkce = useRef(0);
  const posledniKontrola = useRef(0);
  const strankaRef = useRef(stranka);
  useEffect(() => {
    strankaRef.current = stranka;
  });

  const obnovit = useCallback(() => obnovitNaStejneMisto(strankaRef.current()), []);

  useEffect(() => {
    if (!kontrolaMaSmysl()) return;
    let zruseno = false;
    posledniAkce.current = Date.now();

    const zkontroluj = async (vynutit = false) => {
      const ted = Date.now();
      if (!vynutit && ted - posledniKontrola.current < MIN_ROZESTUP_MS) return;
      posledniKontrola.current = ted;
      const build = await nactiNasazenyBuild();
      if (zruseno || !build || build === AKTUALNI_BUILD) return;
      setNovaVerze(true);
    };

    const naAkci = () => { posledniAkce.current = Date.now(); };
    const naViditelnost = () => { if (document.visibilityState === "visible") void zkontroluj(); };
    const naFokus = () => void zkontroluj();
    window.addEventListener("keydown", naAkci, true);
    window.addEventListener("pointerdown", naAkci, true);
    document.addEventListener("visibilitychange", naViditelnost);
    window.addEventListener("focus", naFokus);
    const casovac = window.setInterval(() => void zkontroluj(true), INTERVAL_KONTROLY_MS);
    // První kontrola až po chvíli – při startu jsou na řadě důležitější dotazy.
    const prvni = window.setTimeout(() => void zkontroluj(true), 30_000);

    return () => {
      zruseno = true;
      window.removeEventListener("keydown", naAkci, true);
      window.removeEventListener("pointerdown", naAkci, true);
      document.removeEventListener("visibilitychange", naViditelnost);
      window.removeEventListener("focus", naFokus);
      window.clearInterval(casovac);
      window.clearTimeout(prvni);
    };
  }, []);

  // Je nová verze: každých pár vteřin zkusit, jestli už je klid.
  useEffect(() => {
    if (!novaVerze) return;
    const pokus = () => {
      const stav: StavProReload = {
        skryta: document.visibilityState === "hidden",
        klidMs: Date.now() - posledniAkce.current,
        dialog: jeOtevrenyDialog(),
        neulozeno: neulozeneZmeny().length,
      };
      if (jeCasNaReload(stav)) obnovitNaStejneMisto(strankaRef.current());
    };
    pokus();
    const casovac = window.setInterval(pokus, INTERVAL_POKUSU_MS);
    return () => window.clearInterval(casovac);
  }, [novaVerze]);

  return { novaVerze, obnovit };
}

/**
 * Pojistka pro main.tsx: stará záložka sáhla po modulu, který po vydání
 * na serveru už není. Jedno obnovení to spraví; když by se to opakovalo
 * hned znovu, je chyba jinde a smyčka reloadů by ji jen schovala.
 */
export function zapniObnovuPoChybeModulu(): void {
  if (typeof window === "undefined") return;
  const KLIC = "jobi:reload-po-chybe-modulu";
  window.addEventListener("vite:preloadError", (e) => {
    let nedavno = false;
    try {
      const posledni = Number(sessionStorage.getItem(KLIC) ?? 0);
      nedavno = Date.now() - posledni < 60_000;
      if (!nedavno) sessionStorage.setItem(KLIC, String(Date.now()));
    } catch {
      /* bez úložiště radši neobnovovat opakovaně */
      nedavno = true;
    }
    if (nedavno) return;
    e.preventDefault();
    window.location.reload();
  });
}
