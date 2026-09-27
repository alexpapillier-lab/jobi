import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useIsNarrow } from "../hooks/useIsNarrow";
import { useStatuses } from "../state/StatusesStore";
import { useServiceVat } from "../hooks/useServiceVat";
import { TicketComments, type TicketCardData, type TicketComment } from "../components/tickets";
import { computeFinalPrice } from "../components/tickets/types";
import { showToast } from "../components/Toast";
import { reportError } from "../lib/reportError";
import { claimDocumentData } from "../lib/documentData";
import { normalizeError } from "../utils/errorNormalizer";
import type { NavKey } from "../layout/Sidebar";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { StornoDialog } from "../components/orders/StornoDialog";
import { supabase, supabaseUrl, supabaseAnonKey, supabaseFetch } from "../lib/supabaseClient";
import { typedSupabase, getTypedSupabaseClient } from "../lib/typedSupabase";
import { devLog } from "../lib/devLog";
import { ulozNaPozdeji, jeTrvalaChyba } from "../lib/frontaZapisu";
import { subscribeServiceConfig } from "../lib/serviceSettingsSync";
import { fetchAllPages } from "../lib/fetchAllPages";
import { usePodepsaneFotky } from "../hooks/usePodepsaneFotky";
import { normalizePhone } from "../lib/phone";
import { STORAGE_KEYS } from "../constants/storageKeys";
import { useOrderActions } from "./Orders/hooks/useOrderActions";
import { useStatusActionsMap, runStatusChangeAutomations, runTicketCreatedAutomations } from "./Orders/hooks/useAutomations";
import { type WarrantyClaimRow, useWarrantyClaims } from "./Orders/hooks/useWarrantyClaims";
import { CreateWarrantyClaimModal } from "./Orders/components/CreateWarrantyClaimModal";
import { useAuth } from "../auth/AuthProvider";
import { useUserProfile } from "../hooks/useUserProfile";
import { isWeb } from "../lib/platform";
import { useFoceniNaTelefonu } from "../hooks/useFoceniNaTelefonu";
import { type PerformedRepair } from "../components/orders/types";
import { loadInventoryFromDb, type Product as SkladProdukt } from "../lib/inventoryDb";
import { useClenoveServisu } from "../hooks/useClenoveServisu";
import { VYCHOZI_ZAOKROUHLENI_PRACE, normalizujZaokrouhleni } from "../lib/usekyPrace";
import { type NahradniZarizeni, type ZapujckaData, normalizujNahradni } from "../lib/zapujcka";
import { chybiPodkladZaruky } from "../lib/zarizeniHistorie";
import { SLOUPCE_SEZNAMU, SLOUPCE_DETAILU } from "../lib/sloupceZakazky";
import { nastavStavRezervace } from "../lib/rezervace";
import { type KontrolaPoOpraveData, type SablonaKontroly, normalizujSablony } from "../lib/kontrolniSeznamy";
import { sloucZakazkuZDb, zacniZapis, ukonciZapis, type EvidenceZapisu } from "../lib/slouceniZakazky";
import { sjetNaKartu } from "../components/orders/PostupZakazky";
import { useSbaleno } from "../components/orders/SbalitelnaSekce";
import { normalizujSlevy, type PrednastavenaSleva } from "../lib/prednastaveneSlevy";
import { normalizujOdmeny, vychoziNabidnuto, type PravidloOdmeny } from "../lib/odmeny";
import { poZmeneOprav, soucetOprav } from "../lib/cenaPriPrijmu";
import { normalizujSkryteSekce, type SkrytelnaSekce } from "../lib/sekceDetailu";
import { dniBezZmenyJinde, normalizujNastaveniZasilek, stitekUmisteni, umisteniZakazky, type NastaveniZasilek, type Zasilka } from "../lib/zasilky";
import { ensurePortalToken, portalUrl } from "../lib/portal";
import { useBranches, filterByBranch } from "../context/BranchContext";
import { setTicketBranch, type Branch } from "../lib/branches";
import { BranchPickerDialog } from "../components/orders/BranchPickerDialog";
import { loadDevicesFromDb } from "../lib/devicesDb";
import {
  type DevicesData,
  type InventoryData,
  type DeviceRepair,
  safeLoadDevicesData,
} from "../lib/catalogStorage";
import {
  reserveForRepair,
  releaseReservations,
  consumeTicketReservations,
  loadTicketReservations,
  loadReservations,
  loadTicketOrderItems,
  jenUuid,
  type TicketReservation,
  type TicketOrderItem,
  type ReserveShortage,
} from "../lib/purchaseOrders";
import {
  type CustomerMatch,
} from "../components/orders";
import { useActiveRole } from "../hooks/useActiveRole";
import { smsDoNotNotifyRef } from "../hooks/useSmsNotifications";
import { registerShortcut } from "../lib/keyboardShortcuts";
import { safeLoadCompanyData, doplnFiremniUdajeZDb } from "../lib/companyData";
import { useTicketViewers, useTicketViewersMap, setPresenceTicket } from "../lib/presence";
import { type StatusFilterOption } from "../components/orders/StatusFilter";
import {
  loadDocumentsConfigFromDB,
  safeLoadDocumentsConfig,
} from "../lib/documentHelpers";

import {
  type GroupKey,
  type ClaimsSubGroup,
  type UIConfig,
  type OrdersProps,
  type TicketEx,
  type NewOrderDraft,
  type ModelWithHierarchy,
} from "./Orders/typy";
import { safeLoadUIConfig } from "./Orders/uiConfig";
import {
  NEW_ORDER_MORE_OPEN_KEY,
  NEW_ORDER_DEVICE_MORE_OPEN_KEY,
  NEW_ORDER_CUSTOMER_MORE_OPEN_KEY,
  safeLoadDraft,
  safeSaveDraft,
  defaultDraft,
  isDraftDirty,
} from "./Orders/koncept";
import { isEmailValid, isPhoneValid, isZipValid, isIcoValid } from "./Orders/formatovani";
import { type SupabaseTicketCommentRow, mapSupabaseCommentRow, mapSupabaseTicketToTicketEx } from "./Orders/mapovani";
import { type ClaimResolutionItem, parseClaimResolutionItems, serializeClaimResolutionItems } from "./Orders/reklamaceZakroky";
import {
  type DocMode,
  runWebDocument,
  runDesktopDocument,
  printTicket,
  printWarranty,
} from "./Orders/tiskZakazky";
import { baseFieldTextArea, card } from "./Orders/styly";
import { SmsPanel } from "./Orders/SmsPanel";
import { HistorieZakazkyModal } from "./Orders/HistorieZakazkyModal";
import { HistorieReklamaceModal } from "./Orders/HistorieReklamaceModal";
import { CaptureQrModal } from "./Orders/CaptureQrModal";
import { FotoLightbox } from "./Orders/FotoLightbox";
import { RychlyTiskNabidka } from "./Orders/RychlyTiskNabidka";
import { useHistorieZakazky } from "./Orders/hooks/useHistorieZakazky";
import { useHistorieReklamace } from "./Orders/hooks/useHistorieReklamace";
import { SeznamZakazek } from "./Orders/SeznamZakazek";
import { NovaZakazkaPanel } from "./Orders/NovaZakazkaPanel";
import { DetailZakazky } from "./Orders/DetailZakazky";
import { DetailHlavicka } from "./Orders/DetailHlavicka";
import { DetailReklamace } from "./Orders/DetailReklamace";
import { DetailPrehled } from "./Orders/DetailPrehled";
import { UpravaZakazky } from "./Orders/UpravaZakazky";
import { DetailDalsiKarty } from "./Orders/DetailDalsiKarty";
import { DetailOpravy } from "./Orders/DetailOpravy";
import { DetailDiagnostika } from "./Orders/DetailDiagnostika";

export { safeLoadCompanyData } from "../lib/companyData";
export { safeLoadDocumentsConfig } from "../lib/documentHelpers";
// Veřejné exporty, které používá App.tsx, Calendar, Statistics, lib/documentData a testy – zůstávají tady.
export type { TicketEx } from "./Orders/typy";
export { mapSupabaseTicketToTicketEx } from "./Orders/mapovani";



/**
 * Kolik zakázek se natáhne v prvním kole.
 *
 * Odpovídá největší nastavitelné velikosti stránky, takže se z první odpovědi
 * dá vykreslit celá první stránka seznamu, ať má uživatel nastavené cokoli.
 * Zbytek dojede na pozadí – bez toho čeká i ten, kdo chce jen otevřít první
 * zakázku shora.
 */
const PRVNI_DAVKA_ZAKAZEK = 200;
/** Sbalené sekce v detailu zakázky – stav se pamatuje na zařízení. */
const DETAIL_PORTAL_OPEN_KEY = "jobsheet_detail_portal_open_v1";
const DETAIL_DIAGNOSTIKA_OPEN_KEY = "jobsheet_detail_diagnostika_open_v1";
export default function Orders({
  activeServiceId,
  serviceName = null,
  newOrderPrefill,
  onNewOrderPrefillConsumed,
  openTicketIntent,
  onOpenTicketIntentConsumed,
  smsPanelTicketIdRef,
  openClaimIntent,
  onOpenClaimIntentConsumed,
  onOpenCustomer,
  onReturnToPage,
  onCreateInvoice,
  onOpenInvoice,
  closeDetailWhen,
  smsEnabled = false,
}: OrdersProps) {
  const isNarrow = useIsNarrow();
  const naTelefonu = useFoceniNaTelefonu();
  const { statuses, loading: statusesLoading, error: statusesError, getByKey, isFinal, fallbackKey } = useStatuses();
  const dph = useServiceVat(activeServiceId);
  const { session } = useAuth();
  const { profile: userProfile } = useUserProfile();
  const { hasCapability, isAdmin } = useActiveRole(activeServiceId);
  const canPrintExport = hasCapability("can_print_export");

  const [uiCfg, setUiCfg] = useState<UIConfig>(() => safeLoadUIConfig());
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
  /** Zápisy provedených oprav, které ještě běží nebo čekají na odklad – podle zakázky. */
  const rozpracovaneZapisyOpravRef = useRef<Map<string, number>>(new Map());
  const odlozeneZapisyOpravRef = useRef<Map<string, { casovac: ReturnType<typeof setTimeout>; proved: () => void }>>(new Map());
  /**
   * Zakázky, kterým okamžitý zápis oprav selhal – opravy jsou jen v paměti
   * a uloží se při zavření detailu. Do té doby je realtime nesmí přepsat,
   * jinak by po nich zůstala jen rezervace dílů ve skladu.
   */
  const neulozeneOpravyRef = useRef<Set<string>>(new Set());
  /** Evidence pro sloučení řádku z databáze s pamětí – viz src/lib/slouceniZakazky.ts. */
  const evidenceZapisu = useCallback(
    (): EvidenceZapisu => ({
      bezici: rozpracovaneZapisyOpravRef.current,
      odlozene: odlozeneZapisyOpravRef.current,
      neulozene: neulozeneOpravyRef.current,
    }),
    []
  );
  /** Odložené zápisy kontroly po opravě – psaní poznámky jinak posílá zápis na každou klávesu. */
  const odlozenaKontrolaRef = useRef<Map<string, { casovac: ReturnType<typeof setTimeout>; proved: () => void }>>(new Map());
  const [ticketsLoading, setTicketsLoading] = useState(false);
  /** Seznam už jde používat, ale ještě není celý – dotahuje se zbytek stránek. */
  const [ticketsPartial, setTicketsPartial] = useState(false);
  const [ticketsError, setTicketsError] = useState<string | null>(null);
  const [cloudClaims, setCloudClaims] = useState<WarrantyClaimRow[]>([]);
  const [claimsLoading, setClaimsLoading] = useState(false);
  const [claimsError, setClaimsError] = useState<string | null>(null);
  const [commentsByTicket, setCommentsByTicket] = useState<Record<string, TicketComment[]>>({});
  /** Živé profily autorů komentářů (fotka a přezdívka) – viz TicketComments. */
  const [commentAuthorProfiles, setCommentAuthorProfiles] = useState<Record<string, { nickname: string | null; avatarUrl: string | null }>>({});

  const [, setDocumentsConfig] = useState<any>(() => safeLoadDocumentsConfig());

  // Refs for race condition protection
  const ticketsReqIdRef = useRef(0);
  const claimsReqIdRef = useRef(0);
  const commentsReqIdRef = useRef(0);
  const docsReqIdRef = useRef(0);
  const activeServiceIdRef = useRef<string | null>(activeServiceId);
  
  // Keep activeServiceIdRef in sync
  useEffect(() => {
    activeServiceIdRef.current = activeServiceId;
  }, [activeServiceId]);
  
  // Load documents config from DB when activeServiceId changes
  useEffect(() => {
    if (!activeServiceId || !supabase) {
      return;
    }
    
    const myReqId = ++docsReqIdRef.current;
    
    const loadConfig = async () => {
      const dbConfig = await loadDocumentsConfigFromDB(activeServiceId);
      
      // Check if this request is still valid
      if (myReqId !== docsReqIdRef.current) {
        return; // This request is stale, ignore it
      }
      
      if (dbConfig) {
        setDocumentsConfig(dbConfig);
      }
    };
    
    loadConfig().catch((err) => {
      console.error("[Orders] Error loading documents config:", err);
    });

    /* Firemní údaje pro tisk se berou z kopie v prohlížeči, a tu zapisuje
       jen obrazovka Nastavení. Kdo ji nikdy neotevřel (nový zákazník, druhý
       počítač), tiskl zakázkový list bez názvu servisu. Doplní se z databáze,
       kde je od založení servisu. */
    void doplnFiremniUdajeZDb(activeServiceId).catch((err) => {
      console.error("[Orders] Firemní údaje se nedoplnily:", err);
    });

    return () => {
      docsReqIdRef.current++;
    };
  }, [activeServiceId]);

  // Realtime subscription for service_document_settings
  useEffect(() => {
    if (!activeServiceId || !supabase) return;

    const topic = `service_document_settings:${activeServiceId}`;
    devLog("[RT] subscribe", topic, new Date().toISOString());

    const channel = supabase
      .channel(topic)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "service_document_settings",
          filter: `service_id=eq.${activeServiceId}`,
        },
        async (payload) => {
          devLog("[Orders] service_document_settings changed", payload);
          // Use ref to get current activeServiceId (not closure value)
          const sid = activeServiceIdRef.current;
          if (!sid) return;
          
          // Reload config from DB
          const dbConfig = await loadDocumentsConfigFromDB(sid);
          if (dbConfig) {
            setDocumentsConfig(dbConfig);
            // Sync to localStorage as fallback
            localStorage.setItem(STORAGE_KEYS.DOCUMENTS_CONFIG, JSON.stringify(dbConfig));
          }
        }
      )
      .subscribe();

    return () => {
      devLog("[RT] unsubscribe", topic, new Date().toISOString());
      if (supabase) {
        supabase.removeChannel(channel);
      }
    };
  }, [activeServiceId]);

  /* Nastavení servisu do stavu stránky. Jedno místo pro první načtení,
     ruční událost i realtime – dřív to byly dvě skoro stejné kopie a na
     realtime se zapomnělo. Kvůli tomu se nově přidané náhradní zařízení
     v otevřené aplikaci v detailu zakázky vůbec neobjevilo: stránka
     Zakázky zůstává připojená a config si nikdy znovu nenačetla. */
  const pouzijConfigServisu = useCallback((config: any) => {
    setOrdersShowClaimsInList(!!config?.orders_show_claims_in_list);
    setHodinovaSazba(typeof config?.hodinova_sazba === "number" ? config.hodinova_sazba : null);
    setZaokrouhleniPrace(normalizujZaokrouhleni(config?.zaokrouhleni_prace));
    setKontrolniSeznamy(normalizujSablony(config?.kontrolniSeznamy));
    setNahradniZarizeni(normalizujNahradni(config?.nahradniZarizeni));
    setCasNaOpraveZapnuto(config?.cas_na_oprave === true);
    setPridelovaniTechnika(config?.pridelovani_technika !== false);
    setChatZapnuty(config?.chat !== false);
    setPrednastaveneSlevy(normalizujSlevy(config?.prednastavene_slevy));
    setPravidlaOdmen(normalizujOdmeny(config?.odmeny).pravidla.filter((p) => p.aktivni));
    setSkryteSekce(normalizujSkryteSekce(config?.skryte_sekce_detailu));
    setZasilkyZapnuty(config?.zasilky === true);
    setNastaveniZasilek(normalizujNastaveniZasilek(config ?? undefined));
  }, []);

  const nactiConfigServisu = useCallback(() => {
    if (!activeServiceId || !supabase) return;
    (supabase.from("service_settings") as any)
      .select("config")
      .eq("service_id", activeServiceId)
      .maybeSingle()
      .then(({ data }: any) => pouzijConfigServisu(data?.config))
      .catch(() => {});
  }, [activeServiceId, pouzijConfigServisu]);

  useEffect(() => {
    if (!activeServiceId || !supabase) {
      setOrdersShowClaimsInList(false);
      return;
    }
    nactiConfigServisu();
  }, [activeServiceId, nactiConfigServisu]);

  useEffect(() => {
    window.addEventListener("jobsheet:ui-updated" as any, nactiConfigServisu);
    return () => window.removeEventListener("jobsheet:ui-updated" as any, nactiConfigServisu);
  }, [nactiConfigServisu]);

  // Změna nastavení odjinud (jiný počítač, druhá záložka, kolega) se projeví hned.
  useEffect(() => {
    if (!activeServiceId) return;
    return subscribeServiceConfig(activeServiceId, (config) => pouzijConfigServisu(config), "orders");
  }, [activeServiceId, pouzijConfigServisu]);

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

  // Interní komentáře (chat) k zakázkám – dřív jen v localStorage, teď sdílená
  // tabulka ticket_comments.
  //
  // Dřív se natáhly komentáře **celého servisu** a seskupily podle ticket_id.
  // Vidět je přitom vždycky jen ten jeden otevřený detail: u zátěžového servisu
  // to bylo 6 664 řádků v sedmi kolech po síti kvůli pár řádkům, které si někdo
  // přečte. Načítají se proto ke konkrétní zakázce – ze čtyřiceti osmi dotazů
  // při otevření seznamu zakázek tím ubylo sedm (6. 9. 2026, docs/ZATEZ.md).
  const nactiKomentare = useCallback(async (ticketIds: string[]) => {
    if (!activeServiceId || !supabase || ticketIds.length === 0) return;
    const myReqId = ++commentsReqIdRef.current;
    const { data, error } = await fetchAllPages<SupabaseTicketCommentRow>((from, to) =>
      (supabase!.from("ticket_comments") as any)
        .select("id,ticket_id,author,author_id,author_nickname,author_avatar_url,content,pinned,created_at")
        .eq("service_id", activeServiceId)
        .in("ticket_id", ticketIds)
        .order("created_at", { ascending: true })
        .range(from, to)
    );
    if (myReqId !== commentsReqIdRef.current) return;
    if (error) {
      console.error("[Orders] Error loading ticket comments:", error);
      return;
    }
    // Prázdné pole pro každou dotázanou zakázku: bez něj by se u zakázky, ze
    // které někdo poslední komentář smazal, ukazoval starý obsah z paměti.
    const grouped: Record<string, TicketComment[]> = {};
    for (const id of ticketIds) grouped[id] = [];
    for (const row of data) {
      const c = mapSupabaseCommentRow(row);
      (grouped[c.ticketId] ??= []).push(c);
    }
    setCommentsByTicket((prev) => ({ ...prev, ...grouped }));
  }, [activeServiceId, supabase]);

  /** Zakázky, jejichž komentáře jsou zrovna na obrazovce – kvůli realtime obnově. */
  const otevreneKomentareRef = useRef<string[]>([]);

  // Přepnutí servisu musí komentáře zahodit, jinak by v novém servisu chvíli
  // svítily cizí. (Dřív to zařizovalo hromadné načtení celého servisu.)
  useEffect(() => {
    setCommentsByTicket({});
    otevreneKomentareRef.current = [];
    return () => { commentsReqIdRef.current++; };
  }, [activeServiceId]);

  // Realtime subscription for ticket_comments – ať se nové/připnuté komentáře
  // objeví u všech kolegů na všech zařízeních, ne jen tam, kde vznikly.
  useEffect(() => {
    if (!activeServiceId || !supabase) return;
    const topic = `ticket_comments:${activeServiceId}`;
    const client = supabase;
    const channel = client
      .channel(topic)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ticket_comments", filter: `service_id=eq.${activeServiceId}` },
        () => void nactiKomentare(otevreneKomentareRef.current)
      )
      .subscribe();
    return () => {
      if (client) client.removeChannel(channel);
    };
  }, [activeServiceId, supabase, nactiKomentare]);

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

  const { updateClaimStatus, updateClaim, deleteClaim } = useWarrantyClaims(activeServiceId);

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

  // State declarations (moved up to fix dependency order)
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailClaimId, setDetailClaimId] = useState<string | null>(null);
  const ticketViewers = useTicketViewers(activeServiceId, detailId, session?.user?.id ?? null);
  const viewersByTicket = useTicketViewersMap(activeServiceId, session?.user?.id ?? null);
  // Kolegům se ukáže, že tuhle zakázku máme otevřenou.
  useEffect(() => {
    setPresenceTicket(detailId);
    return () => setPresenceTicket(null);
  }, [detailId]);

  // Rezervace dílů otevřené zakázky (řádek „Díly: …“ pod provedenými opravami).
  // Klíčované id zakázky, aby pozdní odpověď nepřepsala data jiné zakázky.
  const [ticketReservations, setTicketReservations] = useState<{ ticketId: string | null; rows: TicketReservation[] }>({ ticketId: null, rows: [] });
  const refreshTicketReservations = useCallback(async (ticketId: string) => {
    const rows = await loadTicketReservations(ticketId);
    if (!rows) return;
    // Volá se po vlastní akci na otevřené zakázce; render si stejně hlídá shodu ticketId.
    setTicketReservations({ ticketId, rows });
  }, []);
  useEffect(() => {
    if (!detailId) return;
    let cancelled = false;
    void loadTicketReservations(detailId).then((rows) => {
      if (cancelled || !rows) return;
      setTicketReservations({ ticketId: detailId, rows });
    });
    return () => {
      cancelled = true;
    };
  }, [detailId]);

  /** Jedno upozornění na díly, které po rezervaci nejsou skladem. Není to chyba – zakázka jde dál. */
  const toastReserveShortages = useCallback((shortages: ReserveShortage[]) => {
    if (shortages.length === 0) return;
    const text = shortages
      .map((s) => `Díl „${s.name}“ není skladem (rezervováno ${s.reservedTotal}, skladem ${s.stock})`)
      .join("; ");
    showToast(text, "info");
  }, []);

  /** Zarezervuje díly jedné opravy na zakázce; tiché, když RPC na serveru není. */
  const reserveEntryProducts = useCallback(
    async (ticketId: string, entryId: string, productIds: string[] | undefined) => {
      const ids = jenUuid(productIds);
      if (ids.length === 0) return null;
      const res = await reserveForRepair(ticketId, entryId, ids);
      if (res && res.reserved > 0) void refreshTicketReservations(ticketId);
      return res;
    },
    [refreshTicketReservations]
  );
  const [isEditing, setIsEditing] = useState(false);
  const [diagnosticPhotosUploading, setDiagnosticPhotosUploading] = useState(false);
  const [captureQRItems, setCaptureQRItems] = useState<Array<{ deviceLabel: string; url: string }> | null>(null);
  const [captureQRLoading, setCaptureQRLoading] = useState(false);
  const newOrderPhotosBeforeInputRef = useRef<HTMLInputElement>(null);
  const draftCaptureTokenRef = useRef<string | null>(null);
  const [draftCapturePreviewUrls, setDraftCapturePreviewUrls] = useState<string[]>([]);
  const [draftCaptureLiveCount, setDraftCaptureLiveCount] = useState(0);
  const [photoLightbox, setPhotoLightbox] = useState<{ urls: string[]; index: number; ticketCode?: string } | null>(null);
  /* Zvětšenou fotku podepisujeme zvlášť: lightbox drží pole URL zkopírované
     v okamžiku kliknutí, takže by se v něm jinak podpis nikdy neobnovil. */
  const fotkyLightboxu = usePodepsaneFotky(supabase, photoLightbox?.urls ?? null);

  useEffect(() => {
    if (!photoLightbox) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPhotoLightbox(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [photoLightbox]);

  /**
   * Při odchodu na jinou stránku zavřít všechno, co Orders vykresluje portálem.
   *
   * App drží Orders namountované a jen skryté (App.tsx: display: none podle
   * activePage). Potomci uvnitř se skryjí s ním, ale co jde přes createPortal
   * do document.body, tomu skrytí unikne a zůstane viset nad další stránkou.
   * Ověřeno: detail → Historie → Sklad, i tisková nabídka na řádku seznamu.
   *
   * Modaly vykreslené vevnitř (např. CreateWarrantyClaimModal) se schovají
   * samy a rozepsaná data v nich zůstanou – ty tu proto schválně nejsou.
   */
  useEffect(() => {
    if (closeDetailWhen) {
      setDetailId(null);
      setDetailClaimId(null);
      setTicketHistoryModalOpen(false);
      setClaimHistoryModalOpen(false);
      setOpenQuickPrintTicket(null);
      setQuickPrintDropdownRect(null);
      setCaptureQRItems(null);
      setPhotoLightbox(null);
    }
  }, [closeDetailWhen]);

  // Realtime subscription for tickets
  useEffect(() => {
    if (!activeServiceId || !supabase) return;

    const topic = `tickets:${activeServiceId}`;
    devLog("[RT] subscribe", topic, new Date().toISOString());

    const channel = supabase
      .channel(topic)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tickets",
          filter: `service_id=eq.${activeServiceId}`,
        },
        async (payload) => {
          devLog("[Orders] tickets changed", payload);
          
          if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
            devLog("[RT tickets] event", payload.eventType, {
              id: (payload.new as any)?.id,
              service_id: (payload.new as any)?.service_id,
              status: (payload.new as any)?.status,
              updated_at: (payload.new as any)?.updated_at,
            });

            const newTicket = mapSupabaseTicketToTicketEx(payload.new as any);
            const wasDeleted = (payload.old as any)?.deleted_at != null;
            const isDeleted = (payload.new as any)?.deleted_at != null;
            
            // Handle restore: deleted_at changed from not null to null
            if (wasDeleted && !isDeleted) {
              // Ticket was restored - add it back
            setCloudTickets((prev) => {
                const existing = prev.find((t) => t.id === newTicket.id);
                devLog("[RT tickets] setCloudTickets (restore)", {
                  id: newTicket.id,
                  hadExisting: !!existing,
                  prevLen: prev.length,
                  newStatus: newTicket.status,
                });
                if (existing) {
                  // Update existing – stejné sloučení jako u běžné změny níže.
                  const sloucena = sloucZakazkuZDb(existing, newTicket, evidenceZapisu(), newTicket.id);
                  return prev.map((t) => (t.id === newTicket.id ? sloucena : t));
                } else {
                  // Add new - insert in correct position based on created_at
                  const sorted = [...prev, newTicket].sort((a, b) => {
                    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                    return bTime - aTime; // Descending order (newest first)
                  });
                  return sorted;
                }
              });
            } else if (!isDeleted) {
              // Ticket is not deleted - upsert
              setCloudTickets((prev) => {
                const existing = prev.find((t) => t.id === newTicket.id);
                devLog("[RT tickets] setCloudTickets (upsert)", {
                  id: newTicket.id,
                  hadExisting: !!existing,
                  prevLen: prev.length,
                  newStatus: newTicket.status,
                  oldStatus: existing?.status,
                });
                
                // Check if this is the currently edited ticket and if version conflict occurred
                if (existing && isEditing && detailId === newTicket.id) {
                  const existingVersion = existing.version ?? 0;
                  const newVersion = newTicket.version ?? 0;
                  if (newVersion > existingVersion) {
                    // Remote update detected during editing - show banner/toast
                    devLog("[RT tickets] Remote update detected for edited ticket", {
                      ticketId: newTicket.id,
                      existingVersion,
                      newVersion,
                    });
                    showToast("Zakázka se změnila na pozadí", "info");
                  }
                }
                
                if (existing) {
                  // Provedené opravy se ukládají hned; dokud zápis běží, čeká na
                  // odklad, nebo selhal a čeká na zavření detailu, drží se místní
                  // verze. Jinak by změna stavu od kolegy vrátila opravy z databáze,
                  // které jsou o krok pozadu, a ve skladu by zůstala rezervace na
                  // opravu, kterou nikdo nevidí. Stejně se hned ukládá kontrola po
                  // opravě a náhradní zařízení – ozvěna staršího zápisu by přepsala
                  // kliknutí, které přišlo mezitím. Pravidlo: src/lib/slouceniZakazky.ts.
                  const sloucena = sloucZakazkuZDb(existing, newTicket, evidenceZapisu(), newTicket.id);
                  return prev.map((t) => (t.id === newTicket.id ? sloucena : t));
                } else {
                  // Add new - insert in correct position based on created_at
                  const sorted = [...prev, newTicket].sort((a, b) => {
                    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                    return bTime - aTime; // Descending order (newest first)
                  });
                  return sorted;
                }
              });
            } else {
              // Ticket was soft-deleted (deleted_at changed from null to not null)
              setCloudTickets((prev) => prev.filter((t) => t.id !== newTicket.id));
            }
          } else if (payload.eventType === "DELETE") {
            // Hard delete - remove from list
            const deletedId = (payload.old as any)?.id || (payload.new as any)?.id;
            if (deletedId) {
            setCloudTickets((prev) => prev.filter((t) => t.id !== deletedId));
            }
          }
        }
      )
      .subscribe();

    return () => {
      devLog("[RT] unsubscribe", topic, new Date().toISOString());
      if (supabase) {
        supabase.removeChannel(channel);
      }
    };
  }, [activeServiceId, isEditing, detailId]);

  // Cloud mode only: show only cloud tickets
  const { activeBranchId, isMulti: hasBranches, branches, branchById, branchForNew } = useBranches();
  const [moveBranchOpen, setMoveBranchOpen] = useState(false);
  const tickets = useMemo(() => filterByBranch(cloudTickets, activeBranchId), [cloudTickets, activeBranchId]);

  const [activeGroup, setActiveGroup] = useState<GroupKey>("active");
  const [activeStatusKey, setActiveStatusKey] = useState<string | null>(null);
  const [claimsSubGroup, setClaimsSubGroup] = useState<ClaimsSubGroup>("all");

  const [query, setQuery] = useState("");
  const [statusById, setStatusById] = useState<Record<string, string>>({});

  const [isNewOpen, setIsNewOpen] = useState(false);
  const [newDraft, setNewDraft] = useState<NewOrderDraft>(() => safeLoadDraft() ?? defaultDraft());
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [shouldOpenNew, setShouldOpenNew] = useState(false);
  const [matchedCustomer, setMatchedCustomer] = useState<{
    id: string;
    name: string;
    phone?: string;
    email?: string;
    company?: string;
  } | null>(null);
  const [customerMatchDecision, setCustomerMatchDecision] = useState<"undecided" | "accepted" | "rejected">("undecided");
  const lastLookupPhoneNormRef = useRef<string | null>(null);
  const phoneLookupDebounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  /** Sekce „Další údaje“ v nové zakázce – stav se pamatuje v localStorage. */
  const [newOrderMoreOpen, setNewOrderMoreOpen] = useState<boolean>(() => {
    try {
      // Výchozí otevřené – servis při příjmu většinou vyplňuje i IMEI, heslo
      // a stav zařízení; sbalení si pamatujeme, jen když ho uživatel zavře.
      const v = localStorage.getItem(NEW_ORDER_MORE_OPEN_KEY);
      return v === null ? true : v === "1";
    } catch {
      return false;
    }
  });
  /** „Další údaje zařízení“ u každého zařízení v nové zakázce – výchozí otevřené, sbalení se pamatuje. */
  const [newOrderDeviceMoreOpen, setNewOrderDeviceMoreOpen] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(NEW_ORDER_DEVICE_MORE_OPEN_KEY);
      return v === null ? true : v === "1";
    } catch {
      return true;
    }
  });
  /** „Další údaje zákazníka“ (e-mail, firma, adresa, poznámka) v kartě Zákazník – výchozí otevřené, sbalení se pamatuje. */
  const [newOrderCustomerMoreOpen, setNewOrderCustomerMoreOpen] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(NEW_ORDER_CUSTOMER_MORE_OPEN_KEY);
      return v === null ? true : v === "1";
    } catch {
      return true;
    }
  });
  /* Zákaznický portál a Diagnostika v detailu jsou výchozím stavem sbalené –
     při běžné práci se nečtou a odsouvaly opravy a stav o obrazovku níž. */
  const [detailPortalOpen, prepnoutDetailPortal, setDetailPortalOpen] = useSbaleno(DETAIL_PORTAL_OPEN_KEY, false);
  const [detailDiagnostikaOpen, prepnoutDetailDiagnostiku, setDetailDiagnostikaOpen] = useSbaleno(DETAIL_DIAGNOSTIKA_OPEN_KEY, false);
  /** Skok z „Postupu zakázky“ na sbalenou sekci ji nejdřív rozbalí, jinak by se sjelo na prázdnou hlavičku. */
  const sjetNaSbalenouKartu = (id: "detail-portal" | "detail-diagnostika") => {
    if (id === "detail-portal") setDetailPortalOpen(true);
    else setDetailDiagnostikaOpen(true);
    window.setTimeout(() => sjetNaKartu(id), 0);
  };
  /** Které zařízení v nové zakázce je rozbalené (ostatní jsou sbalené karty). */
  const [expandedDeviceIdx, setExpandedDeviceIdx] = useState<number>(0);
  /** Rozbalený úplný seznam oprav z ceníku u zařízení (index → true). */
  const [catalogShowAll, setCatalogShowAll] = useState<Record<number, boolean>>({});
  const createTicketRef = useRef<() => void>(() => {});
  const newOrderBodyRef = useRef<HTMLDivElement | null>(null);
  /**
   * Co se při přepnutí stavu stane automaticky (tisk podle nastavení
   * dokumentů, pravidla automatizací) – ukazuje se v nabídce stavů.
   * Obnovuje se při otevření detailu a každých 5 minut.
   */
  const statusLabelForHint = useCallback((key: string) => getByKey(key)?.label ?? key, [getByKey]);
  const { statusActionsMap, hasRulesFor: hasAutomationRulesFor } = useStatusActionsMap(activeServiceId, detailId, statusLabelForHint);

  const [editedTicket, setEditedTicket] = useState<Partial<TicketEx>>({});
  const [returnToPage, setReturnToPage] = useState<NavKey | null>(null);
  const [matchedCustomerEdit, setMatchedCustomerEdit] = useState<{
    id: string;
    name: string;
    phone?: string;
    email?: string;
    company?: string;
  } | null>(null);
  const returnToCustomerIdRef = useRef<string | undefined>(undefined);
  const originalTicketRef = useRef<TicketEx | null>(null);
  const lastDetailIdRef = useRef<string | null>(null);
  const ticketsLoadHasRunRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const openNewOrderRef = useRef<() => void>(() => {});
  /** Aktuální stav detailu pro `enabled` u zkratek (čte se při stisku, ne při registraci). */
  const detailIdRef = useRef<string | null>(null);
  const isEditingRef = useRef(false);
  const startEditingRef = useRef<() => void>(() => {});
  const saveTicketChangesRef = useRef<() => Promise<boolean>>(async () => false);

  // Dirty tracking for diagnostic text, photos, and performed repairs
  const [dirtyFlags, setDirtyFlags] = useState({
    diagnosticText: false,
    diagnosticPhotos: false,
    performedRepairs: false,
  });

  /** Otázky při stornu: na kterou zakázku a do jakého stavu se čeká na odpověď. */
  const [stornoDotaz, setStornoDotaz] = useState<{ ticketId: string; next: string } | null>(null);
  const [commentDraftByTicket, setCommentDraftByTicket] = useState<Record<string, string>>({});
  const [openQuickPrintTicket, setOpenQuickPrintTicket] = useState<TicketEx | null>(null);
  /** Jen pro přepínání tlačítka na kartě – ať se kvůli němu nepřekresluje celý seznam. */
  const openQuickPrintTicketRef = useRef<TicketEx | null>(null);
  openQuickPrintTicketRef.current = openQuickPrintTicket;
  const [quickPrintDropdownRect, setQuickPrintDropdownRect] = useState<{ top: number; left: number; right: number; height: number } | null>(null);

  const [ordersPage, setOrdersPage] = useState(0);

  // Delete ticket dialog states
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTicketId, setDeleteTicketId] = useState<string | null>(null);
  const [ticketHistoryModalOpen, setTicketHistoryModalOpen] = useState(false);
  const [createClaimModalOpen, setCreateClaimModalOpen] = useState(false);
  /** Zakázka, ze které se reklamace zakládá (z nabídky „…“ v detailu); null = výběr hledáním. */
  const [claimSourceTicket, setClaimSourceTicket] = useState<TicketEx | null>(null);
  const [ordersShowClaimsInList, setOrdersShowClaimsInList] = useState(false);
  /** Hodinová sazba servisu (Kč/h) pro položku „Hodinová práce“; null = nenastavena. */
  const [hodinovaSazba, setHodinovaSazba] = useState<number | null>(null);
  /** Krok zaokrouhlení naměřeného času na hodinovou práci (service_settings.config.zaokrouhleni_prace). */
  const [zaokrouhleniPrace, setZaokrouhleniPrace] = useState<number>(VYCHOZI_ZAOKROUHLENI_PRACE);
  /** Šablony kontroly po opravě (service_settings.config.kontrolniSeznamy, jinak výchozí). */
  const [kontrolniSeznamy, setKontrolniSeznamy] = useState<SablonaKontroly[]>(() => normalizujSablony(undefined));
  /** Stálý seznam náhradních zařízení servisu (service_settings.config.nahradniZarizeni). */
  const [nahradniZarizeni, setNahradniZarizeni] = useState<NahradniZarizeni[]>([]);
  /** Stopky na zakázce – volitelné (service_settings.config.cas_na_oprave). */
  const [casNaOpraveZapnuto, setCasNaOpraveZapnuto] = useState(false);
  /** Přidělování technika (config.pridelovani_technika, výchozí zapnuto). Servis s jedním technikem si ho vypne. */
  const [pridelovaniTechnika, setPridelovaniTechnika] = useState(true);
  /** Přednastavené slevy (config.prednastavene_slevy) – tlačítka u ceny oprav v detailu. */
  const [prednastaveneSlevy, setPrednastaveneSlevy] = useState<PrednastavenaSleva[]>([]);
  /** Aktivní pravidla odměn (config.odmeny) – u opravy, na kterou sedí, se nabízí příznak „nabídnuto navíc“. */
  const [pravidlaOdmen, setPravidlaOdmen] = useState<PravidloOdmeny[]>([]);
  /** Sekce detailu, které si servis vypnul (config.skryte_sekce_detailu). */
  const [skryteSekce, setSkryteSekce] = useState<Set<SkrytelnaSekce>>(() => new Set());
  /** Modul Přesuny mezi pobočkami (config.zasilky): karta „Kde je zakázka“ a štítek místa v seznamu. */
  const [zasilkyZapnuty, setZasilkyZapnuty] = useState(false);
  const [nastaveniZasilek, setNastaveniZasilek] = useState<NastaveniZasilek>(() => normalizujNastaveniZasilek(undefined));
  /** Zásilky otevřené zakázky (dodá karta Kde je zakázka) – pro kroky v Postupu zakázky. */
  const [historieZasilek, setHistorieZasilek] = useState<{ ticketId: string; zasilky: Zasilka[] } | null>(null);
  /** Chat týmu (config.chat) – kvůli položce „Sdílet do chatu“ v detailu. */
  const [chatZapnuty, setChatZapnuty] = useState(true);
  const clenove = useClenoveServisu(activeServiceId, pridelovaniTechnika);
  const [isEditingClaim, setIsEditingClaim] = useState(false);
  const [editedClaim, setEditedClaim] = useState<Partial<WarrantyClaimRow>>({});
  /** Draft zákroků v náhledu reklamace – při změně reklamace se resetuje */
  const [claimResolutionDraft, setClaimResolutionDraft] = useState<ClaimResolutionItem[] | null>(null);
  const [claimHistoryModalOpen, setClaimHistoryModalOpen] = useState(false);
  const [deleteClaimDialogOpen, setDeleteClaimDialogOpen] = useState(false);
  const [deleteClaimId, setDeleteClaimId] = useState<string | null>(null);
  const [smsPanelOpen, setSmsPanelOpen] = useState(false);
  const [smsUnreadCount, setSmsUnreadCount] = useState(0);
  const [smsUnreadByTicketId, setSmsUnreadByTicketId] = useState<Record<string, number>>({});
  const [smsUnreadListBump, setSmsUnreadListBump] = useState(0);
  const [smsActivatedForService, setSmsActivatedForService] = useState(false);
  /** Číslo i modul zároveň – jen tak se SMS smí kdekoli objevit. */
  const smsAvailable = smsActivatedForService && smsEnabled;

  useEffect(() => {
    if (!activeServiceId || !supabase) {
      setSmsActivatedForService(false);
      return;
    }
    supabase
      .from("service_phone_numbers")
      .select("id")
      .eq("service_id", activeServiceId)
      .eq("active", true)
      .maybeSingle()
      .then(({ data }) => setSmsActivatedForService(!!data));
  }, [activeServiceId]);

  // Sync ref for SMS notifications: when SMS panel is open for a ticket, don't show OS notification for that ticket
  useEffect(() => {
    if (smsPanelTicketIdRef) {
      smsPanelTicketIdRef.current = smsPanelOpen && detailId ? detailId : null;
    }
    return () => {
      if (smsPanelTicketIdRef) smsPanelTicketIdRef.current = null;
    };
  }, [smsPanelOpen, detailId, smsPanelTicketIdRef]);

  // SMS unread on detail header: conv linked by ticket_id OR same customer phone (shared thread)
  useEffect(() => {
    const client = getTypedSupabaseClient();
    if (!detailId || !activeServiceId || !client) {
      setSmsUnreadCount(0);
      return;
    }
    let cancelled = false;
    (async () => {
      const convIdSet = new Set<string>();
      const { data: convsTicket } = await client.from("sms_conversations").select("id").eq("ticket_id", detailId);
      convsTicket?.forEach((c) => convIdSet.add(c.id));
      const { data: tick } = await client
        .from("tickets")
        .select("customer_phone")
        .eq("id", detailId)
        .eq("service_id", activeServiceId)
        .maybeSingle();
      const phoneNorm = tick?.customer_phone ? normalizePhone(String(tick.customer_phone)) : null;
      if (phoneNorm) {
        const { data: convPhone } = await client
          .from("sms_conversations")
          .select("id")
          .eq("service_id", activeServiceId)
          .eq("customer_phone", phoneNorm)
          .maybeSingle();
        if (convPhone?.id) convIdSet.add(convPhone.id);
      }
      if (convIdSet.size === 0) {
        if (!cancelled) setSmsUnreadCount(0);
        return;
      }
      const { count, error } = await client
        .from("sms_messages")
        .select("id", { count: "exact", head: true })
        .in("conversation_id", [...convIdSet])
        .eq("direction", "inbound")
        .is("read_at", null);
      if (cancelled) return;
      setSmsUnreadCount(error ? 0 : count ?? 0);
    })();
    return () => { cancelled = true; };
  }, [detailId, activeServiceId]);

  const { ticketHistoryEntries, ticketHistoryLoading, ticketHistoryError, ticketHistoryExpandedId, setTicketHistoryExpandedId } = useHistorieZakazky(ticketHistoryModalOpen, detailId, activeServiceId);
  const { claimHistoryEntries, claimHistoryLoading, claimHistoryError } = useHistorieReklamace(claimHistoryModalOpen, detailClaimId, activeServiceId);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEYS.UI_SETTINGS) setUiCfg(safeLoadUIConfig());
    };
    window.addEventListener("storage", onStorage);

    const onUiUpdated = () => setUiCfg(safeLoadUIConfig());
    window.addEventListener("jobsheet:ui-updated" as any, onUiUpdated);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("jobsheet:ui-updated" as any, onUiUpdated);
    };
  }, []);

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const t of tickets) next[t.id] = t.status as any;
    setStatusById(next);
  }, [tickets]);

  useLayoutEffect(() => {
    if (!openQuickPrintTicket) {
      setQuickPrintDropdownRect(null);
      return;
    }
    const el = document.querySelector(`[data-quick-print-trigger-id="${openQuickPrintTicket.id}"]`);
    if (el) {
      const rect = el.getBoundingClientRect();
      setQuickPrintDropdownRect({ top: rect.bottom, left: rect.left, right: rect.right, height: rect.height });
    } else {
      setQuickPrintDropdownRect(null);
    }
  }, [openQuickPrintTicket]);

  useEffect(() => {
    if (!openQuickPrintTicket) return;
    const handleClick = (e: MouseEvent) => {
      const el = e.target as Element;
      if (el?.closest?.("[data-quick-print-menu]") || el?.closest?.("[data-quick-print-trigger]")) return;
      setOpenQuickPrintTicket(null);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [openQuickPrintTicket]);

  // When navigating from Customers (click on ticket): open that ticket's detail once tickets are loaded.
  // Don't consume intent until we've opened the detail or confirmed the ticket isn't in the list (after load).
  // On first mount tickets is [] and ticketsLoading is false (initial state), so we must not consume until
  // we have either found the ticket or load has completed (ticketsLoadHasRunRef set when ticketsLoading was true).
  useEffect(() => {
    if (ticketsLoading) ticketsLoadHasRunRef.current = true;
  }, [ticketsLoading]);

  useEffect(() => {
    if (!openTicketIntent) return;

    const { ticketId, mode, returnToPage: returnPage, returnToCustomerId, openSmsPanel } = openTicketIntent;
    const exists = tickets.some((t) => t.id === ticketId);

    if (exists) {
      if ((mode ?? "detail") === "detail") {
        setDetailId(ticketId);
        setReturnToPage(returnPage || null);
        returnToCustomerIdRef.current = returnToCustomerId;
        if (openSmsPanel) setSmsPanelOpen(true);
      } else {
        setDetailId(null);
        setReturnToPage(null);
        returnToCustomerIdRef.current = undefined;
      }
      onOpenTicketIntentConsumed();
    } else {
      setDetailId(null);
      setReturnToPage(null);
      returnToCustomerIdRef.current = undefined;
      // Consume when load has finished: either we have data, or we've seen loading complete (ref set when ticketsLoading was true).
      // `ticketsPartial` je tu podstatné: seznam se od 6. 9. 2026 vykresluje už
      // po první stovce zakázek, takže bez téhle podmínky by odkaz na starší
      // zakázku hlásil „nebyla nalezena“, přestože se zrovna dotahuje.
      if (!ticketsLoading && !ticketsPartial && (tickets.length > 0 || ticketsLoadHasRunRef.current)) {
        // Odkaz z faktury nebo zákazníka na zakázku, která už není (smazaná,
        // jiná pobočka) – bez hlášky by kliknutí vypadalo, že nic neudělalo.
        if ((mode ?? "detail") === "detail") showToast("Zakázka nebyla nalezena – nejspíš byla smazána.", "info");
        onOpenTicketIntentConsumed();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTicketIntent, tickets, ticketsLoading, ticketsPartial]);

  useEffect(() => {
    if (!openClaimIntent || !onOpenClaimIntentConsumed) return;
    const { claimId } = openClaimIntent;
    const exists = cloudClaims.some((c) => c.id === claimId);
    if (exists) {
      setDetailClaimId(claimId);
      setDetailId(null);
    }
    onOpenClaimIntentConsumed();
  }, [openClaimIntent, cloudClaims, onOpenClaimIntentConsumed]);

  // Map ticket_id -> invoice id for "Přejít na fakturu" when invoice already exists
  const [invoiceIdByTicketId, setInvoiceIdByTicketId] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!activeServiceId || (!onCreateInvoice && !onOpenInvoice)) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await typedSupabase
          .from("invoices")
          .select("id, ticket_id, kind")
          .eq("service_id", activeServiceId)
          .not("ticket_id", "is", null)
          .is("deleted_at", null)
          // Stornovaná faktura zakázku neblokuje – jinak by po stornu šlo
          // jen „Přejít na fakturu“ a novou by z zakázky nebylo jak vystavit.
          .neq("status", "cancelled")
          // Dobropis není faktura zakázky; záloha (proforma) se ukáže jen
          // dokud k zakázce není běžná faktura – ta má přednost.
          .neq("kind", "credit_note");
        if (cancelled || !data) return;
        const map: Record<string, string> = {};
        const druh: Record<string, string> = {};
        for (const row of data as Array<{ id: string; ticket_id: string | null; kind: string | null }>) {
          if (!row.ticket_id) continue;
          const uz = druh[row.ticket_id];
          if (uz === "invoice" && row.kind !== "invoice") continue;
          map[row.ticket_id] = row.id;
          druh[row.ticket_id] = row.kind ?? "invoice";
        }
        setInvoiceIdByTicketId(map);
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, [activeServiceId, onCreateInvoice, onOpenInvoice]);

  // Ceník oprav (Zařízení a opravy) žije v DB. Dřív se tu četl jednou při
  // startu z localStorage, kam ho zapisovala jen stará verze stránky
  // Zařízení – v čistém prohlížeči byl proto katalog v zakázkách prázdný
  // („Vybrat z katalogu“ nic nenabídlo). Teď se načte z DB a při změně
  // ceníku se obnoví.
  const [devicesData, setDevicesData] = useState<DevicesData>(() => safeLoadDevicesData());
  useEffect(() => {
    if (!activeServiceId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      const res = await loadDevicesFromDb(activeServiceId);
      if (cancelled || res.error) return;
      setDevicesData(res.data);
    };
    const scheduleReload = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void load(); }, 800);
    };
    void load();
    const channel = supabase
      ? supabase
          .channel(`orders-devices:${activeServiceId}`)
          // Tabulka se jmenuje `repairs`; pod názvem „device_repairs“ žádná
          // neexistuje, takže se odběr tiše navázal a nikdy nic neposlal –
          // změna ceníku se v otevřené zakázce neprojevila až do načtení
          // stránky znovu. Supabase na neznámou tabulku nijak neupozorní.
          .on("postgres_changes", { event: "*", schema: "public", table: "repairs", filter: `service_id=eq.${activeServiceId}` }, scheduleReload)
          .on("postgres_changes", { event: "*", schema: "public", table: "device_models", filter: `service_id=eq.${activeServiceId}` }, scheduleReload)
          .subscribe()
      : null;
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (channel && supabase) void supabase.removeChannel(channel);
    };
  }, [activeServiceId]);
  /**
   * Produkty skladu pro výběr dílů u provedených oprav. Čtou se z databáze –
   * starší kopie v localStorage vzniká jen na stránce Sklad a na jiném
   * počítači je prázdná, takže výběr dílů nic nenabízel. Načítá se při
   * otevření detailu, aby stav skladu odpovídal.
   */
  const [inventoryData, setInventoryData] = useState<InventoryData>({ brands: [], categories: [], models: [], products: [] });
  /**
   * Sklad z databáze v plné podobě (stav, dodavatel, nákupní cena) plus živé
   * rezervace přes všechny zakázky – z toho řádek „Díly“ pozná, že díl není
   * skladem, a nabídne objednání u dodavatele (components/orders/DilyOpravy).
   */
  const [skladProdukty, setSkladProdukty] = useState<ReadonlyMap<string, SkladProdukt>>(new Map());
  const [rezervovanoCelkem, setRezervovanoCelkem] = useState<ReadonlyMap<string, number>>(new Map());
  /** Položky objednávek u dodavatele založené kvůli otevřené zakázce; klíčované id, ať pozdní odpověď nepřepíše jinou. */
  const [objednanoProZakazku, setObjednanoProZakazku] = useState<{ ticketId: string | null; rows: TicketOrderItem[] }>({ ticketId: null, rows: [] });
  const refreshObjednanoProZakazku = useCallback(async (ticketId: string) => {
    const res = await loadTicketOrderItems(ticketId);
    if (res.error) return;
    setObjednanoProZakazku({ ticketId, rows: res.data });
  }, []);
  useEffect(() => {
    if (!activeServiceId || !detailId) return;
    let zruseno = false;
    void loadReservations(activeServiceId).then((res) => {
      if (zruseno || res.error) return;
      setRezervovanoCelkem(res.data);
    });
    void loadTicketOrderItems(detailId).then((res) => {
      if (zruseno || res.error) return;
      setObjednanoProZakazku({ ticketId: detailId, rows: res.data });
    });
    void loadInventoryFromDb(activeServiceId).then((res) => {
      if (zruseno || res.error) return;
      setSkladProdukty(new Map(res.data.products.map((p) => [p.id, p])));
      setInventoryData({
        brands: [],
        categories: [],
        models: [],
        products: res.data.products.map((p) => ({
          id: p.id,
          name: p.name,
          modelIds: p.modelIds,
          stock: p.stock,
          price: p.price,
          sku: p.sku,
          description: p.description,
          imageUrl: p.imageUrl,
          repairIds: p.repairIds,
          createdAt: p.createdAt,
        })),
      });
    });
    return () => {
      zruseno = true;
    };
  }, [activeServiceId, detailId]);

  const modelsWithHierarchy: ModelWithHierarchy[] = useMemo(() => {
    if (!devicesData || !Array.isArray(devicesData.models)) return [];
    return devicesData.models
      .map((model) => {
        if (!model || !model.id || !model.name) return null;
        const category = devicesData.categories?.find((c) => c && c.id === model.categoryId);
        const brand = category && devicesData.brands ? devicesData.brands.find((b) => b && b.id === category.brandId) : null;
        const brandName = brand?.name ?? "";
        const categoryName = category?.name ?? "";
        return {
          ...model,
          categoryName,
          brandName,
          fullName: brand ? `${brand.name} ${model.name}` : model.name,
        } satisfies ModelWithHierarchy;
      })
      .filter((m): m is ModelWithHierarchy => m !== null);
  }, [devicesData]);

  const draftDirty = useMemo(() => isDraftDirty(newDraft), [newDraft]);

  const validEnoughToCreate = useMemo(() => {
    const hasDevices = newDraft.devices.length > 0 && newDraft.devices.every((d) => (d.deviceLabel || "").trim().length > 0);
    return (
      hasDevices &&
      isEmailValid(newDraft.customerEmail) &&
      isPhoneValid(newDraft.customerPhone) &&
      isZipValid(newDraft.addressZip) &&
      isIcoValid(newDraft.ico)
    );
  }, [newDraft]);

  const draftBadgeCount = useMemo(() => {
    return draftDirty && !validEnoughToCreate && !isNewOpen ? 1 : 0;
  }, [draftDirty, validEnoughToCreate, isNewOpen]);

  useEffect(() => {
    safeSaveDraft(draftDirty ? newDraft : null);
    window.dispatchEvent(new CustomEvent("jobsheet:draft-count", { detail: { count: draftBadgeCount } }));
  }, [newDraft, draftDirty, draftBadgeCount]);

  useEffect(() => {
    if (!newOrderPrefill) return;
    setShouldOpenNew(true);
    // Rezervace z webu: údaje zákazníka a zařízení rovnou do formuláře.
    // Rozepsanou zakázku nepřepisovat bez dotazu.
    // Pojistka: rezervace patří ke svému servisu, i kdyby záměr přežil přepnutí.
    const r = newOrderPrefill.rezervace && newOrderPrefill.rezervace.service_id === activeServiceId ? newOrderPrefill.rezervace : undefined;
    if (r && isDraftDirty(newDraft) && !window.confirm("Máte rozepsanou novou zakázku. Nahradit ji údaji z rezervace?")) {
      onNewOrderPrefillConsumed();
      return;
    }
    if (r) {
      setNewDraft((prev) => ({
        ...defaultDraft(),
        branchId: prev.branchId,
        customerName: r.customer_name,
        customerPhone: r.customer_phone,
        customerEmail: r.customer_email ?? "",
        devices: [{
          ...defaultDraft().devices[0],
          // Model z ceníku má přednost: podle názvu se pak nabídnou opravy z ceníku.
          deviceLabel: r.model_name || r.device_label,
          requestedRepair: r.repair_name ?? "",
          deviceNote: [r.model_name && r.model_name !== r.device_label ? `Zákazník uvedl: ${r.device_label}` : "", r.note ? `Z rezervace: ${r.note}` : ""].filter(Boolean).join(" · "),
          estimatedPrice: r.price_estimate ?? undefined,
          // Termín z rezervace + délka opravy z ceníku = předpokládané dokončení.
          expectedCompletionAt: r.preferred_at
            ? new Date(new Date(r.preferred_at).getTime() + (r.duration_min ?? 0) * 60_000).toISOString()
            : undefined,
          plannedRepairs: (() => {
            // Zákazník mohl v rezervaci vybrat víc oprav najednou.
            const ids = r.repair_ids && r.repair_ids.length > 0 ? r.repair_ids : r.repair_id ? [r.repair_id] : [];
            const vybrane = ids
              .map((id) => devicesData.repairs.find((x) => x.id === id))
              .filter((x): x is NonNullable<typeof x> => !!x)
              .map((cen) => ({ id: `${Date.now()}_${Math.random()}`, name: cen.name, type: "selected" as const, repairId: cen.id, price: cen.price, costs: cen.costs, estimatedTime: cen.estimatedTime, productIds: cen.productIds, pridalUserId: session?.user?.id ?? undefined }));
            return vybrane.length > 0 ? vybrane : undefined;
          })(),
        }],
        rezervaceId: r.id,
      }));
    }
    if (!newOrderPrefill.customerId) onNewOrderPrefillConsumed();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- devicesData jen pro dohledání opravy z ceníku v okamžiku předvyplnění
  }, [newOrderPrefill, onNewOrderPrefillConsumed]);

  // Load customer detail and prefill form when newOrderPrefill.customerId is set (e.g. "Vytvořit zakázku" u zákazníka)
  useEffect(() => {
    const customerId = newOrderPrefill?.customerId;
    if (!customerId || !supabase || !activeServiceId) return;

    onNewOrderPrefillConsumed();
    (async () => {
      try {
        const { data, error } = await (supabase
          .from("customers") as any)
          .select("id,name,phone,email,company,ico,address_street,address_city,address_zip,note")
          .eq("id", customerId)
          .eq("service_id", activeServiceId)
          .single();

        if (error || !data) {
          console.error("[Orders] Error loading customer for prefill:", error);
          return;
        }

        setNewDraft((prev) => {
          const shouldPrefill = !prev.customerId;
          return {
            ...prev,
            customerId: data.id,
            customerName: shouldPrefill || !prev.customerName.trim() ? (data.name || "") : prev.customerName,
            customerPhone: shouldPrefill || !prev.customerPhone.trim() ? (data.phone || "") : prev.customerPhone,
            customerEmail: shouldPrefill || !prev.customerEmail.trim() ? (data.email || "") : prev.customerEmail,
            addressStreet: shouldPrefill || !prev.addressStreet.trim() ? (data.address_street || "") : prev.addressStreet,
            addressCity: shouldPrefill || !prev.addressCity.trim() ? (data.address_city || "") : prev.addressCity,
            addressZip: shouldPrefill || !prev.addressZip.trim() ? (data.address_zip || "") : prev.addressZip,
            company: shouldPrefill || !prev.company.trim() ? (data.company || "") : prev.company,
            ico: shouldPrefill || !prev.ico.trim() ? (data.ico || "") : prev.ico,
            customerInfo: shouldPrefill || !prev.customerInfo.trim() ? (data.note || "") : prev.customerInfo,
          };
        });
      } catch (err) {
        console.error("[Orders] Error loading customer for prefill:", err);
      }
      // Okno příjmu se otevře až s načtenými údaji zákazníka. Dřív se otevíralo
      // souběžně s načítáním a při pomalejší odpovědi zůstalo prázdné.
      setShouldOpenNew(true);
    })();
  }, [newOrderPrefill?.customerId, supabase, activeServiceId, onNewOrderPrefillConsumed]);

  useEffect(() => {
    const onReq = () => setShouldOpenNew(true);
    window.addEventListener("jobsheet:request-new-order" as any, onReq);
    return () => window.removeEventListener("jobsheet:request-new-order" as any, onReq);
     
  }, []);

  useEffect(() => {
    if (!shouldOpenNew) return;
    setShouldOpenNew(false);
    setSubmitAttempted(false);
    setIsNewOpen(true);
  }, [shouldOpenNew]);

  useEffect(() => {
    try {
      localStorage.setItem(NEW_ORDER_MORE_OPEN_KEY, newOrderMoreOpen ? "1" : "0");
    } catch {
      // ignore
    }
  }, [newOrderMoreOpen]);

  useEffect(() => {
    try {
      localStorage.setItem(NEW_ORDER_DEVICE_MORE_OPEN_KEY, newOrderDeviceMoreOpen ? "1" : "0");
    } catch {
      // ignore
    }
  }, [newOrderDeviceMoreOpen]);

  useEffect(() => {
    try {
      localStorage.setItem(NEW_ORDER_CUSTOMER_MORE_OPEN_KEY, newOrderCustomerMoreOpen ? "1" : "0");
    } catch {
      // ignore
    }
  }, [newOrderCustomerMoreOpen]);

  /**
   * Našeptávač zákazníků v nové zakázce: jméno, telefon, e-mail nebo firma.
   * Vrací i adresu a poznámku, aby výběr vyplnil celý blok bez dalšího dotazu.
   */
  const searchCustomers = useCallback(async (q: string): Promise<CustomerMatch[]> => {
    if (!supabase || !activeServiceId) return [];
    const safe = q.replace(/[,()*%\\]/g, " ").trim();
    if (safe.length < 2) return [];
    const digits = q.replace(/\D/g, "");
    const ors = [
      `name.ilike.*${safe}*`,
      `email.ilike.*${safe}*`,
      `company.ilike.*${safe}*`,
      `phone.ilike.*${safe}*`,
    ];
    if (digits.length >= 3) {
      ors.push(`phone_norm.ilike.*${digits}*`);
      ors.push(`phone.ilike.*${digits}*`);
    }
    const { data, error } = await (supabase.from("customers") as any)
      .select("id,name,phone,email,company,ico,address_street,address_city,address_zip,note")
      .eq("service_id", activeServiceId)
      .or(ors.join(","))
      .order("name", { ascending: true })
      .limit(16);
    if (error || !Array.isArray(data)) return [];
    // „Jan“ má nabídnout Jana Nováka dřív než Aramise Tochjana: nejdřív
    // shoda na začátku jména, pak na začátku slova, pak zbytek.
    const fold = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const needle = fold(safe);
    const rank = (c: any) => {
      const name = fold(String(c.name || ""));
      if (name.startsWith(needle)) return 0;
      if (name.split(/\s+/).some((w) => w.startsWith(needle))) return 1;
      if (fold(String(c.company || "")).startsWith(needle)) return 2;
      return 3;
    };
    data.sort((a: any, b: any) => rank(a) - rank(b));
    return data.slice(0, 8).map((c: any) => ({
      id: String(c.id),
      name: c.name || "",
      phone: c.phone || null,
      email: c.email || null,
      company: c.company || null,
      city: c.address_city || null,
      // navíc pro vyplnění formuláře
      ico: c.ico || null,
      address_street: c.address_street || null,
      address_zip: c.address_zip || null,
      note: c.note || null,
    }));
  }, [supabase, activeServiceId]);

  /** Výběr zákazníka z našeptávače – vyplní celý blok a nastaví customerId. */
  const applyCustomerMatch = useCallback((m: CustomerMatch & { ico?: string | null; address_street?: string | null; address_zip?: string | null; note?: string | null }) => {
    setNewDraft((prev) => ({
      ...prev,
      customerId: m.id,
      customerName: m.name || "",
      customerPhone: m.phone || "",
      customerEmail: m.email || "",
      addressStreet: m.address_street || "",
      addressCity: m.city || "",
      addressZip: (m.address_zip || "").replace(/\D/g, ""),
      company: m.company || "",
      ico: (m.ico || "").replace(/\D/g, ""),
      customerInfo: m.note || "",
    }));
    setCustomerMatchDecision("accepted");
    setMatchedCustomer(null);
    lastLookupPhoneNormRef.current = normalizePhone(m.phone || "") ?? null;
    if (phoneLookupDebounceTimerRef.current) {
      clearTimeout(phoneLookupDebounceTimerRef.current);
      phoneLookupDebounceTimerRef.current = null;
    }
  }, []);

  // Lookup customer by phone or name
  const lookupCustomer = async (phone?: string, name?: string) => {
    if (!supabase || !activeServiceId) return;

    // Try phone lookup first (primary identifier)
    if (phone) {
      const phoneNorm = normalizePhone(phone);
      if (phoneNorm) {
        // Update lastLookupPhoneNormRef to prevent duplicate lookups
        lastLookupPhoneNormRef.current = phoneNorm;

        const { data, error } = await (supabase
          .from("customers") as any)
          .select("id,name,phone,email,company")
          .eq("service_id", activeServiceId)
          .eq("phone_norm", phoneNorm)
          .maybeSingle();

        if (!error && data) {
          // If name is also provided, check if it matches (case-insensitive)
          if (name && name.trim()) {
            const nameMatch = data.name?.trim().toLowerCase() === name.trim().toLowerCase();
            if (nameMatch) {
              // Phone + name match - high confidence
              setMatchedCustomer({
                id: data.id,
                name: data.name || "",
                phone: data.phone || undefined,
                email: data.email || undefined,
                company: data.company || undefined,
              });
              setCustomerMatchDecision("undecided");
              return;
            }
          }
          // Phone match (name may or may not match)
          setMatchedCustomer({
            id: data.id,
            name: data.name || "",
            phone: data.phone || undefined,
            email: data.email || undefined,
            company: data.company || undefined,
          });
          setCustomerMatchDecision("undecided");
          return;
        }
      } else {
        // Invalid phone norm - reset lastLookupPhoneNormRef
        lastLookupPhoneNormRef.current = null;
      }
    }

    // Vyhledání podle jména (když není telefon nebo telefon nenašel)
    if (name && name.trim().length >= 2) {
      const nameTrim = name.trim();
      const { data: nameData, error: nameError } = await (supabase
        .from("customers") as any)
        .select("id,name,phone,email,company")
        .eq("service_id", activeServiceId)
        .ilike("name", `%${nameTrim.replace(/%/g, "\\%")}%`)
        .limit(1)
        .maybeSingle();

      if (!nameError && nameData) {
        setMatchedCustomer({
          id: nameData.id,
          name: nameData.name || "",
          phone: nameData.phone || undefined,
          email: nameData.email || undefined,
          company: nameData.company || undefined,
        });
        setCustomerMatchDecision("undecided");
        return;
      }
    }

    // No match found
    setMatchedCustomer(null);
    setCustomerMatchDecision("undecided");
  };

  // Lookup customer by phone or name (for Edit mode)
  const lookupCustomerEdit = async (phone?: string, name?: string) => {
    if (!supabase || !activeServiceId) return;

    // Try phone lookup first (primary identifier)
    if (phone) {
      const phoneNorm = normalizePhone(phone);
      if (phoneNorm) {
        const { data, error } = await (supabase
          .from("customers") as any)
          .select("id,name,phone,email,company")
          .eq("service_id", activeServiceId)
          .eq("phone_norm", phoneNorm)
          .maybeSingle();

        if (!error && data) {
          // If name is also provided, check if it matches (case-insensitive)
          if (name && name.trim()) {
            const nameMatch = data.name?.trim().toLowerCase() === name.trim().toLowerCase();
            if (nameMatch) {
              // Phone + name match - high confidence
              setMatchedCustomerEdit({
                id: data.id,
                name: data.name || "",
                phone: data.phone || undefined,
                email: data.email || undefined,
                company: data.company || undefined,
              });
              return;
            }
          }
          // Phone match (name may or may not match)
          setMatchedCustomerEdit({
            id: data.id,
            name: data.name || "",
            phone: data.phone || undefined,
            email: data.email || undefined,
            company: data.company || undefined,
          });
          return;
        }
      }
    }

    // Vyhledání podle jména (když není telefon nebo telefon nenašel)
    if (name && name.trim().length >= 2) {
      const nameTrim = name.trim();
      const { data: nameData, error: nameError } = await (supabase
        .from("customers") as any)
        .select("id,name,phone,email,company")
        .eq("service_id", activeServiceId)
        .ilike("name", `%${nameTrim.replace(/%/g, "\\%")}%`)
        .limit(1)
        .maybeSingle();

      if (!nameError && nameData) {
        setMatchedCustomerEdit({
          id: nameData.id,
          name: nameData.name || "",
          phone: nameData.phone || undefined,
          email: nameData.email || undefined,
          company: nameData.company || undefined,
        });
        return;
      }
    }

    // No match found
    setMatchedCustomerEdit(null);
  };

  const statusKeysSet = useMemo(() => new Set(statuses.map((s) => s.key)), [statuses]);
  const statusesReady = !statusesLoading && statuses.length > 0;

  const normalizeStatus = useCallback(
    (key: string): string | null => {
      // If statuses are not loaded yet, return null to indicate placeholder
      if (statusesLoading || statuses.length === 0) {
        return null;
      }
      return statusKeysSet.has(key) ? key : fallbackKey;
    },
    [statusKeysSet, fallbackKey, statusesLoading, statuses.length]
  );

  // Order actions hook
  // Re-fetch single ticket by ID (for conflict resolution)
  const refetchTicketById = useCallback(async (ticketId: string): Promise<TicketEx | null> => {
    if (!activeServiceId || !supabase) return null;
    
    try {
      const { data, error } = await (supabase
        .from("tickets") as any)
        .select(SLOUPCE_DETAILU)
        .eq("id", ticketId)
        .eq("service_id", activeServiceId)
        .single();
      
      if (error) {
        console.error("[Orders] Error re-fetching ticket:", error);
        return null;
      }
      
      if (data) {
        return mapSupabaseTicketToTicketEx(data);
      }
      
      return null;
    } catch (err) {
      console.error("[Orders] Exception re-fetching ticket:", err);
      return null;
    }
  }, [activeServiceId, supabase]);

  /**
   * Dotáhne zakázce zbytek sloupců, které seznam nečte.
   *
   * Volá se všude, kde se ze zakázky stane víc než řádek v seznamu: otevření
   * detailu, tisk z karty, automatický tisk při změně stavu, založení
   * reklamace. Vrací plnou zakázku; když se dotažení nepovede (offline),
   * vrací to, co je v paměti – ale bez příznaku `uplna`, takže se z ní pořád
   * nesmí ukládat.
   *
   * Souběžná volání pro stejnou zakázku sdílí jeden dotaz: detail se otevírá
   * a zároveň se překresluje hlavička, to by jinak byly dva stejné dotazy.
   */
  const dotahovaneZakazkyRef = useRef<Map<string, Promise<TicketEx | null>>>(new Map());
  /** Zakázka, které se nepovedlo dotáhnout zbytek sloupců (typicky výpadek sítě). */
  const [nedotazenaZakazka, setNedotazenaZakazka] = useState<string | null>(null);
  const zajistiPlnouZakazku = useCallback(async (ticketId: string): Promise<TicketEx | null> => {
    const znama = cloudTicketsRef.current.find((t) => t.id === ticketId);
    if (znama?.uplna) return znama;

    const rozdelane = dotahovaneZakazkyRef.current;
    let beh = rozdelane.get(ticketId);
    if (!beh) {
      beh = refetchTicketById(ticketId).finally(() => rozdelane.delete(ticketId));
      rozdelane.set(ticketId, beh);
    }
    const plna = await beh;
    if (!plna) {
      // Ať se to dá poznat na obrazovce; „načítám…“ do nekonečna nikomu nic neřekne.
      setNedotazenaZakazka(ticketId);
      return cloudTicketsRef.current.find((t) => t.id === ticketId) ?? null;
    }
    setNedotazenaZakazka((p) => (p === ticketId ? null : p));

    /* Provedené opravy se ukládají okamžitě; když zrovna běží (nebo čeká)
       zápis, je verze v paměti novější než ta z databáze. Ostatní sloupce
       detailu se z neúplného řádku měnit nedají, tak se přepsat můžou. */
    const evidence = evidenceZapisu();
    setCloudTickets((prev) =>
      prev.map((t) => (t.id === ticketId ? sloucZakazkuZDb(t, plna, evidence, ticketId, ["performedRepairs"]) : t))
    );
    return plna;
  }, [refetchTicketById, evidenceZapisu]);

  const { createTicket: createTicketAction, saveTicketChanges: saveTicketChangesAction } = useOrderActions({
    activeServiceId,
    serviceName,
    userId: session?.user?.id ?? null,
    cloudTickets,
    setCloudTickets,
    setStatusById,
    statusesReady,
    statuses,
    statusKeysSet,
    normalizeStatus,
    refetchTicketById,
  });

  const selectedQuickKeys = uiCfg.home.orderFilters.selectedQuickStatusFilters;

  const quickStatuses = useMemo(() => {
    const set = new Set(statuses.map((s) => s.key));
    const keys = selectedQuickKeys.filter((k) => set.has(k));
    return statuses.filter((s) => keys.includes(s.key));
  }, [selectedQuickKeys, statuses]);

  const showSecondaryFiltersRow = quickStatuses.length > 0;

  useEffect(() => {
    if (!activeStatusKey) return;
    if (statusKeysSet.has(activeStatusKey)) return;
    setActiveStatusKey(null);
  }, [activeStatusKey, statusKeysSet]);

  const mojeId = session?.user?.id ?? null;

  /** Patří zakázka do zvolené záložky (Vše / Aktivní / Moje / Přesuny / Dokončené)? */
  const patriDoSkupiny = useCallback(
    (t: TicketEx, st: string | null): boolean => {
      // If statuses are not ready, show all tickets
      if (st === null) return true;
      if (activeGroup === "all") return true;
      if (activeGroup === "final") return isFinal(st);
      // „Moje“ = co mám dodělat: přidělené mně a ještě nedokončené.
      if (activeGroup === "moje") return !!mojeId && t.assignedTo === mojeId && !isFinal(st);
      // „Přesuny“ = na cestě nebo mimo svou pobočku (zásilky mezi pobočkami).
      if (activeGroup === "presun") return umisteniZakazky(t).druh !== "doma";
      return !isFinal(st);
    },
    [activeGroup, mojeId, isFinal],
  );

  /** Nabídka filtru podle stavu: jen stavy, které ve zvolené záložce opravdu jsou, s počtem. */
  const statusFilterOptions = useMemo((): { options: StatusFilterOption[]; total: number } => {
    const pocty = new Map<string, number>();
    let total = 0;
    for (const t of tickets) {
      const st = normalizeStatus((t.status as any) ?? statusById[t.id]);
      if (!patriDoSkupiny(t, st)) continue;
      total += 1;
      if (st !== null) pocty.set(st, (pocty.get(st) ?? 0) + 1);
    }
    const options = statuses
      .filter((s) => (pocty.get(s.key) ?? 0) > 0 || s.key === activeStatusKey)
      .map((s) => ({ key: s.key, label: s.label, bg: s.bg, count: pocty.get(s.key) ?? 0 }));
    return { options, total };
  }, [tickets, statusById, normalizeStatus, patriDoSkupiny, statuses, activeStatusKey]);

  // Po přepnutí záložky stav, který v ní není (např. „Vydáno“ v Aktivních), nedává smysl držet.
  useEffect(() => {
    if (!activeStatusKey) return;
    const o = statusFilterOptions.options.find((x) => x.key === activeStatusKey);
    if (!o || o.count === 0) setActiveStatusKey(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- jen při změně záložky, ne při každém přepočtu nabídky
  }, [activeGroup]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, "");

    const base = tickets
      .filter((t) => patriDoSkupiny(t, normalizeStatus((t.status as any) ?? statusById[t.id])))
      .filter((t) => {
        if (!activeStatusKey) return true;
        const raw = (t.status as any) ?? statusById[t.id];
        const st = normalizeStatus(raw);
        
        // If statuses are not ready, don't filter by status
        if (st === null) return true;
        return st === activeStatusKey;
      })
      .filter((t) => {
        if (!q) return true;
        // Telefon se porovnává i po číslicích, aby „777123“ našlo „+420 777 123 456“.
        const phoneDigits = (t.customerPhone ?? "").replace(/\D/g, "");
        // Všechna pole přes `?? ""`: zakázka bez čísla (vzniká importem nebo
        // přes veřejné API) shodila celou stránku Zakázky na `toLowerCase`
        // of null, jakmile někdo začal psát do hledání. Jeden vadný řádek
        // nesmí sundat seznam všem.
        return (
          (t.code ?? "").toLowerCase().includes(q) ||
          (t.customerName ?? "").toLowerCase().includes(q) ||
          (t.customerPhone ?? "").toLowerCase().includes(q) ||
          (qDigits.length >= 3 && phoneDigits.includes(qDigits)) ||
          (t.deviceLabel ?? "").toLowerCase().includes(q) ||
          (t.serialOrImei ?? "").toLowerCase().includes(q) ||
          (t.issueShort ?? "").toLowerCase().includes(q) ||
          (t.externalId ?? "").toLowerCase().includes(q)
        );
      });
    // Explicitně řadit od nejnovějších, aby stránkování bylo konzistentní
    return [...base].sort(
      (a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
    );
  }, [tickets, patriDoSkupiny, query, statusById, activeStatusKey, normalizeStatus]);

  /** Reklamace podle aktivní pobočky – stejné pravidlo jako u zakázek (bez pobočky = vidět všude). */
  const claimsInBranch = useMemo(
    () => (activeBranchId ? cloudClaims.filter((c) => !(c as any).branch_id || (c as any).branch_id === activeBranchId) : cloudClaims),
    [cloudClaims, activeBranchId],
  );
  const filteredClaims = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = !q
      ? claimsInBranch
      : claimsInBranch.filter(
          (c) =>
            (c.code?.toLowerCase().includes(q)) ||
            (c.customer_name?.toLowerCase().includes(q)) ||
            (c.customer_phone?.replace(/\s/g, "").includes(q.replace(/\s/g, ""))) ||
            (c.device_serial?.toLowerCase().includes(q)) ||
            (c.device_label?.toLowerCase().includes(q)) ||
            (c.notes?.toLowerCase().includes(q))
        );
    // Explicitně řadit od nejnovějších kvůli konzistentnímu stránkování
    return [...base].sort(
      (a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
    );
  }, [claimsInBranch, query]);

  const filteredClaimsForTab = useMemo(() => {
    if (activeGroup !== "reklamace") return filteredClaims;
    if (claimsSubGroup === "all") return filteredClaims;
    return filteredClaims.filter((c) => {
      const st = normalizeStatus((c.status as string) ?? "");
      if (st === null) return claimsSubGroup === "active";
      if (claimsSubGroup === "final") return isFinal(st);
      return !isFinal(st);
    });
  }, [activeGroup, claimsSubGroup, filteredClaims, normalizeStatus, isFinal]);

  /* Aktivní: reklamace se do stránkovaného seznamu nemíchají – jsou vždy
     všechny pod zakázkami v bloku „Aktivní reklamace“ (viz aktivniReklamace).
     Míchání podle data zůstává jen ve Vše a Dokončené, a jen když je zapnuté. */
  const showClaimsInOrdersList = (activeGroup === "all" || activeGroup === "final") && ordersShowClaimsInList;
  const aktivniReklamace = useMemo(
    () => activeGroup !== "active" ? [] : filteredClaims.filter((c) => {
      const st = normalizeStatus((c.status as string) ?? "");
      if (activeStatusKey && st !== activeStatusKey) return false;
      return st === null || !isFinal(st);
    }),
    [activeGroup, activeStatusKey, filteredClaims, normalizeStatus, isFinal],
  );
  const combinedList = useMemo(() => {
    if (!showClaimsInOrdersList) return [];
    const ticketItems = filtered.map((t) => ({ type: "ticket" as const, data: t, created_at: t.createdAt ?? "" }));
    const claimsForGroup = filteredClaims.filter((c) => {
      const st = normalizeStatus((c.status as string) ?? "");
      // Filtr podle stavu platí i pro reklamace – dřív se do vyfiltrovaného
      // seznamu pletly reklamace, které ten stav vůbec neměly.
      if (activeStatusKey && st !== activeStatusKey) return false;
      if (st === null) return activeGroup !== "final";
      if (activeGroup === "all") return true;
      if (activeGroup === "final") return isFinal(st);
      return !isFinal(st);
    });
    const claimItems = claimsForGroup.map((c) => ({ type: "claim" as const, data: c, created_at: c.created_at ?? "" }));
    return [...ticketItems, ...claimItems].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [showClaimsInOrdersList, filtered, filteredClaims, activeGroup, activeStatusKey, normalizeStatus, isFinal]);

  /** Počty do přepínače skupin – stejná pravidla jako seznam, jen bez textového hledání. */
  const groupCounts = useMemo(() => {
    let active = 0;
    let final = 0;
    let all = 0;
    let moje = 0;
    let presun = 0;
    for (const t of tickets) {
      const raw = (t.status as any) ?? statusById[t.id];
      const st = normalizeStatus(raw);
      if (activeStatusKey && st !== null && st !== activeStatusKey) continue;
      all += 1;
      if (umisteniZakazky(t).druh !== "doma") presun += 1;
      if (st === null || !isFinal(st)) {
        active += 1;
        if (mojeId && t.assignedTo === mojeId) moje += 1;
      } else final += 1;
    }
    // Aktivní reklamace jsou v záložce Aktivní vždy; do Vše a Dokončené jen
    // když se tam míchají (nastavení).
    for (const c of claimsInBranch) {
      const st = normalizeStatus((c.status as string) ?? "");
      if (activeStatusKey && st !== activeStatusKey) continue;
      const aktivni = st === null || !isFinal(st);
      if (aktivni) active += 1;
      if (ordersShowClaimsInList) {
        all += 1;
        if (!aktivni) final += 1;
      }
    }
    return { all, active, final, moje, presun, reklamace: claimsInBranch.length };
  }, [tickets, statusById, normalizeStatus, isFinal, activeStatusKey, ordersShowClaimsInList, claimsInBranch, mojeId]);

  const filtrPresunu = zasilkyZapnuty && hasBranches && nastaveniZasilek.filtr;

  // Vypnuté přidělování nesmí nechat seznam na skupině, která už neexistuje.
  useEffect(() => {
    if (!pridelovaniTechnika && activeGroup === "moje") setActiveGroup("active");
    if (!filtrPresunu && activeGroup === "presun") setActiveGroup("active");
  }, [pridelovaniTechnika, filtrPresunu, activeGroup]);

  const pageSize = uiCfg.orders.pageSize ?? 50;
  const listLength = activeGroup === "reklamace"
    ? filteredClaimsForTab.length
    : showClaimsInOrdersList
      ? combinedList.length
      : filtered.length;
  const effectivePageSize = pageSize <= 0 ? listLength || 1 : pageSize;
  const totalOrdersPages = Math.max(1, Math.ceil(listLength / effectivePageSize));
  const paginatedTickets = useMemo(
    () => (pageSize <= 0 ? filtered : filtered.slice(ordersPage * effectivePageSize, (ordersPage + 1) * effectivePageSize)),
    [filtered, ordersPage, pageSize, effectivePageSize]
  );
  const paginatedClaims = useMemo(
    () => (pageSize <= 0 ? filteredClaimsForTab : filteredClaimsForTab.slice(ordersPage * effectivePageSize, (ordersPage + 1) * effectivePageSize)),
    [filteredClaimsForTab, ordersPage, pageSize, effectivePageSize]
  );
  const paginatedCombined = useMemo(
    () => (pageSize <= 0 ? combinedList : combinedList.slice(ordersPage * effectivePageSize, (ordersPage + 1) * effectivePageSize)),
    [combinedList, ordersPage, pageSize, effectivePageSize]
  );

  /** Zakázky, u kterých má smysl načíst SMS badge (shodné s tím, co je ve výpisu) */
  const ticketsForSmsUnread = useMemo(() => {
    if (activeGroup === "reklamace") return [];
    const mode = uiCfg.orders.displayMode;
    if (mode === "status-grouped") {
      if (showClaimsInOrdersList) {
        return paginatedCombined.filter((r) => r.type === "ticket").map((r) => r.data);
      }
      return filtered;
    }
    return paginatedTickets;
  }, [
    activeGroup,
    uiCfg.orders.displayMode,
    showClaimsInOrdersList,
    paginatedCombined,
    filtered,
    paginatedTickets,
  ]);

  // Realtime: po příchozí SMS nebo označení přečteného přepočíst badge u řádků
  useEffect(() => {
    const client = getTypedSupabaseClient();
    if (!smsAvailable || !activeServiceId || !client) return;
    const topic = `orders_sms_unread_rt:${activeServiceId}`;
    const channel = client
      .channel(topic)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "sms_messages" },
        (payload) => {
          if ((payload.new as { direction?: string })?.direction === "inbound") {
            setSmsUnreadListBump((n) => n + 1);
          }
        }
      )
      .subscribe();
    return () => {
      client.removeChannel(channel);
    };
  }, [smsAvailable, activeServiceId]);

  /**
   * Klíč z obsahu, ne z identity pole.
   *
   * ticketsForSmsUnread je nové pole při každém renderu, takže efekt níž se
   * spouštěl při každém úhozu ve vyhledávání – naměřeno 6 úhozů = 15 dotazů
   * do Supabase, i když se seznam zakázek vůbec nezměnil.
   */
  const smsUnreadKey = useMemo(
    () => ticketsForSmsUnread.map((t) => `${t.id}|${normalizePhone(t.customerPhone) ?? ""}`).join(","),
    [ticketsForSmsUnread]
  );
  const ticketsForSmsUnreadRef = useRef(ticketsForSmsUnread);
  ticketsForSmsUnreadRef.current = ticketsForSmsUnread;

  // SMS unread per řádek: konverzace podle ticket_id nebo stejného telefonu jako u detailu
  useEffect(() => {
    const client = getTypedSupabaseClient();
    const ticketRowsAll = ticketsForSmsUnreadRef.current;
    if (!smsAvailable || !activeServiceId || !client || ticketRowsAll.length === 0) {
      // Nový prázdný objekt by byl pokaždé jiná reference a vynutil další render.
      setSmsUnreadByTicketId((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      return;
    }
    const ticketRows = ticketRowsAll;
    const ticketIds = ticketRows.map((t) => t.id);
    const idSet = new Set(ticketIds);
    const chunk = 180;
    let cancelled = false;
    // Rychlé psaní jinak spustí dotaz na každý mezistav.
    const timer = setTimeout(() => {
    (async () => {
      const convsByTicket: { id: string; ticket_id: string | null; customer_phone: string }[] = [];
      for (let i = 0; i < ticketIds.length; i += chunk) {
        const { data } = await client
          .from("sms_conversations")
          .select("id, ticket_id, customer_phone")
          .eq("service_id", activeServiceId)
          .in("ticket_id", ticketIds.slice(i, i + chunk));
        convsByTicket.push(...((data ?? []) as typeof convsByTicket));
      }
      const phones = [
        ...new Set(ticketRows.map((t) => normalizePhone(t.customerPhone)).filter((p): p is string => !!p)),
      ];
      const convsByPhone: { id: string; ticket_id: string | null; customer_phone: string }[] = [];
      for (let i = 0; i < phones.length; i += chunk) {
        const { data } = await client
          .from("sms_conversations")
          .select("id, ticket_id, customer_phone")
          .eq("service_id", activeServiceId)
          .in("customer_phone", phones.slice(i, i + chunk));
        for (const row of data ?? []) {
          convsByPhone.push(row as (typeof convsByPhone)[number]);
        }
      }
      const convMap = new Map<string, { id: string; ticket_id: string | null; customer_phone: string }>();
      for (const c of [...convsByTicket, ...convsByPhone]) {
        convMap.set(c.id, c);
      }
      const convIds = [...convMap.keys()];
      if (convIds.length === 0) {
        if (!cancelled) setSmsUnreadByTicketId((prev) => (Object.keys(prev).length === 0 ? prev : {}));
        return;
      }
      const countByConv: Record<string, number> = {};
      for (let i = 0; i < convIds.length; i += chunk) {
        const slice = convIds.slice(i, i + chunk);
        const { data: messages } = await client
          .from("sms_messages")
          .select("conversation_id")
          .in("conversation_id", slice)
          .eq("direction", "inbound")
          .is("read_at", null);
        if (cancelled) return;
        (messages ?? []).forEach((m) => {
          countByConv[m.conversation_id] = (countByConv[m.conversation_id] ?? 0) + 1;
        });
      }
      const phonesMatch = (a: string | null | undefined, b: string | null | undefined) => {
        const na = normalizePhone(a);
        const nb = normalizePhone(b);
        if (na && nb && na === nb) return true;
        const da = String(a ?? "").replace(/\D/g, "");
        const db = String(b ?? "").replace(/\D/g, "");
        return da.length >= 9 && db.length >= 9 && da.slice(-9) === db.slice(-9);
      };
      const byTicket: Record<string, number> = {};
      for (const [cid, n] of Object.entries(countByConv)) {
        const conv = convMap.get(cid);
        if (!conv) continue;
        if (conv.ticket_id && idSet.has(conv.ticket_id)) {
          byTicket[conv.ticket_id] = (byTicket[conv.ticket_id] ?? 0) + n;
        } else {
          for (const t of ticketRows) {
            if (phonesMatch(t.customerPhone, conv.customer_phone)) {
              byTicket[t.id] = (byTicket[t.id] ?? 0) + n;
            }
          }
        }
      }
      if (!cancelled) setSmsUnreadByTicketId(byTicket);
    })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [smsAvailable, activeServiceId, smsUnreadKey, smsUnreadListBump]);

  useEffect(() => {
    setOrdersPage(0);
  }, [query, activeStatusKey, activeGroup, claimsSubGroup]);

  useEffect(() => {
    setOrdersPage(0);
  }, [pageSize]);

  useEffect(() => {
    if (ordersPage >= totalOrdersPages && totalOrdersPages > 0) setOrdersPage(totalOrdersPages - 1);
  }, [ordersPage, totalOrdersPages]);

  /**
   * Otevřený detail se hledá v NEfiltrovaném seznamu.
   *
   * Kdyby se hledal v `tickets` (filtrované podle pobočky), zmizela by
   * zakázka ze seznamu ve chvíli, kdy ji přesunu na jinou pobočku – a
   * z detailu by zbylo prázdné okno s pomlčkami a tlačítkem Upravit.
   */
  /** Otevřená zakázka tak, jak ji zná seznam – může jí chybět většina sloupců. */
  const otevrenaZeSeznamu: TicketEx | undefined = useMemo(
    () => (detailId ? cloudTickets.find((t) => t.id === detailId) : undefined),
    [detailId, cloudTickets]
  );

  /**
   * Detail se vykreslí až nad zakázkou se všemi sloupci.
   *
   * Seznam čte jen svoji úzkou sadu (SLOUPCE_SEZNAMU), takže v jeho řádku
   * není diagnostika, kontrola po opravě ani zápůjčka. Kdyby se z takového
   * řádku vykreslil detail, ukazoval by prázdno – a uložení, které posílá
   * celý řádek, by ho prázdnem přepsalo i v databázi. Dotažení je jeden
   * dotaz podle `id` a trvá desítky milisekund; po tu dobu je v okně
   * „Načítám zakázku…“.
   */
  const detailedTicket: TicketEx | undefined = otevrenaZeSeznamu?.uplna ? otevrenaZeSeznamu : undefined;
  /* Jen když zakázku ze seznamu známe a chybí jí sloupce detailu. Odkaz na
     zakázku, která v seznamu není (smazaná, cizí servis), skončí jako dřív –
     prázdným oknem, ne věčným „načítám“. */
  const detailSeNacita = !!otevrenaZeSeznamu && !detailedTicket;

  /* Dotažení zbylých sloupců otevřené zakázky.
     Podmínka je „nemáme plnou zakázku“, ne jen „otevřel se detail“: kdyby
     řádek někdy spadl zpátky na sloupce seznamu (druhé kolo načítání,
     ozvěna z realtime), detail by jinak zůstal viset na „Načítám zakázku…“.
     Když dotažení selže, stav se nemění a znovu se nespustí – žádná smyčka. */
  useEffect(() => {
    if (detailId && !detailedTicket) void zajistiPlnouZakazku(detailId);
  }, [detailId, detailedTicket, zajistiPlnouZakazku]);

  /**
   * Náhradní zařízení, která jsou zrovna u zákazníků.
   *
   * Karta zápůjčky tím říká „tenhle kus je půjčený na zakázce E2E26000123“.
   * Dřív se to počítalo průchodem přes všechny zakázky v paměti; seznam ale
   * zápůjčky nečte, tak se na ně ptáme rovnou databáze – s filtrem na
   * serveru jsou to jednotky řádků místo tisíců.
   */
  const [pujceneKusy, setPujceneKusy] = useState<{ id: string; code: string | null; katalogId: string }[]>([]);
  useEffect(() => {
    // Servis bez seznamu náhradních zařízení nemá co půjčovat – ani se neptáme.
    if (!detailId || !activeServiceId || !supabase || nahradniZarizeni.length === 0) return;
    let zruseno = false;
    void (supabase.from("tickets") as any)
      .select("id,code,loaner")
      .eq("service_id", activeServiceId)
      .is("deleted_at", null)
      .not("loaner", "is", null)
      .limit(500)
      .then(({ data }: { data: any[] | null }) => {
        if (zruseno || !Array.isArray(data)) return;
        setPujceneKusy(
          data
            .filter((r) => r?.loaner?.katalogId && !r.loaner.vraceno)
            .map((r) => ({ id: r.id as string, code: (r.code ?? null) as string | null, katalogId: r.loaner.katalogId as string }))
        );
      });
    return () => {
      zruseno = true;
    };
  }, [detailId, activeServiceId, nahradniZarizeni.length]);

  // After detailedTicket exists: sync ref so SMS OS notifications skip this thread when panel is open
  useEffect(() => {
    if (smsPanelOpen && detailId && detailedTicket?.customerPhone?.trim()) {
      smsDoNotNotifyRef.panelTicketId = detailId;
      smsDoNotNotifyRef.panelCustomerPhoneNorm = normalizePhone(detailedTicket.customerPhone) ?? null;
    } else {
      smsDoNotNotifyRef.panelTicketId = null;
      smsDoNotNotifyRef.panelCustomerPhoneNorm = null;
    }
    return () => {
      smsDoNotNotifyRef.panelTicketId = null;
      smsDoNotNotifyRef.panelCustomerPhoneNorm = null;
    };
  }, [smsPanelOpen, detailId, detailedTicket?.customerPhone]);

  const detailedClaim: WarrantyClaimRow | undefined = useMemo(
    () => (detailClaimId ? cloudClaims.find((c) => c.id === detailClaimId) : undefined),
    [detailClaimId, cloudClaims]
  );

  /**
   * Komentáře se dotahují k tomu, co je zrovna otevřené: k detailu zakázky
   * a u reklamace i k zakázce, ze které vznikla (její diagnostika i komentáře
   * se v reklamaci zobrazují).
   */
  const komentareProZakazky = useMemo(() => {
    const ids: string[] = [];
    if (detailId) ids.push(detailId);
    const zdroj = detailedClaim?.source_ticket_id;
    if (zdroj && !ids.includes(zdroj)) ids.push(zdroj);
    return ids;
  }, [detailId, detailedClaim?.source_ticket_id]);

  useEffect(() => {
    otevreneKomentareRef.current = komentareProZakazky;
    if (komentareProZakazky.length > 0) void nactiKomentare(komentareProZakazky);
  }, [komentareProZakazky, nactiKomentare]);

  /* Reklamace ukazuje diagnostiku napojené zakázky a zapisuje ji rovnou do
     ní. Musí být proto dotažená celá – jinak by textové pole ukázalo prázdno
     a první úhoz by původní diagnostiku přepsal. */
  useEffect(() => {
    const zdroj = detailedClaim?.source_ticket_id;
    if (zdroj) void zajistiPlnouZakazku(zdroj);
  }, [detailedClaim?.source_ticket_id, zajistiPlnouZakazku]);

  // Save originalTicketRef when detailId changes and reset dirty flags
  useEffect(() => {
    /* Zakázka se dotahuje až po otevření detailu, takže při přepnutí ještě
       nemusí být v paměti celá. Základ pro porovnání změn se pak vezme, jakmile
       dorazí – bez toho by zůstal prázdný a rozepsané změny by se neměly s čím
       porovnat. */
    if (detailId === lastDetailIdRef.current) {
      if (detailedTicket && !originalTicketRef.current) {
        originalTicketRef.current = JSON.parse(JSON.stringify(detailedTicket));
      }
      return;
    }

    lastDetailIdRef.current = detailId;
    originalTicketRef.current = detailedTicket ? JSON.parse(JSON.stringify(detailedTicket)) : null;
    // Reset dirty flags when opening new ticket
    setDirtyFlags({
      diagnosticText: false,
      diagnosticPhotos: false,
      performedRepairs: false,
    });
  }, [detailId, detailedTicket]);

  /** Opravy z ceníku pro zařízení podle názvu – stejné párování pro detail i pro příjem. */
  const repairsForDeviceLabel = useCallback(
    (label: string | undefined | null): DeviceRepair[] => {
      const trimmed = (label || "").trim();
      if (!trimmed) return [];
      if (!devicesData || !Array.isArray(devicesData.models) || !Array.isArray(devicesData.repairs)) return [];
      const deviceName = trimmed.toLowerCase();
      const matchingModels = devicesData.models.filter(
        (m) => m && m.name && (m.name.toLowerCase().includes(deviceName) || deviceName.includes(m.name.toLowerCase()))
      );
      const modelIds = matchingModels.map((m) => m.id).filter(Boolean);
      if (modelIds.length === 0) return [];
      return devicesData.repairs.filter((r) => r && r.modelIds && r.modelIds.some((mid: string) => modelIds.includes(mid)));
    },
    [devicesData]
  );

  const availableRepairs = useMemo(
    () => repairsForDeviceLabel(detailedTicket?.deviceLabel),
    [detailedTicket?.deviceLabel, repairsForDeviceLabel]
  );

  /** Přepne opravu z ceníku u zařízení v nové zakázce: text požadované opravy, seznam oprav i předschválenou cenu. */
  const togglePlannedRepair = useCallback((idx: number, repair: DeviceRepair) => {
    setNewDraft((p) => ({
      ...p,
      devices: p.devices.map((d, i) => {
        if (i !== idx) return d;
        const planned = d.plannedRepairs ?? [];
        const has = planned.some((r) => r.repairId === repair.id);
        const nextPlanned = has
          ? planned.filter((r) => r.repairId !== repair.id)
          : [
              ...planned,
              {
                id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                name: repair.name,
                type: "selected" as const,
                repairId: repair.id,
                price: repair.price,
                costs: repair.costs,
                estimatedTime: repair.estimatedTime,
                productIds: repair.productIds,
                // Odměny týmu: kdo opravu nabídl už při příjmu.
                pridalUserId: mojeId ?? undefined,
              },
            ];
        // Text požadované opravy: jména z ceníku oddělená čárkou, ruční text zůstává.
        const parts = (d.requestedRepair || "").split(",").map((x) => x.trim()).filter(Boolean);
        const nextParts = has ? parts.filter((x) => x !== repair.name) : parts.includes(repair.name) ? parts : [...parts, repair.name];
        // Předschválená cena (i se slevou) se přepisuje jen dokud ji uživatel nezadal ručně.
        return {
          ...d,
          ...poZmeneOprav(d, soucetOprav(planned), soucetOprav(nextPlanned)),
          plannedRepairs: nextPlanned,
          requestedRepair: nextParts.join(", "),
        };
      }),
    }));
  }, []);

  /**
   * Oprava mimo ceník už při příjmu. Jde do stejného seznamu jako opravy
   * z ceníku, takže se počítá do součtu, do slevy i do předschválené ceny –
   * dřív se na ni sleva musela dopočítat ručně, protože ji nebylo kam zapsat.
   */
  const [dalsiOprava, setDalsiOprava] = useState<Record<number, { name: string; price: string }>>({});

  const addManualPlannedRepair = useCallback((idx: number, nazev: string, cenaText: string): boolean => {
    const name = nazev.trim();
    const price = Number(cenaText.replace(/\s/g, "").replace(",", "."));
    if (!name || !Number.isFinite(price) || price < 0) return false;
    setNewDraft((p) => ({
      ...p,
      devices: p.devices.map((d, i) => {
        if (i !== idx) return d;
        const planned = d.plannedRepairs ?? [];
        const nextPlanned = [...planned, { id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, name, type: "manual" as const, price, pridalUserId: mojeId ?? undefined }];
        const parts = (d.requestedRepair || "").split(",").map((x) => x.trim()).filter(Boolean);
        return {
          ...d,
          ...poZmeneOprav(d, soucetOprav(planned), soucetOprav(nextPlanned)),
          plannedRepairs: nextPlanned,
          requestedRepair: (parts.includes(name) ? parts : [...parts, name]).join(", "),
        };
      }),
    }));
    return true;
  }, []);

  /** Příznak „nabídnuto navíc“ u opravy vybrané při příjmu (odměny týmu). */
  const nastavPlannedNabidnuto = useCallback((idx: number, id: string, nabidnuto: boolean) => {
    setNewDraft((p) => ({
      ...p,
      devices: p.devices.map((d, i) => (i !== idx ? d : { ...d, plannedRepairs: (d.plannedRepairs ?? []).map((r) => (r.id === id ? { ...r, nabidnuto } : r)) })),
    }));
  }, []);

  const removePlannedRepair = useCallback((idx: number, id: string) => {
    setNewDraft((p) => ({
      ...p,
      devices: p.devices.map((d, i) => {
        if (i !== idx) return d;
        const planned = d.plannedRepairs ?? [];
        const odebirana = planned.find((r) => r.id === id);
        if (!odebirana) return d;
        const nextPlanned = planned.filter((r) => r.id !== id);
        const parts = (d.requestedRepair || "").split(",").map((x) => x.trim()).filter(Boolean);
        return {
          ...d,
          ...poZmeneOprav(d, soucetOprav(planned), soucetOprav(nextPlanned)),
          plannedRepairs: nextPlanned,
          requestedRepair: parts.filter((x) => x !== odebirana.name).join(", "),
        };
      }),
    }));
  }, []);

  /**
   * Zákazník schválil nabídku – její položky se stanou provedenými opravami.
   * Nahrazují se, ne přidávají: schválený rozpis je to, na čem se obě strany
   * dohodly, a dvojitý zápis by se objevil na faktuře.
   *
   * Zapisuje se rovnou do databáze, ne přes běžné automatické ukládání, které
   * čeká na zavření detailu. Uživatel klikl na jednu akci a dostal hlášku, že
   * je hotovo – to musí platit i když hned zavře okno.
   */
  const applyQuoteRepairs = useCallback(
    async (ticketId: string, repairsVstup: PerformedRepair[]) => {
      // Schválená položka z cenové nabídky = nabídnuto a přijato; příznak se
      // doplní jen tam, kde chybí a kde sedí pravidlo odměn.
      const pozadovana = cloudTicketsRef.current.find((t) => t.id === ticketId)?.requestedRepair;
      const repairs = repairsVstup.map((r) => {
        if (r.nabidnuto !== undefined) return r;
        const n = vychoziNabidnuto(r.name, pozadovana, pravidlaOdmen);
        return n === undefined ? r : { ...r, nabidnuto: n };
      });
      setCloudTickets((prev) =>
        prev.map((t) => (t.id === ticketId ? { ...t, performedRepairs: repairs } : t))
      );
      if (!supabase) {
        setDirtyFlags((prev) => ({ ...prev, performedRepairs: true }));
        return;
      }
      // Stejná evidence jako u ostatních zápisů oprav: dokud zápis běží (a po
      // chybě až do zavření detailu), realtime nesmí opravy přepsat.
      zacniZapis(rozpracovaneZapisyOpravRef.current, ticketId);
      try {
        const { error } = await (supabase.from("tickets") as any)
          .update({ performed_repairs: repairs })
          .eq("id", ticketId);
        if (error) {
          // Zůstane rozpracované – uloží se při zavření detailu jako každá jiná změna.
          setDirtyFlags((prev) => ({ ...prev, performedRepairs: true }));
          neulozeneOpravyRef.current.add(ticketId);
          throw error;
        }
        neulozeneOpravyRef.current.delete(ticketId);
      } finally {
        ukonciZapis(rozpracovaneZapisyOpravRef.current, ticketId);
      }
    },
    []
  );

  /**
   * Zápis provedených oprav do databáze.
   *
   * Dřív se opravy ukládaly až při zavření detailu, ale rezervace dílů ve
   * skladu vznikaly okamžitě. Když mezitím někdo změnil stav zakázky,
   * realtime přepsal rozepsané opravy verzí z databáze: rezervace zůstaly
   * bez opravy a při Dokončeno se odečetl díl za opravu, kterou zakázka
   * neměla. Teď jde přidání a odebrání do databáze hned; úpravy ceny,
   * nákladů a času (několik volání z jednoho tlačítka Uložit) s krátkým
   * odkladem, aby se poslal jeden zápis. Při chybě zůstane příznak
   * rozpracovanosti a opravy se uloží při zavření detailu jako dřív.
   */
  /**
   * Označí zakázce běžící okamžitý zápis (opravy, kontrola, zápůjčka), aby
   * realtime ozvěna staršího zápisu nepřepsala místní stav – viz upsert výše.
   */
  /** Číslo zakázky do výpisu neuložených změn; když ho neznáme, aspoň zákazník. */
  const popisZakazky = useCallback((ticketId: string): string => {
    const t = cloudTicketsRef.current.find((x) => x.id === ticketId);
    return t?.code || t?.customerName || "zakázka";
  }, []);

  const sOkamzitymZapisem = useCallback(async <T,>(ticketId: string, zapis: () => Promise<T>): Promise<T> => {
    zacniZapis(rozpracovaneZapisyOpravRef.current, ticketId);
    try {
      return await zapis();
    } finally {
      ukonciZapis(rozpracovaneZapisyOpravRef.current, ticketId);
    }
  }, []);

  const zapisProvedeneOpravy = useCallback((ticketId: string, repairs: PerformedRepair[], hned: boolean) => {
    if (!supabase) {
      setDirtyFlags((prev) => ({ ...prev, performedRepairs: true }));
      return;
    }
    const odlozene = odlozeneZapisyOpravRef.current;
    const cekajici = odlozene.get(ticketId);
    if (cekajici) {
      clearTimeout(cekajici.casovac);
      odlozene.delete(ticketId);
    }
    const proved = () => {
      odlozene.delete(ticketId);
      zacniZapis(rozpracovaneZapisyOpravRef.current, ticketId);
      void (async () => {
        try {
          const { error } = await (supabase!.from("tickets") as any)
            .update({ performed_repairs: repairs })
            .eq("id", ticketId);
          if (error) throw error;
          // Databáze má nejnovější opravy – realtime už je smí přepisovat.
          neulozeneOpravyRef.current.delete(ticketId);
        } catch (err) {
          devLog("[opravy] zápis selhal, uloží se při zavření detailu", err);
          setDirtyFlags((prev) => ({ ...prev, performedRepairs: true }));
          // Opravy jsou teď jen v paměti; realtime je nesmí přepsat, dokud
          // se neuloží při zavření detailu (jinak zůstane rezervace bez opravy).
          neulozeneOpravyRef.current.add(ticketId);
          /* Druhá pojistka: zavření detailu zkusí zápis znovu, ale když je
             síť pryč i potom, opravy by se ztratily. Fronta je dopíše sama,
             až spojení naskočí – přežije i zavření aplikace. */
          if (!jeTrvalaChyba(err)) {
            ulozNaPozdeji({
              klic: `tickets:${ticketId}:performed_repairs`,
              tabulka: "tickets",
              id: ticketId,
              data: { performed_repairs: repairs },
              popis: `Provedené opravy · ${popisZakazky(ticketId)}`,
              serviceId: activeServiceIdRef.current,
              chyba: err,
            });
          }
        } finally {
          ukonciZapis(rozpracovaneZapisyOpravRef.current, ticketId);
        }
      })();
    };
    if (hned) proved();
    else odlozene.set(ticketId, { casovac: setTimeout(proved, 400), proved });
  }, []);

  /** Odložené zápisy oprav pošle hned – před zavřením detailu a při odchodu ze stránky. */
  const dokoncitOdlozeneZapisyOprav = useCallback(() => {
    for (const { casovac, proved } of odlozeneZapisyOpravRef.current.values()) {
      clearTimeout(casovac);
      proved();
    }
    for (const { casovac, proved } of odlozenaKontrolaRef.current.values()) {
      clearTimeout(casovac);
      proved();
    }
    for (const { casovac, proved } of odlozenaDiagnostikaRef.current.values()) {
      clearTimeout(casovac);
      proved();
    }
  }, []);

  useEffect(() => {
    // `pagehide` chytí i Safari, kde se `beforeunload` někdy nespustí, a
    // odmontování stránky Zakázky, kde by odložený zápis jinak visel.
    window.addEventListener("beforeunload", dokoncitOdlozeneZapisyOprav);
    window.addEventListener("pagehide", dokoncitOdlozeneZapisyOprav);
    return () => {
      window.removeEventListener("beforeunload", dokoncitOdlozeneZapisyOprav);
      window.removeEventListener("pagehide", dokoncitOdlozeneZapisyOprav);
      dokoncitOdlozeneZapisyOprav();
    };
  }, [dokoncitOdlozeneZapisyOprav]);

  /** Upraví provedené opravy zakázky v místním stavu i v databázi. */
  const upravProvedeneOpravy = useCallback(
    (ticketId: string, uprava: (repairs: PerformedRepair[]) => PerformedRepair[], hned: boolean) => {
      const ticket = cloudTicketsRef.current.find((t) => t.id === ticketId);
      if (!ticket) return;
      const next = uprava(ticket.performedRepairs ?? []);
      // Do ref hned, aby další volání ve stejném kliknutí stavělo na tomhle výsledku.
      cloudTicketsRef.current = cloudTicketsRef.current.map((t) => (t.id === ticketId ? { ...t, performedRepairs: next } : t));
      setCloudTickets((prev) => prev.map((t) => (t.id === ticketId ? { ...t, performedRepairs: next } : t)));
      zapisProvedeneOpravy(ticketId, next, hned);
    },
    [zapisProvedeneOpravy]
  );

  const addPerformedRepair = useCallback(
    (ticketId: string, repair: { name: string; type: "selected" | "manual" | "hourly"; repairId?: string; price?: number; costs?: number; estimatedTime?: number; productIds?: string[]; hodiny?: number; sazba?: number; technik?: string; technikUserId?: string; zMereni?: boolean }) => {
      // Ruční oprava si cenu, náklady, čas a díly nese sama; oprava z ceníku je má v ceníku.
      let repairPrice: number | undefined = repair.price;
      let repairCosts: number | undefined = repair.costs;
      let repairTime: number | undefined = repair.estimatedTime;
      let repairProductIds: string[] | undefined = repair.productIds;
      if (repair.repairId) {
        const repairData = devicesData.repairs.find((r) => r.id === repair.repairId);
        if (repairData) {
          repairPrice = repairData.price;
          repairCosts = repairData.costs;
          repairTime = repairData.estimatedTime;
          repairProductIds = repairData.productIds;
        }
      }

      const entryId = `${Date.now()}_${Math.random()}`;

      // Díly se rezervují ve skladu (DB); ze skladu se odečtou až v koncovém stavu zakázky.
      if (repairProductIds && repairProductIds.length > 0) {
        void reserveEntryProducts(ticketId, entryId, repairProductIds).then((res) => {
          if (res) toastReserveShortages(res.shortages);
        });
      }

      // Hodinová práce: cena a čas se počítají z hodin a sazby.
      if (repair.type === "hourly") {
        const hodiny = repair.hodiny ?? 0;
        const sazba = repair.sazba ?? 0;
        repairPrice = Math.round(hodiny * sazba * 100) / 100;
        repairTime = Math.round(hodiny * 60);
      }

      const newRepair: PerformedRepair = {
        id: entryId,
        name: repair.name,
        type: repair.type,
        repairId: repair.repairId,
        price: repairPrice,
        costs: repairCosts,
        estimatedTime: repairTime,
        productIds: repairProductIds,
        // Odměny týmu (lib/odmeny): kdo opravu na zakázku přidal – nabídl ji zákazníkovi.
        ...(mojeId ? { pridalUserId: mojeId } : {}),
        // …a jestli ji nabídl navíc (není v požadované opravě z příjmu). Kdo přidává, může to v řádku otočit.
        ...(() => {
          const n = vychoziNabidnuto(repair.name, cloudTicketsRef.current.find((t) => t.id === ticketId)?.requestedRepair, pravidlaOdmen);
          return n === undefined ? {} : { nabidnuto: n };
        })(),
        ...(repair.type === "hourly" ? { hodiny: repair.hodiny, sazba: repair.sazba, technik: repair.technik, technikUserId: repair.technikUserId, ...(repair.zMereni ? { zMereni: true } : {}) } : {}),
      };
      upravProvedeneOpravy(ticketId, (repairs) => [...repairs, newRepair], true);
    },
    [devicesData, reserveEntryProducts, toastReserveShortages, upravProvedeneOpravy, mojeId, pravidlaOdmen]
  );

  const updatePerformedRepairPrice = useCallback((ticketId: string, repairId: string, price: number) => {
    upravProvedeneOpravy(ticketId, (repairs) => repairs.map((r) => (r.id === repairId ? { ...r, price } : r)), false);
  }, [upravProvedeneOpravy]);

  const updatePerformedRepairCosts = useCallback((ticketId: string, repairId: string, costs: number) => {
    upravProvedeneOpravy(ticketId, (repairs) => repairs.map((r) => (r.id === repairId ? { ...r, costs } : r)), false);
  }, [upravProvedeneOpravy]);

  const updatePerformedRepairTime = useCallback((ticketId: string, repairId: string, estimatedTime: number) => {
    upravProvedeneOpravy(ticketId, (repairs) => repairs.map((r) => (r.id === repairId ? { ...r, estimatedTime } : r)), false);
  }, [upravProvedeneOpravy]);

  const updatePerformedRepairProducts = useCallback((ticketId: string, repairId: string, productIds: string[]) => {
    upravProvedeneOpravy(ticketId, (repairs) => repairs.map((r) => (r.id === repairId ? { ...r, productIds } : r)), false);
  }, [upravProvedeneOpravy]);

  /** Náhradní zařízení se ukládá hned – smlouva se tiskne vzápětí a data musí být v DB. */
  const ulozZapujcku = useCallback(async (ticketId: string, zapujcka: ZapujckaData | null) => {
    const puvodni = cloudTicketsRef.current.find((t) => t.id === ticketId)?.loaner;
    setCloudTickets((prev) => prev.map((t) => (t.id === ticketId ? { ...t, loaner: zapujcka ?? undefined } : t)));
    if (!supabase) return;
    const { error } = await sOkamzitymZapisem<{ error: unknown }>(ticketId, () => (supabase!.from("tickets") as any).update({ loaner: zapujcka }).eq("id", ticketId));
    if (error) {
      devLog("[zapujcka] zápis selhal", error);
      if (jeTrvalaChyba(error)) {
        // Opakování by nepomohlo (chybí právo, zakázka zmizela). Zpět na stav
        // z databáze – jinak by karta ukazovala něco, co po obnovení zmizí.
        setCloudTickets((prev) => prev.map((t) => (t.id === ticketId ? { ...t, loaner: puvodni } : t)));
        showToast("Půjčení zařízení se nepodařilo uložit", "error");
        return;
      }
      // Výpadek spojení: zadané údaje si necháme a frontu je dopíše sama.
      ulozNaPozdeji({
        klic: `tickets:${ticketId}:loaner`,
        tabulka: "tickets",
        id: ticketId,
        data: { loaner: zapujcka },
        popis: `Půjčení zařízení · ${popisZakazky(ticketId)}`,
        serviceId: activeServiceIdRef.current,
        chyba: error,
      });
      showToast("Spojení vypadlo – půjčení se uloží samo, jakmile bude připojení. Neztratí se.", "info");
    }
  }, []);

  /**
   * Kontrola po opravě se ukládá s krátkým odkladem.
   *
   * Bez něj šel do databáze zápis na každou klávesu v poznámce. Dvacet
   * požadavků na stejný řádek nemá zaručené pořadí, takže při pomalejší síti
   * mohl doběhnout jako poslední ten s kratším textem – a poznámka se
   * ořízla nebo zmizela. Odklad pošle jen poslední stav; před zavřením
   * detailu a při odchodu ze stránky se dopíše okamžitě.
   */
  /** Přidělený technik – hned do databáze, bez spojení do fronty. */
  const ulozTechnika = useCallback(async (ticketId: string, userId: string | null) => {
    const puvodni = cloudTicketsRef.current.find((t) => t.id === ticketId)?.assignedTo ?? null;
    setCloudTickets((prev) => prev.map((t) => (t.id === ticketId ? { ...t, assignedTo: userId } : t)));
    if (!supabase) return;
    const { error } = await sOkamzitymZapisem<{ error: unknown }>(ticketId, () => (supabase!.from("tickets") as any).update({ assigned_to: userId }).eq("id", ticketId));
    if (!error) return;
    devLog("[technik] zápis selhal", error);
    if (jeTrvalaChyba(error)) {
      setCloudTickets((prev) => prev.map((t) => (t.id === ticketId ? { ...t, assignedTo: puvodni } : t)));
      showToast("Technika se nepodařilo uložit", "error");
      return;
    }
    ulozNaPozdeji({
      klic: `tickets:${ticketId}:assigned_to`,
      tabulka: "tickets",
      id: ticketId,
      data: { assigned_to: userId },
      popis: "Zakázka · technik",
      serviceId: activeServiceId,
      chyba: error,
    });
    showToast("Spojení vypadlo – technik se uloží, jakmile bude připojení.", "info");
  }, [activeServiceId, sOkamzitymZapisem]);

  /**
   * Štítek Find My v detailu – přepíná se jedním klikem, hned do databáze.
   * Stejný postup jako u technika: optimisticky do paměti, při trvalé chybě
   * zpět, při výpadku do fronty.
   */
  const ulozFindMy = useCallback(async (ticketId: string, vypnuto: boolean) => {
    const puvodni = cloudTicketsRef.current.find((t) => t.id === ticketId)?.findMyOff ?? null;
    setCloudTickets((prev) => prev.map((t) => (t.id === ticketId ? { ...t, findMyOff: vypnuto } : t)));
    if (!supabase) return;
    const { error } = await sOkamzitymZapisem<{ error: unknown }>(ticketId, () => (supabase!.from("tickets") as any).update({ find_my_off: vypnuto }).eq("id", ticketId));
    if (!error) return;
    devLog("[find my] zápis selhal", error);
    if (jeTrvalaChyba(error)) {
      setCloudTickets((prev) => prev.map((t) => (t.id === ticketId ? { ...t, findMyOff: puvodni } : t)));
      showToast("Stav Find My se nepodařilo uložit", "error");
      return;
    }
    ulozNaPozdeji({
      klic: `tickets:${ticketId}:find_my_off`,
      tabulka: "tickets",
      id: ticketId,
      data: { find_my_off: vypnuto },
      popis: "Zakázka · Find My",
      serviceId: activeServiceId,
      chyba: error,
    });
    showToast("Spojení vypadlo – stav Find My se uloží, jakmile bude připojení.", "info");
  }, [activeServiceId, sOkamzitymZapisem]);

  const ulozKontrolu = useCallback(async (ticketId: string, kontrola: KontrolaPoOpraveData | null) => {
    const puvodni = cloudTicketsRef.current.find((t) => t.id === ticketId)?.testChecklist;
    setCloudTickets((prev) => prev.map((t) => (t.id === ticketId ? { ...t, testChecklist: kontrola ?? undefined } : t)));
    if (!supabase) return;
    const odlozene = odlozenaKontrolaRef.current;
    const cekajici = odlozene.get(ticketId);
    if (cekajici) clearTimeout(cekajici.casovac);
    const proved = () => {
      odlozene.delete(ticketId);
      void zapisKontrolu(ticketId, kontrola, puvodni);
    };
    odlozene.set(ticketId, { casovac: setTimeout(proved, 450), proved });
  }, []);

  const zapisKontrolu = useCallback(async (ticketId: string, kontrola: KontrolaPoOpraveData | null, puvodni: KontrolaPoOpraveData | undefined) => {
    if (!supabase) return;
    const { error } = await sOkamzitymZapisem<{ error: unknown }>(ticketId, () => (supabase!.from("tickets") as any).update({ test_checklist: kontrola }).eq("id", ticketId));
    if (error) {
      devLog("[kontrola] zápis selhal", error);
      if (jeTrvalaChyba(error)) {
        setCloudTickets((prev) => prev.map((t) => (t.id === ticketId ? { ...t, testChecklist: puvodni } : t)));
        showToast("Kontrolu se nepodařilo uložit", "error");
        return;
      }
      ulozNaPozdeji({
        klic: `tickets:${ticketId}:test_checklist`,
        tabulka: "tickets",
        id: ticketId,
        data: { test_checklist: kontrola },
        popis: `Kontrola po opravě · ${popisZakazky(ticketId)}`,
        serviceId: activeServiceIdRef.current,
        chyba: error,
      });
      showToast("Spojení vypadlo – kontrola se uloží sama, jakmile bude připojení. Neztratí se.", "info");
    }
  }, []);


  /** Odložené zápisy diagnostiky psané v detailu reklamace. */
  const odlozenaDiagnostikaRef = useRef<Map<string, { casovac: ReturnType<typeof setTimeout>; proved: () => void; patch: Record<string, unknown> }>>(new Map());

  /**
   * Zápis diagnostiky zakázky mimo její vlastní detail – typicky z reklamace,
   * kde se ukazují údaje napojené zakázky.
   *
   * Dřív se změna zapsala jen do stavu v prohlížeči a u karty stálo „pro
   * uložení otevřete zakázku a klikněte na Uložit“. Kdo si toho nevšiml,
   * přišel o napsaný protokol i o nahrané fotky – ty zůstaly v úložišti,
   * ale zakázka o nich nevěděla. Text se posílá s krátkým odkladem (píše se
   * po písmenech), fotky hned.
   */
  const ulozDiagnostikuZakazky = useCallback((ticketId: string, patch: { diagnostic_text?: string; diagnostic_photos?: string[]; diagnostic_photos_before?: string[] }, hned: boolean) => {
    if (!supabase) return;
    const odlozene = odlozenaDiagnostikaRef.current;
    const cekajici = odlozene.get(ticketId);
    /* Čekající zápis se s novým sloučí, nezahodí. Patche jsou různé sloupce
       (text vs. fotky), takže zrušením čekajícího by se ztratilo posledních
       pár set milisekund psaní – a v okně by text zůstal, takže by si toho
       nikdo nevšiml až do přenačtení. */
    const spojeny = cekajici ? { ...cekajici.patch, ...patch } : patch;
    if (cekajici) clearTimeout(cekajici.casovac);
    const proved = () => {
      odlozene.delete(ticketId);
      void (async () => {
        const { error } = await sOkamzitymZapisem<{ error: unknown }>(ticketId, () =>
          (supabase!.from("tickets") as any).update(spojeny).eq("id", ticketId));
        if (!error) return;
        devLog("[diagnostika] zápis selhal", error);
        if (jeTrvalaChyba(error)) {
          showToast("Diagnostiku se nepodařilo uložit", "error");
          return;
        }
        ulozNaPozdeji({
          klic: `tickets:${ticketId}:diagnostika`,
          tabulka: "tickets",
          id: ticketId,
          data: spojeny,
          popis: `Diagnostika · ${popisZakazky(ticketId)}`,
          serviceId: activeServiceIdRef.current,
          chyba: error,
        });
      })();
    };
    if (hned) proved();
    else odlozene.set(ticketId, { casovac: setTimeout(proved, 600), proved, patch: spojeny });
  }, [popisZakazky, sOkamzitymZapisem]);

  const updatePerformedRepairFields = useCallback((ticketId: string, repairId: string, fields: Partial<PerformedRepair>) => {
    upravProvedeneOpravy(ticketId, (repairs) => repairs.map((r) => (r.id === repairId ? { ...r, ...fields } : r)), false);
  }, [upravProvedeneOpravy]);

  const removePerformedRepair = useCallback((ticketId: string, repairId: string) => {
    upravProvedeneOpravy(ticketId, (repairs) => repairs.filter((r) => r.id !== repairId), true);
    // Odebraná oprava už díly nedrží – rezervace se uvolní (tiché, když RPC chybí).
    void releaseReservations(ticketId, repairId).then((released) => {
      if (released) void refreshTicketReservations(ticketId);
    });
  }, [refreshTicketReservations, upravProvedeneOpravy]);

  const openNewOrder = () => {
    setSubmitAttempted(false);
    setIsNewOpen(true);
  };

  const setClaimStatus = async (claimId: string, next: string) => {
    if (!statusKeysSet.has(next)) {
      showToast("Neplatný status pro tento servis (obnovte statusy).", "error");
      return;
    }
    const prev = cloudClaims.find((c) => c.id === claimId);
    const completedAt = isFinal(next) ? new Date().toISOString() : null;
    setCloudClaims((p) =>
      p.map((c) =>
        c.id === claimId ? { ...c, status: next, ...(completedAt ? { completed_at: completedAt } : {}) } : c
      )
    );
    const ok = await updateClaimStatus(claimId, next, completedAt ?? undefined, prev?.code ?? undefined);
    if (!ok && prev) {
      setCloudClaims((p) => p.map((c) => (c.id === claimId ? { ...c, status: prev.status } : c)));
    }
  };

  const startEditingClaim = useCallback(() => {
    if (!detailedClaim) return;
    setEditedClaim({
      customer_name: detailedClaim.customer_name ?? "",
      customer_phone: detailedClaim.customer_phone ?? "",
      customer_email: detailedClaim.customer_email ?? "",
      customer_address_street: detailedClaim.customer_address_street ?? "",
      customer_address_city: detailedClaim.customer_address_city ?? "",
      customer_address_zip: detailedClaim.customer_address_zip ?? "",
      customer_company: detailedClaim.customer_company ?? "",
      customer_ico: detailedClaim.customer_ico ?? "",
      customer_info: detailedClaim.customer_info ?? "",
      device_label: detailedClaim.device_label ?? "",
      device_serial: detailedClaim.device_serial ?? "",
      device_brand: detailedClaim.device_brand ?? "",
      device_model: detailedClaim.device_model ?? "",
      device_condition: detailedClaim.device_condition ?? "",
      device_accessories: detailedClaim.device_accessories ?? "",
      device_note: detailedClaim.device_note ?? "",
      device_passcode: detailedClaim.device_passcode ?? "",
      notes: detailedClaim.notes ?? "",
      resolution_summary: detailedClaim.resolution_summary ?? "",
      status: detailedClaim.status,
      expected_completion_at: detailedClaim.expected_completion_at ?? null,
    });
    setIsEditingClaim(true);
  }, [detailedClaim]);

  /** Uložit pouze zákroky reklamace (bez přepnutí do režimu úprav) */
  const saveClaimResolutionItems = useCallback(
    async (claimId: string, items: ClaimResolutionItem[]): Promise<boolean> => {
      const filtered = items.filter((x) => (x.name || "").trim());
      const payload = { resolution_summary: filtered.length > 0 ? serializeClaimResolutionItems(filtered) : null };
      const updated = await updateClaim(claimId, payload as any, cloudClaims.find((c) => c.id === claimId)?.code ?? undefined);
      if (!updated) return false;
      setCloudClaims((prev) => prev.map((cl) => (cl.id === claimId ? { ...cl, ...updated } : cl)));
      setClaimResolutionDraft(null);
      return true;
    },
    [updateClaim, cloudClaims]
  );

  const saveClaimChanges = useCallback(async (): Promise<boolean> => {
    if (!detailedClaim) return false;
    const payload: Record<string, unknown> = {};
    const c = { ...detailedClaim, ...editedClaim };
    if (claimResolutionDraft !== null) {
      const filtered = claimResolutionDraft.filter((x) => (x.name || "").trim());
      payload.resolution_summary = filtered.length > 0 ? serializeClaimResolutionItems(filtered) : null;
    } else if (c.resolution_summary !== undefined) {
      const items = parseClaimResolutionItems(c.resolution_summary || null).filter((x) => (x.name || "").trim());
      payload.resolution_summary = items.length > 0 ? serializeClaimResolutionItems(items) : null;
    }
    if (c.customer_name !== undefined) payload.customer_name = c.customer_name || null;
    if (c.customer_phone !== undefined) payload.customer_phone = c.customer_phone || null;
    if (c.customer_email !== undefined) payload.customer_email = c.customer_email || null;
    if (c.customer_address_street !== undefined) payload.customer_address_street = c.customer_address_street || null;
    if (c.customer_address_city !== undefined) payload.customer_address_city = c.customer_address_city || null;
    if (c.customer_address_zip !== undefined) payload.customer_address_zip = c.customer_address_zip || null;
    if (c.customer_company !== undefined) payload.customer_company = c.customer_company || null;
    if (c.customer_ico !== undefined) payload.customer_ico = c.customer_ico || null;
    if (c.customer_info !== undefined) payload.customer_info = c.customer_info || null;
    if (c.device_label !== undefined) payload.device_label = c.device_label || null;
    if (c.device_serial !== undefined) payload.device_serial = c.device_serial || null;
    if (c.device_brand !== undefined) payload.device_brand = c.device_brand || null;
    if (c.device_model !== undefined) payload.device_model = c.device_model || null;
    if (c.device_condition !== undefined) payload.device_condition = c.device_condition || null;
    if (c.device_accessories !== undefined) payload.device_accessories = c.device_accessories || null;
    if (c.device_note !== undefined) payload.device_note = c.device_note || null;
    if (c.device_passcode !== undefined) payload.device_passcode = c.device_passcode || null;
    if (c.notes !== undefined) payload.notes = c.notes || "";
    if (c.status !== undefined) payload.status = c.status;
    if ("expected_completion_at" in c && (c as any).expected_completion_at !== undefined) payload.expected_completion_at = (c as any).expected_completion_at;
    const updated = await updateClaim(detailedClaim.id, payload as any, detailedClaim.code ?? undefined);
    if (!updated) return false;
    setCloudClaims((prev) => prev.map((cl) => (cl.id === detailedClaim.id ? { ...cl, ...updated } : cl)));
    setIsEditingClaim(false);
    setEditedClaim({});
    setClaimResolutionDraft(null);
    return true;
  }, [detailedClaim, editedClaim, claimResolutionDraft, updateClaim]);

  /**
   * Stav, který vypadá jako storno – servisy si stavy pojmenovávají sami,
   * takže se poznává podle názvu. Při přechodu do něj se servis zeptá proč
   * (StornoDialog) a odpověď uloží do historie; stav se změní až po potvrzení.
   */
  const jeStornoStav = (key: string) => /cancel|storno/i.test(key) || /storn|zruš|nerealiz|neopraven|odmítn/i.test(getByKey(key)?.label ?? "");

  const setTicketStatus = async (ticketId: string, next: string) => {
    const soucasny = statusById[ticketId] ?? tickets.find((t) => t.id === ticketId)?.status;
    if (jeStornoStav(next) && !jeStornoStav(String(soucasny ?? ""))) {
      setStornoDotaz({ ticketId, next });
      return;
    }
    await provedZmenuStavu(ticketId, next);
  };

  const potvrdStorno = async (odpoved: { duvod: string; poznamka: string }) => {
    if (!stornoDotaz) return;
    const { ticketId, next } = stornoDotaz;
    // Nejdřív změna stavu; když neprojde (oprávnění, neplatný stav), důvod se
    // nezapíše a dialog zůstane otevřený – hlášku o chybě ukáže změna stavu.
    const zmeneno = await provedZmenuStavu(ticketId, next);
    if (!zmeneno) return;
    if (!supabase || !activeServiceId) {
      setStornoDotaz(null);
      return;
    }
    /* Dotaz na uživatele je taky síťové volání. Když spadne (offline,
       vypršelý token), nesmí to shodit celý potvrzovací krok – stav zakázky
       už je změněný a dialog by zůstal viset nad stornovanou zakázkou.
       Důvod storna je cennější než jméno toho, kdo ho zapsal. */
    let uid: string | null = null;
    try {
      uid = (await supabase.auth.getUser()).data.user?.id ?? null;
    } catch {
      uid = null;
    }
    const radek = {
      ticket_id: ticketId,
      service_id: activeServiceId,
      action: "cancel_reason",
      changed_by: uid,
      details: { duvod: odpoved.duvod, poznamka: odpoved.poznamka, status: next },
    };
    /* Zápis se opakuje. `insert` chybu nevyhazuje, jen ji vrátí – dřív se
       nekontrolovala vůbec, takže se důvod storna občas do historie nezapsal
       a nikdo se to nedozvěděl. Historie zakázky je přitom to jediné, kde
       důvod zůstane. */
    let posledniChyba: unknown = null;
    for (let pokus = 0; pokus < 3; pokus++) {
      try {
        const { error } = await (supabase.from("ticket_history") as any).insert(radek);
        if (!error) {
          // Dialog se zavírá až po zápisu: kdo hned otevře historii, vidí důvod.
          setStornoDotaz(null);
          return;
        }
        posledniChyba = error;
      } catch (err) {
        posledniChyba = err;
      }
      await new Promise((r) => setTimeout(r, 400 * (pokus + 1)));
    }
    setStornoDotaz(null);
    reportError({
      code: "orders.cancel_reason_failed",
      error: posledniChyba,
      userMessage: "Zakázka je zrušená, ale důvod se nepodařilo zapsat do historie.",
      source: "Orders.potvrdStorno",
      serviceId: activeServiceId,
    });
  };

  const provedZmenuStavu = async (ticketId: string, next: string): Promise<boolean> => {
    // Guard: check if selectedStatusKey is valid (exists in statuses array)
    if (!statusKeysSet.has(next)) {
      showToast("Neplatný status pro tento servis (obnovte statusy).", "error");
      return false;
    }

    const ticket = tickets.find((t) => t.id === ticketId);

    // Optimistic update
    const prevStatus = statusById[ticketId] ?? (ticket?.status as any);
    setStatusById((prev) => ({ ...prev, [ticketId]: next }));
      setCloudTickets((prev) => prev.map((t) => (t.id === ticketId ? ({ ...t, status: next as any } as TicketEx) : t)));

    // Call RPC if supabase is available
    if (supabase) {
      try {
        const { error } = await (supabase as any).rpc("change_ticket_status", {
          p_ticket_id: ticketId,
          p_next: next,
        });

        if (error) {
          console.error("[change_ticket_status] rpc error", error);
          throw error;
        }

        // Koncový stav: rezervované díly se odečtou ze skladu. Zpět z koncového
        // stavu se nic nevrací – odečtené zůstává odečtené.
        if (isFinal(next)) {
          void consumeTicketReservations(ticketId).then((res) => {
            if (!res) return;
            if (res.shortages.length > 0) {
              const chybelo = res.shortages.map((s) => `${s.name} ×${s.missing}`).join(", ");
              showToast(`Odečteno ze skladu, chybělo: ${chybelo}`, "info");
            }
            if (res.consumed > 0) void refreshTicketReservations(ticketId);
          });
        }
        // Zpět z koncového stavu: odečtené díly zůstávají odečtené. Ať to
        // člověk ví hned, ne až při inventuře.
        if (
          prevStatus && isFinal(String(prevStatus)) && !isFinal(next) &&
          ticketReservations.ticketId === ticketId && ticketReservations.rows.some((r) => r.status === "consumed")
        ) {
          showToast("Díly odečtené ze skladu se vrácením stavu nevracejí – případně je naskladněte ručně.", "info");
        }

        const config = await loadDocumentsConfigFromDB(activeServiceId);
        /* Automatický tisk i automatizace pracují s celou zakázkou – adresa,
           stav zařízení, kontrola po opravě, cena. Ze seznamu se stav mění
           u řádku, který má jen sloupce seznamu, takže se zbytek dotáhne.
           Jen když je pro tenhle stav opravdu co spustit: jinak by každé
           přepnutí stavu platilo dotazem navíc. */
        const potrebaCelaZakazka =
          config?.autoPrint?.ticketListOnStatusKey === next ||
          config?.autoPrint?.warrantyOnStatusKey === next ||
          hasAutomationRulesFor(next);
        const zaklad = potrebaCelaZakazka ? ((await zajistiPlnouZakazku(ticketId)) ?? ticket) : ticket;
        const ticketUpdated = zaklad ? { ...zaklad, status: next as any } : tickets.find((t) => t.id === ticketId);
        if (config?.autoPrint && ticketUpdated) {
          if (config.autoPrint.ticketListOnStatusKey === next) {
            printTicket(ticketUpdated as TicketEx, activeServiceId).then(() => {});
          }
          if (config.autoPrint.warrantyOnStatusKey === next) {
            printWarranty(ticketUpdated as TicketEx, activeServiceId).then(() => {});
          }
        }
        // Automatizace (stavebnice pravidel) – na pozadí, po úspěšné změně stavu.
        if (ticketUpdated && activeServiceId) {
          const tu = ticketUpdated as TicketEx;
          const sid = activeServiceId;
          void runStatusChangeAutomations({
            serviceId: sid,
            ticketId,
            statusKey: next,
            statusLabel: statuses.find((s) => s.key === next)?.label ?? next,
            ticket: tu,
            totalPrice: computeFinalPrice(toCardData(tu as (typeof filtered)[number])),
            resolvePortalUrl: async () => portalUrl(tu.portalToken || (await ensurePortalToken(ticketId))),
            hasRules: hasAutomationRulesFor(next),
          });
        }
      return true;
      } catch (err: any) {
        // Rollback optimistic update
        setStatusById((prev) => {
          const next = { ...prev };
          if (prevStatus) {
            next[ticketId] = prevStatus;
          } else {
            delete next[ticketId];
          }
          return next;
        });
        setCloudTickets((prev) => prev.map((t) => (t.id === ticketId ? ({ ...t, status: prevStatus as any } as TicketEx) : t)));

        console.error("[change_ticket_status] error", err);
        const errorMessage = err?.message || "Neznámá chyba";
        if (errorMessage.includes("Not authorized") || errorMessage.includes("permission")) {
          showToast("Nemáte oprávnění měnit status zakázky", "error");
        } else {
        showToast(`Chyba při změně statusu: ${errorMessage}`, "error");
        }
        return false;
      }
    }
    // Bez připojení zůstala jen optimistická změna – pro volajícího je hotová.
    return true;
  };


  /** Skončil poslední zápis ve frontě? Pak se nesmí hlásit „Změny uloženy“. */
  const zapisSkoncilVeFronteRef = useRef(false);

  const saveTicketChanges = useCallback(async (): Promise<boolean> => {
    zapisSkoncilVeFronteRef.current = false;
    if (!detailedTicket) {
      return false;
    }
    if (uiCfg.orders.customerPhoneRequired && !(editedTicket.customerPhone ?? detailedTicket.customerPhone ?? "").trim()) {
      showToast("Telefon zákazníka je povinný. Vyplňte ho před uložením.", "error");
      return false;
    }

    return saveTicketChangesAction({
      detailedTicket,
      editedTicket,
      onSuccess: (updatedTicket) => {
        setIsEditing(false);
        setEditedTicket({});
        // Aktualizovat původní hodnotu po úspěšném uložení
        originalTicketRef.current = JSON.parse(JSON.stringify(updatedTicket));
        // Reset dirty flags after successful save
        setDirtyFlags({
          diagnosticText: false,
          diagnosticPhotos: false,
          performedRepairs: false,
        });
        // Opravy po neúspěšném okamžitém zápisu jsou teď v databázi.
        neulozeneOpravyRef.current.delete(updatedTicket.id);
      },
      /* Souběžná úprava: zakázka se načte znovu (kvůli `version`, jinak by
         každé další uložení narazilo na stejný konflikt), ale režim úprav
         zůstává a rozepsané změny s ním. Dřív se tu volal `onSuccess`, který
         je zahodil – uživatel dostal hlášku „zkontrolujte a uložte znovu“
         nad formulářem, kde už jeho práce nebyla. */
      onConflict: (refreshedTicket) => {
        originalTicketRef.current = JSON.parse(JSON.stringify(refreshedTicket));
      },
      onQueued: () => {
        zapisSkoncilVeFronteRef.current = true;
      },
    });
  }, [detailedTicket, editedTicket, saveTicketChangesAction, activeServiceId, uiCfg.orders.customerPhoneRequired]);

  const handleCloseDetail = useCallback(async () => {
    devLog("[Close] clicked - about to save?");
    
    const hasEditingChanges = isEditing && Object.keys(editedTicket).length > 0;
    const hasEditingClaimChanges = isEditingClaim && Object.keys(editedClaim).length > 0;
    
    if (hasEditingChanges || hasEditingClaimChanges) {
      showToast("Máte neuložené změny. Uložte nebo zrušte úpravy.", "error");
      return;
    }

    // Odložený zápis oprav (cena, náklady) nesmí čekat, až se detail zavře.
    dokoncitOdlozeneZapisyOprav();

    const hasDirtyAutoSave = dirtyFlags.diagnosticText || dirtyFlags.diagnosticPhotos || dirtyFlags.performedRepairs;
    if (hasDirtyAutoSave) {
      try {
        const saved = await saveTicketChanges();
        if (!saved) {
          return;
        }
        // Nad změnou, která teprve čeká ve frontě, by „uloženo“ byla lež.
        if (!zapisSkoncilVeFronteRef.current) showToast("Změny uloženy", "success");
      } catch (err) {
        showToast("Chyba při ukládání změn: " + (err instanceof Error ? err.message : "Neznámá chyba"), "error");
        return;
      }
    }

    const page = returnToPage;
    const customerId = returnToCustomerIdRef.current;
    setDetailId(null);
    setDetailClaimId(null);
    setIsEditingClaim(false);
    setEditedClaim({});
    setReturnToPage(null);
    returnToCustomerIdRef.current = undefined;
    if (page && onReturnToPage) {
      onReturnToPage(page, customerId);
    }
  }, [saveTicketChanges, returnToPage, onReturnToPage, dirtyFlags, isEditing, editedTicket, isEditingClaim, editedClaim, dokoncitOdlozeneZapisyOprav]);

  // Escape: zavřít detail/modal; v capture phase + preventDefault, aby v fullscreen neukončil fullscreen
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const hasSomethingToClose = smsPanelOpen || ticketHistoryModalOpen || claimHistoryModalOpen || !!detailId || !!detailClaimId || isNewOpen;
      if (!hasSomethingToClose) return;
      // Otevřená nabídka (našeptávač, stavy, Tisk, ⋯) si Escape zpracuje sama – nezavírat kvůli ní celé okno.
      if (document.querySelector('[role="listbox"], [role="menu"], [data-escape-vlastni]')) return;
      e.preventDefault();
      e.stopPropagation();
      if (smsPanelOpen) {
        setSmsPanelOpen(false);
        return;
      }
      if (ticketHistoryModalOpen) {
        setTicketHistoryModalOpen(false);
        return;
      }
      if (claimHistoryModalOpen) {
        setClaimHistoryModalOpen(false);
        return;
      }
      if (detailId || detailClaimId) {
        await handleCloseDetail();
      } else if (isNewOpen) {
        setIsNewOpen(false);
        setCustomerMatchDecision("undecided");
        setMatchedCustomer(null);
        lastLookupPhoneNormRef.current = null;
        if (phoneLookupDebounceTimerRef.current) {
          clearTimeout(phoneLookupDebounceTimerRef.current);
          phoneLookupDebounceTimerRef.current = null;
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [smsPanelOpen, detailId, detailClaimId, isNewOpen, ticketHistoryModalOpen, claimHistoryModalOpen, handleCloseDetail]);

  // Zamykání scrollu za modalem – body i hlavní oblast (main) scrollují, obě musí být zamčené
  useEffect(() => {
    if (!detailId && !detailClaimId) return;
    const prevBody = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const main = document.querySelector("main");
    if (main instanceof HTMLElement) {
      main.style.overflow = "hidden";
    }
    return () => {
      document.body.style.overflow = prevBody;
      if (main instanceof HTMLElement) {
        main.style.overflow = "auto";
      }
    };
  }, [detailId, detailClaimId]);

  useEffect(() => {
    setClaimResolutionDraft(null);
  }, [detailClaimId]);

  useEffect(() => {
    if (!detailedTicket) return;
    return registerShortcut("order_print", () => printTicket(detailedTicket, activeServiceId), { priority: 20 });
  }, [detailedTicket, activeServiceId, session?.user?.id]);

  // Enter v náhledu zakázky při úpravách = Uložit a zavřít (kromě textarea, kde Enter = nový řádek)
  useEffect(() => {
    if (!detailId || !isEditing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      const target = e.target as Node | null;
      if (target && typeof (target as HTMLElement).tagName === "string" && (target as HTMLElement).tagName === "TEXTAREA") return;
      e.preventDefault();
      saveTicketChanges().then((ok) => {
        if (!ok) return;
        if (!zapisSkoncilVeFronteRef.current) showToast("Změny uloženy", "success");
        const page = returnToPage;
        const customerId = returnToCustomerIdRef.current;
        setDetailId(null);
        setReturnToPage(null);
        returnToCustomerIdRef.current = undefined;
        if (page && onReturnToPage) onReturnToPage(page, customerId);
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detailId, isEditing, saveTicketChanges, returnToPage, onReturnToPage]);

  const startEditing = useCallback(() => {
    if (!detailedTicket) return;
    setEditedTicket({
      customerName: detailedTicket.customerName,
      customerPhone: detailedTicket.customerPhone || "",
      customerEmail: detailedTicket.customerEmail || "",
      customerAddressStreet: detailedTicket.customerAddressStreet || "",
      customerAddressCity: detailedTicket.customerAddressCity || "",
      customerAddressZip: detailedTicket.customerAddressZip || "",
      customerCompany: detailedTicket.customerCompany || "",
      customerIco: detailedTicket.customerIco || "",
      customerInfo: detailedTicket.customerInfo || "",
      deviceLabel: detailedTicket.deviceLabel,
      serialOrImei: detailedTicket.serialOrImei || "",
      devicePasscode: detailedTicket.devicePasscode || "",
      deviceCondition: detailedTicket.deviceCondition || "",
      deviceAccessories: detailedTicket.deviceAccessories || "",
      warrantyClaim: detailedTicket.warrantyClaim ?? null,
      purchaseDate: detailedTicket.purchaseDate || "",
      purchaseProof: detailedTicket.purchaseProof || "",
      requestedRepair: detailedTicket.requestedRepair || detailedTicket.issueShort || "",
      handoffMethod: detailedTicket.handoffMethod || "",
      handbackMethod: detailedTicket.handbackMethod || "",
      deviceNote: detailedTicket.deviceNote || "",
      externalId: detailedTicket.externalId || "",
      expectedCompletionAt: (detailedTicket as any).expected_completion_at ?? null,
    } as any);
    setIsEditing(true);
  }, [detailedTicket]);

  useEffect(() => {
    openNewOrderRef.current = openNewOrder;
    startEditingRef.current = startEditing;
    saveTicketChangesRef.current = saveTicketChanges;
    detailIdRef.current = detailId;
    isEditingRef.current = isEditing;
  });

  /**
   * Zkratky stránky Zakázky. Priorita 10 – přebijí globální navigaci, ale jen
   * dokud je stránka vidět (App drží Orders namountované i skryté).
   */
  useEffect(() => {
    const naStrance = () => !closeDetailWhen;
    const offs = [
      registerShortcut("orders_search", () => searchInputRef.current?.focus(), {
        priority: 10,
        allowInInput: true,
        enabled: naStrance,
      }),
      registerShortcut("orders_new", () => openNewOrderRef.current(), { priority: 10, enabled: naStrance }),
      registerShortcut("order_detail_edit", () => startEditingRef.current(), {
        priority: 10,
        enabled: () => naStrance() && !!detailIdRef.current && !isEditingRef.current,
      }),
      registerShortcut("order_detail_save", () => saveTicketChangesRef.current(), {
        priority: 10,
        allowInInput: true,
        enabled: () => naStrance() && !!detailIdRef.current && isEditingRef.current,
      }),
    ];
    return () => { for (const off of offs) off(); };
  }, [closeDetailWhen]);

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    newDraft.devices.forEach((dev, i) => {
      if (!dev.deviceLabel.trim()) e[`deviceLabel_${i}`] = "Vyplňte zařízení.";
      // Záruční oprava bez data nákupu ani dokladu se u dodavatele neuplatní.
      if (chybiPodkladZaruky(dev)) e[`zaruka_${i}`] = "U záruční opravy vyplňte datum nákupu nebo doklad o koupi.";
    });
    const phoneRequired = uiCfg.orders.customerPhoneRequired;
    if (phoneRequired && !newDraft.customerPhone.trim()) e.customerPhone = "Telefon je povinný.";
    else if (!isPhoneValid(newDraft.customerPhone)) e.customerPhone = "Telefon vypadá neplatně.";
    if (!isEmailValid(newDraft.customerEmail)) e.customerEmail = "E-mail vypadá neplatně.";
    if (!isZipValid(newDraft.addressZip)) e.addressZip = "PSČ musí mít 5 číslic.";
    if (!isIcoValid(newDraft.ico)) e.ico = "IČO musí mít 8 číslic.";
    return e;
  }, [newDraft, uiCfg.orders.customerPhoneRequired]);

  const canCreate = Object.keys(errors).length === 0;
  const showError = (field: string) => submitAttempted && !!errors[field];
  const showDeviceError = (idx: number) => submitAttempted && !!errors[`deviceLabel_${idx}`];

  /** Krátký důvod, proč nejde vytvořit – k tlačítku v patičce. */
  const createBlockedReason = useMemo(() => {
    const keys = Object.keys(errors);
    if (keys.length === 0) return null;
    if (keys.some((k) => k.startsWith("deviceLabel_"))) return "Chybí zařízení";
    if (keys.some((k) => k.startsWith("zaruka_"))) return "Chybí podklad záruky";
    if (errors.customerPhone) return errors.customerPhone === "Telefon je povinný." ? "Chybí telefon" : "Neplatný telefon";
    if (errors.customerEmail) return "Neplatný e-mail";
    if (errors.addressZip) return "Neplatné PSČ";
    if (errors.ico) return "Neplatné IČO";
    return "Zkontrolujte vyplněné údaje";
  }, [errors]);

  /**
   * Při pokusu o vytvoření s chybami: rozbalí, co je třeba, a přesune fokus
   * do prvního chybného pole. Pořadí odpovídá pořadí polí ve formuláři.
   */
  const focusFirstInvalidField = () => {
    const deviceIdx = newDraft.devices.findIndex((_, i) => !!errors[`deviceLabel_${i}`]);
    let selector: string | null = null;
    // E-mail, PSČ a IČO leží v kartě Zákazník pod sbalitelnými „Dalšími údaji zákazníka“.
    let needsCustomerMore = false;
    if (errors.customerPhone) selector = "#new-order-phone";
    else if (errors.customerEmail) { selector = "#new-order-email"; needsCustomerMore = true; }
    else if (errors.addressZip) { selector = "#new-order-zip"; needsCustomerMore = true; }
    else if (errors.ico) { selector = "#new-order-ico"; needsCustomerMore = true; }
    else if (deviceIdx >= 0) {
      setExpandedDeviceIdx(deviceIdx);
      selector = `#new-order-device-${deviceIdx} input`;
    }
    if (!selector) return;
    if (needsCustomerMore) setNewOrderCustomerMoreOpen(true);
    const sel = selector;
    window.setTimeout(() => {
      const root = newOrderBodyRef.current ?? document;
      const el = root.querySelector<HTMLElement>(sel);
      if (el) {
        el.focus();
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }, 60);
  };

  const createTicket = () => {
    setSubmitAttempted(true);
    if (!canCreate) {
      focusFirstInvalidField();
      return;
    }

    const chosenBranch = branchById(newDraft.branchId) ?? branchForNew;
    const rezervaceId = newDraft.rezervaceId;
    createTicketAction({
      newDraft,
      branch: chosenBranch ? { id: chosenBranch.id, code: chosenBranch.code } : null,
      customerMatchDecision,
      draftCaptureToken: draftCaptureTokenRef.current ?? undefined,
      onSuccess: async (tickets) => {
        draftCaptureTokenRef.current = null;
        setDraftCapturePreviewUrls([]);
        setDraftCaptureLiveCount(0);
        setNewDraft(defaultDraft());
        setIsNewOpen(false);
        setSubmitAttempted(false);
        setCustomerMatchDecision("undecided");
        setMatchedCustomer(null);
        lastLookupPhoneNormRef.current = null;
        if (phoneLookupDebounceTimerRef.current) {
          clearTimeout(phoneLookupDebounceTimerRef.current);
          phoneLookupDebounceTimerRef.current = null;
        }
        safeSaveDraft(null);
        window.dispatchEvent(new CustomEvent("jobsheet:draft-count", { detail: { count: 0 } }));
        const first = tickets[0];
        if (first) setDetailId(first.id);
        if (first && rezervaceId) {
          nastavStavRezervace(rezervaceId, "converted", first.id)
            .then((zmeneno) => {
              if (!zmeneno) showToast("Rezervaci mezitím někdo vyřídil; zakázka je založená.", "info");
              window.dispatchEvent(new CustomEvent("jobsheet:rezervace-zmena"));
            })
            .catch((e) => devLog("[rezervace] označení převedené selhalo", e));
        }
        const config = await loadDocumentsConfigFromDB(activeServiceId);
        if (first && config?.autoPrint?.ticketListOnCreate) {
          printTicket(first, activeServiceId).then(() => {});
        }
        if (first && config?.autoPrint?.warrantyOnCreate) {
          printWarranty(first, activeServiceId).then(() => {});
        }
        if (activeServiceId) {
          for (const t of tickets) void runTicketCreatedAutomations(activeServiceId, t.id);
        }
        // Opravy vybrané už při příjmu: díly se rezervují po vzniku zakázky.
        void (async () => {
          const shortages = new Map<string, ReserveShortage>();
          for (const t of tickets) {
            for (const r of t.performedRepairs ?? []) {
              if (!r.productIds || r.productIds.length === 0) continue;
              const res = await reserveEntryProducts(t.id, r.id, r.productIds);
              for (const s of res?.shortages ?? []) shortages.set(s.productId, s);
            }
          }
          toastReserveShortages(Array.from(shortages.values()));
        })();
      },
    });
  };

  createTicketRef.current = createTicket;

  /** Tisk / export dokumentu „Přijetí reklamace“ z hlavičky detailu reklamace. */
  const runClaimDocument = async (action: DocMode) => {
    if (!detailedClaim) return;
    const sid = activeServiceId ?? undefined;
    if (!sid) {
      showToast("Vyberte servis pro tisk.", "error");
      return;
    }
    const original = cloudTickets.find((t) => t.id === detailedClaim.source_ticket_id) as TicketEx | undefined;
    const data = claimDocumentData(detailedClaim, safeLoadCompanyData(), original?.code ?? "");
    if (isWeb()) {
      await runWebDocument(action, "prijemka_reklamace", sid, data);
      return;
    }
    await runDesktopDocument(action, "prijemka_reklamace", sid, data, `prijemka-reklamace-${detailedClaim.code}.pdf`);
  };

  /** Zavře okno Nová zakázka; rozpracované údaje zůstávají uložené. */
  const closeNewOrder = () => {
    setIsNewOpen(false);
    setCustomerMatchDecision("undecided");
    setMatchedCustomer(null);
    lastLookupPhoneNormRef.current = null;
    if (phoneLookupDebounceTimerRef.current) {
      clearTimeout(phoneLookupDebounceTimerRef.current);
      phoneLookupDebounceTimerRef.current = null;
    }
  };

  /** Zruší rozpracovanou zakázku – zahodí koncept i přijímací fotky. */
  const discardNewOrder = () => {
    draftCaptureTokenRef.current = null;
    setDraftCapturePreviewUrls([]);
    setDraftCaptureLiveCount(0);
    setNewDraft(defaultDraft());
    safeSaveDraft(null);
    window.dispatchEvent(new CustomEvent("jobsheet:draft-count", { detail: { count: 0 } }));
    setExpandedDeviceIdx(0);
    closeNewOrder();
  };

  // ⌘/Ctrl+Enter v okně Nová zakázka = Vytvořit zakázku
  useEffect(() => {
    if (!isNewOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      createTicketRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isNewOpen]);

  // Nově přidané zařízení je rozbalené; po smazání drží index v mezích.
  useEffect(() => {
    setExpandedDeviceIdx((idx) => Math.min(idx, Math.max(0, newDraft.devices.length - 1)));
  }, [newDraft.devices.length]);

  const loadDraftCapturePreviews = useCallback(async (showAddedToast: boolean = true) => {
    const draftToken = draftCaptureTokenRef.current;
    if (!draftToken || !supabase || !supabaseUrl || !supabaseAnonKey) return;
    try {
      const authToken = (await supabase.auth.getSession()).data?.session?.access_token;
      if (!authToken) return;
      const res = await supabaseFetch(`${supabaseUrl}/functions/v1/capture-list-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}`, apikey: supabaseAnonKey },
        body: JSON.stringify({ token: draftToken }),
      });
      const raw = await res.text();
      const data: { urls?: string[]; error?: string } = raw ? JSON.parse(raw) : {};
      if (!res.ok) throw new Error(data.error || res.statusText);
      if (Array.isArray(data.urls)) {
        setDraftCaptureLiveCount(data.urls.length);
        setDraftCapturePreviewUrls((prev) => {
          const added = Math.max(0, data.urls!.length - prev.length);
          if (showAddedToast && added > 0) {
            const suffix = added === 1 ? "fotka" : added >= 2 && added <= 4 ? "fotky" : "fotek";
            showToast(`Načteno ${added} ${suffix} z mobilu`, "success");
          }
          return data.urls!;
        });
      }
    } catch (err) {
      console.warn("[Orders] loadDraftCapturePreviews failed", err);
    }
  }, []);

  const closeCaptureQrModal = useCallback(() => {
    setCaptureQRItems(null);
    void loadDraftCapturePreviews(true);
  }, [loadDraftCapturePreviews]);

  useEffect(() => {
    if (!captureQRItems || !draftCaptureTokenRef.current) return;
    void loadDraftCapturePreviews(false);
    const t = setInterval(() => {
      void loadDraftCapturePreviews(false);
    }, 3000);
    return () => clearInterval(t);
  }, [captureQRItems, loadDraftCapturePreviews]);

  const commentsFor = (ticketId: string): TicketComment[] => {
    const all = (commentsByTicket[ticketId] ?? []).slice();

    all.sort((a, b) => {
      const ap = !!a.pinned;
      const bp = !!b.pinned;
      if (ap !== bp) return ap ? -1 : 1;
      return (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
    });

    return all;
  };

  const addComment = async (ticketId: string) => {
    const text = (commentDraftByTicket[ticketId] ?? "").trim();
    if (!text || !supabase || !activeServiceId) return;

    const displayName = userProfile?.nickname?.trim() || session?.user?.email?.split("@")[0] || "Servis";
    const payload = {
      ticket_id: ticketId,
      service_id: activeServiceId,
      author: displayName,
      author_id: session?.user?.id ?? null,
      author_nickname: userProfile?.nickname?.trim() || null,
      author_avatar_url: userProfile?.avatarUrl?.trim() || null,
      content: text,
      pinned: false,
    };

    setCommentDraftByTicket((p) => ({ ...p, [ticketId]: "" }));

    const { data, error } = await (supabase.from("ticket_comments") as any)
      .insert(payload)
      .select("id,ticket_id,author,author_id,author_nickname,author_avatar_url,content,pinned,created_at")
      .single();

    if (error || !data) {
      console.error("[Orders] Error adding comment:", error);
      showToast("Nepodařilo se uložit komentář.", "error");
      setCommentDraftByTicket((p) => ({ ...p, [ticketId]: text }));
      return;
    }

    const c = mapSupabaseCommentRow(data as SupabaseTicketCommentRow);
    setCommentsByTicket((p) => ({ ...p, [ticketId]: [...(p[ticketId] ?? []), c] }));
  };

  const editComment = async (ticketId: string, commentId: string, text: string) => {
    if (!supabase) return;
    const prev = commentsByTicket[ticketId]?.find((c) => c.id === commentId);
    if (!prev || prev.text === text) return;
    setCommentsByTicket((p) => ({
      ...p,
      [ticketId]: (p[ticketId] ?? []).map((c) => (c.id === commentId ? { ...c, text } : c)),
    }));
    const { error } = await (supabase.from("ticket_comments") as any).update({ content: text }).eq("id", commentId);
    if (error) {
      setCommentsByTicket((p) => ({
        ...p,
        [ticketId]: (p[ticketId] ?? []).map((c) => (c.id === commentId ? { ...c, text: prev.text } : c)),
      }));
      reportError({ code: "orders.comment_edit_failed", error, userMessage: "Komentář se nepodařilo upravit.", source: "Orders.editComment", serviceId: activeServiceId });
    }
  };

  // Fotky a přezdívky autorů komentářů z aktuálních profilů (komentář má
  // jen snímek z doby uložení – kdo si fotku přidal později, byl bez ní).
  const commentAuthorIdsKey = useMemo(() => {
    const ids = new Set<string>();
    for (const list of Object.values(commentsByTicket)) for (const c of list) if (c.author_id) ids.add(c.author_id);
    return [...ids].sort().join(",");
  }, [commentsByTicket]);
  useEffect(() => {
    if (!supabase || !commentAuthorIdsKey) return;
    const ids = commentAuthorIdsKey.split(",");
    let cancelled = false;
    (async () => {
      const { data, error } = await (supabase.from("profiles") as any).select("id, nickname, avatar_url").in("id", ids);
      if (cancelled || error || !Array.isArray(data)) return;
      const map: Record<string, { nickname: string | null; avatarUrl: string | null }> = {};
      for (const p of data) map[p.id] = { nickname: p.nickname ?? null, avatarUrl: p.avatar_url ?? null };
      setCommentAuthorProfiles(map);
    })();
    return () => { cancelled = true; };
  }, [commentAuthorIdsKey]);

  const togglePin = async (ticketId: string, commentId: string) => {
    if (!supabase) return;
    const current = commentsByTicket[ticketId]?.find((c) => c.id === commentId);
    const nextPinned = !current?.pinned;

    setCommentsByTicket((p) => ({
      ...p,
      [ticketId]: (p[ticketId] ?? []).map((c) => (c.id === commentId ? { ...c, pinned: nextPinned } : c)),
    }));

    const { error } = await (supabase.from("ticket_comments") as any).update({ pinned: nextPinned }).eq("id", commentId);
    if (error) {
      console.error("[Orders] Error toggling comment pin:", error);
      setCommentsByTicket((p) => ({
        ...p,
        [ticketId]: (p[ticketId] ?? []).map((c) => (c.id === commentId ? { ...c, pinned: !nextPinned } : c)),
      }));
    }
  };

  const handleCommentDraftChange = useCallback((ticketId: string, value: string) => {
    setCommentDraftByTicket((p) => ({ ...p, [ticketId]: value }));
  }, []);

  const toCardData = useCallback((t: (typeof filtered)[number]): TicketCardData => ({
    id: t.id,
    code: t.code,
    customerName: t.customerName,
    customerPhone: t.customerPhone,
    deviceLabel: t.deviceLabel,
    serialOrImei: t.serialOrImei,
    issueShort: t.issueShort,
    technik: pridelovaniTechnika ? clenove.jmeno(t.assignedTo) : null,
    // Šedý štítek: odkud zakázka je, když to není vybraná pobočka (v pohledu
    // „Všechny pobočky“ vždy). Oranžový: kde fyzicky je, když ne doma.
    pobocka: hasBranches && t.branchId && t.branchId !== activeBranchId ? (branchById(t.branchId)?.name ?? null) : null,
    umisteni: zasilkyZapnuty && hasBranches ? stitekUmisteni(umisteniZakazky(t), (id) => branchById(id)?.name ?? "jiná pobočka") : null,
    umisteniVaruje: zasilkyZapnuty && hasBranches ? dniBezZmenyJinde(t, nastaveniZasilek.upozorneniDni) : null,
    requestedRepair: t.requestedRepair,
    createdAt: t.createdAt,
    status: (t.status as any) ?? statusById[t.id] ?? null,
    discountType: t.discountType,
    discountValue: t.discountValue,
    performedRepairs: t.performedRepairs,
    expectedDoneAt: t.expectedDoneAt,
  }), [statusById, pridelovaniTechnika, clenove, zasilkyZapnuty, hasBranches, branchById, activeBranchId, nastaveniZasilek.upozorneniDni]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <SeznamZakazek
        activeServiceId={activeServiceId}
        isAdmin={isAdmin}
        ticketIds={ticketIds}
        searchInputRef={searchInputRef}
        query={query}
        setQuery={setQuery}
        openNewOrder={openNewOrder}
        onNovaReklamace={() => { setClaimSourceTicket(null); setCreateClaimModalOpen(true); }}
        activeGroup={activeGroup}
        setActiveGroup={setActiveGroup}
        groupCounts={groupCounts}
        pridelovaniTechnika={pridelovaniTechnika}
        filtrPresunu={filtrPresunu}
        activeStatusKey={activeStatusKey}
        setActiveStatusKey={setActiveStatusKey}
        statusFilterOptions={statusFilterOptions}
        claimsSubGroup={claimsSubGroup}
        setClaimsSubGroup={setClaimsSubGroup}
        showSecondaryFiltersRow={showSecondaryFiltersRow}
        quickStatuses={quickStatuses}
        statusesLoading={statusesLoading}
        statusesError={statusesError}
        statusesReady={statusesReady}
        ticketsLoading={ticketsLoading}
        ticketsPartial={ticketsPartial}
        ticketsError={ticketsError}
        claimsLoading={claimsLoading}
        claimsError={claimsError}
        ordersCfg={uiCfg.orders}
        statuses={statuses}
        getByKey={getByKey}
        normalizeStatus={normalizeStatus}
        statusById={statusById}
        toCardData={toCardData}
        filtered={filtered}
        combinedList={combinedList}
        showClaimsInOrdersList={showClaimsInOrdersList}
        paginatedTickets={paginatedTickets}
        paginatedClaims={paginatedClaims}
        paginatedCombined={paginatedCombined}
        aktivniReklamace={aktivniReklamace}
        pageSize={pageSize}
        listLength={listLength}
        effectivePageSize={effectivePageSize}
        totalOrdersPages={totalOrdersPages}
        ordersPage={ordersPage}
        setOrdersPage={setOrdersPage}
        zadneZakazky={cloudTickets.length === 0}
        zadneReklamace={cloudClaims.length === 0}
        setDetailId={setDetailId}
        setDetailClaimId={setDetailClaimId}
        setTicketStatus={setTicketStatus}
        setClaimStatus={setClaimStatus}
        statusActionsMap={statusActionsMap}
        canPrintExport={canPrintExport}
        zajistiPlnouZakazku={zajistiPlnouZakazku}
        openQuickPrintTicketRef={openQuickPrintTicketRef}
        setOpenQuickPrintTicket={setOpenQuickPrintTicket}
        viewersByTicket={viewersByTicket}
        smsPanelOpen={smsPanelOpen}
        detailId={detailId}
        smsUnreadByTicketId={smsUnreadByTicketId}
      />

      {/* ===== Nová zakázka (portál do body, aby fixed byl vůči viewportu,
             ne vůči <main> s transformem – jinak si okno nechá přes sebe
             ležet spodní navigaci a plovoucí "+") ===== */}
      <NovaZakazkaPanel
        isNewOpen={isNewOpen}
        setIsNewOpen={setIsNewOpen}
        newDraft={newDraft}
        setNewDraft={setNewDraft}
        isNarrow={isNarrow}
        naTelefonu={naTelefonu}
        activeServiceId={activeServiceId}
        serviceName={serviceName}
        hasBranches={hasBranches}
        branches={branches}
        branchForNew={branchForNew}
        closeNewOrder={closeNewOrder}
        discardNewOrder={discardNewOrder}
        createTicket={createTicket}
        canCreate={canCreate}
        submitAttempted={submitAttempted}
        createBlockedReason={createBlockedReason}
        errors={errors}
        showError={showError}
        showDeviceError={showDeviceError}
        newOrderBodyRef={newOrderBodyRef}
        newOrderPhotosBeforeInputRef={newOrderPhotosBeforeInputRef}
        customerPhoneRequired={uiCfg.orders.customerPhoneRequired}
        searchCustomers={searchCustomers}
        applyCustomerMatch={applyCustomerMatch}
        lookupCustomer={lookupCustomer}
        matchedCustomer={matchedCustomer}
        setMatchedCustomer={setMatchedCustomer}
        customerMatchDecision={customerMatchDecision}
        setCustomerMatchDecision={setCustomerMatchDecision}
        lastLookupPhoneNormRef={lastLookupPhoneNormRef}
        phoneLookupDebounceTimerRef={phoneLookupDebounceTimerRef}
        newOrderMoreOpen={newOrderMoreOpen}
        setNewOrderMoreOpen={setNewOrderMoreOpen}
        newOrderCustomerMoreOpen={newOrderCustomerMoreOpen}
        setNewOrderCustomerMoreOpen={setNewOrderCustomerMoreOpen}
        newOrderDeviceMoreOpen={newOrderDeviceMoreOpen}
        setNewOrderDeviceMoreOpen={setNewOrderDeviceMoreOpen}
        expandedDeviceIdx={expandedDeviceIdx}
        setExpandedDeviceIdx={setExpandedDeviceIdx}
        modelsWithHierarchy={modelsWithHierarchy}
        repairsForDeviceLabel={repairsForDeviceLabel}
        dalsiOprava={dalsiOprava}
        setDalsiOprava={setDalsiOprava}
        addManualPlannedRepair={addManualPlannedRepair}
        catalogShowAll={catalogShowAll}
        setCatalogShowAll={setCatalogShowAll}
        togglePlannedRepair={togglePlannedRepair}
        removePlannedRepair={removePlannedRepair}
        nastavPlannedNabidnuto={nastavPlannedNabidnuto}
        pravidlaOdmen={pravidlaOdmen}
        prednastaveneSlevy={prednastaveneSlevy}
        cloudTickets={cloudTickets}
        draftCapturePreviewUrls={draftCapturePreviewUrls}
        setDraftCapturePreviewUrls={setDraftCapturePreviewUrls}
        setDraftCaptureLiveCount={setDraftCaptureLiveCount}
        draftCaptureTokenRef={draftCaptureTokenRef}
        setCaptureQRItems={setCaptureQRItems}
        captureQRLoading={captureQRLoading}
        setCaptureQRLoading={setCaptureQRLoading}
      />

      {/* ===== Full detail modal (portal do body, aby fixed byl vůči viewportu, ne main s transform) ===== */}
      <DetailZakazky
        detailId={detailId}
        detailClaimId={detailClaimId}
        detailedTicket={detailedTicket}
        detailedClaim={detailedClaim}
        detailSeNacita={detailSeNacita}
        nedotazenaZakazka={nedotazenaZakazka}
        setNedotazenaZakazka={setNedotazenaZakazka}
        zajistiPlnouZakazku={zajistiPlnouZakazku}
        isEditing={isEditing}
        handleCloseDetail={handleCloseDetail}
        hlavicka={
          <DetailHlavicka
            isNarrow={isNarrow}
            activeServiceId={activeServiceId}
            detailedClaim={detailedClaim}
            otevrenaZeSeznamu={otevrenaZeSeznamu}
            detailedTicket={detailedTicket}
            isEditing={isEditing}
            isEditingClaim={isEditingClaim}
            statuses={statuses}
            getByKey={getByKey}
            isFinal={isFinal}
            normalizeStatus={normalizeStatus}
            statusById={statusById}
            statusActionsMap={statusActionsMap}
            setTicketStatus={setTicketStatus}
            setClaimStatus={setClaimStatus}
            ticketViewers={ticketViewers}
            hasBranches={hasBranches}
            branchById={branchById}
            setMoveBranchOpen={setMoveBranchOpen}
            onOpenCustomer={onOpenCustomer}
            saveClaimChanges={saveClaimChanges}
            setIsEditingClaim={setIsEditingClaim}
            setEditedClaim={setEditedClaim}
            startEditingClaim={startEditingClaim}
            canPrintExport={canPrintExport}
            runClaimDocument={runClaimDocument}
            setDetailId={setDetailId}
            setDetailClaimId={setDetailClaimId}
            setClaimHistoryModalOpen={setClaimHistoryModalOpen}
            setDeleteClaimId={setDeleteClaimId}
            setDeleteClaimDialogOpen={setDeleteClaimDialogOpen}
            saveTicketChanges={saveTicketChanges}
            setIsEditing={setIsEditing}
            setEditedTicket={setEditedTicket}
            startEditing={startEditing}
            smsAvailable={smsAvailable}
            smsPanelOpen={smsPanelOpen}
            setSmsPanelOpen={setSmsPanelOpen}
            smsUnreadCount={smsUnreadCount}
            onCreateInvoice={onCreateInvoice}
            onOpenInvoice={onOpenInvoice}
            invoiceIdByTicketId={invoiceIdByTicketId}
            dph={dph}
            setTicketHistoryModalOpen={setTicketHistoryModalOpen}
            setClaimSourceTicket={setClaimSourceTicket}
            setCreateClaimModalOpen={setCreateClaimModalOpen}
            chatZapnuty={chatZapnuty}
            setDeleteTicketId={setDeleteTicketId}
            setDeleteDialogOpen={setDeleteDialogOpen}
            handleCloseDetail={handleCloseDetail}
          />
        }
        reklamace={detailedClaim && (
          <DetailReklamace
            detailedClaim={detailedClaim}
            editedClaim={editedClaim}
            setEditedClaim={setEditedClaim}
            isEditingClaim={isEditingClaim}
            cloudTickets={cloudTickets}
            setCloudTickets={setCloudTickets}
            detailedTicket={detailedTicket}
            claimResolutionDraft={claimResolutionDraft}
            setClaimResolutionDraft={setClaimResolutionDraft}
            saveClaimResolutionItems={saveClaimResolutionItems}
            statuses={statuses}
            getByKey={getByKey}
            statusActionsMap={statusActionsMap}
            ulozDiagnostikuZakazky={ulozDiagnostikuZakazky}
            setPhotoLightbox={setPhotoLightbox}
            naTelefonu={naTelefonu}
            activeServiceId={activeServiceId}
            serviceName={serviceName}
            captureQRLoading={captureQRLoading}
            setCaptureQRLoading={setCaptureQRLoading}
            diagnosticPhotosUploading={diagnosticPhotosUploading}
            setDiagnosticPhotosUploading={setDiagnosticPhotosUploading}
            setCaptureQRItems={setCaptureQRItems}
            commentsFor={commentsFor}
            commentDraftByTicket={commentDraftByTicket}
            handleCommentDraftChange={handleCommentDraftChange}
            addComment={addComment}
            togglePin={togglePin}
            editComment={editComment}
            currentUserId={session?.user?.id ?? null}
            commentAuthorProfiles={commentAuthorProfiles}
          />
        )}
        prehled={detailedTicket && (
          <DetailPrehled
            detailedTicket={detailedTicket}
            postupZakazky={uiCfg.app.postupZakazky}
            invoiceIdByTicketId={invoiceIdByTicketId}
            isFinal={isFinal}
            getByKey={getByKey}
            zasilkyZapnuty={zasilkyZapnuty}
            hasBranches={hasBranches}
            nastaveniZasilek={nastaveniZasilek}
            historieZasilek={historieZasilek}
            branchById={branchById}
            skryteSekce={skryteSekce}
            sjetNaSbalenouKartu={sjetNaSbalenouKartu}
            onOpenCustomer={onOpenCustomer}
            cloudClaims={cloudClaims}
            cloudTickets={cloudTickets}
            setDetailId={setDetailId}
            setDetailClaimId={setDetailClaimId}
            ulozFindMy={ulozFindMy}
          />
        )}
        uprava={detailedTicket && (
          <UpravaZakazky
            detailedTicket={detailedTicket}
            editedTicket={editedTicket}
            setEditedTicket={setEditedTicket}
            activeServiceId={activeServiceId}
            customerPhoneRequired={uiCfg.orders.customerPhoneRequired}
            lookupCustomerEdit={lookupCustomerEdit}
            matchedCustomerEdit={matchedCustomerEdit}
            setMatchedCustomerEdit={setMatchedCustomerEdit}
            modelsWithHierarchy={modelsWithHierarchy}
          />
        )}
        dalsiKarty={detailedTicket && (
          <DetailDalsiKarty
            detailedTicket={detailedTicket}
            activeServiceId={activeServiceId}
            skryteSekce={skryteSekce}
            opravy={
              <DetailOpravy
                detailedTicket={detailedTicket}
                ticketReservations={ticketReservations}
                removePerformedRepair={removePerformedRepair}
                updatePerformedRepairPrice={updatePerformedRepairPrice}
                updatePerformedRepairCosts={updatePerformedRepairCosts}
                updatePerformedRepairTime={updatePerformedRepairTime}
                updatePerformedRepairProducts={updatePerformedRepairProducts}
                updatePerformedRepairFields={updatePerformedRepairFields}
                devicesData={devicesData}
                inventoryData={inventoryData}
                pravidlaOdmen={pravidlaOdmen}
                activeServiceId={activeServiceId}
                skladProdukty={skladProdukty}
                rezervovanoCelkem={rezervovanoCelkem}
                objednanoProZakazku={objednanoProZakazku}
                muzeObjednatDily={hasCapability("can_edit_inventory")}
                refreshObjednanoProZakazku={refreshObjednanoProZakazku}
                setCloudTickets={setCloudTickets}
                prednastaveneSlevy={prednastaveneSlevy}
                availableRepairs={availableRepairs}
                addPerformedRepair={addPerformedRepair}
                hodinovaSazba={hodinovaSazba}
                currentUserNickname={userProfile?.nickname}
                currentUserId={session?.user?.id}
              />
            }
            diagnostika={
              <DetailDiagnostika
                detailedTicket={detailedTicket}
                detailDiagnostikaOpen={detailDiagnostikaOpen}
                prepnoutDetailDiagnostiku={prepnoutDetailDiagnostiku}
                setDirtyFlags={setDirtyFlags}
                setCloudTickets={setCloudTickets}
                setPhotoLightbox={setPhotoLightbox}
                naTelefonu={naTelefonu}
                activeServiceId={activeServiceId}
                serviceName={serviceName}
                captureQRLoading={captureQRLoading}
                setCaptureQRLoading={setCaptureQRLoading}
                diagnosticPhotosUploading={diagnosticPhotosUploading}
                setDiagnosticPhotosUploading={setDiagnosticPhotosUploading}
                setCaptureQRItems={setCaptureQRItems}
              />
            }
            smsAvailable={smsAvailable}
            availableRepairs={availableRepairs}
            applyQuoteRepairs={applyQuoteRepairs}
            setCloudTickets={setCloudTickets}
            detailPortalOpen={detailPortalOpen}
            prepnoutDetailPortal={prepnoutDetailPortal}
            zasilkyZapnuty={zasilkyZapnuty}
            hasBranches={hasBranches}
            branches={branches}
            branchById={branchById}
            setHistorieZasilek={setHistorieZasilek}
            nastaveniZasilek={nastaveniZasilek}
            ulozZapujcku={ulozZapujcku}
            nahradniZarizeni={nahradniZarizeni}
            pujceneKusy={pujceneKusy}
            pridelovaniTechnika={pridelovaniTechnika}
            clenoveServisu={clenove.clenove}
            ulozTechnika={ulozTechnika}
            casNaOpraveZapnuto={casNaOpraveZapnuto}
            currentUserId={session?.user?.id}
            currentUserNickname={userProfile?.nickname}
            hodinovaSazba={hodinovaSazba}
            zaokrouhleniPrace={zaokrouhleniPrace}
            addPerformedRepair={addPerformedRepair}
            kontrolniSeznamy={kontrolniSeznamy}
            ulozKontrolu={ulozKontrolu}
          />
        )}
        komentare={detailedTicket && (
          <TicketComments
            ticketId={detailedTicket.id}
            comments={commentsFor(detailedTicket.id)}
            draft={commentDraftByTicket[detailedTicket.id] ?? ""}
            onDraftChange={handleCommentDraftChange}
            onAdd={addComment}
            onTogglePin={togglePin}
            onEdit={editComment}
            currentUserId={session?.user?.id ?? null}
            authorProfiles={commentAuthorProfiles}
            card={card}
            baseFieldTextArea={baseFieldTextArea}
          />
        )}
        smsPanel={smsPanelOpen && detailedTicket && activeServiceId && (
          <SmsPanel
            detailedTicket={detailedTicket}
            activeServiceId={activeServiceId}
            sidebarPosition={uiCfg.sidebar?.position}
            onClose={() => setSmsPanelOpen(false)}
            onInboundMarkedRead={() => {
              setSmsUnreadCount(0);
              setSmsUnreadListBump((n) => n + 1);
            }}
          />
        )}
      />

      {/* ConfirmDialog for soft delete */}
      <StornoDialog
        open={!!stornoDotaz}
        nazevStavu={stornoDotaz ? getByKey(stornoDotaz.next)?.label ?? stornoDotaz.next : ""}
        onPotvrdit={potvrdStorno}
        onZrusit={() => setStornoDotaz(null)}
      />
      <ConfirmDialog
        open={deleteDialogOpen}
        title="Smazat zakázku"
        message="Opravdu chcete tuto zakázku přesunout do smazaných?"
        confirmLabel="Smazat"
        cancelLabel="Zrušit"
        variant="danger"
        onConfirm={async () => {
          if (!deleteTicketId || !supabase || !activeServiceId) {
            throw new Error("Chyba: není připojení k databázi");
          }
          
          const { error } = await (supabase as any).rpc("soft_delete_ticket", {
            p_ticket_id: deleteTicketId,
          });
          
          if (error) {
            console.error("[DeleteTicket] Error soft deleting ticket:", error);
            throw error;
          }
          
          showToast("Zakázka smazána", "success");
          /* Ze seznamu hned, ne až po přenačtení. Měkké smazání je z pohledu
             databáze obyčejná úprava řádku, takže živá aktualizace ho jako
             zmizení nepozná – zakázka po smazání dál svítila v seznamu
             a uživatel nevěděl, jestli se to povedlo. */
          setCloudTickets((prev) => prev.filter((t) => t.id !== deleteTicketId));
          // Smazaná zakázka díly nedrží.
          void releaseReservations(deleteTicketId);

          // Reuse returnTo navigation logic from "Zavřít" button
          const page = returnToPage;
          const customerId = returnToCustomerIdRef.current;
          setDetailId(null);
          setReturnToPage(null);
          returnToCustomerIdRef.current = undefined;
          if (page && onReturnToPage) {
            onReturnToPage(page, customerId);
          }
          
          setDeleteDialogOpen(false);
          setDeleteTicketId(null);
        }}
        onCancel={() => {
          setDeleteDialogOpen(false);
          setDeleteTicketId(null);
        }}
      />

      <ConfirmDialog
        open={deleteClaimDialogOpen}
        title="Smazat reklamaci"
        message="Opravdu chcete smazat tuto reklamaci? Tato akce je nevratná."
        confirmLabel="Smazat"
        cancelLabel="Zrušit"
        variant="danger"
        onConfirm={async () => {
          if (!deleteClaimId) return;
          const ok = await deleteClaim(deleteClaimId);
          if (!ok) return;
          refetchClaims();
          setDetailClaimId(null);
          setDeleteClaimDialogOpen(false);
          setDeleteClaimId(null);
        }}
        onCancel={() => {
          setDeleteClaimDialogOpen(false);
          setDeleteClaimId(null);
        }}
      />

      <CreateWarrantyClaimModal
        open={createClaimModalOpen}
        onClose={() => { setCreateClaimModalOpen(false); setClaimSourceTicket(null); }}
        activeServiceId={activeServiceId}
        tickets={cloudTickets}
        initialTicket={claimSourceTicket}
        nactiPlnouZakazku={zajistiPlnouZakazku}
        existingClaimCodes={cloudClaims.map((c) => ({ code: c.code }))}
        onCreated={async (_claimCode, claim) => {
          setCreateClaimModalOpen(false);
          setClaimSourceTicket(null);
          refetchClaims();
          setActiveGroup("reklamace");
          if (claim) {
            const config = await loadDocumentsConfigFromDB(activeServiceId);
            if (config?.autoPrint?.prijetiReklamaceOnCreate && activeServiceId) {
              const data = claimDocumentData(claim, safeLoadCompanyData(), "");
              if (isWeb()) await runWebDocument("print", "prijemka_reklamace", activeServiceId, data);
              else await runDesktopDocument("print", "prijemka_reklamace", activeServiceId, data, `prijemka-reklamace-${claim.code}.pdf`);
            }
          }
        }}
      />

      {/* Ticket history modal */}
      {ticketHistoryModalOpen && (
        <HistorieZakazkyModal
          entries={ticketHistoryEntries}
          loading={ticketHistoryLoading}
          error={ticketHistoryError}
          expandedId={ticketHistoryExpandedId}
          setExpandedId={setTicketHistoryExpandedId}
          onClose={() => setTicketHistoryModalOpen(false)}
          getByKey={getByKey}
          activeServiceId={activeServiceId}
          jmenoClena={clenove.jmeno}
        />
      )}

      {/* Claim history modal */}
      <BranchPickerDialog
        open={moveBranchOpen && !!detailedTicket}
        branches={branches}
        currentId={detailedTicket?.branchId ?? null}
        onClose={() => setMoveBranchOpen(false)}
        onSelect={(b: Branch) => {
          const t = detailedTicket;
          if (!t) return;
          const prev = t.branchId ?? null;
          setCloudTickets((list) => list.map((x) => (x.id === t.id ? { ...x, branchId: b.id } : x)));
          void setTicketBranch(t.id, b.id).then((res) => {
            if (!res.error) {
              showToast(`Zakázka přesunuta na pobočku ${b.name}`, "success");
              return;
            }
            if (jeTrvalaChyba(res.error)) {
              setCloudTickets((list) => list.map((x) => (x.id === t.id ? { ...x, branchId: prev } : x)));
              showToast(`Přesun se nepodařil: ${res.error}`, "error");
              return;
            }
            /* Výpadek spojení: přesun zůstane na obrazovce a fronta ho dopíše.
               Bez toho stačilo hned přenačíst stránku a zakázka byla zpátky
               na staré pobočce, aniž by se o tom kdokoli dozvěděl. */
            ulozNaPozdeji({
              klic: `tickets:${t.id}:branch`,
              tabulka: "tickets",
              id: t.id,
              data: { branch_id: b.id },
              popis: `Přesun na pobočku · ${popisZakazky(t.id)}`,
              serviceId: activeServiceIdRef.current,
              chyba: res.error,
            });
            showToast("Spojení vypadlo – přesun se uloží sám, jakmile bude připojení.", "info");
          });
        }}
      />
      {claimHistoryModalOpen && (
        <HistorieReklamaceModal
          entries={claimHistoryEntries}
          loading={claimHistoryLoading}
          error={claimHistoryError}
          onClose={() => setClaimHistoryModalOpen(false)}
          getByKey={getByKey}
        />
      )}

      {/* Capture QR modal – fotka z telefonu */}
      {captureQRItems && captureQRItems.length > 0 && (
        <CaptureQrModal
          items={captureQRItems}
          onClose={closeCaptureQrModal}
          draftCaptureTokenRef={draftCaptureTokenRef}
          draftCaptureLiveCount={draftCaptureLiveCount}
        />
      )}

      {/* Photo lightbox – rozkliknutí diagnostických fotek */}
      {photoLightbox && (
        <FotoLightbox photoLightbox={photoLightbox} fotkyLightboxu={fotkyLightboxu} onClose={() => setPhotoLightbox(null)} />
      )}

      {canPrintExport && openQuickPrintTicket && quickPrintDropdownRect && (
        <RychlyTiskNabidka
          ticket={openQuickPrintTicket}
          rect={quickPrintDropdownRect}
          activeServiceId={activeServiceId}
          onClose={() => setOpenQuickPrintTicket(null)}
        />
      )}
    </div>
  );
}
