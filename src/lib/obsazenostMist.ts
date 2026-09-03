/**
 * Obsazenost míst servisu pro Owner obrazovku.
 *
 * Počty chodí z funkce service_seat_overview() přes edge funkci
 * services-list, takže sedí s kontrolou při zvaní: zahrnují nepřijaté
 * pozvánky a vynechávají root ownera. Tady se z nich dělá jen text.
 */

export type ObsazenostVstup = {
  /** Kolik míst servis zabírá. undefined = nepodařilo se zjistit. */
  member_count?: number;
  /** Limit plánu. null/undefined = plán bez omezení (Enterprise, legacy). */
  seat_limit?: number | null;
};

/** „1 člen" / „3 členové" / „7 členů" – čeština skloňuje jinak u 1, 2–4 a 5+. */
export function clenoveTvar(n: number): string {
  if (n === 1) return "1 člen";
  if (n >= 2 && n <= 4) return `${n} členové`;
  return `${n} členů`;
}

/**
 * „3 / 6 členů" u plánu s limitem, „3 členové" u plánu bez omezení.
 * Vrací null, když počet není známý – UI pak radši neukáže nic, než
 * aby ukázalo špatné číslo.
 */
export function obsazenostText(s: ObsazenostVstup): string | null {
  if (typeof s.member_count !== "number") return null;
  if (typeof s.seat_limit !== "number") return clenoveTvar(s.member_count);
  return `${s.member_count} / ${s.seat_limit} členů`;
}

/**
 * Je limit vyčerpaný? Pak servis nikoho dalšího nepozve a v Owner
 * obrazovce se to zvýrazní.
 *
 * Záměrně >= a ne ==: servis se může nad limit dostat downgradem plánu
 * a takový stav se musí poznat taky.
 */
export function jeLimitPlny(s: ObsazenostVstup): boolean {
  return (
    typeof s.member_count === "number" &&
    typeof s.seat_limit === "number" &&
    s.member_count >= s.seat_limit
  );
}
