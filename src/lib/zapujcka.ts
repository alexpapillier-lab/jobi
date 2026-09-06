/**
 * Náhradní zařízení půjčené zákazníkovi na dobu opravy (tickets.loaner).
 */
export type ZapujckaData = {
  /** Co se půjčilo („iPhone SE 2020, černý“). */
  nazev: string;
  seriove?: string;
  prislusenstvi?: string;
  /** Vratná kauce v Kč; 0 nebo prázdné = bez kauce. */
  kauce?: number;
  /** Datum půjčení (YYYY-MM-DD). */
  pujceno: string;
  /** Datum vrácení (YYYY-MM-DD); prázdné = zákazník ho ještě má. */
  vraceno?: string | null;
  poznamka?: string;
  /** Odkaz na položku seznamu náhradních zařízení servisu, když se vybíralo z něj. */
  katalogId?: string;
};

/** Náhradní zařízení, která servis půjčuje (Nastavení → Zakázky → Náhradní zařízení). */
export type NahradniZarizeni = {
  id: string;
  nazev: string;
  seriove?: string;
  prislusenstvi?: string;
  kauce?: number;
};

export function normalizujNahradni(raw: unknown): NahradniZarizeni[] {
  if (!Array.isArray(raw)) return [];
  const out: NahradniZarizeni[] = [];
  for (const z of raw as Array<Partial<NahradniZarizeni>>) {
    if (!z || typeof z !== "object" || typeof z.nazev !== "string" || !z.nazev.trim()) continue;
    out.push({
      id: typeof z.id === "string" && z.id ? z.id : `n_${out.length}`,
      nazev: z.nazev.trim(),
      seriove: typeof z.seriove === "string" && z.seriove.trim() ? z.seriove.trim() : undefined,
      prislusenstvi: typeof z.prislusenstvi === "string" && z.prislusenstvi.trim() ? z.prislusenstvi.trim() : undefined,
      kauce: typeof z.kauce === "number" && z.kauce > 0 ? z.kauce : undefined,
    });
  }
  return out;
}

export function dnesDatum(): string {
  return new Date().toISOString().slice(0, 10);
}

export function jeVraceno(z: ZapujckaData | null | undefined): boolean {
  return !!z?.vraceno;
}
