import { useEffect, useState } from "react";

/**
 * True na úzkých obrazovkách (tablet na výšku a menší).
 *
 * Používá se hlavně ve webové verzi, kde se aplikace otevře i na menším
 * displeji. Na desktopu se sidebar rozbaluje najetím myší, což na dotykovém
 * zařízení nefunguje – tam se místo toho přepíná klepnutím.
 */
const QUERY = "(max-width: 900px)";

export function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(QUERY);
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mq.addEventListener("change", onChange);
    setNarrow(mq.matches);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return narrow;
}
