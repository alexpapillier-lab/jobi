/**
 * Termín zakázky v seznamu: kdy se má zakázka dokončit a jak moc to hoří.
 *
 * Stránka Dnes má sekce „Po termínu“ a „Dnešní termíny“, ale technik, který
 * pracuje v seznamu zakázek, termín neviděl vůbec – karta ukazuje datum
 * přijetí. Tohle je společné pravidlo pro štítek na kartě i záložku
 * „Termíny“: stejné jako na Dnes (lib/dnes.ts), ať obě stránky říkají totéž.
 *
 *   - po termínu: termín je v minulosti,
 *   - dnes: termín je dnes (do půlnoci),
 *   - blíží se: do `prahDni` dnů (výchozí 2 – zítra a pozítří),
 *   - v pořádku: dál v budoucnosti; na kartě se nepíše nic.
 *
 * Koncová zakázka (vydaná) termín nemá – je hotovo. Zakázka připravená
 * k převzetí taky ne: dokončit už ji není potřeba, jen si pro ni má
 * zákazník přijít (stejně to bere Dnes).
 */

export type DruhTerminu = "po" | "dnes" | "blizi" | "ok";

export type StavTerminu = {
  druh: DruhTerminu;
  /** Celé dny od dneška: záporně = po termínu (−3 = tři dny po), 0 = dnes, 1 = zítra. */
  dni: number;
  /** Termín jako okamžik (ms) – pro řazení. */
  cas: number;
};

/** Od kolika dnů před termínem se karta začne hlásit. */
export const PRAH_TERMINU_DNI = 2;

function zacatekDne(d: Date): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

/**
 * Stav termínu, nebo null, když se termín nemá hlásit (bez termínu, koncový
 * stav, připraveno k převzetí, nečitelné datum).
 */
export function stavTerminu(
  expectedAt: string | null | undefined,
  volby: { ted: Date; koncovy?: boolean; pripraveno?: boolean; prahDni?: number },
): StavTerminu | null {
  if (!expectedAt || volby.koncovy || volby.pripraveno) return null;
  const cas = new Date(expectedAt).getTime();
  if (Number.isNaN(cas)) return null;
  const prah = volby.prahDni ?? PRAH_TERMINU_DNI;
  const ted = volby.ted.getTime();
  // Celé kalendářní dny, ne 24hodinové úseky: termín „zítra 8:00“ je zítra
  // i ve 20:00 večer. Po termínu se bere i dnešní termín, který už minul.
  const dni = Math.round((zacatekDne(new Date(cas)) - zacatekDne(volby.ted)) / 86_400_000);
  if (cas < ted) return { druh: "po", dni: Math.min(dni, 0), cas };
  if (dni <= 0) return { druh: "dnes", dni: 0, cas };
  if (dni <= prah) return { druh: "blizi", dni, cas };
  return { druh: "ok", dni, cas };
}

/** Text štítku na kartě; null = nic se neukazuje. */
export function textTerminu(s: StavTerminu | null): string | null {
  if (!s) return null;
  switch (s.druh) {
    case "po": {
      const d = -s.dni;
      return d === 0 ? "po termínu" : `po termínu · ${d} d`;
    }
    case "dnes":
      return "termín dnes";
    case "blizi":
      return s.dni === 1 ? "termín zítra" : `termín za ${s.dni} dny`;
    default:
      return null;
  }
}

/** Patří zakázka do záložky „Termíny“ (po termínu, dnes nebo se blíží)? */
export function hlasiTermin(s: StavTerminu | null): boolean {
  return s !== null && s.druh !== "ok";
}

/** Řazení v záložce Termíny: nejdřívější termín nahoře; při shodě starší přijetí. */
export function podleTerminu<T extends { termin: StavTerminu | null; createdAt?: string | null }>(a: T, b: T): number {
  const ta = a.termin?.cas ?? Infinity;
  const tb = b.termin?.cas ?? Infinity;
  if (ta !== tb) return ta - tb;
  return new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime();
}
