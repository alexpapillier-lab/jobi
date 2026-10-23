/**
 * Přesun položky o jedno místo v zobrazeném (zúženém) seznamu.
 *
 * Opravy v ceníku jsou jeden seznam pro celý servis (pořadí = order_index
 * při uložení), ale člověk je vidí zúžené na vybraný model. Šipka „nahoru“
 * proto znamená: postav opravu těsně před tu, která je v zobrazeném seznamu
 * nad ní – ostatní opravy (jiných modelů) zůstanou, kde jsou.
 */
export function posunVPoradi<T extends { id: string }>(vse: T[], zobrazene: T[], id: string, smer: -1 | 1): T[] | null {
  const i = zobrazene.findIndex((x) => x.id === id);
  const soused = i < 0 ? undefined : zobrazene[i + smer];
  if (!soused) return null;
  const polozka = vse.find((x) => x.id === id);
  if (!polozka) return null;
  const bez = vse.filter((x) => x.id !== id);
  const j = bez.findIndex((x) => x.id === soused.id);
  if (j < 0) return null;
  bez.splice(smer === -1 ? j : j + 1, 0, polozka);
  return bez;
}

/** Přetažení: postav položku `id` těsně před (nebo za) položku `cilId`. Ostatní zůstanou. */
export function presunKPolozce<T extends { id: string }>(vse: T[], id: string, cilId: string, za: boolean): T[] | null {
  if (id === cilId) return null;
  const polozka = vse.find((x) => x.id === id);
  if (!polozka) return null;
  const bez = vse.filter((x) => x.id !== id);
  const j = bez.findIndex((x) => x.id === cilId);
  if (j < 0) return null;
  bez.splice(za ? j + 1 : j, 0, polozka);
  // Nic se nezměnilo (puštěno na stejné místo) → null, ať se zbytečně neukládá.
  return bez.every((x, i) => x.id === vse[i].id) ? null : bez;
}
