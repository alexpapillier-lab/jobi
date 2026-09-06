import { useEffect, useState } from "react";
import { supabase, supabaseUrl, supabaseFetch } from "../lib/supabaseClient";
import { useIsRootOwner } from "../hooks/useIsRootOwner";
import { showToast } from "./Toast";

/**
 * Upozornění, že v otevřeném servisu nejsem člen.
 *
 * Majitel aplikace vidí v přepínači **všechny** servisy (services-list mu je
 * vrací s rolí „owner"), jenže databáze pouští data jen členům. Po přepnutí do
 * cizího servisu se tak načte prázdno: nula zakázek, nula zákazníků, prázdný
 * sklad – a vypadá to, že servis o data přišel. Přesně tak to na zátěžovém
 * servisu vypadalo i majiteli Jobi, než se přišlo na to, že v něm členství nemá.
 *
 * Majitel aplikace si přístup zjedná jedním kliknutím. Schválně členstvím, ne
 * výjimkou v RLS: přístup je pak vidět v týmu servisu (zákazník ví, kdo mu do
 * dílny vidí), dá se odebrat a zbytek aplikace o žádnou výjimku neví.
 *
 * Proužek se ptá databáze přímo na členství, ne seznamu servisů: role
 * v seznamu je jen popiska z edge funkce, kdežto o tom, co se načte,
 * rozhoduje řádek v `service_memberships`.
 */
export function CiziServis({ serviceId, onPristupZiskan }: {
  serviceId: string | null;
  /** Po získání přístupu se musí znovu načíst seznam servisů i data stránky. */
  onPristupZiskan?: () => void;
}) {
  const [chybiClenstvi, setChybiClenstvi] = useState(false);
  const [pracuje, setPracuje] = useState(false);
  const jeMajitelAplikace = useIsRootOwner();

  useEffect(() => {
    let zruseno = false;
    setChybiClenstvi(false);
    if (!serviceId || !supabase) return;
    void (async () => {
      const { data: uzivatel } = await supabase!.auth.getUser();
      const uid = uzivatel?.user?.id;
      if (!uid || zruseno) return;
      const { data, error } = await supabase!
        .from("service_memberships")
        .select("user_id")
        .eq("service_id", serviceId)
        .eq("user_id", uid)
        .maybeSingle();
      // Při chybě dotazu se nic netvrdí: proužek „nejste členem" u servisu,
      // kde členem jsem, by byl horší než žádný.
      if (!zruseno && !error) setChybiClenstvi(!data);
    })();
    return () => {
      zruseno = true;
    };
  }, [serviceId]);

  async function ziskatPristup() {
    if (!serviceId || !supabase || !supabaseUrl) return;
    setPracuje(true);
    try {
      // Na desktopu vrací getSession() občas prošlý token → 401; stejný postup
      // má callServiceManage v OwnerSettings.
      const { data: obnovene } = await supabase.auth.refreshSession();
      const token = obnovene?.session?.access_token ?? (await supabase.auth.getSession()).data?.session?.access_token;
      if (!token) throw new Error("Nejste přihlášeni.");
      const res = await supabaseFetch(`${supabaseUrl}/functions/v1/service-manage`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "join", serviceId }),
      });
      const raw = await res.text();
      let data: { error?: string } = {};
      try {
        if (raw) data = JSON.parse(raw) as typeof data;
      } catch {
        // odpověď není JSON (např. HTML od brány)
      }
      if (!res.ok || data.error) throw new Error(data.error || `Chyba ${res.status}`);
      setChybiClenstvi(false);
      showToast("Přístup do servisu získán, data se načítají", "success");
      onPristupZiskan?.();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Přístup se nepodařilo získat", "error");
    } finally {
      setPracuje(false);
    }
  }

  if (!chybiClenstvi) return null;

  return (
    <div
      role="status"
      data-cizi-servis="1"
      style={{
        position: "fixed",
        left: "50%",
        transform: "translateX(-50%)",
        top: 12,
        zIndex: 9000,
        maxWidth: 640,
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "10px 16px",
        borderRadius: 12,
        border: "1px solid var(--warning-border, #f59e0b)",
        background: "var(--warning-bg, #fffbeb)",
        color: "var(--warning-text, #92400e)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
        fontSize: 13,
        fontWeight: 600,
        lineHeight: 1.45,
      }}
    >
      <span>
        V tomhle servisu nemáte členství, takže se z něj nenačtou žádná data – zakázky, zákazníky ani sklad.
        Servis o ně nepřišel.
        {jeMajitelAplikace && " Přístup si můžete zjednat; objeví se jako členství v týmu servisu."}
      </span>
      {jeMajitelAplikace && (
        <button
          type="button"
          onClick={() => { void ziskatPristup(); }}
          disabled={pracuje}
          style={{
            flex: "0 0 auto",
            padding: "6px 12px",
            borderRadius: 8,
            border: "1px solid var(--warning-text, #92400e)",
            background: "transparent",
            color: "inherit",
            fontSize: 13,
            fontWeight: 700,
            cursor: pracuje ? "default" : "pointer",
          }}
        >
          {pracuje ? "Získávám…" : "Získat přístup"}
        </button>
      )}
    </div>
  );
}
