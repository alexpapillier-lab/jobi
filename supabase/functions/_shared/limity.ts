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

/**
 * Adresa volajícího tak, jak si ji nemůže určit sám.
 *
 * Před edge funkcemi stojí Cloudflare – ověřeno na nasazené funkci, odpověď
 * má `server: cloudflare` a `cf-ray`. Cloudflare `cf-connecting-ip` přepisuje
 * vlastní hodnotou, takže je to jediná hlavička, které se dá věřit.
 *
 * `x-forwarded-for` je seznam, do kterého proxy své adresy PŘIPOJUJÍ NA KONEC.
 * První položka je tedy to, co poslal klient, a tu si napíše jakou chce –
 * kdo bral první, měl limit „na klienta", který stačilo obejít jednou
 * hlavičkou navíc. Bere se proto poslední položka.
 */
export function klientskaIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const seznam = (req.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  return seznam.length > 0 ? seznam[seznam.length - 1] : "neznama";
}

/** Otisk IP, solený dnem. Zkrácený – na rozlišení volajících stačí. */
export async function otiskKlienta(req: Request): Promise<string> {
  const ip = klientskaIp(req);
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
