/**
 * Tokeny veřejného API – tvar, hash a rozsahy.
 *
 * Ukládá se jen SHA-256 otisk. Samotný token vidí uživatel jednou při
 * vytvoření; kdyby se dal přečíst z databáze, byl by únik databáze rovnou
 * přístupem k zápisu.
 *
 * Bez Deno API (crypto.subtle je i v prohlížeči), aby to šlo testovat
 * z vitest – viz src/lib/tokeny.test.ts.
 */

export const ROZSAHY = [
  "catalog:read",
  "catalog:write",
  "inventory:read",
  "inventory:write",
] as const;

export type Rozsah = (typeof ROZSAHY)[number];

/** Prefix je schválně viditelný – ať se pozná v logu, co se povalilo. */
export const PREFIX = "jobi_";

export function jeRozsah(x: unknown): x is Rozsah {
  return typeof x === "string" && (ROZSAHY as readonly string[]).includes(x);
}

/** Zahodí neznámé rozsahy a duplicity, pořadí drží podle ROZSAHY. */
export function ocistiRozsahy(vstup: unknown): Rozsah[] {
  const pole = Array.isArray(vstup) ? vstup : [];
  return ROZSAHY.filter((r) => pole.includes(r));
}

/**
 * Nový token. 32 bajtů z crypto.getRandomValues – Math.random() se na
 * tajemství nepoužívá, je předvídatelný.
 */
export function novyToken(): string {
  const bajty = new Uint8Array(32);
  crypto.getRandomValues(bajty);
  const hex = [...bajty].map((b) => b.toString(16).padStart(2, "0")).join("");
  return PREFIX + hex;
}

export async function otisk(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Co se smí ukázat v UI: „jobi_1a2b…9f8e“, ať se token pozná v seznamu. */
export function nahled(token: string): string {
  const telo = token.slice(PREFIX.length);
  return `${PREFIX}${telo.slice(0, 4)}…${telo.slice(-4)}`;
}

/** Modul, který musí mít servis zapnutý, aby rozsah něco znamenal. */
export function modulProRozsah(r: Rozsah): "api_catalog" | "api_inventory" {
  return r.startsWith("catalog") ? "api_catalog" : "api_inventory";
}
