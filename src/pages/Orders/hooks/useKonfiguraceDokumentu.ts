/**
 * Nastavení dokumentů servisu (service_document_settings): první načtení z DB
 * i realtime obnova, plus doplnění firemních údajů do kopie v prohlížeči.
 * Hodnota se na stránce Zakázky nečte (tisk si ji bere z lib), efekty ale
 * musí běžet. Vyneseno z Orders.tsx beze změny obsahu.
 */
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { devLog } from "../../../lib/devLog";
import { STORAGE_KEYS } from "../../../constants/storageKeys";
import { loadDocumentsConfigFromDB, safeLoadDocumentsConfig } from "../../../lib/documentHelpers";
import { doplnFiremniUdajeZDb } from "../../../lib/companyData";

export function useKonfiguraceDokumentu(activeServiceId: string | null, activeServiceIdRef: MutableRefObject<string | null>) {
  const [, setDocumentsConfig] = useState<any>(() => safeLoadDocumentsConfig());
  const docsReqIdRef = useRef(0);
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
}
