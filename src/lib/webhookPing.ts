/**
 * Ping na webhook servisu po změně veřejného ceníku nebo skladu.
 *
 * Volá se po úspěšném uložení. Schválně „nejlepší snaha“ – když se ping
 * nepovede, uložení tím padnout nesmí; výsledek posledního pokusu je
 * v Nastavení → API.
 *
 * Sdružuje se do jednoho volání za 10 sekund. Bez toho by úprava deseti
 * cen po sobě spustila deset buildů webu.
 */
import { supabase, supabaseUrl, supabaseAnonKey, supabaseFetch } from "./supabaseClient";

const cekajici = new Map<string, ReturnType<typeof setTimeout>>();
const PRODLEVA_MS = 10_000;

export function oznamZmenuKatalogu(serviceId: string | null): void {
  if (!serviceId || !supabase || !supabaseAnonKey) return;

  const drive = cekajici.get(serviceId);
  if (drive) clearTimeout(drive);

  cekajici.set(serviceId, setTimeout(async () => {
    cekajici.delete(serviceId);
    try {
      const { data: obnovena } = await supabase!.auth.refreshSession();
      const jwt = obnovena?.session?.access_token
        ?? (await supabase!.auth.getSession()).data?.session?.access_token;
      if (!jwt) return;
      await supabaseFetch(`${supabaseUrl}/functions/v1/public-webhook-ping`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt}`,
          apikey: supabaseAnonKey!,
        },
        body: JSON.stringify({ serviceId }),
      });
    } catch {
      // Ticho schválně: webhook je pohodlí navíc, ne součást uložení.
      // Jestli chodí, se pozná v Nastavení → API.
    }
  }, PRODLEVA_MS));
}
