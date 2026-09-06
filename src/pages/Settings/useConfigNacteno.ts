import { useCallback, useEffect, useState } from "react";

/**
 * Hlídá, jestli sekce nastavení už má config servisu ze serveru.
 *
 * Proč: sekce startují s výchozím (často prázdným) seznamem a načítají ho
 * asynchronně. Kdo stihl kliknout dřív, uložil ten prázdný výchozí stav –
 * a `mergeServiceConfig` přepíše celý klíč, takže tím zmizel seznam, který
 * byl v databázi. Odhalil to E2E test: přidání jednoho náhradního zařízení
 * smazalo všechna ostatní.
 *
 * `oznacNacteno()` se volá i tehdy, když server nic nevrátil – „servis
 * zatím nic nemá" je taky platný načtený stav.
 */
export function useConfigNacteno(activeServiceId: string | null) {
  const [nacteno, setNacteno] = useState(false);
  // Přepnutí servisu = jiný config; do jeho načtení se zase nesmí ukládat.
  useEffect(() => { setNacteno(false); }, [activeServiceId]);
  const oznacNacteno = useCallback(() => setNacteno(true), []);
  return { nacteno, oznacNacteno };
}
