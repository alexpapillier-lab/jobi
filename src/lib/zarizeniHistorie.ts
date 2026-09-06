/**
 * Historie zařízení podle sériového čísla / IMEI a kontrola IMEI.
 *
 * Servis chce při příjmu vědět, že tenhle telefon už tu byl (reklamace,
 * opakovaná závada, „minule jsme měnili displej“). IMEI se navíc dá ověřit
 * kontrolní číslicí (Luhn), takže překlep z klávesnice je vidět hned.
 */
export function normalizujSeriove(s: string | null | undefined): string {
  return (s ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
}

/** 15 číslic = IMEI (po odstranění mezer a pomlček). */
export function vypadaJakoImei(s: string | null | undefined): boolean {
  return /^\d{15}$/.test(normalizujSeriove(s));
}

/** Luhnova kontrolní číslice IMEI. Pro jiné řetězce vrací true (nic se nekontroluje). */
export function platnyImei(s: string | null | undefined): boolean {
  const n = normalizujSeriove(s);
  if (!/^\d{15}$/.test(n)) return true;
  let soucet = 0;
  for (let i = 0; i < 15; i++) {
    let c = n.charCodeAt(i) - 48;
    if (i % 2 === 1) {
      c *= 2;
      if (c > 9) c -= 9;
    }
    soucet += c;
  }
  return soucet % 10 === 0;
}

export type ZaznamZarizeni = { id: string; code?: string | null; createdAt: string; serialOrImei?: string | null; issueShort?: string | null; requestedRepair?: string | null; status?: string | null };

/**
 * Zakázky se stejným sériovým číslem / IMEI (bez ohledu na mezery a
 * velikost písmen), nejnovější první. Krátké řetězce (pod 6 znaků) se
 * neporovnávají – to nejsou identifikátory, to jsou poznámky typu „bez SN“.
 */
export function najdiStejneZarizeni<T extends ZaznamZarizeni>(zakazky: T[], seriove: string | null | undefined, vynechatId?: string): T[] {
  const klic = normalizujSeriove(seriove);
  if (klic.length < 6) return [];
  return zakazky
    .filter((t) => t.id !== vynechatId && normalizujSeriove(t.serialOrImei) === klic)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
