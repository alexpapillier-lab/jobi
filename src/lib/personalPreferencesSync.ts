/**
 * Sdílení osobních voleb napříč zařízeními a platformami.
 *
 * Do teď žily jen v localStorage – tedy zvlášť pro každé zařízení, ne pro
 * uživatele. Kdo si na desktopu zapnul výrazné zvýraznění stavu zakázek
 * nebo si vybral barvu loga, na webu to neměl.
 *
 * Řešení se schválně nenapojuje na jednotlivá místa, která dnes ukládají
 * (Settings.tsx má vlastní `saveUIConfig`, volané na patnácti místech).
 * Místo toho poslouchá stejné události, které se po každém uložení už
 * dneska posílají (`jobsheet:ui-updated`, `jobsheet:logo-preset-changed`)
 * – ty samé, na které reaguje App.tsx a Sidebar/AppLogo. Sync tak funguje
 * bez zásahu do existujících míst, která do localStorage zapisují.
 *
 * Server je zdroj pravdy jen při přihlášení/otevření appky (pull). Zápisy
 * za běhu jdou vždy z klienta ven (push) – nikdy ne obráceně, aby si
 * otevřená appka sama neplezla do rozdělané změny, kterou uživatel právě
 * dělá. Souběh dvou zařízení otevřených zároveň řeší merge v databázi
 * (viz merge_user_preferences), ne nic tady.
 */
import { supabase } from "./supabaseClient";
import { STORAGE_KEYS } from "../constants/storageKeys";
import { SHORTCUTS_CHANGED_EVENT } from "./keyboardShortcuts";
import { THEME_PREFERENCE_STORAGE_KEY } from "../theme/ThemeProvider";

/** Klíče v localStorage, které se sdílí. Přidat další stačí sem. */
const SYNCED_KEYS = [
  STORAGE_KEYS.UI_SETTINGS,
  STORAGE_KEYS.LOGO_PRESET,
  STORAGE_KEYS.THEME,
  // Volba „podle systému“ – přeložené ID je v THEME, tohle nese, že se má
  // překládat podle OS. Bez toho by druhé zařízení dostalo jen pevný motiv.
  THEME_PREFERENCE_STORAGE_KEY,
  STORAGE_KEYS.INVENTORY_DISPLAY_MODE,
  STORAGE_KEYS.KEYBOARD_SHORTCUTS,
] as const;
type SyncedKey = (typeof SYNCED_KEYS)[number];

/** Kterou událost po zápisu daného klíče přeposlat, ať se UI překreslí. */
const REFRESH_EVENT: Record<SyncedKey, string> = {
  [STORAGE_KEYS.UI_SETTINGS]: "jobsheet:ui-updated",
  [STORAGE_KEYS.LOGO_PRESET]: "jobsheet:logo-preset-changed",
  [STORAGE_KEYS.THEME]: "jobsheet:theme-changed",
  [THEME_PREFERENCE_STORAGE_KEY]: "jobsheet:theme-changed",
  [STORAGE_KEYS.INVENTORY_DISPLAY_MODE]: "jobsheet:inventory-display-mode-changed",
  [STORAGE_KEYS.KEYBOARD_SHORTCUTS]: SHORTCUTS_CHANGED_EVENT,
};

export function readSyncedKeys(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of SYNCED_KEYS) {
    const raw = localStorage.getItem(key);
    if (raw === null) continue;
    // UI_SETTINGS je JSON, LOGO_PRESET holý řetězec ("auto", "blue"...) –
    // obojí se do jsonb sloupce uloží stejně přes JSON.parse/hodnotu.
    try {
      out[key] = JSON.parse(raw);
    } catch {
      out[key] = raw;
    }
  }
  return out;
}

export function writeSyncedKeys(data: Record<string, unknown>): void {
  for (const key of SYNCED_KEYS) {
    if (!(key in data)) continue;
    const value = data[key];
    const raw = typeof value === "string" ? value : JSON.stringify(value);
    if (localStorage.getItem(key) === raw) continue; // beze změny, ať se zbytečně nepřekresluje
    localStorage.setItem(key, raw);
    window.dispatchEvent(new CustomEvent(REFRESH_EVENT[key]));
  }
}

/** Stáhne uložené volby a napíše je do localStorage. Volá se jednou po přihlášení. */
export async function pullPersonalPreferences(): Promise<void> {
  if (!supabase) return;
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) return;
  const { data, error } = await (supabase.from("user_preferences") as any)
    .select("data")
    .eq("user_id", userRes.user.id)
    .maybeSingle();
  if (error || !data?.data) return;
  writeSyncedKeys(data.data as Record<string, unknown>);
}

let odlozeno: ReturnType<typeof setTimeout> | null = null;

function naplanujOdeslani() {
  if (odlozeno) clearTimeout(odlozeno);
  odlozeno = setTimeout(() => {
    odlozeno = null;
    if (!supabase) return;
    const patch = readSyncedKeys();
    if (Object.keys(patch).length === 0) return;
    // PostgrestBuilder je „thenable“ a požadavek odešle až při await/.then –
    // samotné `void rpc(...)` nikdy nic neposlalo, takže se na server nikdy
    // nedostala žádná změna a každý start appky stáhl stará nastavení
    // (zobrazení zakázek „skákalo“ zpátky na mřížku).
    void (supabase as any)
      .rpc("merge_user_preferences", { p_patch: patch })
      .then(({ error }: { error: { message?: string } | null }) => {
        if (error) console.warn("[preferences] push selhal:", error.message);
      }, (e: unknown) => console.warn("[preferences] push selhal:", e));
  }, 1000);
}

/**
 * Zapne sync pro dobu, po kterou je uživatel přihlášený. Vrací funkci na
 * úklid (odregistrování posluchačů) – volat při odhlášení/odmontování.
 *
 * Po pullu se navíc jednou pošle push toho, co je PRÁVĚ TEĎ v localStorage
 * – ne proto, aby se posílalo to, co se zrovna stáhlo (to už tam je),
 * ale kvůli tomu, co se stihlo změnit lokálně BĚHEM čekání na pull (dvě
 * otevřená zařízení, na jednom se něco přepne přesně v okamžiku, kdy
 * druhé po startu appky ještě stahuje). Bez týhle "smiřovací" zprávy by
 * taková změna zůstala jen lokálně, dokud by uživatel nezměnil ještě
 * něco dalšího.
 */
export function startPersonalPreferencesSync(): () => void {
  let zruseno = false;

  const events = Object.values(REFRESH_EVENT);
  const handler = () => naplanujOdeslani();

  pullPersonalPreferences().finally(() => {
    if (zruseno) return;
    naplanujOdeslani();
    for (const ev of events) window.addEventListener(ev, handler);
  });

  return () => {
    zruseno = true;
    for (const ev of events) window.removeEventListener(ev, handler);
    if (odlozeno) clearTimeout(odlozeno);
  };
}
