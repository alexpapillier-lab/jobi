/**
 * Limity čtení veřejného API.
 *
 * Počítá se jen to, co se ke funkci opravdu dostane – odpovědi mají
 * Cache-Control i ETag, takže většina opakovaných dotazů sem nedojde.
 *
 * IP se neukládá v čitelné podobě. Na limit stačí otisk a ten se navíc
 * solí dnem, aby se z tabulky nedala zpětně poskládat historie návštěv
 * jedné adresy. Je to osobní údaj, i když technický.
 */

export const LIMIT_NA_IP = 60;
export const LIMIT_NA_SERVIS = 600;

/** Otisk IP, solený dnem. Zkrácený – na rozlišení volajících stačí. */
export async function otiskKlienta(req: Request): Promise<string> {
  // x-forwarded-for může být seznam; první položka je původní klient
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim()
    || req.headers.get("cf-connecting-ip")
    || "neznama";
  const den = new Date().toISOString().slice(0, 10);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${den}|${ip}`));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

export type StavLimitu = { prekroceno: boolean; duvod?: string };

export function vyhodnotLimit(zaServis: number, zaKlic: number): StavLimitu {
  if (zaKlic > LIMIT_NA_IP) {
    return { prekroceno: true, duvod: `Překročen limit ${LIMIT_NA_IP} dotazů za minutu` };
  }
  if (zaServis > LIMIT_NA_SERVIS) {
    return { prekroceno: true, duvod: `Servis překročil limit ${LIMIT_NA_SERVIS} dotazů za minutu` };
  }
  return { prekroceno: false };
}
