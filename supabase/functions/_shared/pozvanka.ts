/**
 * Kód pozvánky při opakovaném pozvání téhož e-mailu.
 *
 * Pozvánka je v tabulce jedna na dvojici (servis, e-mail) a zapisuje se
 * `upsert`em. Dřív si každé pozvání vygenerovalo nový kód, takže druhé kliknutí
 * na „Pozvat" přepsalo kód z prvního e-mailu a ten přestal platit. Když se
 * kliklo víckrát za sebou (dialog se při odesílání nijak neměnil), dostal
 * pozvaný pět e-mailů a platil jen poslední – ostatní hlásily „Pozvánka
 * nenalezena“.
 *
 * Čekající pozvánka, která ještě neprošla, si proto kód nechává; jen se znovu
 * pošle e-mail a prodlouží platnost. Nový kód dostane jen ten, kdo žádnou
 * použitelnou pozvánku nemá – tedy první pozvání, pozvánka už přijatá
 * (pozvání po odebrání z týmu) nebo propadlá.
 */

export type ExistujiciPozvanka = {
  token: string | null;
  expires_at: string | null;
  accepted_at: string | null;
} | null | undefined;

/**
 * Vrátí kód, který se má použít. `novy` je funkce, která vyrobí čerstvý kód;
 * volá se jen když je potřeba, aby šlo v testu poznat, že se nevolala.
 */
export function kodPozvanky(
  existujici: ExistujiciPozvanka,
  email: string,
  ted: Date,
  novy: () => string,
): { token: string; zachovany: boolean } {
  // Pozvánka bez e-mailu se k žádné jiné nepáruje – sdílený kód by mohl
  // omylem převzít cizí pozvánku.
  const kod = existujici?.token?.trim();
  const platna =
    email.trim() !== "" &&
    !!kod &&
    !existujici?.accepted_at &&
    !!existujici?.expires_at &&
    new Date(existujici.expires_at).getTime() > ted.getTime();
  return platna ? { token: kod!, zachovany: true } : { token: novy(), zachovany: false };
}
