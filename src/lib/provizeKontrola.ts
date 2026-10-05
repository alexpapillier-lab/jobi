/**
 * Zakázky ke kontrole v provizích (migrace 20261005130000_provize_ke_kontrole).
 *
 * Vyloučené slovo („bat“, „těl“) vyřadí z provizního základu celou položku.
 * Když je v ní ale víc práce najednou – „Výměna baterie + servisní čištění“
 * za jednu cenu –, vypadne s ní i čištění. Synchronizace takovou zakázku
 * označí ke kontrole a majitel rozhodne: bez vyloučených položek, plně,
 * nebo vlastní částkou. Tady je jen čtení toho rozhodnutí a kontrola
 * zadané částky; počítá databáze.
 */

export type RozhodnutiProvize = "ceka" | "bez" | "plne" | "castka";

export type PolozkaKeKontrole = {
  ke_kontrole: boolean;
  nejasne_opravy: string[] | null;
  rucni_zaklad: number | string | null;
  pocitat_vse: boolean;
  zkontrolovano_at: string | null;
};

/** Má zakázka nejasné položky (ať už rozhodnuté, nebo ne)? */
export function maNejasneOpravy(p: Pick<PolozkaKeKontrole, "nejasne_opravy">): boolean {
  return Array.isArray(p.nejasne_opravy) && p.nejasne_opravy.length > 0;
}

/**
 * Co majitel u zakázky zvolil. „ceka“ = ke kontrole, ještě nerozhodnuto.
 * Ruční částka má přednost před „plně“ – stejně jako v synchronizaci.
 */
export function rozhodnuti(p: PolozkaKeKontrole): RozhodnutiProvize {
  if (p.ke_kontrole) return "ceka";
  if (p.rucni_zaklad !== null && p.rucni_zaklad !== undefined && p.rucni_zaklad !== "") return "castka";
  if (p.pocitat_vse) return "plne";
  return "bez";
}

/**
 * Částka z políčka: „1 490,50“, „1490.5 Kč“. Vrací chybu jako text, ať ji jde
 * rovnou ukázat; strop je cena celé zakázky (databáze ho hlídá taky).
 */
export function prectiCastku(vstup: string, strop: number | null): { ok: true; castka: number } | { ok: false; chyba: string } {
  const t = vstup.replace(/kč|czk/gi, "").replace(/\s/g, "").replace(",", ".");
  if (!t) return { ok: false, chyba: "Zadejte částku." };
  const n = Number(t);
  if (!Number.isFinite(n)) return { ok: false, chyba: `„${vstup.trim()}“ není číslo.` };
  if (n < 0) return { ok: false, chyba: "Částka nesmí být záporná." };
  const castka = Math.round(n * 100) / 100;
  if (strop !== null && castka > strop) return { ok: false, chyba: `Částka je vyšší než cena celé zakázky.` };
  return { ok: true, castka };
}
