import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

/**
 * Upozornění, že v otevřeném servisu nejsem člen.
 *
 * Majitel aplikace vidí v přepínači **všechny** servisy (services-list mu je
 * vrací s rolí „owner"), jenže databáze pouští data jen členům. Po přepnutí do
 * cizího servisu se tak načte prázdno: nula zakázek, nula zákazníků, prázdný
 * sklad – a vypadá to, že servis o data přišel. Přesně tak to na zátěžovém
 * servisu vypadalo i majiteli Jobi, než se přišlo na to, že v něm členství nemá.
 *
 * Proužek se ptá databáze přímo na členství, ne seznamu servisů: role
 * v seznamu je jen popiska z edge funkce, kdežto o tom, co se načte,
 * rozhoduje řádek v `service_memberships`.
 */
export function CiziServis({ serviceId }: { serviceId: string | null }) {
  const [chybiClenstvi, setChybiClenstvi] = useState(false);

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
        maxWidth: 620,
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
      V tomhle servisu nemáte členství, takže se z něj nenačtou žádná data –
      zakázky, zákazníci ani sklad. Servis o ně nepřišel; přidejte si členství
      v záložce Owner, nebo se přepněte zpět na svůj servis.
    </div>
  );
}
