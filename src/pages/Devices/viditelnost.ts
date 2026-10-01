/**
 * Účinná viditelnost položek ceníku ve veřejném API.
 *
 * Štítek „v API“ u řádku říká jen, jak je nastavený vlastní přepínač. Ven
 * se ale položka nedostane ani tehdy, když ji schová něco nad ní: skrytá
 * značka schová kategorie a modely pod sebou, skrytý model schová opravy,
 * které nemají jiný viditelný model, a oprava může mít u konkrétního
 * modelu výjimku. Uživatel pak vidí zapnutý štítek a diví se, proč
 * položka v odpovědi není.
 *
 * Tohle zrcadlí, co dělá edge funkce public-catalog (viditelneVetve
 * a filtr oprav) – jen to vrací důvod pro titulek štítku.
 */
import type { DevicesData, Repair, Selection } from "./types";

/** modelId → proč se model neposílá (název nadřazené položky, nebo null když je skrytý sám). */
export type SkryteModely = Map<string, string | null>;

/**
 * Co je ve stromu skryté „shora“: kategorie pod skrytou značkou a modely
 * pod skrytou kategorií nebo značkou. Hodnota je důvod do titulku
 * („značka Apple“). Vlastní přepínač položky se tu neřeší – ten čte
 * štítek přímo.
 */
export function zdedeneSkrytiStromu(data: DevicesData): { kategorie: Map<string, string>; modely: Map<string, string> } {
  const skryteZnacky = new Map(data.brands.filter((b) => b.publicVisible === false).map((b) => [b.id, `značka ${b.name}`]));
  const kategorie = new Map<string, string>();
  const skryteKategorie = new Map<string, string>();
  for (const c of data.categories) {
    const zdedeno = skryteZnacky.get(c.brandId);
    if (zdedeno) {
      kategorie.set(c.id, zdedeno);
      skryteKategorie.set(c.id, zdedeno);
    } else if (c.publicVisible === false) {
      skryteKategorie.set(c.id, `kategorie ${c.name}`);
    }
  }
  const modely = new Map<string, string>();
  for (const m of data.models) {
    const duvod = skryteKategorie.get(m.categoryId);
    if (duvod) modely.set(m.id, duvod);
  }
  return { kategorie, modely };
}

/**
 * Modely, které se do ceníku nedostanou. Hodnota je popis důvodu
 * („značka Apple“), u modelu skrytého vlastním přepínačem null.
 */
export function ucinneSkryteModely(data: DevicesData): SkryteModely {
  const { modely: zdedene } = zdedeneSkrytiStromu(data);
  const out: SkryteModely = new Map();
  for (const m of data.models) {
    const duvod = zdedene.get(m.id);
    if (duvod !== undefined) out.set(m.id, duvod);
    else if (m.publicVisible === false) out.set(m.id, null);
  }
  return out;
}

/** Proč je uzel stromu skrytý „shora“, i když má vlastní štítek zapnutý. */
export function duvodZdedenehoSkryti(data: DevicesData, sel: Selection): string | null {
  if (sel.kind === "brand") return null;
  const kategorie = sel.kind === "category"
    ? data.categories.find((c) => c.id === sel.id)
    : data.categories.find((c) => c.id === data.models.find((m) => m.id === sel.id)?.categoryId);
  if (!kategorie) return null;
  const znacka = data.brands.find((b) => b.id === kategorie.brandId);
  if (znacka?.publicVisible === false) return `značka ${znacka.name}`;
  if (sel.kind === "model" && kategorie.publicVisible === false) return `kategorie ${kategorie.name}`;
  return null;
}

/**
 * Proč se oprava se zapnutým štítkem přesto neposílá. Bere v úvahu i to,
 * u kterého modelu se na ni uživatel zrovna dívá: výjimka pro tenhle model
 * je jiný důvod než „nemá žádný viditelný model“.
 */
export function duvodSkrytiOpravy(
  r: Repair,
  selection: Selection | null,
  skryteModely: SkryteModely,
  nazvyModelu: Map<string, string>,
): string | null {
  const vyjimky = new Set(r.publicHiddenModelIds ?? []);
  if (selection?.kind === "model" && vyjimky.has(selection.id)) {
    return `u modelu ${nazvyModelu.get(selection.id) ?? ""} je nastavená výjimka`.replace("  ", " ");
  }
  const modely = r.modelIds ?? [];
  if (modely.length === 0) return null;
  if (modely.some((id) => !skryteModely.has(id) && !vyjimky.has(id))) return null;
  if (modely.every((id) => vyjimky.has(id))) return "má výjimku u všech svých modelů";
  return "všechny její modely jsou skryté";
}
