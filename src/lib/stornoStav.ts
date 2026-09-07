/**
 * Co je „storno“ – jedna definice pro celou aplikaci.
 *
 * Statistiky sčítaly do tržeb i zakázky, které servis stornoval. Majitel pak
 * v Přehledu viděl peníze, které nikdy nedostal (v iSwapu 7 550 Kč, v testovacím
 * servisu 132 000 Kč), a podle nich stavěl ceny. Počet zakázek storno naopak
 * obsahovat má – ta práce se odvedla, jen se za ni nezaplatilo.
 *
 * Stav zakázky si každý servis pojmenovává sám, takže se storno nepozná podle
 * jednoho klíče. Pravidlo musí být na řádek stejné v databázi
 * (`public.stav_je_storno`) i tady, jinak se čísla ze serveru a ze záložního
 * výpočtu v prohlížeči rozejdou.
 */

/** Klíče, které aplikace i importy používají pro storno. */
const KLIC = /(cancel|storno)/iu;
/** Pojmenování, která si servisy dávají samy („Zrušeno“, „Neopraveno“…). */
const NAZEV = /(storn|zruš|nerealiz|neopraven|odmítn)/iu;

/**
 * Je stav storno? Bere klíč i název – servis si stav může pojmenovat
 * „Neopraveno / Neopravitelné“ a nechat mu klíč `cancelled`, i naopak.
 */
export function jeStornoStav(klic: string | null | undefined, nazev?: string | null): boolean {
  return KLIC.test(klic ?? "") || NAZEV.test(nazev ?? "");
}

/**
 * Předpis pro seznam stavů servisu: vrátí funkci, která pro klíč stavu řekne,
 * jestli je storno. Neznámý klíč (stav mezitím někdo smazal) se posuzuje
 * aspoň podle klíče samotného.
 */
export function stornoPodleStavu(
  stavy: ReadonlyArray<{ key: string; label?: string | null }>
): (klic: string | null | undefined) => boolean {
  const nazvy = new Map(stavy.map((s) => [s.key, s.label ?? ""]));
  return (klic) => jeStornoStav(klic, nazvy.get(klic ?? ""));
}
