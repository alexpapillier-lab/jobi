/**
 * Majitel aplikace (root owner) je pro členy servisů neviditelný.
 *
 * Je členem všech servisů kvůli správě a podpoře, ale zákazník o něm nemá
 * vědět: nevidí ho v týmu, v chatu, mezi online kolegy, jako autora změn ani
 * jako technika. Seznamy členů a jména filtruje databáze (migrace
 * 20261009160000_root_owner_neviditelny), tady je klientská půlka:
 *
 *   - id, které přišlo v datech (historie, komentář, úsek práce, presence),
 *     se ostatním ukáže jako „Systém“ – stejně jako import nebo automatika;
 *   - v chatu jako „Podpora Jobi“ (zpráva bez autora by nedávala smysl);
 *   - sám root owner se vidí normálně.
 *
 * Id se bere z `VITE_ROOT_OWNER_ID` (musí sedět s `app_nastaveni.root_owner_id`
 * v databázi a `ROOT_OWNER_ID` u edge funkcí). Funkce berou id i parametrem,
 * ať jdou otestovat bez proměnné prostředí.
 */

const ROOT_OWNER_ID: string | null = import.meta.env.VITE_ROOT_OWNER_ID?.trim() || null;

/** Jak se ostatním ukáže autor akce, kterou udělal majitel aplikace. */
export const JMENO_SYSTEM = "Systém";
/** Jak se ostatním ukáže autor zprávy v chatu týmu od majitele aplikace. */
export const JMENO_PODPORA = "Podpora Jobi";

export function rootOwnerId(): string | null {
  return ROOT_OWNER_ID;
}

/** Je tohle id majitel aplikace? Prázdné id ani nenastavená proměnná nikdy. */
export function jeRootOwnerId(userId: string | null | undefined, root: string | null = ROOT_OWNER_ID): boolean {
  if (!userId || !root) return false;
  return userId.trim().toLowerCase() === root.trim().toLowerCase();
}

/**
 * Má se tohle id přede mnou schovat? Ano, když je to majitel aplikace a já
 * jím nejsem. Sám sebe majitel vidí.
 */
export function skrytyRootOwner(
  userId: string | null | undefined,
  mojeId: string | null | undefined,
  root: string | null = ROOT_OWNER_ID
): boolean {
  return jeRootOwnerId(userId, root) && !jeRootOwnerId(mojeId, root);
}

/** Vyřadí ze seznamu majitele aplikace (když se nedívá on sám). */
export function bezRootOwnera<T>(
  polozky: readonly T[],
  idPolozky: (p: T) => string | null | undefined,
  mojeId: string | null | undefined,
  root: string | null = ROOT_OWNER_ID
): T[] {
  return polozky.filter((p) => !skrytyRootOwner(idPolozky(p), mojeId, root));
}

/** Autor změny pro ostatní: id majitele aplikace se změní na null (= „Systém“). */
export function autorProOstatni(
  userId: string | null | undefined,
  mojeId: string | null | undefined,
  root: string | null = ROOT_OWNER_ID
): string | null {
  if (!userId) return null;
  return skrytyRootOwner(userId, mojeId, root) ? null : userId;
}

/**
 * Jméno technika u hodinové práce, jak se smí ukázat a vytisknout. Práce,
 * kterou zapsal majitel aplikace, je bez jména – jde i na doklady zákazníkovi.
 */
export function technikPrace(
  r: { technik?: string | null; technikUserId?: string | null },
  root: string | null = ROOT_OWNER_ID
): string | null {
  const jmeno = r.technik?.trim();
  if (!jmeno || jeRootOwnerId(r.technikUserId, root)) return null;
  return jmeno;
}
