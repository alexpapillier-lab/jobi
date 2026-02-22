/**
 * Přednastavené způsoby převzetí a předání zařízení (v Nastavení).
 * Uživatel může vybrat z listu nebo při zakládání zakázky napsat vlastní text.
 */

import { STORAGE_KEYS } from "../constants/storageKeys";

export type HandoffOptions = {
  receiveMethods: string[];
  returnMethods: string[];
};

const DEFAULT_OPTIONS: HandoffOptions = {
  receiveMethods: ["Osobně", "Poštou"],
  returnMethods: ["Osobně", "Poštou"],
};

function loadRaw(): Partial<HandoffOptions> {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.HANDOFF_OPTIONS);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function getHandoffOptions(): HandoffOptions {
  const raw = loadRaw();
  return {
    receiveMethods: Array.isArray(raw.receiveMethods) ? raw.receiveMethods : DEFAULT_OPTIONS.receiveMethods,
    returnMethods: Array.isArray(raw.returnMethods) ? raw.returnMethods : DEFAULT_OPTIONS.returnMethods,
  };
}

export function setHandoffOptions(options: Partial<HandoffOptions>): void {
  const current = getHandoffOptions();
  const next: HandoffOptions = {
    receiveMethods: options.receiveMethods ?? current.receiveMethods,
    returnMethods: options.returnMethods ?? current.returnMethods,
  };
  localStorage.setItem(STORAGE_KEYS.HANDOFF_OPTIONS, JSON.stringify(next));
}
