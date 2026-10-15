/**
 * Provedené zákroky u reklamace – ukládají se do resolution_summary jako JSON.
 * Vyneseno z Orders.tsx beze změny obsahu.
 */

/** Položka provedeného zákroku u reklamace (ukládá se do resolution_summary jako JSON). */
export type ClaimResolutionItem = { id: string; name: string; description?: string; price?: number };

export function parseClaimResolutionItems(raw: string | null): ClaimResolutionItem[] {
  if (!raw || !raw.trim()) return [];
  const t = raw.trim();
  if (t.startsWith("[")) {
    try {
      const arr = JSON.parse(t) as unknown;
      if (!Array.isArray(arr)) return [];
      return arr.filter((x): x is ClaimResolutionItem => x && typeof x === "object" && typeof (x as any).id === "string" && typeof (x as any).name === "string").map((x) => ({
        id: (x as any).id,
        name: (x as any).name ?? "",
        description: (x as any).description ?? undefined,
        price: typeof (x as any).price === "number" ? (x as any).price : undefined,
      }));
    } catch {
      return [{ id: (crypto as any).randomUUID?.() ?? `legacy-${Date.now()}`, name: t }];
    }
  }
  return [{ id: (crypto as any).randomUUID?.() ?? `legacy-${Date.now()}`, name: t }];
}

export function serializeClaimResolutionItems(items: ClaimResolutionItem[]): string {
  if (items.length === 0) return "";
  return JSON.stringify(items);
}

/**
 * Zákrok vybraný z ceníku: název z ceníku, cena 0 – u reklamace se oprava
 * zákazníkovi neúčtuje. Cenu jde v detailu přepsat (neuznaná reklamace).
 */
export function zakrokZCeniku(oprava: { name: string }): ClaimResolutionItem {
  return { id: (crypto as any).randomUUID?.() ?? `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: oprava.name, price: 0 };
}
