import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Potvrzení „Uloženo“ u prvků, které se ukládají samy.
 *
 * Přepínače a výběry v Nastavení se ukládají hned po změně. Bez zpětné
 * vazby si uživatel není jistý, jestli se něco stalo, a hledá tlačítko
 * Uložit. Toast je na to moc hlučný (a překryl by jiné toasty), proto se
 * na ~1,5 s ukáže drobný zelený nápis přímo u karty.
 *
 * Použití:
 *   const hint = useSavedHint();
 *   onChange={() => { save(); hint.show(); }}
 *   <h3>Nadpis {hint.node}</h3>
 */
export function useSavedHint(durationMs = 1500): { show: () => void; node: ReactNode } {
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(() => {
    setVisible(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(false), durationMs);
  }, [durationMs]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const node = visible ? <SavedHint /> : null;
  return { show, node };
}

export function SavedHint({ children = "Uloženo" }: { children?: ReactNode }) {
  return (
    <span className="ui-saved-hint" role="status" aria-live="polite">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 6L9 17l-5-5" />
      </svg>
      {children}
    </span>
  );
}
