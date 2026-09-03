/**
 * Kaskáda viditelnosti nad zařízeními.
 *
 * Viditelnost se dědí dolů: skrytá značka schová i kategorie a modely pod
 * sebou. Bez toho by ven prosákly modely z větve, kterou servis schoval –
 * dotaz na device_models sám o sobě o nadřazené značce nic neví.
 *
 * Používá to ceník i sklad (produkt nemá ukazovat na skrytý model), proto
 * to je tady a ne v jedné z funkcí.
 *
 * Bez Deno API, aby to šlo testovat z vitest (viz src/lib/viditelnost.test.ts).
 */

export type Znacka = { id: string };
export type Kategorie = { id: string; brand_id: string };
export type Model = { id: string; category_id: string };

export type ViditelneVetve = {
  kategorie: Kategorie[];
  modely: Model[];
  idModelu: Set<string>;
};

/**
 * Vstup jsou řádky UŽ profiltrované na public_visible = true. Tahle funkce
 * dořeší jen dědění – tedy zahodí potomky, jejichž rodič ve vstupu chybí.
 */
export function viditelneVetve(
  znacky: Znacka[],
  kategorie: Kategorie[],
  modely: Model[],
): ViditelneVetve {
  const idZnacek = new Set(znacky.map((b) => b.id));
  const viditelneKategorie = kategorie.filter((c) => idZnacek.has(c.brand_id));
  const idKategorii = new Set(viditelneKategorie.map((c) => c.id));
  const viditelneModely = modely.filter((m) => idKategorii.has(m.category_id));
  return {
    kategorie: viditelneKategorie,
    modely: viditelneModely,
    idModelu: new Set(viditelneModely.map((m) => m.id)),
  };
}
