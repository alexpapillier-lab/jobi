/**
 * Stránkuje přes PostgREST `.range()`, dokud nedojdou řádky.
 *
 * Supabase (PostgREST) má server-side limit na počet řádků v jedné
 * odpovědi (`max_rows`, typicky 1000) – dotaz bez `.range()` se nad tímhle
 * limitem tiše ořízne, bez chyby. Pro servisy s víc než ~1000 zakázkami /
 * zákazníky by to znamenalo, že se v appce zobrazí jen část dat.
 */
export async function fetchAllPages<T>(
  loadPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000
): Promise<{ data: T[]; error: unknown }> {
  const all: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await loadPage(from, from + pageSize - 1);
    if (error) return { data: all, error };
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return { data: all, error: null };
}
