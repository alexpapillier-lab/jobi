/**
 * Logování jen ve vývojovém prostředí (import.meta.env.DEV).
 * V produkci se nic nevolá.
 */
const isDev = typeof import.meta !== "undefined" && import.meta.env?.DEV;

export function devLog(...args: unknown[]): void {
  if (isDev) {
    console.log(...args);
  }
}

export function devWarn(...args: unknown[]): void {
  if (isDev) {
    console.warn(...args);
  }
}
