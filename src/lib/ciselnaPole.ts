/**
 * Číselné pole se nesmí měnit kolečkem myši.
 *
 * V prohlížeči se hodnota `<input type="number">` při otáčení kolečkem nad
 * zaostřeným polem zvyšuje a snižuje. U ceny, slevy nebo počtu kusů to znamená,
 * že člověk jen posouvá stránku a mezitím mu pod myší tiše naskakuje jiná
 * částka – a zjistí to až na dokladu. Polí tohoto typu je v aplikaci několik
 * desítek, takže se to řeší na jednom místě, ne v každém zvlášť.
 *
 * Pole se při kolečku odostří. Hodnota se tak nezmění a stránka se posune jako
 * kdekoli jinde (nemůžeme volat preventDefault, to by posun zastavilo taky).
 * Odostřuje se jen pole, nad kterým kolečko skutečně je: kdo píše částku
 * a posouvá stránku jinde, o zaostření nepřijde.
 */

type Odostrit = { blur: () => void };

/** Je to `<input type="number">`? Bere i náhradní objekty z testů. */
export function jeCiselnePole(el: unknown): el is Odostrit {
  if (!el || typeof el !== "object") return false;
  const e = el as { tagName?: unknown; type?: unknown; blur?: unknown };
  return e.tagName === "INPUT" && e.type === "number" && typeof e.blur === "function";
}

/** Obsluha jedné události kolečka. Vrací true, když pole odostřila. */
export function zpracujKolecko(cil: unknown, aktivniPrvek: unknown): boolean {
  if (cil !== aktivniPrvek || !jeCiselnePole(cil)) return false;
  cil.blur();
  return true;
}

type Dokument = {
  activeElement: unknown;
  addEventListener: (typ: string, fn: (e: { target: unknown }) => void, volby: { passive: boolean; capture: boolean }) => void;
  removeEventListener: (typ: string, fn: (e: { target: unknown }) => void, volby: { capture: boolean }) => void;
};

/** Zapne ochranu pro celý dokument. Vrací funkci, která ji zase vypne. */
export function zapniOchranuCiselnychPoli(doc: Dokument): () => void {
  const obsluha = (e: { target: unknown }) => {
    zpracujKolecko(e.target, doc.activeElement);
  };
  // passive: obsluha nikdy nevolá preventDefault, takže prohlížeč nemusí čekat.
  doc.addEventListener("wheel", obsluha, { passive: true, capture: true });
  return () => doc.removeEventListener("wheel", obsluha, { capture: true });
}
