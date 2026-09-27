import { STORAGE_KEYS } from "../../constants/storageKeys";
import type { RozsahDnes } from "../../lib/dnes";

/**
 * Volba „Jen moje / Celý tým“ na stránce Dnes.
 *
 * Bydlí v osobních volbách (`jobsheet_ui_settings_v1` → `dnes.rozsah`), které
 * personalPreferencesSync po události `jobsheet:ui-updated` pošle do
 * `user_preferences` – technik ji tak má stejnou na počítači i na telefonu.
 * Zapisuje se sloučením do uloženého objektu, ne přepsáním: ostatní části
 * aplikace (Nastavení, App) si do stejného klíče ukládají svoje.
 */

export function nactiRozsahDnes(): RozsahDnes | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.UI_SETTINGS);
    const v = raw ? (JSON.parse(raw) as { dnes?: { rozsah?: unknown } })?.dnes?.rozsah : null;
    return v === "moje" || v === "tym" ? v : null;
  } catch {
    return null;
  }
}

export function ulozRozsahDnes(rozsah: RozsahDnes): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.UI_SETTINGS);
    const parsed = raw ? JSON.parse(raw) : {};
    const obj = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    const dnes = obj.dnes && typeof obj.dnes === "object" ? (obj.dnes as Record<string, unknown>) : {};
    obj.dnes = { ...dnes, rozsah };
    localStorage.setItem(STORAGE_KEYS.UI_SETTINGS, JSON.stringify(obj));
    window.dispatchEvent(new CustomEvent("jobsheet:ui-updated"));
  } catch {
    /* bez úložiště volba platí jen do zavření stránky */
  }
}
