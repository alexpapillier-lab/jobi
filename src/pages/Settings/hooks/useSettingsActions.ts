import { useCallback, useRef } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { showToast } from "../../../components/Toast";
import { useStatuses, type StatusMeta } from "../../../state/StatusesStore";
import { STORAGE_KEYS } from "../../../constants/storageKeys";

type CompanyData = {
  abbreviation: string;
  name: string;
  ico: string;
  dic: string;
  language: string;
  defaultPhonePrefix: string;
  addressStreet: string;
  addressCity: string;
  addressZip: string;
  phone: string;
  email: string;
  website: string;
  bankAccount: string;
  iban: string;
  swift: string;
};

type UseSettingsActionsParams = {
  activeServiceId: string | null;
};

export function useSettingsActions({ activeServiceId }: UseSettingsActionsParams) {
  const { upsertStatus: upsertStatusFromStore, removeStatus: removeStatusFromStore, statuses } = useStatuses();
  const isReorderingRef = useRef(false);

  // Status operations
  const createStatus = useCallback(
    async (status: StatusMeta) => {
      await upsertStatusFromStore(status);
    },
    [upsertStatusFromStore]
  );

  const updateStatus = useCallback(
    async (status: StatusMeta) => {
      await upsertStatusFromStore(status);
    },
    [upsertStatusFromStore]
  );

  const deleteStatus = useCallback(
    async (key: string) => {
      if (!activeServiceId || !supabase) {
        showToast("Chyba: Nelze smazat status bez aktivního servisu", "error");
        return;
      }

      try {
        const { error } = await (supabase.from("service_statuses") as any).delete().eq("service_id", activeServiceId).eq("key", key);

        if (error) {
          console.error("[Settings] deleteStatus failed", error);
          showToast(`Chyba při mazání statusu: ${error.message || "Neznámá chyba"}`, "error");
          return;
        }

        // Remove from local state after successful DB delete
        removeStatusFromStore(key);
        showToast("Status smazán", "success");
      } catch (err) {
        console.error("[Settings] deleteStatus failed", err);
        showToast(`Chyba při mazání statusu: ${err instanceof Error ? err.message : "Neznámá chyba"}`, "error");
      }
    },
    [activeServiceId, removeStatusFromStore]
  );

  // Helper function to explicitly fetch statuses from DB
  const loadStatusesFromDB = useCallback(async (): Promise<void> => {
    if (!activeServiceId || !supabase) {
      return;
    }

    try {
      const { data: dbStatuses, error: dbError } = await supabase
        .from("service_statuses")
        .select("*")
        .eq("service_id", activeServiceId)
        .order("order_index");

      if (dbError) {
        console.error("[Settings] loadStatusesFromDB failed", dbError);
        return;
      }

      if (dbStatuses && dbStatuses.length > 0) {
        // Update local state by calling upsertStatus for each status
        // This ensures StatusesStore is updated with the correct order
        for (const s of dbStatuses) {
          const statusData = s as any;
          await upsertStatusFromStore({
            key: String(statusData.key),
            label: String(statusData.label),
            bg: typeof statusData.bg === "string" ? statusData.bg : undefined,
            fg: typeof statusData.fg === "string" ? statusData.fg : undefined,
            isFinal: !!statusData.is_final,
          });
        }
      }
    } catch (err) {
      console.error("[Settings] loadStatusesFromDB exception", err);
    }
  }, [activeServiceId, upsertStatusFromStore]);

  const reorderStatuses = useCallback(
    async (statusKeys: string[]) => {
      // Guard proti paralelním reorderům
      if (isReorderingRef.current) {
        showToast("Pořadí se právě ukládá.", "info");
        return;
      }

      if (!activeServiceId || !supabase) {
        showToast("Chyba: Nelze změnit pořadí statusů bez aktivního servisu", "error");
        return;
      }

      // Uložit předchozí pořadí pro rollback
      const prevStatusesOrder = statuses.map((s) => s.key);
      isReorderingRef.current = true;

      try {
        // Fáze A: Přesun všech statusů do bezpečné oblasti (order_index + 100000)
        // Každému statusu dáme unikátní dočasný index = 100000 + pozice v původním seznamu
        const phaseAUpdates = statusKeys.map((key, index) =>
          (supabase!.from("service_statuses") as any)
            .update({ order_index: 100000 + index })
            .eq("service_id", activeServiceId)
            .eq("key", key)
        );

        const phaseAResults = await Promise.all(phaseAUpdates);
        const phaseAErrors = phaseAResults.filter((r) => r.error);

        if (phaseAErrors.length > 0) {
          console.error("[Settings] reorderStatuses phase A failed", phaseAErrors);
          showToast("Nepodařilo se uložit pořadí stavů.", "error");
          // Rollback UI: obnovit předchozí pořadí
          for (let i = 0; i < prevStatusesOrder.length; i++) {
            const key = prevStatusesOrder[i];
            const status = statuses.find((s) => s.key === key);
            if (status) {
              await upsertStatusFromStore(status);
            }
          }
          // Explicitní re-fetch z DB
          await loadStatusesFromDB();
          return;
        }

        // Fáze B: Nastavení finálních indexů 0..N
        const phaseBUpdates = statusKeys.map((key, index) =>
          (supabase!.from("service_statuses") as any)
            .update({ order_index: index })
            .eq("service_id", activeServiceId)
            .eq("key", key)
        );

        const phaseBResults = await Promise.all(phaseBUpdates);
        const phaseBErrors = phaseBResults.filter((r) => r.error);

        if (phaseBErrors.length > 0) {
          console.error("[Settings] reorderStatuses phase B failed", phaseBErrors);
          showToast("Nepodařilo se uložit pořadí stavů.", "error");
          // Rollback UI: obnovit předchozí pořadí
          for (let i = 0; i < prevStatusesOrder.length; i++) {
            const key = prevStatusesOrder[i];
            const status = statuses.find((s) => s.key === key);
            if (status) {
              await upsertStatusFromStore(status);
            }
          }
          // Explicitní re-fetch z DB
          await loadStatusesFromDB();
          return;
        }

        // Úspěch: update local state na finální pořadí
        // Procházíme statusKeys a updatujeme každý status v pořadí
        for (let i = 0; i < statusKeys.length; i++) {
          const key = statusKeys[i];
          const status = statuses.find((s) => s.key === key);
          if (status) {
            await upsertStatusFromStore(status);
          }
        }

        showToast("Pořadí statusů uloženo", "success");
      } catch (err) {
        console.error("[Settings] reorderStatuses failed", err);
        showToast("Nepodařilo se uložit pořadí stavů.", "error");
        // Rollback UI: obnovit předchozí pořadí
        for (let i = 0; i < prevStatusesOrder.length; i++) {
          const key = prevStatusesOrder[i];
          const status = statuses.find((s) => s.key === key);
          if (status) {
            await upsertStatusFromStore(status);
          }
        }
        // Explicitní re-fetch z DB
        await loadStatusesFromDB();
      } finally {
        isReorderingRef.current = false;
      }
    },
    [activeServiceId, statuses, upsertStatusFromStore, loadStatusesFromDB]
  );

  // Service settings operations
  const saveServiceSettings = useCallback(
    async (companyData: CompanyData) => {
      // Save to localStorage (for backward compatibility)
      localStorage.setItem(STORAGE_KEYS.COMPANY, JSON.stringify(companyData));

      // Save abbreviation to service_settings in DB
      if (activeServiceId && supabase) {
        try {
          const { error } = await (supabase as any).rpc("update_service_settings", {
            p_service_id: activeServiceId,
            p_patch: {
              config: {
                abbreviation: companyData.abbreviation,
              },
            },
          });

          if (error) {
            throw error;
          }

          showToast("Uloženo", "success");
        } catch (err) {
          console.error("[Settings] Error saving service settings:", err);
          showToast(`Chyba při ukládání do databáze: ${err instanceof Error ? err.message : "Neznámá chyba"}`, "error");
          throw err;
        }
      } else {
        showToast("Uloženo", "success");
      }
    },
    [activeServiceId]
  );

  return {
    createStatus,
    updateStatus,
    deleteStatus,
    reorderStatuses,
    saveServiceSettings,
  };
}

