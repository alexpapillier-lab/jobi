/**
 * Předschválená cena u zařízení v nové zakázce: jak se dopočítává z oprav
 * z ceníku a ze slevy.
 *
 * Dřív se cena rovnala součtu oprav z ceníku a sleva zadaná při příjmu
 * ji nechala být – u pultu se pak zákazníkovi řeklo 2 250 Kč, ale na
 * zakázce svítilo 2 500. Teď je předschválená cena to, co zákazník
 * doopravdy zaplatí: základ po slevě.
 *
 * Základ je součet oprav z ceníku, nebo částka, kterou člověk napsal
 * ručně (`cenaPredSlevou`). Ručně zadaná cena se bere jako cena před
 * slevou, ať jde sleva vrátit i přidat, aniž by se původní číslo ztratilo.
 */

import { konecnaCena, type TypSlevy } from "./slevaZakazky";

export type CenaZarizeni = {
  estimatedPrice?: number;
  /** Ručně napsaná cena před slevou; bez ní je základem součet oprav z ceníku. */
  cenaPredSlevou?: number;
  discountType?: TypSlevy;
  discountValue?: number;
};

export function soucetOprav(opravy: Array<{ price?: number | null }> | null | undefined): number {
  return (opravy ?? []).reduce((a, r) => a + (Number(r?.price) || 0), 0);
}

/** Z čeho se sleva počítá: ruční cena, jinak součet oprav z ceníku. */
export function zakladCeny(d: CenaZarizeni, soucetZCeniku: number): number {
  return d.cenaPredSlevou ?? soucetZCeniku;
}

/** Cena, kterou by formulář sám dopočítal. `undefined` = není z čeho. */
export function dopocitanaCena(d: CenaZarizeni, soucetZCeniku: number): number | undefined {
  const zaklad = zakladCeny(d, soucetZCeniku);
  if (zaklad <= 0) return undefined;
  return konecnaCena(zaklad, d.discountType, d.discountValue);
}

/** Po klepnutí na slevu (nebo jejím zrušení): cena se přepočítá ze základu. */
export function poZmeneSlevy(d: CenaZarizeni, soucetZCeniku: number, typ: TypSlevy, hodnota: number): CenaZarizeni {
  const next: CenaZarizeni = { ...d, discountType: typ ?? null, discountValue: typ ? hodnota : undefined };
  const cena = dopocitanaCena(next, soucetZCeniku);
  return cena === undefined ? next : { ...next, estimatedPrice: cena };
}

/**
 * Po přidání/odebrání opravy z ceníku. Cena se přepíše jen dokud ji člověk
 * nezadal ručně – tedy dokud se rovná tomu, co formulář sám dopočítal.
 */
export function poZmeneOprav(d: CenaZarizeni, staryZCeniku: number, novyZCeniku: number): CenaZarizeni {
  const drivDopocitana = dopocitanaCena(d, staryZCeniku);
  const nedotcena = d.estimatedPrice === undefined || d.estimatedPrice === drivDopocitana;
  if (!nedotcena) return d;
  const bezRucni: CenaZarizeni = { ...d, cenaPredSlevou: undefined };
  return { ...bezRucni, estimatedPrice: dopocitanaCena(bezRucni, novyZCeniku) };
}

/** Člověk napsal cenu sám: platí, jak je, a od teď je základem pro slevu. */
export function poRucniCene(d: CenaZarizeni, text: string): CenaZarizeni {
  if (text.trim() === "") return { ...d, estimatedPrice: undefined, cenaPredSlevou: undefined };
  const n = Number(text);
  if (!Number.isFinite(n)) return d;
  return { ...d, estimatedPrice: n, cenaPredSlevou: n };
}
