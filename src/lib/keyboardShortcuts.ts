/**
 * Klávesové zkratky – výchozí hodnoty, načítání/ukládání, porovnání s událostí.
 * Formát kombinace: "Ctrl+Q", "Ctrl+Shift+?", "E", "Enter", "Escape" (Ctrl = Ctrl nebo Cmd).
 */

import { STORAGE_KEYS } from "../constants/storageKeys";

export type ShortcutId =
  | "help"
  | "nav_orders"
  | "nav_calendar"
  | "nav_invoices"
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
  "help", "nav_orders", "nav_calendar", "nav_customers", "nav_invoices", "nav_inventory", "nav_devices", "nav_statistics", "nav_settings",
  "orders_new", "orders_search", "order_detail_edit", "order_detail_save", "order_detail_save_close", "order_print",
];

export const DEFAULT_SHORTCUTS: Record<ShortcutId, string> = {
  help: "Shift+?",
  nav_orders: "q",
  nav_calendar: "k",
  nav_invoices: "f",
  nav_inventory: "s",
  nav_devices: "d",
  nav_customers: "c",
  nav_statistics: "Ctrl+ř",
  nav_settings: "Ctrl+,",
  orders_new: "n",
  orders_search: "Ctrl+F",
  order_detail_edit: "e",
  order_detail_save: "Ctrl+S",
  order_detail_save_close: "Enter",
  order_print: "Ctrl+P",
};

export const SHORTCUT_LABELS: Record<ShortcutId, string> = {
  help: "Nápověda zkratek",
  nav_orders: "Přepnout na Zakázky",
  nav_calendar: "Přepnout na Kalendář",
  nav_invoices: "Přepnout na Faktury",
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

export const SHORTCUTS_CHANGED_EVENT = "jobsheet:keyboard-shortcuts-changed";

let cached: Partial<Record<ShortcutId, string>> | null = null;

// Zkratky nastavené na jiném zařízení dorazí přes personalPreferencesSync
// rovnou do localStorage, mimo setShortcut/resetShortcuts – bez tohohle by
// getShortcut() dál vracela starou hodnotu z cache.
if (typeof window !== "undefined") {
  window.addEventListener(SHORTCUTS_CHANGED_EVENT, () => {
    cached = null;
  });
}

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
  window.dispatchEvent(new CustomEvent(SHORTCUTS_CHANGED_EVENT));
}

export function resetShortcuts(): void {
  localStorage.removeItem(STORAGE_KEYS.KEYBOARD_SHORTCUTS);
  cached = null;
  window.dispatchEvent(new CustomEvent(SHORTCUTS_CHANGED_EVENT));
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

/** Na macOS zobrazí ⌘ místo Ctrl; Meta (Command) zobrazí jako ⌘, aby nevzniklo „⌘+Meta“. */
export function formatShortcutForDisplay(combo: string): string {
  if (typeof navigator === "undefined") return combo;
  const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  let out = combo;
  if (isMac) {
    out = out.replace(/\bCtrl\+/g, "⌘+").replace(/\bCtrl\b/g, "⌘");
    out = out.replace(/\bMeta\b/g, "⌘");
    out = out.replace(/⌘\+⌘/g, "⌘");
  }
  return out;
}

/** True, pokud událost odpovídá uložené kombinaci (case-insensitive pro písmena). */
export function comboMatchesEvent(e: KeyboardEvent, combo: string | undefined | null): boolean {
  // Zkratka bez nastavení (nový identifikátor, smazaná volba) nebo událost
  // bez klávesy (syntetická) – nic nespárovat, ne spadnout v globálním
  // posluchači, který pak přestane obsluhovat všechny zkratky.
  if (!combo || typeof e.key !== "string") return false;
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


// ---------------------------------------------------------------------------
// Dispečink zkratek
//
// Dřív si každá obrazovka registrovala vlastní posluchač na window i document
// v capture fázi. Kdo přišel dřív, ten vyhrál, dvojí registrace spouštěla
// akci dvakrát a dvě akce se stejnou kombinací se tiše přebíjely – zkratka
// pak „nefungovala“, aniž by bylo poznat proč. Teď je posluchač jeden a
// obrazovky do něj jen přihlašují obsluhy; při shodě rozhoduje priorita.

export type ShortcutHandlerOptions = {
  /** Vyšší číslo vyhrává. Stránky 10, modály 20; globální navigace 0. */
  priority?: number;
  /** Spustit i s fokusem v poli (typicky Ctrl+F). */
  allowInInput?: boolean;
  /** Dynamické vypnutí bez odregistrování (např. jen s otevřeným detailem). */
  enabled?: () => boolean;
};

type Registered = {
  id: ShortcutId;
  run: (e: KeyboardEvent) => void;
  priority: number;
  allowInInput: boolean;
  enabled?: () => boolean;
  /** Pořadí registrace – při shodné prioritě vyhrává pozdější (modál nad stránkou). */
  seq: number;
};

let seqCounter = 0;
const registered = new Set<Registered>();

/**
 * Přihlásí obsluhu zkratky. Vrací funkci na odhlášení – volat v úklidu efektu.
 */
export function registerShortcut(
  id: ShortcutId,
  run: (e: KeyboardEvent) => void,
  options: ShortcutHandlerOptions = {},
): () => void {
  const entry: Registered = {
    id,
    run,
    priority: options.priority ?? 0,
    allowInInput: options.allowInInput === true,
    enabled: options.enabled,
    seq: ++seqCounter,
  };
  registered.add(entry);
  return () => {
    registered.delete(entry);
  };
}

/** Jen pro testy – zapomene všechny obsluhy. */
export function resetShortcutHandlers(): void {
  registered.clear();
}

/** Která obsluha by událost obsloužila. Exportováno kvůli testům. */
export function pickHandler(e: KeyboardEvent, inputFocused: boolean): Registered | null {
  let best: Registered | null = null;
  for (const h of registered) {
    if (inputFocused && !h.allowInInput) continue;
    if (h.enabled && !h.enabled()) continue;
    if (!comboMatchesEvent(e, getShortcut(h.id))) continue;
    if (!best || h.priority > best.priority || (h.priority === best.priority && h.seq > best.seq)) {
      best = h;
    }
  }
  return best;
}

/** Události, které už dispečink obsloužil (posluchač visí na window i document). */
const handled = new WeakSet<KeyboardEvent>();

/**
 * Spustí jediný posluchač zkratek. Vrací funkci na úklid.
 *
 * `isBlocked` vypne zkratky dočasně – když je otevřená nápověda nebo když se
 * na stránce Klávesové zkratky zrovna nahrává nová kombinace.
 */
export function startShortcutDispatcher(isBlocked?: () => boolean): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (handled.has(e)) return;
    if (typeof e.key !== "string") return;
    if (isBlocked?.()) return;
    // Pojistka pro stránku Klávesové zkratky, která si klávesy nahrává sama.
    if (typeof document !== "undefined" && document.body?.dataset?.jobsheetShortcutsConfig === "true") return;
    const best = pickHandler(e, isInputFocused());
    if (!best) return;
    handled.add(e);
    e.preventDefault();
    e.stopPropagation();
    best.run(e);
  };
  // window i document: v Tauri/Electron nemusí událost dojít na obojí.
  window.addEventListener("keydown", onKey, true);
  document.addEventListener("keydown", onKey, true);
  return () => {
    window.removeEventListener("keydown", onKey, true);
    document.removeEventListener("keydown", onKey, true);
  };
}

/**
 * Kombinace přiřazené víc než jedné akci. Dvě akce na stejné klávese jsou
 * hlavní důvod, proč zkratka „přestane fungovat“ – proto to Nastavení hlásí.
 */
export function shortcutConflicts(): Map<string, ShortcutId[]> {
  const byCombo = new Map<string, ShortcutId[]>();
  for (const id of ALL_SHORTCUT_IDS) {
    const combo = getShortcut(id).trim().toLowerCase();
    if (!combo) continue;
    const list = byCombo.get(combo) ?? [];
    list.push(id);
    byCombo.set(combo, list);
  }
  const out = new Map<string, ShortcutId[]>();
  for (const [combo, ids] of byCombo) {
    if (ids.length > 1) out.set(combo, ids);
  }
  return out;
}

/** Které jiné akce už tuhle kombinaci používají. */
export function shortcutIdsUsing(combo: string, except?: ShortcutId): ShortcutId[] {
  const needle = combo.trim().toLowerCase();
  return ALL_SHORTCUT_IDS.filter((id) => id !== except && getShortcut(id).trim().toLowerCase() === needle);
}
