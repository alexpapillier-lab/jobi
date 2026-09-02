/**
 * Přepočet ceny mezi variantami s DPH a bez.
 *
 * Samostatný soubor, aby šel otestovat z testů Jobi (vitest) – uvnitř
 * edge funkce by se testovat nedal. Žádné Deno API se tu nepoužívá.
 */
export type CenoveVarianty = {
  price: number;
  price_incl_vat: number;
  price_excl_vat: number;
};

const zaokrouhli = (n: number) => Math.round(n * 100) / 100;

export function cenoveVarianty(
  cena: number,
  sazba: number,
  cenyJsouVcetneDph: boolean,
  jePlatce: boolean,
): CenoveVarianty {
  // Neplátce nemá co rozpočítávat a nulová sazba taky ne – cena je cena.
  if (!jePlatce || !Number.isFinite(sazba) || sazba <= 0) {
    return { price: cena, price_incl_vat: cena, price_excl_vat: cena };
  }
  const koeficient = 1 + sazba / 100;
  return cenyJsouVcetneDph
    ? { price: cena, price_incl_vat: cena, price_excl_vat: zaokrouhli(cena / koeficient) }
    : { price: cena, price_incl_vat: zaokrouhli(cena * koeficient), price_excl_vat: cena };
}
