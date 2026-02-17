/**
 * Klávesové zkratky – výchozí hodnoty, načítání/ukládání, porovnání s událostí.
 * Formát kombinace: "Ctrl+Q", "Ctrl+Shift+?", "E", "Enter", "Escape" (Ctrl = Ctrl nebo Cmd).
 */

import { STORAGE_KEYS } from "../constants/storageKeys";

export type ShortcutId =
  | "help"
  | "nav_orders"
  | "nav_inventory"
  | "nav_devices"
  | "nav_customers"
  | "nav_statistics"
  | "nav_settings"
  | "orders_new"
  | "orders_search"
  | "order_detail_edit"
  | "order_detail_save"
  | "order_detail_save_close"
  | "order_print";

export const ALL_SHORTCUT_IDS: ShortcutId[] = [
  "help", "nav_orders", "nav_inventory", "nav_devices", "nav_customers", "nav_statistics", "nav_settings",
  "orders_new", "orders_search", "order_detail_edit", "order_detail_save", "order_detail_save_close", "order_print",
];

export const DEFAULT_SHORTCUTS: Record<ShortcutId, string> = {
  help: "Shift+?",
  nav_orders: "Q",
  nav_inventory: "S",
  nav_devices: "D",
  nav_customers: "C",
  nav_statistics: "Ctrl+ř",
  nav_settings: "Ctrl+,",
  orders_new: "Ctrl+N",
  orders_search: "Ctrl+F",
  order_detail_edit: "E",
  order_detail_save: "Ctrl+S",
  order_detail_save_close: "Enter",
  order_print: "Ctrl+P",
};

export const SHORTCUT_LABELS: Record<ShortcutId, string> = {
  help: "Nápověda zkratek",
  nav_orders: "Přepnout na Zakázky",
  nav_inventory: "Přepnout na Sklad",
  nav_devices: "Přepnout na Zařízení",
  nav_customers: "Přepnout na Zákazníky",
  nav_statistics: "Přepnout na Statistiky",
  nav_settings: "Přepnout na Nastavení",
  orders_new: "Nová zakázka",
  orders_search: "Vyhledávání v zakázkách",
  order_detail_edit: "Režim úprav (detail zakázky)",
  order_detail_save: "Uložit změny (detail zakázky)",
  order_detail_save_close: "Uložit a zavřít (detail zakázky)",
  order_print: "Tisk zakázkového listu",
};

let cached: Partial<Record<ShortcutId, string>> | null = null;

function loadRaw(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.KEYBOARD_SHORTCUTS);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function getCache(): Record<ShortcutId, string> {
  if (cached) {
    return { ...DEFAULT_SHORTCUTS, ...cached };
  }
  const overrides = loadRaw();
  cached = overrides as Partial<Record<ShortcutId, string>>;
  return { ...DEFAULT_SHORTCUTS, ...cached };
}

export function getShortcut(id: ShortcutId): string {
  return getCache()[id] ?? DEFAULT_SHORTCUTS[id];
}

export function setShortcut(id: ShortcutId, combo: string): void {
  const overrides = loadRaw();
  if (combo.trim() === "" || combo === DEFAULT_SHORTCUTS[id]) {
    delete overrides[id];
  } else {
    overrides[id] = combo.trim();
  }
  localStorage.setItem(STORAGE_KEYS.KEYBOARD_SHORTCUTS, JSON.stringify(overrides));
  cached = null;
}

export function resetShortcuts(): void {
  localStorage.removeItem(STORAGE_KEYS.KEYBOARD_SHORTCUTS);
  cached = null;
}

/** Klávesy, které jsou jen modifikátory – při zápisu zkratky na ně nereagovat, čekat na skutečnou klávesu. */
const MODIFIER_KEY_NAMES = ["Control", "Meta", "Alt", "Shift"];

/** True, pokud je stisknutá klávesa jen modifikátor (samotné Ctrl/Cmd/Alt/Shift). */
export function isModifierOnlyKey(e: KeyboardEvent): boolean {
  return MODIFIER_KEY_NAMES.includes(e.key);
}

/** Vrátí kombinaci z události (např. "Ctrl+Q"). Ctrl = Ctrl nebo Cmd. Nevolat pro samotný stisk modifikátoru. */
export function keyEventToCombo(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  const key = e.key === " " ? "Space" : e.key;
  parts.push(key);
  return parts.join("+");
}

/** Na macOS zobrazí ⌘ místo Ctrl, jinak nechá text. */
export function formatShortcutForDisplay(combo: string): string {
  if (typeof navigator === "undefined") return combo;
  const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  if (!isMac) return combo;
  return combo.replace(/\bCtrl\+/g, "⌘+").replace(/\bCtrl\b/g, "⌘");
}

/** True, pokud událost odpovídá uložené kombinaci (case-insensitive pro písmena). */
export function comboMatchesEvent(e: KeyboardEvent, combo: string): boolean {
  const parts = combo.split("+").map((p) => p.trim());
  if (parts.length === 0) return false;
  const keyPart = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  const wantCtrl = mods.some((m) => m.toLowerCase() === "ctrl");
  const wantAlt = mods.some((m) => m.toLowerCase() === "alt");
  const wantShift = mods.some((m) => m.toLowerCase() === "shift");
  const ctrlOk = wantCtrl ? !!(e.ctrlKey || e.metaKey) : !(e.ctrlKey || e.metaKey);
  const altOk = wantAlt ? e.altKey : !e.altKey;
  const shiftOk = wantShift ? e.shiftKey : !e.shiftKey;
  const keyNorm = (k: string) => (k === " " ? "Space" : k);
  const eventKey = keyNorm(e.key);
  const matchKey =
    keyPart.length === 1 && keyPart !== " "
      ? eventKey.toLowerCase() === keyPart.toLowerCase()
      : eventKey === keyPart || eventKey.toLowerCase() === keyPart.toLowerCase();
  return ctrlOk && altOk && shiftOk && matchKey;
}

/** True, pokud je prvek (nebo některý předek) skrytý – pak fokus v něm neblokuje zkratky. */
function isElementVisible(el: HTMLElement): boolean {
  let node: HTMLElement | null = el;
  while (node) {
    const style = window.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
    if (parseFloat(style.opacity) === 0) return false;
    const rect = node.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0 && style.display !== "inline") return false;
    node = node.parentElement;
  }
  return true;
}

/** Zjistí, jestli je fokus v prvku, kde by se neměly spouštět globální zkratky (input, textarea, contenteditable). Skryté inputy (např. v zavřeném panelu) se nepočítají. */
export function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName.toLowerCase();
  if (tag !== "input" && tag !== "textarea" && !el.isContentEditable) return false;
  if (!isElementVisible(el)) return false;
  return true;
}
