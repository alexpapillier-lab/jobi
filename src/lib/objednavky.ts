import { supabase, supabaseUrl, supabaseAnonKey, supabaseFetch } from "./supabaseClient";
import type { DevicesData } from "./catalogStorage";
import type { PerformedRepair } from "../components/orders/types";
import type { DeviceRow, NewOrderDraft } from "../pages/Orders/typy";
import {
  NAZEV_DOPRAVCE,
  POPIS_STAVU,
  odkazProCislo,
  jeOtevrena,
  type Dopravce,
  type SledovaciCislo,
  type StavDb,
} from "../../supabase/functions/_shared/objednavky";

/**
 * Objednávky oprav z webu servisu (tabulka web_objednavky). Zvenku je
 * zakládá edge funkce api-orders (token se scope orders) nebo vložitelný
 * formulář (public-order-form); servis je tady čte, mění stav, převádí na
 * zakázku a ruší. Zápis jde jen přes RPC – REST zápis klient nemá.
 *
 * Logika sdílená se serverem (stavy, sledovací čísla, podpis webhooku) je
 * v supabase/functions/_shared/objednavky.ts.
 */
export {
  NAZEV_DOPRAVCE,
  POPIS_STAVU,
  POPIS_UDALOSTI,
  STAV_API,
  UDALOSTI,
  jeOtevrena,
  odkazProCislo,
  type Udalost,
} from "../../supabase/functions/_shared/objednavky";
export type { StavDb as StavObjednavky, SledovaciCislo };

export type WebObjednavka = {
  id: string;
  service_id: string;
  branch_id: string | null;
  externi_cislo: string;
  zdroj: string;
  stav: StavDb;
  zakaznik_jmeno: string | null;
  zakaznik_telefon: string | null;
  zakaznik_email: string | null;
  zakaznik_firma: string | null;
  zakaznik_ico: string | null;
  zakaznik_dic: string | null;
  zakaznik_ulice: string | null;
  zakaznik_mesto: string | null;
  zakaznik_psc: string | null;
  zarizeni: string | null;
  model_id: string | null;
  sn_imei: string | null;
  heslo_zarizeni: string | null;
  prislusenstvi: string | null;
  popis_zavady: string | null;
  pozadovana_oprava: string | null;
  repair_id: string | null;
  doprava_tam: string | null;
  doprava_zpet: string | null;
  vydejni_misto: string | null;
  adresa_zpet: string | null;
  sledovaci_cisla: SledovaciCislo[] | null;
  poznamka: string | null;
  ticket_id: string | null;
  created_at: string;
  updated_at: string;
  dorazilo_at: string | null;
};

const SLOUPCE =
  "id, service_id, branch_id, externi_cislo, zdroj, stav, zakaznik_jmeno, zakaznik_telefon, zakaznik_email, zakaznik_firma, zakaznik_ico, zakaznik_dic, zakaznik_ulice, zakaznik_mesto, zakaznik_psc, zarizeni, model_id, sn_imei, heslo_zarizeni, prislusenstvi, popis_zavady, pozadovana_oprava, repair_id, doprava_tam, doprava_zpet, vydejni_misto, adresa_zpet, sledovaci_cisla, poznamka, ticket_id, created_at, updated_at, dorazilo_at";

/** Nevyřízené objednávky všechny, vyřízené (převedené, zrušené) jen posledních 20. */
export async function nactiObjednavky(serviceId: string): Promise<WebObjednavka[]> {
  if (!supabase) return [];
  const tabulka = () => supabase!.from("web_objednavky" as never) as any;
  const [otevrene, uzavrene] = await Promise.all([
    tabulka().select(SLOUPCE).eq("service_id", serviceId).in("stav", ["nova", "na_ceste", "dorazilo"]).order("created_at", { ascending: false }),
    tabulka().select(SLOUPCE).eq("service_id", serviceId).in("stav", ["prevedeno", "zrusena"]).order("updated_at", { ascending: false }).limit(20),
  ]);
  if (otevrene.error) throw otevrene.error;
  if (uzavrene.error) throw uzavrene.error;
  return [...((otevrene.data ?? []) as WebObjednavka[]), ...((uzavrene.data ?? []) as WebObjednavka[])];
}

/** Objednávka, ze které zakázka vznikla (řádek v detailu zakázky). */
export async function objednavkaZakazky(ticketId: string): Promise<Pick<WebObjednavka, "id" | "externi_cislo" | "zdroj"> | null> {
  if (!supabase) return null;
  const { data, error } = await (supabase.from("web_objednavky" as never) as any)
    .select("id, externi_cislo, zdroj")
    .eq("ticket_id", ticketId)
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data as Pick<WebObjednavka, "id" | "externi_cislo" | "zdroj"> | null) ?? null;
}

/** Na cestě / Dorazilo / Zrušit / zpět Nová. false = mezitím vyřízená někým jiným. */
export async function nastavStavObjednavky(id: string, stav: "nova" | "na_ceste" | "dorazilo" | "zrusena"): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await (supabase as any).rpc("web_objednavka_nastav_stav", { p_id: id, p_stav: stav });
  if (error) throw error;
  return data === true;
}

/** Po založení zakázky: objednávka → převedená + webhook order.converted. */
export async function prevedObjednavku(id: string, ticketId: string): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await (supabase as any).rpc("web_objednavka_prevest", { p_id: id, p_ticket_id: ticketId });
  if (error) throw error;
  return data === true;
}

/**
 * Pošle čekající webhooky servisu hned, ne až s minutovým cronem.
 * Nejlepší snaha – když se nepovede, pošle je cron.
 */
export async function odesliWebhookyHned(serviceId: string): Promise<void> {
  if (!supabase || !supabaseAnonKey) return;
  try {
    const jwt = (await supabase.auth.getSession()).data?.session?.access_token;
    if (!jwt) return;
    await supabaseFetch(`${supabaseUrl}/functions/v1/api-webhooks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}`, apikey: supabaseAnonKey },
      body: JSON.stringify({ action: "kick", serviceId }),
    });
  } catch {
    /* pošle cron */
  }
}

/** Realtime: každá změna objednávek servisu zavolá callback. */
export function sledujObjednavky(serviceId: string, onZmena: (typ: "INSERT" | "UPDATE" | "DELETE") => void): () => void {
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`web_objednavky:${serviceId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "web_objednavky", filter: `service_id=eq.${serviceId}` }, (payload) => {
      onZmena(payload.eventType as "INSERT" | "UPDATE" | "DELETE");
    })
    .subscribe();
  return () => {
    void supabase?.removeChannel(channel);
  };
}

/** Sledovací čísla s odkazem na sledování (když jde dopravce poznat). */
export function sledovaciOdkazy(o: Pick<WebObjednavka, "sledovaci_cisla">): { text: string; url: string | null; smer: "tam" | "zpet" | null }[] {
  const sc = Array.isArray(o.sledovaci_cisla) ? o.sledovaci_cisla : [];
  return sc
    .filter((s) => s && typeof s.cislo === "string" && s.cislo.trim())
    .map((s) => ({
      text: `${s.dopravce && s.dopravce !== "jiny" ? `${NAZEV_DOPRAVCE[s.dopravce as Dopravce] ?? s.dopravce} ` : ""}${s.cislo}`,
      url: odkazProCislo(s),
      smer: s.smer ?? null,
    }));
}

/** „Na cestě · DPD“, „Dorazilo“… – krátký stav pro řádek seznamu. */
export function popisDopravy(o: Pick<WebObjednavka, "stav" | "doprava_tam">): string {
  const stav = POPIS_STAVU[o.stav] ?? o.stav;
  return o.doprava_tam && jeOtevrena(o.stav) && o.stav !== "dorazilo" ? `${stav} · ${o.doprava_tam}` : stav;
}

/** Název modelu z ceníku i se značkou („Apple iPhone 13“). */
export function nazevModelu(data: Pick<DevicesData, "brands" | "categories" | "models">, modelId: string | null | undefined): string | null {
  if (!modelId) return null;
  const m = data.models.find((x) => x.id === modelId);
  if (!m) return null;
  const k = data.categories.find((x) => x.id === m.categoryId);
  const z = k ? data.brands.find((x) => x.id === k.brandId) : undefined;
  return z && !m.name.toLowerCase().startsWith(z.name.toLowerCase()) ? `${z.name} ${m.name}` : m.name;
}

export type PodkladyPrijmu = {
  /** Výchozí způsob převzetí/předání z Nastavení (když objednávka dopravu neuvádí). */
  handoffDefault?: string;
  handbackDefault?: string;
  /** Název modelu z ceníku podle model_id (má přednost před textem od zákazníka). */
  modelNazev?: string | null;
  /** Oprava z ceníku podle repair_id – jde do zakázky jako plánovaná oprava. */
  oprava?: { id: string; name: string; price: number; costs?: number; estimatedTime?: number; productIds?: string[] } | null;
  /** Kdo opravu přidal (odměny týmu). */
  pridalUserId?: string;
  /** Pobočka konceptu, když ji objednávka neurčuje. */
  branchIdDefault?: string | null;
};

/**
 * Objednávka → koncept nové zakázky (stejná cesta jako rezervace z webu):
 * zákazník, zařízení, SN/IMEI, heslo, příslušenství, závada jako požadovaná
 * oprava, doprava jako způsob převzetí a předání, Externí identifikace =
 * číslo objednávky, pobočka. Zbytek (výdejní místo, adresa zpět, sledovací
 * čísla, poznámka) jde do poznámky k zařízení, ať ho technik má po ruce.
 */
export function objednavkaNaKoncept(o: WebObjednavka, p: PodkladyPrijmu = {}): NewOrderDraft {
  const s = (v: string | null | undefined) => (v ?? "").trim();
  const zarizeniText = s(o.zarizeni);
  const nazev = s(p.modelNazev) || zarizeniText || "Zařízení z objednávky";
  const zavada = s(o.popis_zavady);
  const pozadovano = s(o.pozadovana_oprava);
  const pozadovanaOprava = [pozadovano, zavada && zavada !== pozadovano ? zavada : ""].filter(Boolean).join(" – ");
  const sc = sledovaciOdkazy(o);
  const poznamka = [
    `Z objednávky ${o.externi_cislo}${s(o.zdroj) ? ` (${s(o.zdroj)})` : ""}`,
    p.modelNazev && zarizeniText && zarizeniText !== p.modelNazev ? `Zákazník uvedl: ${zarizeniText}` : "",
    s(o.vydejni_misto) ? `Výdejní místo: ${s(o.vydejni_misto)}` : "",
    s(o.adresa_zpet) ? `Adresa pro vrácení: ${s(o.adresa_zpet)}` : "",
    sc.length ? `Zásilky: ${sc.map((x) => x.text).join(", ")}` : "",
    s(o.poznamka),
  ].filter(Boolean).join("\n");
  const planovane: PerformedRepair[] | undefined = p.oprava
    ? [{
        id: `${Date.now()}_${Math.random()}`,
        name: p.oprava.name,
        type: "selected",
        repairId: p.oprava.id,
        price: p.oprava.price,
        costs: p.oprava.costs,
        estimatedTime: p.oprava.estimatedTime,
        productIds: p.oprava.productIds,
        pridalUserId: p.pridalUserId,
      } as PerformedRepair]
    : undefined;
  const zarizeni: DeviceRow = {
    deviceLabel: nazev,
    serialOrImei: s(o.sn_imei),
    devicePasscode: s(o.heslo_zarizeni),
    deviceCondition: "",
    deviceAccessories: s(o.prislusenstvi),
    warrantyClaim: false,
    purchaseDate: "",
    purchaseProof: "",
    findMyOff: false,
    requestedRepair: pozadovanaOprava,
    handoffMethod: s(o.doprava_tam) ? `Poštou – ${s(o.doprava_tam)}` : (p.handoffDefault ?? ""),
    handbackMethod: s(o.doprava_zpet) ? `Poštou – ${s(o.doprava_zpet)}` : (p.handbackDefault ?? ""),
    deviceNote: poznamka,
    externalId: o.externi_cislo,
    estimatedPrice: undefined,
    plannedRepairs: planovane,
    expectedCompletionAt: undefined,
  };
  const dic = s(o.zakaznik_dic);
  return {
    customerName: s(o.zakaznik_jmeno),
    customerPhone: s(o.zakaznik_telefon),
    customerEmail: s(o.zakaznik_email),
    addressStreet: s(o.zakaznik_ulice),
    addressCity: s(o.zakaznik_mesto),
    addressZip: s(o.zakaznik_psc).replace(/\s/g, ""),
    company: s(o.zakaznik_firma),
    ico: s(o.zakaznik_ico),
    customerInfo: dic ? `DIČ: ${dic}` : "",
    devices: [zarizeni],
    branchId: o.branch_id ?? p.branchIdDefault ?? null,
    objednavkaId: o.id,
  };
}

const bezDiakritiky = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Hledání v příchozích objednávkách: číslo, zákazník (jméno, telefon,
 * e-mail, firma), zařízení, SN/IMEI, závada a sledovací čísla. Bez
 * diakritiky a velikosti písmen, každé slovo dotazu musí někde sedět.
 * Telefon a čísla se porovnávají i bez mezer („777 123“ najde +420777123…).
 */
export function odpovidaHledani(o: WebObjednavka, dotaz: string): boolean {
  const slova = bezDiakritiky(dotaz).split(/\s+/).filter(Boolean);
  if (slova.length === 0) return true;
  const text = bezDiakritiky(
    [
      o.externi_cislo, o.zakaznik_jmeno, o.zakaznik_telefon, o.zakaznik_email, o.zakaznik_firma,
      o.zarizeni, o.sn_imei, o.popis_zavady, o.pozadovana_oprava,
      ...(o.sledovaci_cisla ?? []).map((s) => s.cislo),
    ].filter(Boolean).join(" "),
  );
  const bezMezer = text.replace(/[\s\-+]/g, "");
  const cisloDotazu = bezDiakritiky(dotaz).replace(/[\s\-+]/g, "");
  if (/^\d{4,}$/.test(cisloDotazu) && bezMezer.includes(cisloDotazu)) return true;
  return slova.every((w) => text.includes(w) || bezMezer.includes(w.replace(/[-+]/g, "")));
}
