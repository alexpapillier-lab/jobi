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

/** Klíče v localStorage, které se sdílí. Přidat další stačí sem. */
const SYNCED_KEYS = [STORAGE_KEYS.UI_SETTINGS, STORAGE_KEYS.LOGO_PRESET] as const;
type SyncedKey = (typeof SYNCED_KEYS)[number];

/** Kterou událost po zápisu daného klíče přeposlat, ať se UI překreslí. */
const REFRESH_EVENT: Record<SyncedKey, string> = {
  [STORAGE_KEYS.UI_SETTINGS]: "jobsheet:ui-updated",
  [STORAGE_KEYS.LOGO_PRESET]: "jobsheet:logo-preset-changed",
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
    void (supabase as any).rpc("merge_user_preferences", { p_patch: patch });
  }, 1000);
}

/**
 * Zapne sync pro dobu, po kterou je uživatel přihlášený. Vrací funkci na
 * úklid (odregistrování posluchačů) – volat při odhlášení/odmontování.
 */
export function startPersonalPreferencesSync(): () => void {
  void pullPersonalPreferences();

  const events = Object.values(REFRESH_EVENT);
  const handler = () => naplanujOdeslani();
  for (const ev of events) window.addEventListener(ev, handler);

  return () => {
    for (const ev of events) window.removeEventListener(ev, handler);
    if (odlozeno) clearTimeout(odlozeno);
  };
}
