import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useIsNarrow } from "../hooks/useIsNarrow";
import { useStatuses } from "../state/StatusesStore";
import { useServiceVat } from "../hooks/useServiceVat";
import { TicketComments, type TicketCardData } from "../components/tickets";
import { computeFinalPrice } from "../components/tickets/types";
import { showToast } from "../components/Toast";
import { reportError } from "../lib/reportError";
import { claimDocumentData } from "../lib/documentData";
import type { NavKey } from "../layout/Sidebar";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { StornoDialog } from "../components/orders/StornoDialog";
import { supabase } from "../lib/supabaseClient";
import { devLog } from "../lib/devLog";
import { ulozNaPozdeji, jeTrvalaChyba } from "../lib/frontaZapisu";
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
import { useClenoveServisu } from "../hooks/useClenoveServisu";
import { SLOUPCE_DETAILU } from "../lib/sloupceZakazky";
import { nastavStavRezervace } from "../lib/rezervace";
import { sloucZakazkuZDb } from "../lib/slouceniZakazky";
import { sjetNaKartu } from "../components/orders/PostupZakazky";
import { useSbaleno } from "../components/orders/SbalitelnaSekce";
import { dniBezZmenyJinde, stitekUmisteni, umisteniZakazky, type Zasilka } from "../lib/zasilky";
import { ensurePortalToken, portalUrl } from "../lib/portal";
import { useBranches, filterByBranch } from "../context/BranchContext";
import { setTicketBranch, type Branch } from "../lib/branches";
import { BranchPickerDialog } from "../components/orders/BranchPickerDialog";
import {
  reserveForRepair,
  releaseReservations,
  consumeTicketReservations,
  loadTicketReservations,
  jenUuid,
  type TicketReservation,
  type ReserveShortage,
} from "../lib/purchaseOrders";
import { useActiveRole } from "../hooks/useActiveRole";
import { smsDoNotNotifyRef } from "../hooks/useSmsNotifications";
import { registerShortcut } from "../lib/keyboardShortcuts";
import { safeLoadCompanyData } from "../lib/companyData";
import { useTicketViewers, useTicketViewersMap, setPresenceTicket } from "../lib/presence";
import {
  loadDocumentsConfigFromDB,
} from "../lib/documentHelpers";

import {
  type UIConfig,
  type OrdersProps,
  type TicketEx,
} from "./Orders/typy";
import { safeLoadUIConfig } from "./Orders/uiConfig";
import {
  safeSaveDraft,
  defaultDraft,
} from "./Orders/koncept";
import { mapSupabaseTicketToTicketEx } from "./Orders/mapovani";
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
import { useKonfiguraceDokumentu } from "./Orders/hooks/useKonfiguraceDokumentu";
import { useNastaveniServisu } from "./Orders/hooks/useNastaveniServisu";
import { useNacitaniZakazek } from "./Orders/hooks/useNacitaniZakazek";
import { useRealtimeZakazek } from "./Orders/hooks/useRealtimeZakazek";
import { useSmsDostupnost } from "./Orders/hooks/useSmsDostupnost";
import { useSmsNeprecteneDetailu } from "./Orders/hooks/useSmsNeprecteneDetailu";
import { useSmsNeprecteneSeznamu } from "./Orders/hooks/useSmsNeprecteneSeznamu";
import { useEvidenceZapisu } from "./Orders/hooks/useEvidenceZapisu";
import { useKomentare } from "./Orders/hooks/useKomentare";
import { useZapisyZakazky } from "./Orders/hooks/useZapisyZakazky";
import { useNovaZakazkaKoncept } from "./Orders/hooks/useNovaZakazkaKoncept";
import { useKatalogASklad } from "./Orders/hooks/useKatalogASklad";
import { useFiltrSeznamu } from "./Orders/hooks/useFiltrSeznamu";
import { useFakturyZakazek } from "./Orders/hooks/useFakturyZakazek";
import { stitekFaktury } from "../lib/fakturyZakazek";
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
  const mojeId = session?.user?.id ?? null;
  const { profile: userProfile } = useUserProfile();
  const { hasCapability, isAdmin } = useActiveRole(activeServiceId);
  const canPrintExport = hasCapability("can_print_export");

  const [uiCfg, setUiCfg] = useState<UIConfig>(() => safeLoadUIConfig());
  const { rozpracovaneZapisyOpravRef, odlozeneZapisyOpravRef, neulozeneOpravyRef, evidenceZapisu, odlozenaKontrolaRef, odlozenaDiagnostikaRef } = useEvidenceZapisu();

  // Refs for race condition protection
  const activeServiceIdRef = useRef<string | null>(activeServiceId);
  
  // Keep activeServiceIdRef in sync
  useEffect(() => {
    activeServiceIdRef.current = activeServiceId;
  }, [activeServiceId]);
  
  useKonfiguraceDokumentu(activeServiceId, activeServiceIdRef);

  const {
    ordersShowClaimsInList,
    hodinovaSazba,
    zaokrouhleniPrace,
    kontrolniSeznamy,
    nahradniZarizeni,
    casNaOpraveZapnuto,
    pridelovaniTechnika,
    prednastaveneSlevy,
    pravidlaOdmen,
    skryteSekce,
    zasilkyZapnuty,
    nastaveniZasilek,
    chatZapnuty,
  } = useNastaveniServisu(activeServiceId);

  const {
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
  } = useNacitaniZakazek(activeServiceId);

  const {
    commentAuthorProfiles,
    nactiKomentare,
    otevreneKomentareRef,
    commentDraftByTicket,
    commentsFor,
    addComment,
    editComment,
    togglePin,
    handleCommentDraftChange,
  } = useKomentare({ activeServiceId, session, userProfile });
  const { updateClaimStatus, updateClaim, deleteClaim } = useWarrantyClaims(activeServiceId);

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

  /* Escape nad zvětšenou fotkou zavírá jen ji – obstarává to hlavní
     Escape handler níž (capture), který ji má jako první v pořadí. */

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

  useRealtimeZakazek({ activeServiceId, isEditing, detailId, setCloudTickets, evidenceZapisu });

  // Cloud mode only: show only cloud tickets
  const { activeBranchId, isMulti: hasBranches, branches, branchById, branchForNew } = useBranches();
  const [moveBranchOpen, setMoveBranchOpen] = useState(false);
  const tickets = useMemo(() => filterByBranch(cloudTickets, activeBranchId), [cloudTickets, activeBranchId]);

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
  const [openQuickPrintTicket, setOpenQuickPrintTicket] = useState<TicketEx | null>(null);
  /** Jen pro přepínání tlačítka na kartě – ať se kvůli němu nepřekresluje celý seznam. */
  const openQuickPrintTicketRef = useRef<TicketEx | null>(null);
  openQuickPrintTicketRef.current = openQuickPrintTicket;
  const [quickPrintDropdownRect, setQuickPrintDropdownRect] = useState<{ top: number; left: number; right: number; height: number } | null>(null);

  // Delete ticket dialog states
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTicketId, setDeleteTicketId] = useState<string | null>(null);
  const [ticketHistoryModalOpen, setTicketHistoryModalOpen] = useState(false);
  const [createClaimModalOpen, setCreateClaimModalOpen] = useState(false);
  /** Zakázka, ze které se reklamace zakládá (z nabídky „…“ v detailu); null = výběr hledáním. */
  const [claimSourceTicket, setClaimSourceTicket] = useState<TicketEx | null>(null);
  /** Zásilky otevřené zakázky (dodá karta Kde je zakázka) – pro kroky v Postupu zakázky. */
  const [historieZasilek, setHistorieZasilek] = useState<{ ticketId: string; zasilky: Zasilka[] } | null>(null);
  const clenove = useClenoveServisu(activeServiceId, pridelovaniTechnika);
  const [isEditingClaim, setIsEditingClaim] = useState(false);
  const [editedClaim, setEditedClaim] = useState<Partial<WarrantyClaimRow>>({});
  /** Draft zákroků v náhledu reklamace – při změně reklamace se resetuje */
  const [claimResolutionDraft, setClaimResolutionDraft] = useState<ClaimResolutionItem[] | null>(null);
  const [claimHistoryModalOpen, setClaimHistoryModalOpen] = useState(false);
  const [deleteClaimDialogOpen, setDeleteClaimDialogOpen] = useState(false);
  const [deleteClaimId, setDeleteClaimId] = useState<string | null>(null);
  const [smsPanelOpen, setSmsPanelOpen] = useState(false);

  const smsActivatedForService = useSmsDostupnost(activeServiceId);
  /** Číslo i modul zároveň – jen tak se SMS smí kdekoli objevit. */
  const smsAvailable = smsActivatedForService && smsEnabled;

  // Sync ref for SMS notifications: when SMS panel is open for a ticket, don't show OS notification for that ticket
  useEffect(() => {
    if (smsPanelTicketIdRef) {
      smsPanelTicketIdRef.current = smsPanelOpen && detailId ? detailId : null;
    }
    return () => {
      if (smsPanelTicketIdRef) smsPanelTicketIdRef.current = null;
    };
  }, [smsPanelOpen, detailId, smsPanelTicketIdRef]);

  const [smsUnreadCount, setSmsUnreadCount] = useSmsNeprecteneDetailu(detailId, activeServiceId);

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

  /* Zakázka → faktura pro „Přejít na fakturu“ a štítek v seznamu. Čte se
     z invoice_tickets, takže platí i pro souhrnnou fakturu za víc zakázek;
     záloha dál přes invoices.ticket_id (viz lib/fakturyZakazek). */
  const fakturaByTicketId = useFakturyZakazek(activeServiceId, !!(onCreateInvoice || onOpenInvoice), !closeDetailWhen);
  const invoiceIdByTicketId = useMemo(() => {
    const m: Record<string, string> = {};
    for (const [ticketId, f] of Object.entries(fakturaByTicketId)) m[ticketId] = f.id;
    return m;
  }, [fakturaByTicketId]);

  const {
    devicesData,
    inventoryData,
    skladProdukty,
    rezervovanoCelkem,
    objednanoProZakazku,
    refreshObjednanoProZakazku,
    modelsWithHierarchy,
    repairsForDeviceLabel,
  } = useKatalogASklad(activeServiceId, detailId);

  const {
    isNewOpen,
    setIsNewOpen,
    newDraft,
    setNewDraft,
    submitAttempted,
    setSubmitAttempted,
    matchedCustomer,
    setMatchedCustomer,
    customerMatchDecision,
    setCustomerMatchDecision,
    lastLookupPhoneNormRef,
    phoneLookupDebounceTimerRef,
    newOrderMoreOpen,
    setNewOrderMoreOpen,
    newOrderDeviceMoreOpen,
    setNewOrderDeviceMoreOpen,
    newOrderCustomerMoreOpen,
    setNewOrderCustomerMoreOpen,
    expandedDeviceIdx,
    setExpandedDeviceIdx,
    catalogShowAll,
    setCatalogShowAll,
    createTicketRef,
    newOrderBodyRef,
    searchCustomers,
    applyCustomerMatch,
    lookupCustomer,
    togglePlannedRepair,
    dalsiOprava,
    setDalsiOprava,
    addManualPlannedRepair,
    nastavPlannedNabidnuto,
    removePlannedRepair,
    openNewOrder,
    errors,
    canCreate,
    showError,
    showDeviceError,
    createBlockedReason,
    focusFirstInvalidField,
    closeNewOrder,
    discardNewOrder,
    closeCaptureQrModal,
  } = useNovaZakazkaKoncept({
    activeServiceId,
    newOrderPrefill,
    onNewOrderPrefillConsumed,
    devicesData,
    session,
    mojeId,
    customerPhoneRequired: uiCfg.orders.customerPhoneRequired,
    draftCaptureTokenRef,
    setDraftCapturePreviewUrls,
    setDraftCaptureLiveCount,
    captureQRItems,
    setCaptureQRItems,
  });
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

  const {
    activeGroup,
    setActiveGroup,
    activeStatusKey,
    setActiveStatusKey,
    claimsSubGroup,
    setClaimsSubGroup,
    query,
    setQuery,
    statusById,
    setStatusById,
    ordersPage,
    setOrdersPage,
    quickStatuses,
    showSecondaryFiltersRow,
    statusFilterOptions,
    filtered,
    showClaimsInOrdersList,
    aktivniReklamace,
    combinedList,
    groupCounts,
    filtrPresunu,
    pageSize,
    listLength,
    effectivePageSize,
    totalOrdersPages,
    paginatedTickets,
    paginatedClaims,
    paginatedCombined,
    ticketsForSmsUnread,
  } = useFiltrSeznamu({
    tickets,
    cloudClaims,
    statuses,
    isFinal,
    normalizeStatus,
    statusKeysSet,
    uiCfg,
    mojeId,
    activeBranchId,
    ordersShowClaimsInList,
    zasilkyZapnuty,
    hasBranches,
    nastaveniZasilek,
    pridelovaniTechnika,
  });

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

  const { smsUnreadByTicketId, setSmsUnreadListBump } = useSmsNeprecteneSeznamu({ smsAvailable, activeServiceId, ticketsForSmsUnread });

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

  const availableRepairs = useMemo(
    () => repairsForDeviceLabel(detailedTicket?.deviceLabel),
    [detailedTicket?.deviceLabel, repairsForDeviceLabel]
  );

  const {
    applyQuoteRepairs,
    popisZakazky,
    dokoncitOdlozeneZapisyOprav,
    addPerformedRepair,
    updatePerformedRepairPrice,
    updatePerformedRepairCosts,
    updatePerformedRepairTime,
    updatePerformedRepairProducts,
    updatePerformedRepairFields,
    removePerformedRepair,
    ulozZapujcku,
    ulozTechnika,
    ulozFindMy,
    ulozKontrolu,
    ulozDiagnostikuZakazky,
  } = useZapisyZakazky({
    activeServiceId,
    activeServiceIdRef,
    cloudTicketsRef,
    setCloudTickets,
    setDirtyFlags,
    devicesData,
    reserveEntryProducts,
    toastReserveShortages,
    refreshTicketReservations,
    mojeId,
    pravidlaOdmen,
    rozpracovaneZapisyOpravRef,
    odlozeneZapisyOpravRef,
    neulozeneOpravyRef,
    odlozenaKontrolaRef,
    odlozenaDiagnostikaRef,
  });

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
      const hasSomethingToClose = !!photoLightbox || smsPanelOpen || ticketHistoryModalOpen || claimHistoryModalOpen || !!detailId || !!detailClaimId || isNewOpen;
      if (!hasSomethingToClose) return;
      /* Zvětšená fotka leží nade vším (portál, z-index 10002). Dřív ji tenhle
         handler neznal: v capture fázi zastavil událost dřív, než k ní došla,
         a místo fotky zavřel celý detail. */
      if (photoLightbox) {
        e.preventDefault();
        e.stopPropagation();
        setPhotoLightbox(null);
        return;
      }
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
  }, [photoLightbox, smsPanelOpen, detailId, detailClaimId, isNewOpen, ticketHistoryModalOpen, claimHistoryModalOpen, handleCloseDetail]);

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
    /* Otevřený příjem leží nad detailem a Enter (i ⌘/Ctrl+Enter = Vytvořit
       zakázku) patří jemu. Dřív se spustilo obojí: vznikla zakázka a zároveň
       se uložil a zavřel detail pod ní. */
    if (!detailId || !isEditing || isNewOpen) return;
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
  }, [detailId, isEditing, isNewOpen, saveTicketChanges, returnToPage, onReturnToPage]);

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
    // Číslo faktury, která zakázku kryje (i souhrnná); záloha štítek nemá.
    faktura: stitekFaktury(fakturaByTicketId[t.id]),
  }), [statusById, pridelovaniTechnika, clenove, zasilkyZapnuty, hasBranches, branchById, activeBranchId, nastaveniZasilek.upozorneniDni, fakturaByTicketId]);

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
