/**
 * Přednastavené možnosti pro stav zařízení a příslušenství (v Nastavení).
 * Uživatel může vybrat z listu nebo při zakládání zakázky napsat vlastní text.
 */

import { STORAGE_KEYS } from "../constants/storageKeys";

export type DeviceOptions = {
  deviceConditions: string[];
  deviceAccessories: string[];
};

const DEFAULT_OPTIONS: DeviceOptions = {
  deviceConditions: [],
  deviceAccessories: [],
};

function loadRaw(): Partial<DeviceOptions> {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.DEVICE_OPTIONS);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function getDeviceOptions(): DeviceOptions {
  const raw = loadRaw();
  return {
    deviceConditions: Array.isArray(raw.deviceConditions) ? raw.deviceConditions : DEFAULT_OPTIONS.deviceConditions,
    deviceAccessories: Array.isArray(raw.deviceAccessories) ? raw.deviceAccessories : DEFAULT_OPTIONS.deviceAccessories,
  };
}

export function setDeviceOptions(options: Partial<DeviceOptions>): void {
  const current = getDeviceOptions();
  const next: DeviceOptions = {
    deviceConditions: options.deviceConditions ?? current.deviceConditions,
    deviceAccessories: options.deviceAccessories ?? current.deviceAccessories,
  };
  localStorage.setItem(STORAGE_KEYS.DEVICE_OPTIONS, JSON.stringify(next));
}

export function getDefaultDeviceOptions(): DeviceOptions {
  return { ...DEFAULT_OPTIONS };
}
