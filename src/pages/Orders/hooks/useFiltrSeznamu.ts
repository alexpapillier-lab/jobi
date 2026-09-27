/**
 * Filtr a stránkování seznamu zakázek: záložky (Vše / Aktivní / Moje /
 * Přesuny / Dokončené / Reklamace), filtr podle stavu, hledání, rychlé filtry
 * z předvoleb, míšení reklamací, počty u záložek, stránkování a výběr zakázek
 * pro SMS odznaky.
 *
 * Vyneseno z Orders.tsx beze změny obsahu včetně závislostí. Efekty tu jen
 * nastavují vlastní stav (stav mimo nabídku, stránka po změně filtru), takže
 * jejich dřívější místo v pořadí efektů nic nemění.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { StatusMeta } from "../../../state/StatusesStore";
import type { StatusFilterOption } from "../../../components/orders/StatusFilter";
import { umisteniZakazky, type NastaveniZasilek } from "../../../lib/zasilky";
import type { WarrantyClaimRow } from "./useWarrantyClaims";
import type { ClaimsSubGroup, GroupKey, TicketEx, UIConfig } from "../typy";

type Vstup = {
  /** Zakázky aktivní pobočky. */
  tickets: TicketEx[];
  cloudClaims: WarrantyClaimRow[];
  statuses: StatusMeta[];
  isFinal: (key: string) => boolean;
  normalizeStatus: (key: string) => string | null;
  statusKeysSet: Set<string>;
  uiCfg: UIConfig;
  mojeId: string | null;
  activeBranchId: string | null;
  ordersShowClaimsInList: boolean;
  zasilkyZapnuty: boolean;
  hasBranches: boolean;
  nastaveniZasilek: NastaveniZasilek;
  pridelovaniTechnika: boolean;
};

export function useFiltrSeznamu({
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
}: Vstup) {
  const [activeGroup, setActiveGroup] = useState<GroupKey>("active");
  const [activeStatusKey, setActiveStatusKey] = useState<string | null>(null);
  const [claimsSubGroup, setClaimsSubGroup] = useState<ClaimsSubGroup>("all");

  const [query, setQuery] = useState("");
  const [statusById, setStatusById] = useState<Record<string, string>>({});
  const [ordersPage, setOrdersPage] = useState(0);
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const t of tickets) next[t.id] = t.status as any;
    setStatusById(next);
  }, [tickets]);
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
  useEffect(() => {
    setOrdersPage(0);
  }, [query, activeStatusKey, activeGroup, claimsSubGroup]);

  useEffect(() => {
    setOrdersPage(0);
  }, [pageSize]);

  useEffect(() => {
    if (ordersPage >= totalOrdersPages && totalOrdersPages > 0) setOrdersPage(totalOrdersPages - 1);
  }, [ordersPage, totalOrdersPages]);

  return {
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
  };
}
