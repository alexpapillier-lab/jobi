import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { showToast } from "../components/Toast";
import { normalizeError } from "../utils/errorNormalizer";

export type StatusKey = string;

export type StatusMeta = {
  key: StatusKey;
  label: string;
  bg?: string;
  fg?: string;
  isFinal: boolean;
};

type StatusesContextValue = {
  statuses: StatusMeta[];
  loading: boolean;
  error: string | null;
  upsertStatus: (s: StatusMeta) => Promise<void>;
  removeStatus: (key: StatusKey) => void;
  resetToDefaults: () => void;
  getByKey: (key: StatusKey) => StatusMeta | undefined;
  isFinal: (key: StatusKey) => boolean;
  fallbackKey: StatusKey;
};

const FALLBACK_KEY = "received";

const Ctx = createContext<StatusesContextValue | null>(null);

// Removed: defaults() and safeLoad() functions - no longer used in cloud-first approach

export function StatusesProvider({ children, activeServiceId }: { children: React.ReactNode; activeServiceId: string | null }) {
  const [statuses, setStatuses] = useState<StatusMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visibilityKey, setVisibilityKey] = useState(0);

  useEffect(() => {
    const onVisible = () => setVisibilityKey((k) => k + 1);
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  useEffect(() => {
    // If activeServiceId is null, don't load statuses
    if (!activeServiceId) {
      setStatuses([]);
      setLoading(false);
      setError(null);
      return;
    }

    // If no supabase, don't load statuses
    if (!supabase) {
      setStatuses([]);
      setLoading(false);
      setError(null);
      return;
    }

    (async () => {
      try {
        setLoading(true);
        setError(null);

        // V Tauri/desktopu getSession() často vrací prošlý token → 401 Invalid JWT
        const { data: refreshData } = await supabase.auth.refreshSession();
        const accessToken =
          refreshData?.session?.access_token ??
          (await supabase.auth.getSession()).data?.session?.access_token;
        if (!accessToken) {
          setStatuses([]);
          setLoading(false);
          setError(null);
          return;
        }

        // First: try to load statuses directly from DB
        const { data: dbStatuses, error: dbError } = await supabase
          .from("service_statuses")
          .select("*")
          .eq("service_id", activeServiceId)
          .order("order_index");

        if (dbError) {
          console.error("[Statuses] load failed", dbError);
          setStatuses([]);
          setLoading(false);
          setError(normalizeError(dbError) || "Chyba při načítání statusů z databáze");
          return;
        }

        // If we have statuses, use them
        if (dbStatuses && dbStatuses.length > 0) {
          const mappedStatuses: StatusMeta[] = dbStatuses.map((s: any) => ({
            key: String(s.key),
            label: String(s.label),
            bg: typeof s.bg === "string" ? s.bg : undefined,
            fg: typeof s.fg === "string" ? s.fg : undefined,
            isFinal: !!s.is_final,
          }));
          setStatuses(mappedStatuses);
          setLoading(false);
          setError(null);
          return;
        }

        // If no statuses in DB, initialize defaults via Edge Function
        const { data: initData, error: initError } = await supabase.functions.invoke("statuses-init-defaults", {
          body: { serviceId: activeServiceId },
        });

        if (initError) {
          console.error("[Statuses] load failed", initError);
          setStatuses([]);
          setLoading(false);
          setError(normalizeError(initError) || "Chyba při inicializaci výchozích statusů");
          return;
        }

        if (!initData?.ok) {
          console.error("[Statuses] load failed", { initData });
          setStatuses([]);
          setLoading(false);
          setError("Chyba při inicializaci výchozích statusů");
          return;
        }

        // After init, reload from DB
        const { data: reloadedStatuses, error: reloadError } = await supabase
          .from("service_statuses")
          .select("*")
          .eq("service_id", activeServiceId)
          .order("order_index");

        if (reloadError) {
          console.error("[Statuses] load failed", reloadError);
          setStatuses([]);
          setLoading(false);
          setError(normalizeError(reloadError) || "Chyba při načítání statusů po inicializaci");
          return;
        }

        if (reloadedStatuses && reloadedStatuses.length > 0) {
          const mappedStatuses: StatusMeta[] = reloadedStatuses.map((s: any) => ({
            key: String(s.key),
            label: String(s.label),
            bg: typeof s.bg === "string" ? s.bg : undefined,
            fg: typeof s.fg === "string" ? s.fg : undefined,
            isFinal: !!s.is_final,
          }));
          setStatuses(mappedStatuses);
        } else {
          setStatuses([]);
        }
        setLoading(false);
        setError(null);
      } catch (err: any) {
        console.error("[Statuses] load failed", err);
        setStatuses([]);
        setLoading(false);
        setError(normalizeError(err) || "Neznámá chyba při načítání statusů");
      }
    })();
  }, [activeServiceId, visibilityKey]);

  const getByKey = (key: StatusKey) => statuses.find((s) => s.key === key);

  const isFinal = (key: StatusKey) => getByKey(key)?.isFinal ?? false;

  const upsertStatus = async (s: StatusMeta) => {
    const key = s.key.trim();
    const label = s.label.trim();
    if (!key || !label) return;

    // Validate activeServiceId and supabase
    if (!activeServiceId || !supabase) {
      showToast("Chyba: Nelze uložit status bez aktivního servisu", "error");
      return;
    }

    // Calculate order_index: if status exists, keep its order; otherwise, append to end
    const existingStatus = statuses.find((x) => x.key === key);
    let orderIndex: number;
    
    if (existingStatus) {
      // Find the existing status in DB to get its order_index
      const { data: existingDbStatus } = await supabase
        .from("service_statuses")
        .select("order_index")
        .eq("service_id", activeServiceId)
        .eq("key", key)
        .maybeSingle();
      
      orderIndex = (existingDbStatus as any)?.order_index ?? statuses.length;
    } else {
      // New status: append to end (max order_index + 1)
      const { data: maxOrder } = await supabase
        .from("service_statuses")
        .select("order_index")
        .eq("service_id", activeServiceId)
        .order("order_index", { ascending: false })
        .limit(1)
        .maybeSingle();
      
      orderIndex = (maxOrder as any)?.order_index !== undefined ? (maxOrder as any).order_index + 1 : statuses.length;
    }

    // Perform Supabase upsert
    const { error } = await (supabase
      .from("service_statuses") as any)
      .upsert(
        {
          service_id: activeServiceId,
          key,
          label,
          bg: s.bg?.trim() || null,
          fg: s.fg?.trim() || null,
          is_final: !!s.isFinal,
          order_index: orderIndex,
        },
        {
          onConflict: "service_id,key",
        }
      );

    if (error) {
      console.error("[Statuses] upsert failed", error);
      showToast(`Chyba při ukládání statusu: ${error.message || "Neznámá chyba"}`, "error");
      return;
    }

    // Update local state only after successful DB upsert
    setStatuses((prev) => {
      const next = prev.filter((x) => x.key !== key);
      next.push({
        key,
        label,
        bg: s.bg?.trim() || undefined,
        fg: s.fg?.trim() || undefined,
        isFinal: !!s.isFinal,
      });
      return next;
    });

    showToast("Status uložen", "success");
  };

  const removeStatus = (key: StatusKey) => {
    // nedovol smaž fallback
    if (key === FALLBACK_KEY) return;
        setStatuses((prev) => prev.filter((s) => s.key !== key));
  };

  const resetToDefaults = () => {
    // Reset clears statuses - they must be reloaded from DB
    setStatuses([]);
  };

  const value = useMemo<StatusesContextValue>(
    () => ({
      statuses,
      loading,
      error,
      upsertStatus,
      removeStatus,
      resetToDefaults,
      getByKey,
      isFinal,
      fallbackKey: FALLBACK_KEY,
    }),
    [statuses, loading, error]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStatuses() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStatuses must be used within StatusesProvider");
  return ctx;
}
