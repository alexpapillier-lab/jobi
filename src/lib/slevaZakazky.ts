/**
 * Sleva a konečná cena zakázky – jeden vzorec pro celou aplikaci.
 *
 * Dřív byl stejný výpočet na čtyřech místech (karta zakázky, dva generátory
 * dokumentů, podklady pro JobiDocs, statistiky) a rozcházel se v detailech:
 * někde se ořezávalo na nulu, někde ne, někde se zaokrouhlovalo na haléře.
 * Zákazník tak mohl na kartě vidět 0 Kč a na vytištěném dokladu zápornou
 * částku.
 */

export type TypSlevy = "percentage" | "amount" | null | undefined;

/** Kolik se z hrubé ceny strhává. Nikdy víc, než kolik je cena. */
export function castkaSlevy(hruba: number, typ: TypSlevy, hodnota: number | null | undefined): number {
  const v = hodnota ?? 0;
  if (!typ || v <= 0 || hruba <= 0) return 0;
  const sleva = typ === "percentage" ? (hruba * v) / 100 : v;
  return Math.min(hruba, Math.round(sleva * 100) / 100);
}

/** Kolik zákazník nakonec zaplatí. Záporná cena nedává smysl na kartě ani na dokladu. */
export function konecnaCena(hruba: number, typ: TypSlevy, hodnota: number | null | undefined): number {
  return Math.max(0, Math.round((hruba - castkaSlevy(hruba, typ, hodnota)) * 100) / 100);
}

/** Částka česky: „1 234,50 Kč“. Doklady se nesmí tisknout jako „1234.5 Kč“. */
export function korunami(castka: number): string {
  return `${new Intl.NumberFormat("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(castka)} Kč`;
}
