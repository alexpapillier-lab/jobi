/**
 * Evidence okamžitých zápisů detailu zakázky mimo React: běžící zápisy oprav,
 * odložené zápisy (opravy, kontrola po opravě, diagnostika) a zakázky, kterým
 * okamžitý zápis selhal. Čte ji realtime (src/lib/slouceniZakazky.ts) i
 * dotažení zakázky – proto stojí před nimi. Vyneseno z Orders.tsx beze změny.
 */
import { useCallback, useRef } from "react";
import type { EvidenceZapisu } from "../../../lib/slouceniZakazky";

export function useEvidenceZapisu() {
  /** Zápisy provedených oprav, které ještě běží nebo čekají na odklad – podle zakázky. */
  const rozpracovaneZapisyOpravRef = useRef<Map<string, number>>(new Map());
  const odlozeneZapisyOpravRef = useRef<Map<string, { casovac: ReturnType<typeof setTimeout>; proved: () => void }>>(new Map());
  /**
   * Zakázky, kterým okamžitý zápis oprav selhal – opravy jsou jen v paměti
   * a uloží se při zavření detailu. Do té doby je realtime nesmí přepsat,
   * jinak by po nich zůstala jen rezervace dílů ve skladu.
   */
  const neulozeneOpravyRef = useRef<Set<string>>(new Set());
  /** Evidence pro sloučení řádku z databáze s pamětí – viz src/lib/slouceniZakazky.ts. */
  const evidenceZapisu = useCallback(
    (): EvidenceZapisu => ({
      bezici: rozpracovaneZapisyOpravRef.current,
      odlozene: odlozeneZapisyOpravRef.current,
      neulozene: neulozeneOpravyRef.current,
    }),
    []
  );
  /** Odložené zápisy kontroly po opravě – psaní poznámky jinak posílá zápis na každou klávesu. */
  const odlozenaKontrolaRef = useRef<Map<string, { casovac: ReturnType<typeof setTimeout>; proved: () => void }>>(new Map());
  /** Odložené zápisy diagnostiky psané v detailu reklamace. */
  const odlozenaDiagnostikaRef = useRef<Map<string, { casovac: ReturnType<typeof setTimeout>; proved: () => void; patch: Record<string, unknown> }>>(new Map());

  return { rozpracovaneZapisyOpravRef, odlozeneZapisyOpravRef, neulozeneOpravyRef, evidenceZapisu, odlozenaKontrolaRef, odlozenaDiagnostikaRef };
}
