/**
 * Aktivní pobočka a seznam poboček servisu.
 *
 * `activeBranchId === null` znamená „všechny pobočky“. Volba se pamatuje
 * na zařízení zvlášť pro každý servis; při prvním otevření se vezme
 * domovská pobočka člena, jinak všechny. Servis s jedinou pobočkou
 * (`isMulti === false`) žádný přepínač neukazuje a filtry nefiltrují.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  loadBranches,
  loadMyHomeBranch,
  setCachedBranches,
  subscribeBranches,
  type Branch,
} from "../lib/branches";

export type BranchContextValue = {
  branches: Branch[];
  loading: boolean;
  /** Tabulka poboček na serveru chybí – chovat se jako bez poboček. */
  unavailable: boolean;
  /** null = všechny pobočky. */
  activeBranchId: string | null;
  setActiveBranchId: (id: string | null) => void;
  activeBranch: Branch | null;
  defaultBranch: Branch | null;
  homeBranchId: string | null;
  isMulti: boolean;
  branchById: (id: string | null | undefined) => Branch | null;
  /** Pobočka pro novou zakázku: aktivní, jinak domovská, jinak výchozí. */
  branchForNew: Branch | null;
  reload: () => Promise<void>;
};

const EMPTY: BranchContextValue = {
  branches: [],
  loading: false,
  unavailable: false,
  activeBranchId: null,
  setActiveBranchId: () => {},
  activeBranch: null,
  defaultBranch: null,
  homeBranchId: null,
  isMulti: false,
  branchById: () => null,
  branchForNew: null,
  reload: async () => {},
};

const BranchContext = createContext<BranchContextValue>(EMPTY);

const storageKey = (serviceId: string) => `jobsheet_active_branch__${serviceId}`;

function readStored(serviceId: string): string | null | undefined {
  try {
    const v = localStorage.getItem(storageKey(serviceId));
    if (v === null) return undefined; // nic uloženo
    return v === "" ? null : v;
  } catch {
    return undefined;
  }
}

function writeStored(serviceId: string, id: string | null) {
  try {
    localStorage.setItem(storageKey(serviceId), id ?? "");
  } catch {
    /* ignore */
  }
}

export function BranchProvider({ serviceId, userId, children }: { serviceId: string | null; userId: string | null; children: React.ReactNode }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [homeBranchId, setHomeBranchId] = useState<string | null>(null);
  const [activeBranchId, setActiveState] = useState<string | null>(null);
  const initializedFor = useRef<string | null>(null);

  const reload = useCallback(async () => {
    if (!serviceId) {
      setBranches([]);
      setUnavailable(false);
      return;
    }
    const res = await loadBranches(serviceId);
    setBranches(res.branches);
    setUnavailable(res.unavailable === true);
    setCachedBranches(serviceId, res.branches);
  }, [serviceId]);

  useEffect(() => {
    let cancelled = false;
    initializedFor.current = null;
    setActiveState(null);
    setHomeBranchId(null);
    if (!serviceId) {
      setBranches([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    (async () => {
      const [res, home] = await Promise.all([
        loadBranches(serviceId),
        userId ? loadMyHomeBranch(serviceId, userId) : Promise.resolve(null),
      ]);
      if (cancelled) return;
      setBranches(res.branches);
      setUnavailable(res.unavailable === true);
      setCachedBranches(serviceId, res.branches);
      setHomeBranchId(home);
      const stored = readStored(serviceId);
      const valid = (id: string | null | undefined) => id != null && res.branches.some((b) => b.id === id);
      if (stored === null) setActiveState(null);
      else if (valid(stored)) setActiveState(stored as string);
      else if (valid(home)) setActiveState(home);
      else setActiveState(null);
      initializedFor.current = serviceId;
      setLoading(false);
    })();
    const unsubscribe = subscribeBranches(serviceId, () => { void reload(); });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [serviceId, userId, reload]);

  const setActiveBranchId = useCallback((id: string | null) => {
    setActiveState(id);
    if (serviceId) writeStored(serviceId, id);
  }, [serviceId]);

  const value = useMemo<BranchContextValue>(() => {
    const byId = (id: string | null | undefined) => (id ? branches.find((b) => b.id === id) ?? null : null);
    const defaultBranch = branches.find((b) => b.isDefault) ?? branches[0] ?? null;
    const isMulti = branches.length > 1;
    // U jediné pobočky se aktivní filtr neuplatní – všechno je „ta jedna“.
    const effectiveActive = isMulti && activeBranchId && byId(activeBranchId) ? activeBranchId : null;
    const branchForNew = byId(effectiveActive) ?? byId(homeBranchId) ?? defaultBranch;
    return {
      branches,
      loading,
      unavailable,
      activeBranchId: effectiveActive,
      setActiveBranchId,
      activeBranch: byId(effectiveActive),
      defaultBranch,
      homeBranchId,
      isMulti,
      branchById: byId,
      branchForNew,
      reload,
    };
  }, [branches, loading, unavailable, activeBranchId, homeBranchId, setActiveBranchId, reload]);

  return <BranchContext.Provider value={value}>{children}</BranchContext.Provider>;
}

export function useBranches(): BranchContextValue {
  return useContext(BranchContext);
}

/** Filtr seznamu podle aktivní pobočky; řádky bez pobočky zůstávají viditelné všude. */
export function filterByBranch<T extends { branchId?: string | null }>(rows: T[], activeBranchId: string | null): T[] {
  if (!activeBranchId) return rows;
  return rows.filter((r) => !r.branchId || r.branchId === activeBranchId);
}
