import { useEffect, useMemo, useState } from "react";
import { useActiveRole } from "../../hooks/useActiveRole";
import { useNastaveniPokladny } from "../../hooks/useNastaveniPokladny";
import { jeVydanyStav } from "../../lib/recenze";
import {
  chybiUzaverka,
  nactiPokladny,
  nactiPosledniHotovostPredDneskem,
  nactiStavy,
  nactiVydaneBezPlatby,
  subscribePokladna,
  type Pokladna,
  type ZakazkaProPokladnu,
} from "../../lib/pokladna";

/**
 * Pokladna na Dnes: vydané zakázky bez zaznamenané platby (od spuštění
 * pokladny) a pokladny, ve kterých chybí uzávěrka z minulých dnů.
 * Jen když je modul zapnutý, upozornění povolené a člen pokladnu smí.
 */
export function usePokladnaDnes(serviceId: string | null, activeBranchId: string | null, statuses: ReadonlyArray<{ key: string; label: string; isFinal: boolean }>) {
  const nastaveni = useNastaveniPokladny(serviceId);
  const { isAdmin, capabilities } = useActiveRole(serviceId);
  const zapnuto = nastaveni.zapnuto && nastaveni.upozorneni && (isAdmin || capabilities.can_use_pokladna !== false);
  const vydane = useMemo(() => statuses.filter((s) => jeVydanyStav(s.key, s.label, s.isFinal)).map((s) => s.key), [statuses]);
  const vydaneKlic = vydane.join("\u0001");

  const [nezaplacene, setNezaplacene] = useState<ZakazkaProPokladnu[]>([]);
  const [bezUzaverky, setBezUzaverky] = useState<Pokladna[]>([]);
  const [verze, setVerze] = useState(0);

  useEffect(() => {
    if (!serviceId || !zapnuto) return;
    return subscribePokladna(serviceId, () => setVerze((v) => v + 1));
  }, [serviceId, zapnuto]);

  useEffect(() => {
    if (!serviceId || !zapnuto) { setNezaplacene([]); setBezUzaverky([]); return; }
    let zruseno = false;
    const stavy = vydaneKlic ? vydaneKlic.split("\u0001") : [];
    void Promise.all([
      nastaveni.od ? nactiVydaneBezPlatby(serviceId, nastaveni.od, stavy) : Promise.resolve([]),
      nactiPokladny(serviceId),
      nactiStavy(serviceId),
      nactiPosledniHotovostPredDneskem(serviceId),
    ]).then(([nz, pokladny, st, starsi]) => {
      if (zruseno) return;
      setNezaplacene(nz);
      setBezUzaverky(pokladny.filter((p) => !p.archivovana && chybiUzaverka(st.get(p.id)?.posledniUzaverkaAt ?? null, starsi.get(p.id))));
    }).catch(() => {
      // Upozornění je doplněk Dnes – výpadek ho jen schová.
    });
    return () => { zruseno = true; };
  }, [serviceId, zapnuto, nastaveni.od, vydaneKlic, verze]);

  return useMemo(() => ({
    zapnuto,
    nezaplacene: activeBranchId ? nezaplacene.filter((t) => !t.branchId || t.branchId === activeBranchId) : nezaplacene,
    bezUzaverky: activeBranchId ? bezUzaverky.filter((p) => !p.branchId || p.branchId === activeBranchId) : bezUzaverky,
  }), [zapnuto, nezaplacene, bezUzaverky, activeBranchId]);
}
