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
};

export function dnesDatum(): string {
  return new Date().toISOString().slice(0, 10);
}

export function jeVraceno(z: ZapujckaData | null | undefined): boolean {
  return !!z?.vraceno;
}
