/**
 * Měsíční připomínka v Owner → Provize: pevná částka v cizí měně (15 USD),
 * kterou si majitel každý měsíc připisuje k provizím. Kurz bere z ČNB
 * (edge funkce kurz-cnb – lístek ČNB nemá CORS) a zapisuje ji jako řádek
 * provizí s kódem MESICNI-RRRR-MM, takže jde do dalšího vyúčtování.
 */
import { supabaseUrl, supabaseAnonKey, supabaseFetch, supabase } from "./supabaseClient";

/** Kód řádku provizí pro měsíc – podle něj se pozná, že je připsáno. */
export function kodMesicni(d: Date): string {
  return `MESICNI-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Je částka za měsíc už připsaná (i když se mezitím vyúčtovala)? */
export function jeMesicPripsan(polozky: ReadonlyArray<{ kod: string }>, d: Date): boolean {
  const kod = kodMesicni(d);
  return polozky.some((p) => p.kod === kod);
}

/** Přepočet na Kč, na haléře. */
export function prepocetNaKc(castka: number, kurz: number): number {
  return Math.round(castka * kurz * 100) / 100;
}

/** Poznámka k řádku: „15 USD × 21,762 Kč (ČNB 3. 11. 2026)“. */
export function poznamkaPrepoctu(castka: number, mena: string, kurz: number, platnost: string | null): string {
  const k = kurz.toLocaleString("cs-CZ", { maximumFractionDigits: 4 });
  const c = castka.toLocaleString("cs-CZ", { maximumFractionDigits: 2 });
  const datum = platnost ? ` (ČNB ${new Date(`${platnost}T12:00:00`).toLocaleDateString("cs-CZ")})` : "";
  return `${c} ${mena} × ${k} Kč${datum}`;
}

export type KurzCnb = { mena: string; kurz: number; platnost: string | null };

export async function nactiKurzCnb(mena: string): Promise<KurzCnb> {
  if (!supabase) throw new Error("Není připojení k databázi.");
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? supabaseAnonKey;
  const r = await supabaseFetch(`${supabaseUrl}/functions/v1/kurz-cnb`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: supabaseAnonKey },
    body: JSON.stringify({ mena }),
  });
  const d = (await r.json().catch(() => ({}))) as Partial<KurzCnb> & { error?: string };
  if (!r.ok || typeof d.kurz !== "number") throw new Error(d.error ?? `Kurz se nepodařilo načíst (${r.status}).`);
  return { mena: d.mena ?? mena, kurz: d.kurz, platnost: d.platnost ?? null };
}
