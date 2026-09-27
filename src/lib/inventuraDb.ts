/**
 * Inventura skladu – čtení a zápis v Supabase.
 *
 * Tabulky `inventory_stocktakes` a `inventory_stocktake_items` a RPC
 * `inventura_*` (migrace 20260927110000) na starším serveru nemusí být.
 * Čtení proto selhává měkce (`nedostupne: true`) a stránka Sklad jen
 * tlumeně oznámí, že inventura na serveru zapnutá není.
 *
 * Napočítané kusy se ukládají po řádku hned. Když zápis nevyjde kvůli síti,
 * jde do fronty neuložených změn (`frontaZapisu`) – číslo z regálu se tak
 * neztratí ani zavřením aplikace. Fronta drží cílový stav řádku (`napocitano`),
 * opakování je bezpečné; kdo a kdy doplní databáze při skutečném zápisu.
 */

import { getSupabaseClient } from "./supabaseClient";
import { fetchAllPages } from "./fetchAllPages";
import { jeTrvalaChyba, neulozeneZmeny, ulozNaPozdeji } from "./frontaZapisu";
import { jeChybaChybejicihoObjektu, type PoVysledek } from "./purchaseOrders";
import { mapInventura, mapPolozka, mapSouhrn, type Inventura, type PolozkaInventury, type SouhrnInventury } from "./inventura";

export const HLASKA_INVENTURA_NEDOSTUPNA = "Inventura zatím není na serveru zapnutá.";

type DbChyba = { code?: string; message?: string; details?: string } | null | undefined;

function selhani<T>(prazdne: T, err: DbChyba): PoVysledek<T> {
  if (jeChybaChybejicihoObjektu(err)) return { data: prazdne, nedostupne: true, error: err?.message };
  return { data: prazdne, error: err?.message ?? "Neznámá chyba" };
}

const INVENTURA_COLS =
  "id, service_id, warehouse_id, branch_id, cislo, sklad_nazev, status, poznamka, zahajil, zahajeno_at, uzavrel, uzavreno_at, nespocitane_beze_zmeny, souhrn";
const POLOZKA_COLS =
  "id, stocktake_id, product_id, nazev, sku, nakupni_cena, ocekavano, rezervovano, napocitano, stav_pri_pocitani, napocital, napocitano_at, stav_pred_uzavrenim, zapsany_rozdil, pridano_rucne";

/** Inventury servisu, nejnovější první. Do historie stačí posledních dvě stě. */
export async function nactiInventury(serviceId: string | null): Promise<PoVysledek<Inventura[]>> {
  const supabase = getSupabaseClient();
  if (!supabase || !serviceId) return { data: [], nedostupne: true };
  try {
    const res = await (supabase.from("inventory_stocktakes") as any)
      .select(INVENTURA_COLS)
      .eq("service_id", serviceId)
      .order("zahajeno_at", { ascending: false })
      .limit(200);
    if (res.error) return selhani([], res.error);
    return { data: ((res.data ?? []) as Record<string, unknown>[]).map(mapInventura) };
  } catch (e) {
    return selhani([], { message: (e as Error)?.message });
  }
}

/** Řádky jedné inventury, podle názvu. Stránkuje – sklad může mít přes tisíc produktů. */
export async function nactiPolozky(stocktakeId: string): Promise<PoVysledek<PolozkaInventury[]>> {
  const supabase = getSupabaseClient();
  if (!supabase) return { data: [], nedostupne: true };
  try {
    const res = await fetchAllPages<Record<string, unknown>>((od, doo) =>
      (supabase.from("inventory_stocktake_items") as any)
        .select(POLOZKA_COLS)
        .eq("stocktake_id", stocktakeId)
        .order("nazev")
        .order("id")
        .range(od, doo)
    );
    if (res.error) return selhani([], res.error as DbChyba);
    return { data: res.data.map(mapPolozka) };
  } catch (e) {
    return selhani([], { message: (e as Error)?.message });
  }
}

async function rpc<T>(nazev: string, args: Record<string, unknown>, prazdne: T, map: (d: unknown) => T): Promise<PoVysledek<T>> {
  const supabase = getSupabaseClient();
  if (!supabase) return { data: prazdne, nedostupne: true };
  try {
    const res = await (supabase as any).rpc(nazev, args);
    if (res.error) return selhani(prazdne, res.error);
    return { data: map(res.data) };
  } catch (e) {
    return selhani(prazdne, { message: (e as Error)?.message });
  }
}

/** Zahájí inventuru skladu; běží-li už, vrátí její id. */
export function zahajitInventuru(warehouseId: string, poznamka: string, vcetneNulovych: boolean): Promise<PoVysledek<string | null>> {
  return rpc(
    "inventura_zahajit",
    { p_warehouse_id: warehouseId, p_poznamka: poznamka.trim() || null, p_vcetne_nulovych: vcetneNulovych },
    null,
    (d) => (typeof d === "string" ? d : null)
  );
}

/** Přidá do rozdělané inventury produkt, který v seznamu nebyl. Vrací id řádku. */
export function pridatProdukt(stocktakeId: string, productId: string): Promise<PoVysledek<string | null>> {
  return rpc("inventura_pridat_produkt", { p_id: stocktakeId, p_product_id: productId }, null, (d) => (typeof d === "string" ? d : null));
}

/** Uzavře inventuru – zapíše rozdíly do skladu a zamkne. Vrací souhrn protokolu. */
export function uzavritInventuru(
  stocktakeId: string,
  nespocitaneBezeZmeny: boolean,
  poznamka: string
): Promise<PoVysledek<SouhrnInventury | null>> {
  return rpc(
    "inventura_uzavrit",
    { p_id: stocktakeId, p_nespocitane_beze_zmeny: nespocitaneBezeZmeny, p_poznamka: poznamka.trim() || null },
    null,
    mapSouhrn
  );
}

/** Zruší rozdělanou inventuru. Sklad se nemění. */
export function zrusitInventuru(stocktakeId: string): Promise<PoVysledek<boolean>> {
  return rpc("inventura_zrusit", { p_id: stocktakeId }, false, () => true);
}

export type VysledekZapisu =
  | { stav: "ulozeno"; polozka: PolozkaInventury | null }
  /** Síť nejela – zápis čeká ve frontě neuložených změn a dopíše se sám. */
  | { stav: "ve-fronte" }
  | { stav: "chyba"; zprava: string };

/**
 * Zapíše napočítané kusy jednoho řádku (null = vzít zpět). Vrací čerstvý
 * řádek z databáze (s doplněným „kdo, kdy, stav při počítání“).
 */
export async function zapsatNapocitano(
  polozka: Pick<PolozkaInventury, "id" | "nazev">,
  napocitano: number | null,
  serviceId: string | null,
  cisloInventury: string
): Promise<VysledekZapisu> {
  const supabase = getSupabaseClient();
  if (!supabase) return { stav: "chyba", zprava: "Aplikace není připojená k databázi." };
  const klic = `inventory_stocktake_items:${polozka.id}:napocitano`;
  const popis = cisloInventury ? `Inventura ${cisloInventury} · ${polozka.nazev}` : `Inventura · ${polozka.nazev}`;
  let chyba: unknown = null;
  try {
    const { data, error } = await (supabase.from("inventory_stocktake_items") as any)
      .update({ napocitano })
      .eq("id", polozka.id)
      .select(POLOZKA_COLS);
    if (error) {
      chyba = error;
    } else if (!Array.isArray(data) || data.length === 0) {
      // 204 bez řádku = zápis se nekonal (chybí právo, řádek zmizel). Viz frontaZapisu.
      return { stav: "chyba", zprava: "Počet se nezapsal – nemáte právo k inventuře, nebo řádek už neexistuje." };
    } else {
      /*
       * Starší zápis téhož řádku mohl předtím spadnout do fronty (výpadek sítě)
       * a teď by po návratu spojení přepsal tohle novější číslo. Fronta drží
       * na klíč jen poslední cíl – přepíšeme ho tímhle, takže dopsání už nic
       * nezkazí (zapíše stejnou hodnotu).
       */
      if (neulozeneZmeny().some((z) => z.klic === klic)) {
        ulozNaPozdeji({ klic, tabulka: "inventory_stocktake_items", id: polozka.id, data: { napocitano }, popis, serviceId });
      }
      return { stav: "ulozeno", polozka: mapPolozka(data[0] as Record<string, unknown>) };
    }
  } catch (e) {
    chyba = e;
  }
  if (jeTrvalaChyba(chyba)) {
    const zprava = (chyba as { message?: string })?.message ?? "Počet se nepodařilo uložit.";
    return { stav: "chyba", zprava };
  }
  ulozNaPozdeji({ klic, tabulka: "inventory_stocktake_items", id: polozka.id, data: { napocitano }, popis, serviceId, chyba });
  return { stav: "ve-fronte" };
}

/**
 * Sleduje změny inventur servisu (hlavičky i řádky) – víc lidí počítá naráz.
 * Vrací odhlášení. `onRadek` dostane změněný řádek, ať se nemusí číst celá
 * inventura; `onHlavicka` se volá při změně stavu kterékoli inventury.
 */
export function sledujInventury(
  serviceId: string,
  onRadek: (polozka: PolozkaInventury) => void,
  onHlavicka: () => void
): () => void {
  const supabase = getSupabaseClient();
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`inventura:${serviceId}:${Math.random().toString(36).slice(2, 8)}`)
    .on(
      "postgres_changes" as any,
      { event: "*", schema: "public", table: "inventory_stocktake_items", filter: `service_id=eq.${serviceId}` },
      (payload: { new?: Record<string, unknown> }) => {
        if (payload.new && payload.new.id) onRadek(mapPolozka(payload.new));
      }
    )
    .on(
      "postgres_changes" as any,
      { event: "*", schema: "public", table: "inventory_stocktakes", filter: `service_id=eq.${serviceId}` },
      () => onHlavicka()
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
