/**
 * Trojité sloučení seznamů (základ – moje – jejich).
 *
 * Sklad a ceník se neukládají po řádcích, ale jako celý snímek: uloží se, co
 * je v paměti, a co v tom není, se z databáze smaže. To funguje, dokud je
 * uživatel sám. Jakmile mezitím zapíše kolega (nebo se moje rozpracovaná
 * verze vrátí po restartu aplikace), musí se obojí spojit – jinak by můj
 * zápis smazal všechno, co přibylo mezitím.
 *
 * Vstupem jsou tři stavy: `zaklad` je to, z čeho jsem vycházel (poslední
 * stav, který jsem viděl v databázi), `moje` je můj rozpracovaný stav
 * a `jejich` je to, co je v databázi teď. Výsledek zachová cizí přírůstky
 * a přitom uplatní moje změny včetně mazání.
 */

export type SIdem = { id: string };

function stejne(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Spojí jeden seznam. Pravidla, v tomhle pořadí:
 * – co jsem přidal, přibude,
 * – co jsem změnil, přepíše cizí verzi (pokud ji mezitím nesmazali),
 * – co jsem smazal, zmizí,
 * – čeho jsem se nedotkl, zůstane tak, jak to je v databázi.
 */
export function sloucSeznam<T extends SIdem>(zaklad: T[], moje: T[], jejich: T[]): T[] {
  const vZakladu = new Map(zaklad.map((x) => [x.id, x]));
  const vMych = new Map(moje.map((x) => [x.id, x]));
  const vysledek = new Map(jejich.map((x) => [x.id, x]));

  for (const [id, muj] of vMych) {
    const puvodni = vZakladu.get(id);
    if (!puvodni) {
      vysledek.set(id, muj); // přidal jsem
      continue;
    }
    if (stejne(puvodni, muj)) continue; // nesahal jsem na to
    // Změnil jsem to. Když to mezitím někdo smazal, nekřísím to.
    if (vysledek.has(id)) vysledek.set(id, muj);
  }

  for (const id of vZakladu.keys()) {
    if (!vMych.has(id)) vysledek.delete(id); // smazal jsem
  }

  /* Pořadí (ceník: order_index = pozice v seznamu). Když jsem položky
     přeskládal, platí moje pořadí – jinak by přenačtení během ukládání
     přetažení vrátilo zpátky. Cizí přírůstky, které u mě nejsou, zůstanou
     za svým předchůdcem z databáze. Když jsem pořadí neměnil, bere se
     databázové (kolega mohl přeskládat on). */
  if (!zmenilJsemPoradi(zaklad, moje)) return [...vysledek.values()];
  const out: T[] = [];
  const pouzite = new Set<string>();
  for (const x of moje) {
    const v = vysledek.get(x.id);
    if (v) { out.push(v); pouzite.add(x.id); }
  }
  // Cizí přírůstky vložit za položku, která je v databázi před nimi.
  const jejichIds = jejich.map((x) => x.id);
  for (const [i, id] of jejichIds.entries()) {
    if (pouzite.has(id) || !vysledek.has(id)) continue;
    const pred = jejichIds.slice(0, i).reverse().find((p) => pouzite.has(p));
    const kam = pred ? out.findIndex((x) => x.id === pred) + 1 : 0;
    out.splice(kam, 0, vysledek.get(id)!);
    pouzite.add(id);
  }
  return out;
}

/** Je relativní pořadí společných položek u mě jiné než v základu? */
function zmenilJsemPoradi(zaklad: SIdem[], moje: SIdem[]): boolean {
  const vMych = new Set(moje.map((x) => x.id));
  const vZakladu = new Set(zaklad.map((x) => x.id));
  const a = zaklad.filter((x) => vMych.has(x.id)).map((x) => x.id);
  const b = moje.filter((x) => vZakladu.has(x.id)).map((x) => x.id);
  return a.some((id, i) => id !== b[i]);
}

/**
 * Spojí celou datovou strukturu složenou ze seznamů (sklad, ceník).
 * Klíče, které v žádném ze vstupů nejsou pole, se berou z `jejich`.
 */
export function sloucData<T extends Record<string, unknown>>(zaklad: T, moje: T, jejich: T): T {
  const out: Record<string, unknown> = { ...jejich };
  for (const klic of Object.keys(jejich)) {
    const z = (zaklad as Record<string, unknown>)[klic];
    const m = (moje as Record<string, unknown>)[klic];
    const j = (jejich as Record<string, unknown>)[klic];
    if (!Array.isArray(z) || !Array.isArray(m) || !Array.isArray(j)) continue;
    if (!j.every((x) => x && typeof x === "object" && "id" in (x as object))) continue;
    out[klic] = sloucSeznam(z as SIdem[], m as SIdem[], j as SIdem[]);
  }
  return out as T;
}
