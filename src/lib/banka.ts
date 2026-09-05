/**
 * České číslo účtu → IBAN.
 *
 * QR platba (SPAYD) potřebuje IBAN, ale servisy mají v nastavení často jen
 * číslo účtu „předčíslí-číslo/kód banky“. Český IBAN je z něj odvoditelný
 * bez dotazu do banky: CZ + 2 kontrolní číslice + kód banky (4) + předčíslí
 * doplněné na 6 + číslo doplněné na 10.
 */
export function ibanZCislaUctu(cislo: string | null | undefined): string | null {
  const bezMezer = (cislo ?? "").replace(/\s/g, "");
  const m = /^(?:(\d{1,6})-)?(\d{2,10})\/(\d{4})$/.exec(bezMezer);
  if (!m) return null;
  const predcisli = (m[1] ?? "").padStart(6, "0");
  const ucet = m[2].padStart(10, "0");
  const banka = m[3];
  const bban = banka + predcisli + ucet;
  // Kontrolní číslice: 98 − (BBAN + „CZ00“ jako číslice, C=12, Z=35) mod 97.
  const kontrola = 98 - mod97(bban + "123500");
  return `CZ${String(kontrola).padStart(2, "0")}${bban}`;
}

/** Zbytek po dělení 97 pro dlouhý číselný řetězec – po částech, ať nepřeteče. */
function mod97(cislice: string): number {
  let zbytek = 0;
  for (const c of cislice) {
    zbytek = (zbytek * 10 + (c.charCodeAt(0) - 48)) % 97;
  }
  return zbytek;
}
