import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { fetchAllPages } from "../../lib/fetchAllPages";
import { reportSilent } from "../../lib/reportError";
import { nactiKanaly, nactiNeprectene } from "../../lib/chat";
import { UDALOST_ZMENY_CONFIGU, loadServiceConfig, subscribeServiceConfig } from "../../lib/serviceSettingsSync";
import type { Rezervace } from "../../lib/rezervace";
import {
  mapujZakazkuDnes,
  zakazkySDilemNaCeste,
  type PolozkaObjednavkyDnes,
  type ZakazkaDnes,
} from "../../lib/dnes";

/**
 * Data pro stránku Dnes.
 *
 * Zakázky v paměti mají jen Zakázky (jejich vlastní stav) a ty nečtou
 * termín dokončení – proto si Dnes čte sám, ale jen **rozpracované**
 * zakázky (bez koncových stavů) a jen sloupce, které potřebuje. Žádné nové
 * RPC: tabulky tickets, bookings a objednávky dílů přes RLS, nepřečtené
 * zprávy přes existující chat_neprectene.
 *
 * Realtime: změna zakázky se propíše rovnou z řádku, který přijde (INSERT
 * i UPDATE nesou celý řádek), bez nového dotazu. Kanály mají vlastní
 * jména – supabase-js při stejném názvu vrátí už přihlášený kanál Kalendáře
 * nebo chatu a nový odběr by se k němu nepřidal.
 *
 * Stránka se načítá až při první návštěvě (App ji do té doby nemountuje).
 */

const SLOUPCE = "id,code,title,status,customer_name,created_at,updated_at,expected_completion_at,assigned_to,branch_id,location_branch_id";
/** Stav cenové nabídky je portálový sloupec – stará databáze ho nemusí mít. */
const SLOUPCE_S_NABIDKOU = `${SLOUPCE},quote_status`;
/** Stejné sloupce jako lib/rezervace – příjem se z nich předvyplní. */
const SLOUPCE_REZERVACI = "id, service_id, status, customer_name, customer_phone, customer_email, device_label, repair_name, repair_id, repair_ids, model_name, price_estimate, duration_min, note, preferred_at, ticket_id, created_at";
/** Pojistka, kdyby realtime zprávu ztratil. */
const OBNOVA_MS = 5 * 60_000;

export type KanalSNeprectenymi = { kanal: string; nazev: string; pocet: number; avatarUrl: string | null };

/** Hodnota pro PostgREST `in.(…)`: klíče v uvozovkách, ať projde i čárka nebo závorka. */
function seznamProIn(klice: readonly string[]): string {
  return `(${klice.map((k) => `"${k.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")})`;
}

// Dotazy na tabulky mimo vygenerované typy (bookings, objednávky) – jako jinde v aplikaci.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Dotaz = any;

export function useDnesData({
  serviceId,
  koncoveStavy,
  stavyNacteny,
  chatZapnuty,
}: {
  serviceId: string | null;
  /** Klíče koncových stavů – takové zakázky se vůbec nestahují. */
  koncoveStavy: readonly string[];
  /** Dokud stavy nejsou, nevíme, co je koncové – čekat, ať se nestáhne celá historie. */
  stavyNacteny: boolean;
  chatZapnuty: boolean;
}) {
  const [zakazky, setZakazky] = useState<ZakazkaDnes[]>([]);
  const [dilNaCeste, setDilNaCeste] = useState<Set<string>>(() => new Set());
  /* Celé řádky (jako lib/rezervace), ať z nich jde rovnou založit zakázku. */
  const [rezervace, setRezervace] = useState<Rezervace[]>([]);
  const [neprectene, setNeprectene] = useState<KanalSNeprectenymi[]>([]);
  const [nacitam, setNacitam] = useState(true);
  const [chyba, setChyba] = useState<string | null>(null);

  const koncoveKlic = koncoveStavy.join("\u0001");
  const koncoveRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    koncoveRef.current = new Set(koncoveStavy);
    // koncoveKlic nese obsah pole – samotné pole je při každém renderu nové.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [koncoveKlic]);
  const bezNabidkyRef = useRef(false);
  const reqRef = useRef(0);

  /* ---------- Zakázky ---------- */
  const nactiZakazky = useCallback(async () => {
    if (!serviceId || !supabase || !stavyNacteny) return;
    const client = supabase;
    const koncove = koncoveKlic ? koncoveKlic.split("\u0001") : [];
    const muj = ++reqRef.current;
    const stranka = (sloupce: string) => (from: number, to: number) => {
      let q: Dotaz = (client.from("tickets") as Dotaz).select(sloupce).eq("service_id", serviceId).is("deleted_at", null);
      if (koncove.length > 0) q = q.not("status", "in", seznamProIn(koncove));
      return q.order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, to);
    };
    try {
      let vysledek = await fetchAllPages<Record<string, unknown>>(stranka(bezNabidkyRef.current ? SLOUPCE : SLOUPCE_S_NABIDKOU));
      // 42703 = neznámý sloupec: databáze bez portálu. Zkusit bez nabídky a pamatovat si to.
      if (vysledek.error && (vysledek.error as { code?: string }).code === "42703" && !bezNabidkyRef.current) {
        bezNabidkyRef.current = true;
        vysledek = await fetchAllPages<Record<string, unknown>>(stranka(SLOUPCE));
      }
      if (muj !== reqRef.current) return;
      if (vysledek.error) throw vysledek.error;
      setZakazky(vysledek.data.map(mapujZakazkuDnes));
      setChyba(null);
    } catch (error) {
      if (muj !== reqRef.current) return;
      reportSilent({ code: "dnes.tickets_failed", error, source: "Dnes", serviceId });
      setChyba("Zakázky se nepodařilo načíst. Zkuste to za chvíli znovu.");
    } finally {
      if (muj === reqRef.current) setNacitam(false);
    }
  }, [serviceId, stavyNacteny, koncoveKlic]);

  /* ---------- Díly na cestě (objednávky s vazbou na zakázku) ---------- */
  const nactiDily = useCallback(async () => {
    if (!serviceId || !supabase) return;
    const client = supabase;
    try {
      const obj = await (client.from("inventory_purchase_orders") as Dotaz)
        .select("id,status")
        .eq("service_id", serviceId)
        .in("status", ["draft", "ordered"]);
      if (obj.error) throw obj.error;
      const stavObjednavky = new Map<string, string>(((obj.data ?? []) as Array<{ id: string; status: string }>).map((o) => [o.id, o.status]));
      if (stavObjednavky.size === 0) {
        setDilNaCeste((prev) => (prev.size === 0 ? prev : new Set()));
        return;
      }
      const pol = await (client.from("inventory_purchase_order_items") as Dotaz)
        .select("order_id,ticket_id,qty,received_qty")
        .in("order_id", [...stavObjednavky.keys()])
        .not("ticket_id", "is", null);
      if (pol.error) throw pol.error;
      const polozky: PolozkaObjednavkyDnes[] = ((pol.data ?? []) as Array<Record<string, unknown>>).map((p) => ({
        ticketId: typeof p.ticket_id === "string" ? p.ticket_id : null,
        qty: Number(p.qty) || 0,
        receivedQty: Number(p.received_qty) || 0,
        orderStatus: stavObjednavky.get(String(p.order_id)) ?? "",
      }));
      setDilNaCeste(zakazkySDilemNaCeste(polozky));
    } catch (error) {
      // Objednávky nemusí být na serveru zapnuté nebo je člen nesmí číst –
      // sekce Čeká na díl pak stojí jen na stavech.
      reportSilent({ code: "dnes.parts_failed", error, source: "Dnes", serviceId });
      setDilNaCeste((prev) => (prev.size === 0 ? prev : new Set()));
    }
  }, [serviceId]);

  /* ---------- Rezervace na dnešek ---------- */
  const nactiRezervace = useCallback(async () => {
    if (!serviceId || !supabase) return;
    const od = new Date();
    od.setHours(0, 0, 0, 0);
    const doo = new Date(od);
    doo.setDate(doo.getDate() + 1);
    try {
      const res = await (supabase.from("bookings") as Dotaz)
        .select(SLOUPCE_REZERVACI)
        .eq("service_id", serviceId)
        .in("status", ["new", "confirmed"])
        .gte("preferred_at", od.toISOString())
        .lt("preferred_at", doo.toISOString())
        .order("preferred_at", { ascending: true });
      if (res.error) throw res.error;
      setRezervace((res.data ?? []) as Rezervace[]);
    } catch (error) {
      // Stará databáze bez rezervací – sekce zůstane prázdná.
      reportSilent({ code: "dnes.bookings_failed", error, source: "Dnes", serviceId });
      setRezervace([]);
    }
  }, [serviceId]);

  /* ---------- Nepřečtené v chatu ---------- */
  const nactiChat = useCallback(async () => {
    if (!serviceId || !chatZapnuty) {
      setNeprectene((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    try {
      const pocty = await nactiNeprectene(serviceId);
      if (Object.keys(pocty).length === 0) {
        setNeprectene((prev) => (prev.length === 0 ? prev : []));
        return;
      }
      const kanaly = await nactiKanaly(serviceId);
      const podleKlice = new Map(kanaly.map((k) => [k.kanal, k]));
      setNeprectene(
        Object.entries(pocty)
          .map(([kanal, pocet]) => ({ kanal, pocet, nazev: podleKlice.get(kanal)?.nazev ?? "Chat", avatarUrl: podleKlice.get(kanal)?.avatarUrl ?? null }))
          // Kanál, který už nevidím (odebraná pobočka), se nenabízí.
          .filter((k) => podleKlice.has(k.kanal))
          .sort((a, b) => kanaly.findIndex((k) => k.kanal === a.kanal) - kanaly.findIndex((k) => k.kanal === b.kanal)),
      );
    } catch (error) {
      reportSilent({ code: "dnes.chat_failed", error, source: "Dnes", serviceId });
    }
  }, [serviceId, chatZapnuty]);

  const obnovit = useCallback(() => {
    void nactiZakazky();
    void nactiDily();
    void nactiRezervace();
    void nactiChat();
  }, [nactiZakazky, nactiDily, nactiRezervace, nactiChat]);

  // Přepnutí servisu: nic z předchozího nesmí probleskout.
  useEffect(() => {
    setZakazky([]);
    setRezervace([]);
    setNeprectene([]);
    setDilNaCeste(new Set());
    setNacitam(true);
    setChyba(null);
  }, [serviceId]);

  useEffect(() => { void nactiZakazky(); }, [nactiZakazky]);
  useEffect(() => { void nactiDily(); void nactiRezervace(); }, [nactiDily, nactiRezervace]);
  useEffect(() => { void nactiChat(); }, [nactiChat]);

  /* ---------- Realtime ---------- */
  useEffect(() => {
    if (!serviceId || !supabase) return;
    const client = supabase;
    let casovacChatu: ReturnType<typeof setTimeout> | null = null;
    const kanal = client
      .channel(`dnes:${serviceId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tickets", filter: `service_id=eq.${serviceId}` }, (p: Dotaz) => {
        const typ = p?.eventType as string | undefined;
        if (typ === "DELETE") {
          const id = p?.old?.id;
          if (id) setZakazky((prev) => prev.filter((z) => z.id !== id));
          return;
        }
        const radek = p?.new as Record<string, unknown> | undefined;
        if (!radek?.id) return;
        const pryc = !!radek.deleted_at || koncoveRef.current.has(String(radek.status ?? ""));
        const nova = mapujZakazkuDnes(radek);
        setZakazky((prev) => {
          const bez = prev.filter((z) => z.id !== nova.id);
          return pryc ? (bez.length === prev.length ? prev : bez) : [nova, ...bez];
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings", filter: `service_id=eq.${serviceId}` }, () => void nactiRezervace())
      .on("postgres_changes", { event: "*", schema: "public", table: "inventory_purchase_orders", filter: `service_id=eq.${serviceId}` }, () => void nactiDily())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `service_id=eq.${serviceId}` }, () => {
        // Zprávy chodí po několika – souhrn stačí jednou za chvíli.
        if (casovacChatu) clearTimeout(casovacChatu);
        casovacChatu = setTimeout(() => void nactiChat(), 1500);
      })
      .subscribe();
    return () => {
      if (casovacChatu) clearTimeout(casovacChatu);
      void client.removeChannel(kanal);
    };
  }, [serviceId, nactiRezervace, nactiDily, nactiChat]);

  // Zakázka založená z rezervace (Zakázky ji označí jako převedenou).
  useEffect(() => {
    const na = () => void nactiRezervace();
    window.addEventListener("jobsheet:rezervace-zmena", na);
    return () => window.removeEventListener("jobsheet:rezervace-zmena", na);
  }, [nactiRezervace]);

  /* Pojistky: návrat do okna (přečtené zprávy, změny během spánku počítače)
     a pravidelná obnova, kdyby realtime zprávu ztratil. */
  useEffect(() => {
    let posledni = Date.now();
    const naViditelnost = () => {
      if (document.visibilityState !== "visible") return;
      void nactiChat();
      if (Date.now() - posledni > 60_000) {
        posledni = Date.now();
        obnovit();
      }
    };
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      posledni = Date.now();
      obnovit();
    }, OBNOVA_MS);
    window.addEventListener("focus", naViditelnost);
    document.addEventListener("visibilitychange", naViditelnost);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", naViditelnost);
      document.removeEventListener("visibilitychange", naViditelnost);
    };
  }, [obnovit, nactiChat]);

  return { zakazky, dilNaCeste, rezervace, neprectene, nacitam, chyba, obnovit };
}

/**
 * Přiděluje servis zakázky technikům? (`config.pridelovani_technika`,
 * výchozí zapnuto.) Bez přidělování nemá Dnes přepínač „Jen moje“
 * ani sekci Přidělené mně.
 */
export function usePridelovaniTechnika(serviceId: string | null): boolean {
  const [zapnuto, setZapnuto] = useState(true);
  useEffect(() => {
    if (!serviceId) return;
    let zruseno = false;
    const nacti = () => {
      void loadServiceConfig(serviceId).then((config) => {
        if (!zruseno) setZapnuto((config as { pridelovani_technika?: unknown } | null)?.pridelovani_technika !== false);
      });
    };
    nacti();
    const odhlasit = subscribeServiceConfig(serviceId, (config) => {
      setZapnuto((config as { pridelovani_technika?: unknown } | null)?.pridelovani_technika !== false);
    }, "dnes");
    const naZmenu = (e: Event) => {
      const d = (e as CustomEvent<{ serviceId?: string; patch?: Record<string, unknown> }>).detail;
      if (d?.serviceId === serviceId && d.patch && "pridelovani_technika" in d.patch) nacti();
    };
    window.addEventListener(UDALOST_ZMENY_CONFIGU, naZmenu);
    return () => { zruseno = true; odhlasit(); window.removeEventListener(UDALOST_ZMENY_CONFIGU, naZmenu); };
  }, [serviceId]);
  return zapnuto;
}
