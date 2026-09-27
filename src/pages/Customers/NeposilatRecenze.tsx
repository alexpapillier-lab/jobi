import { useEffect, useState } from "react";
import { showToast } from "../../components/Toast";
import { reportError } from "../../lib/reportError";
import { nactiNeposilatRecenze, ulozNeposilatRecenze } from "../../lib/recenze";
import { useActiveRole } from "../../hooks/useActiveRole";
import type { CustomerRecord } from "./CustomerList";

/**
 * Přepínač „Neposílat žádosti o recenzi“ v detailu zákazníka.
 *
 * Ukládá se hned (není součástí okna Upravit): je to souhlas zákazníka,
 * ne údaj, který by se měl ztratit se zavřeným formulářem. Příznak se čte
 * zvlášť – dokud na serveru není migrace 20260927140000, sloupec chybí
 * a přepínač se jen neukáže (seznam zákazníků kvůli němu nespadne).
 */
export function NeposilatRecenze({
  customer,
  activeServiceId,
  onVersion,
}: {
  customer: CustomerRecord;
  activeServiceId: string | null;
  /** Uložení zvedne verzi řádku – bez ní by pak okno Upravit hlásilo souběžnou úpravu. */
  onVersion: (version: number) => void;
}) {
  const { hasCapability } = useActiveRole(activeServiceId);
  const smiUpravit = hasCapability("can_manage_customers");
  // Hodnota patří konkrétnímu zákazníkovi – po přepnutí na jiného se neukáže cizí.
  const [nacteno, setNacteno] = useState<{ id: string; hodnota: boolean | null } | null>(null);
  const [ukladam, setUkladam] = useState(false);
  const hodnota = nacteno?.id === customer.id ? nacteno.hodnota : null;
  const setHodnota = (v: boolean) => setNacteno({ id: customer.id, hodnota: v });

  useEffect(() => {
    let zruseno = false;
    const id = customer.id;
    void nactiNeposilatRecenze(id).then((v) => { if (!zruseno) setNacteno({ id, hodnota: v }); });
    return () => { zruseno = true; };
  }, [customer.id]);

  if (hodnota === null) return null;

  const prepni = async (dalsi: boolean) => {
    if (!activeServiceId) return;
    setUkladam(true);
    setHodnota(dalsi);
    const res = await ulozNeposilatRecenze(customer.id, activeServiceId, dalsi);
    setUkladam(false);
    if (!res.ok) {
      setHodnota(!dalsi);
      reportError({ code: "customers.review_opt_out_failed", error: res.error, userMessage: "Změnu se nepodařilo uložit", source: "Customers.NeposilatRecenze", serviceId: activeServiceId });
      return;
    }
    if (res.version != null) onVersion(res.version);
    showToast(dalsi ? "Zákazník nedostane žádost o recenzi" : "Žádosti o recenzi zapnuty", "success");
  };

  return (
    <label
      title={smiUpravit ? undefined : "Nemáte oprávnění upravovat zákazníky"}
      style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text)", cursor: smiUpravit ? "pointer" : "not-allowed", opacity: smiUpravit ? 1 : 0.6 }}
    >
      <input
        type="checkbox"
        checked={hodnota}
        disabled={!smiUpravit || ukladam}
        onChange={(e) => void prepni(e.target.checked)}
        style={{ width: 18, height: 18, accentColor: "var(--accent)" }}
      />
      Neposílat žádosti o recenzi
      <span style={{ color: "var(--muted)", fontSize: 12 }}>(automatizace v Nastavení → Komunikace)</span>
    </label>
  );
}
