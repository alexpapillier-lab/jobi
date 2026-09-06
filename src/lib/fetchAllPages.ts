/**
 * Stránkuje přes PostgREST `.range()`, dokud nedojdou řádky.
 *
 * Supabase (PostgREST) má server-side limit na počet řádků v jedné
 * odpovědi (`max_rows`, typicky 1000) – dotaz bez `.range()` se nad tímhle
 * limitem tiše ořízne, bez chyby. Pro servisy s víc než ~1000 zakázkami /
 * zákazníky by to znamenalo, že se v appce zobrazí jen část dat.
 *
 * Stránky se od druhé berou **po několika najednou**. Sekvenční stránkování
 * platí čekání na síť za každou stránku zvlášť: u 4 800 zakázek to bylo pět
 * kol za sebou, souběžně jsou z toho dvě (změřeno 6. 9. 2026, viz
 * docs/ZATEZ.md oddíl 5). První stránka jde vždycky sama – z její velikosti
 * se pozná, jestli má smysl posílat další, takže malý servis pošle přesně
 * jeden dotaz jako dřív.
 */
export async function fetchAllPages<T>(
  loadPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000,
  /** Kolik stránek se od druhého kola tahá najednou. 1 = původní sekvenční chování. */
  soubezne = 4
): Promise<{ data: T[]; error: unknown }> {
  const prvni = await loadPage(0, pageSize - 1);
  if (prvni.error) return { data: prvni.data ?? [], error: prvni.error };
  const all: T[] = [...(prvni.data ?? [])];
  // Kratší stránka = konec dat. U servisů pod tisíc řádků tím celá funkce končí
  // jedním dotazem, přesně jako před zavedením souběžnosti.
  if (!prvni.data || prvni.data.length < pageSize) return { data: all, error: null };

  const davka = Math.max(1, Math.floor(soubezne));
  let from = pageSize;
  for (;;) {
    const rozsahy: [number, number][] = [];
    for (let i = 0; i < davka; i++) {
      const od = from + i * pageSize;
      rozsahy.push([od, od + pageSize - 1]);
    }
    const odpovedi = await Promise.all(rozsahy.map(([od, doo]) => loadPage(od, doo)));

    // Chyba kdekoli v dávce ukončuje čtení. Data z dřívějších stránek se vracejí
    // spolu s ní – volající se tak chová stejně jako u sekvenční verze.
    const chyba = odpovedi.find((o) => o.error);

    let konec = false;
    for (const o of odpovedi) {
      if (o.error) break;
      const radky = o.data ?? [];
      all.push(...radky);
      if (radky.length < pageSize) {
        konec = true;
        break;
      }
    }
    if (chyba) return { data: all, error: chyba.error };
    if (konec) return { data: all, error: null };
    from += davka * pageSize;
  }
}
