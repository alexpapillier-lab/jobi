/**
 * Načtení zakázek a reklamací servisu (dvě kola u zakázek, realtime obnova
 * reklamací) a zakázky mimo React (cloudTicketsRef) pro okamžité zápisy.
 * Vyneseno z Orders.tsx beze změny obsahu; názvy stavů zůstávají.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { fetchAllPages } from "../../../lib/fetchAllPages";
import { normalizeError } from "../../../utils/errorNormalizer";
import { SLOUPCE_SEZNAMU } from "../../../lib/sloupceZakazky";
import { mapSupabaseTicketToTicketEx } from "../mapovani";
import type { TicketEx } from "../typy";
import type { WarrantyClaimRow } from "./useWarrantyClaims";

/**
 * Kolik zakázek se natáhne v prvním kole.
 *
 * Odpovídá největší nastavitelné velikosti stránky, takže se z první odpovědi
 * dá vykreslit celá první stránka seznamu, ať má uživatel nastavené cokoli.
 * Zbytek dojede na pozadí – bez toho čeká i ten, kdo chce jen otevřít první
 * zakázku shora.
 */
const PRVNI_DAVKA_ZAKAZEK = 200;

export function useNacitaniZakazek(activeServiceId: string | null) {
  const [cloudTickets, setCloudTickets] = useState<TicketEx[]>([]);
  /**
   * Aktuální zakázky mimo React – pro úpravy provedených oprav, které se
   * ukládají hned do databáze. Několik změn za sebou v jednom kliknutí
   * (cena, náklady, čas, díly) musí vidět výsledek té předchozí, a ne stav
   * z posledního vykreslení.
   */
  const cloudTicketsRef = useRef<TicketEx[]>([]);
  cloudTicketsRef.current = cloudTickets;
  /* Pro První kroky: id všech zakázek – karta si z nich podle stopy v configu
     odečte ukázkové, aby „první zakázku“ neodškrtla ukázka. */
  const ticketIds = useMemo(() => cloudTickets.map((t) => t.id), [cloudTickets]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  /** Seznam už jde používat, ale ještě není celý – dotahuje se zbytek stránek. */
  const [ticketsPartial, setTicketsPartial] = useState(false);
  const [ticketsError, setTicketsError] = useState<string | null>(null);
  const [cloudClaims, setCloudClaims] = useState<WarrantyClaimRow[]>([]);
  const [claimsLoading, setClaimsLoading] = useState(false);
  const [claimsError, setClaimsError] = useState<string | null>(null);
  // Refs for race condition protection
  const ticketsReqIdRef = useRef(0);
  const claimsReqIdRef = useRef(0);
  // Load tickets from cloud when activeServiceId changes
  //
  // Čtou se jen sloupce, ze kterých se skládá seznam (SLOUPCE_SEZNAMU).
  // Zbytek – diagnostika, fotky, kontrola po opravě, zápůjčka, adresa –
  // se dotáhne až při otevření konkrétní zakázky. U servisu s 2 100
  // zakázkami tím ze seznamu zmizely přes dva megabajty (docs/ZATEZ.md).
  //
  // Načítá se ve dvou kolech. První dotaz vezme jen PRVNI_DAVKA_ZAKAZEK
  // nejnovějších zakázek – tolik, že první stránka seznamu je z čeho vykreslit –
  // a teprve pak se dotahuje zbytek. U servisu s 4 800 zakázkami se tím první
  // řádek seznamu objevil za 520 ms místo 2 505 ms (medián ze tří běhů,
  // 6. 9. 2026, viz docs/ZATEZ.md oddíl 5).
  // Servis pod dvě stě zakázek pošle pořád jen jeden dotaz.
  useEffect(() => {
    if (!activeServiceId || !supabase) {
        setCloudTickets([]);
      setTicketsLoading(false);
      setTicketsPartial(false);
        setTicketsError(null);
      return;
    }

    const myReqId = ++ticketsReqIdRef.current;

    setTicketsLoading(true);
    setTicketsPartial(false);
    setTicketsError(null);

    const stranka = (from: number, to: number) =>
      (supabase!
        .from("tickets") as any)
        .select(SLOUPCE_SEZNAMU)
        .eq("service_id", activeServiceId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to);

    // `service_id` se nečte – pro celý seznam je stejné a v každém řádku by to
    // bylo jen uuid navíc po drátě. Doplní se z aktivního servisu, protože
    // podle něj se pak tisknou dokumenty a otevírá SMS.
    const doZakazky = (r: any): TicketEx => mapSupabaseTicketToTicketEx({ ...r, service_id: activeServiceId });

    /* Zakázka, kterou si detail mezitím dotáhl celou, se nesmí vrátit na
       sloupce seznamu – druhé kolo dojíždí vteřiny po prvním a uživatel už
       může mít detail otevřený. */
    const zachovejDotazene = (nove: TicketEx[], prev: TicketEx[]): TicketEx[] => {
      const plne = new Map(prev.filter((t) => t.uplna).map((t) => [t.id, t] as const));
      return plne.size === 0 ? nove : nove.map((t) => plne.get(t.id) ?? t);
    };

    const loadTickets = async () => {
      try {
        const { data: prvni, error: chybaPrvni } = await stranka(0, PRVNI_DAVKA_ZAKAZEK - 1);

        // Check if this request is still valid
        if (myReqId !== ticketsReqIdRef.current) {
          return; // This request is stale, ignore it
        }
        if (chybaPrvni) throw chybaPrvni;

        const prvniRadky: any[] = prvni ?? [];
        setCloudTickets((prev) => zachovejDotazene(prvniRadky.map(doZakazky), prev));
        setTicketsLoading(false);

        // Kratší odpověď = servis nemá víc zakázek, druhé kolo nemá co dotáhnout.
        if (prvniRadky.length < PRVNI_DAVKA_ZAKAZEK) {
          setTicketsPartial(false);
          return;
        }

        // Seznam je od téhle chvíle použitelný, ale ještě není celý – hledání
        // a počty by na neúplných datech lhaly, proto se to dá poznat zvenčí.
        setTicketsPartial(true);
        const { data, error } = await fetchAllPages((from, to) =>
          stranka(PRVNI_DAVKA_ZAKAZEK + from, PRVNI_DAVKA_ZAKAZEK + to)
        );

        if (myReqId !== ticketsReqIdRef.current) return;
        if (error) throw error;

        const zbytek: any[] = data ?? [];
        setCloudTickets((prev) => zachovejDotazene([...prvniRadky, ...zbytek].map(doZakazky), prev));
        setTicketsPartial(false);
      } catch (err) {
        // Check if this request is still valid before setting error
        if (myReqId !== ticketsReqIdRef.current) {
          return; // This request is stale, ignore it
        }
        console.error("[Orders] Error loading tickets:", err);
        setTicketsError(normalizeError(err) || "Neznámá chyba při načítání zakázek");
        setCloudTickets([]);
        setTicketsLoading(false);
        setTicketsPartial(false);
      }
    };

    loadTickets();

    return () => {
      ticketsReqIdRef.current++;
    };
  }, [activeServiceId, supabase]);

  // Load warranty claims when activeServiceId changes
  useEffect(() => {
    if (!activeServiceId || !supabase) {
      setCloudClaims([]);
      setClaimsLoading(false);
      setClaimsError(null);
      return;
    }
    const myReqId = ++claimsReqIdRef.current;
    const client = supabase;
    setClaimsLoading(true);
    setClaimsError(null);
    const loadClaims = async () => {
      if (!client) return;
      try {
        const { data, error } = await fetchAllPages<WarrantyClaimRow>((from, to) =>
          (client
            .from("warranty_claims") as any)
            .select("*")
            .eq("service_id", activeServiceId)
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .range(from, to)
        );
        if (myReqId !== claimsReqIdRef.current) return;
        if (error) throw error;
        setCloudClaims(data ?? []);
      } catch (err) {
        if (myReqId !== claimsReqIdRef.current) return;
        setClaimsError(normalizeError(err) || "Chyba při načítání reklamací");
        setCloudClaims([]);
      } finally {
        if (myReqId === claimsReqIdRef.current) setClaimsLoading(false);
      }
    };
    loadClaims();
    return () => { claimsReqIdRef.current++; };
  }, [activeServiceId, supabase]);
  const refetchClaims = useCallback(async () => {
    if (!activeServiceId || !supabase) return;
    const { data, error } = await fetchAllPages<WarrantyClaimRow>((from, to) =>
      (supabase!.from("warranty_claims") as any)
        .select("*")
        .eq("service_id", activeServiceId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to)
    );
    if (!error && data) setCloudClaims(data);
  }, [activeServiceId, supabase]);
  // Realtime subscription for warranty_claims
  useEffect(() => {
    if (!activeServiceId || !supabase) return;
    const topic = `warranty_claims:${activeServiceId}`;
    const client = supabase;
    const channel = client
      .channel(topic)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "warranty_claims", filter: `service_id=eq.${activeServiceId}` },
        () => refetchClaims()
      )
      .subscribe();
    return () => {
      if (client) client.removeChannel(channel);
    };
  }, [activeServiceId, supabase, refetchClaims]);

  return {
    cloudTickets,
    setCloudTickets,
    cloudTicketsRef,
    ticketIds,
    ticketsLoading,
    ticketsPartial,
    ticketsError,
    cloudClaims,
    setCloudClaims,
    claimsLoading,
    claimsError,
    refetchClaims,
  };
}
