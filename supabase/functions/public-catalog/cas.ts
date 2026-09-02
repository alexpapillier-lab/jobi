/**
 * Odhadovaný čas opravy v lidské podobě.
 *
 * V databázi je uložený v minutách, takže syrová hodnota (třeba 10080)
 * se na web nedá napsat. Tohle z ní udělá "7 dní".
 *
 * Samostatný soubor bez Deno API, aby šel otestovat z vitest.
 */

/** České skloňování: 1 den, 2–4 dny, 5+ dní. */
function tvar(pocet: number, jedna: string, dva: string, pet: string): string {
  if (pocet === 1) return jedna;
  if (pocet >= 2 && pocet <= 4) return dva;
  return pet;
}

/** Číslo s desetinnou čárkou a bez zbytečné nuly: 1.5 → "1,5", 2.0 → "2". */
function cislo(n: number): string {
  return (Math.round(n * 10) / 10).toString().replace(".", ",");
}

export function popisCasu(minut: unknown): string | null {
  const m = Number(minut);
  if (!Number.isFinite(m) || m <= 0) return null;

  if (m < 60) {
    const cele = Math.round(m);
    return `${cele} ${tvar(cele, "minuta", "minuty", "minut")}`;
  }

  const hodin = m / 60;
  if (hodin < 24) {
    // Celé hodiny skloňujeme, půlhodiny ne – "1,5 hodiny" zní líp než výjimky.
    if (Number.isInteger(hodin)) {
      return `${hodin} ${tvar(hodin, "hodina", "hodiny", "hodin")}`;
    }
    return `${cislo(hodin)} hodiny`;
  }

  const dnu = m / 1440;
  if (Number.isInteger(dnu)) {
    return `${dnu} ${tvar(dnu, "den", "dny", "dní")}`;
  }
  return `${cislo(dnu)} dne`;
}
