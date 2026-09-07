/**
 * Sleva a konečná cena zakázky – jeden vzorec pro celou aplikaci.
 *
 * Dřív byl stejný výpočet na čtyřech místech (karta zakázky, dva generátory
 * dokumentů, podklady pro JobiDocs, statistiky) a rozcházel se v detailech:
 * někde se ořezávalo na nulu, někde ne, někde se zaokrouhlovalo na haléře.
 * Zákazník tak mohl na kartě vidět 0 Kč a na vytištěném dokladu zápornou
 * částku.
 */

import { formatCurrency, naHalere } from "./invoiceMath";

export type TypSlevy = "percentage" | "amount" | null | undefined;

/** Kolik se z hrubé ceny strhává. Nikdy víc, než kolik je cena. */
export function castkaSlevy(hruba: number, typ: TypSlevy, hodnota: number | null | undefined): number {
  const v = hodnota ?? 0;
  if (!typ || v <= 0 || hruba <= 0) return 0;
  const sleva = typ === "percentage" ? (hruba * v) / 100 : v;
  return Math.min(hruba, naHalere(sleva));
}

/**
 * Hrubá cena zakázky – součet provedených oprav, zaokrouhlený na haléře.
 *
 * Zaokrouhluje se hned na součtu: sčítání floatů vyrobí z 19,99 + 0,01 + …
 * hodnotu jako 666,6700000000001 a takové číslo se pak posílalo do portálu
 * i do QR platby. Renderer dokladu (jobidocs/core) sčítá stejně, takže
 * karta zakázky a doklad vycházejí z téhož čísla.
 */
export function hrubaCena(opravy: Array<{ price?: number | null }> | null | undefined): number {
  return naHalere((opravy ?? []).reduce((sum, r) => sum + (Number(r?.price) || 0), 0));
}

/** Kolik zákazník nakonec zaplatí. Záporná cena nedává smysl na kartě ani na dokladu. */
export function konecnaCena(hruba: number, typ: TypSlevy, hodnota: number | null | undefined): number {
  return Math.max(0, naHalere(hruba - castkaSlevy(hruba, typ, hodnota)));
}

/**
 * Částka česky: „1 234,50 Kč“. Doklady se nesmí tisknout jako „1234.5 Kč“.
 *
 * Jen jméno pro `formatCurrency` v korunách – dvě samostatné implementace
 * téhož formátu se vždycky rozešly v maličkosti (obyčejná mezera před „Kč“
 * místo nedělitelné) a částka se pak na dokladu zalomila přes dva řádky.
 */
export function korunami(castka: number): string {
  return formatCurrency(castka, "CZK");
}
