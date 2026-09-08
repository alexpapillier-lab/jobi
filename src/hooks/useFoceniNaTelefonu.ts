import { useEffect, useState } from "react";

/**
 * Držíme v ruce telefon nebo tablet, na kterém se dá rovnou fotit?
 *
 * Rozhoduje o tom, jestli u fotek zakázky nabídnout „Vyfotit“ místo
 * „Nahrát soubory“ a jestli schovat tlačítko s QR kódem – to má smysl jen
 * u počítače, kde technik potřebuje dostat fotku z telefonu do zakázky.
 * Na telefonu by skenoval kód, který sám drží.
 *
 * Proč ne `useIsNarrow`: iPad na šířku má přes 900 px, a přesto na něm QR
 * nedává smysl. Kameru bez svolení uživatele ověřit nejde, tak stačí
 * dotykové ovládání (`pointer: coarse`) a existence `navigator.mediaDevices`.
 * Notebook s dotykovým displejem se tím zařadí mezi telefony – nahrávání
 * ze souborů mu ale zůstane, jen pod jménem „Z galerie“.
 */
const QUERY = "(pointer: coarse)";

function maKameru(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices;
}

export function useFoceniNaTelefonu(): boolean {
  const [dotyk, setDotyk] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(QUERY);
    const onChange = (e: MediaQueryListEvent) => setDotyk(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return dotyk && maKameru();
}
