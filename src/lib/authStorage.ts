/**
 * Kde se drží přihlášení: „Zapamatovat přihlášení“ z přihlašovací obrazovky.
 *
 * Zaškrtávátko dřív ukládalo jen e-mail do políčka, se samotným přihlášením
 * nedělalo nic – relace vždycky ležela v localStorage. Teď rozhoduje o tom,
 * kam se uloží: zaškrtnuté = localStorage (přežije zavření prohlížeče),
 * odškrtnuté = sessionStorage (skončí se zavřením okna).
 *
 * Čtení sahá do obou úložišť, aby po změně volby nikdo nevypadl.
 * V desktopové aplikaci se přihlášení pamatuje vždycky – tam žádné cizí
 * počítače neřešíme a odhlašovat člověka po zavření okna nedává smysl.
 */
const REMEMBER_KEY = "jobsheet_remember_me";

function jeDesktop(): boolean {
  return typeof window !== "undefined" && !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
}

/** Má se přihlášení pamatovat i po zavření prohlížeče? */
export function rememberSession(): boolean {
  if (jeDesktop()) return true;
  try {
    return localStorage.getItem(REMEMBER_KEY) !== "false";
  } catch {
    return true;
  }
}

/** Volá přihlašovací obrazovka ještě před samotným přihlášením. */
export function setRememberSession(remember: boolean): void {
  try {
    localStorage.setItem(REMEMBER_KEY, remember ? "true" : "false");
  } catch {
    /* prohlížeč bez úložiště – zůstane výchozí chování */
  }
}

function trvale(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}
function docasne(): Storage | null {
  try { return window.sessionStorage; } catch { return null; }
}

export const authStorage = {
  getItem: (key: string): string | null => {
    // Nejdřív tam, kam podle volby patří; pak to druhé, ať se relace neztratí
    // při přepnutí volby ani po aktualizaci aplikace.
    const prvni = rememberSession() ? trvale() : docasne();
    const druhe = rememberSession() ? docasne() : trvale();
    return prvni?.getItem(key) ?? druhe?.getItem(key) ?? null;
  },
  setItem: (key: string, value: string): void => {
    const cil = rememberSession() ? trvale() : docasne();
    const druhe = rememberSession() ? docasne() : trvale();
    try { cil?.setItem(key, value); } catch { /* plné úložiště */ }
    // Kopie v tom druhém by volbu obcházela.
    try { druhe?.removeItem(key); } catch { /* ignore */ }
  },
  removeItem: (key: string): void => {
    try { trvale()?.removeItem(key); } catch { /* ignore */ }
    try { docasne()?.removeItem(key); } catch { /* ignore */ }
  },
};
