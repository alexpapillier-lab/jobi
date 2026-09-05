import { ThemeLogo } from "./ThemeLogo";

/**
 * Konec zkušebního období: aplikace se zamkne, dokud si servis nevybere plán.
 *
 * Zkušební období není „měsíc placených modulů a pak se jede zadarmo dál“ –
 * po jeho konci se v Jobi nepracuje. Data zůstávají netknutá, jen se do nich
 * nedá, dokud majitel Jobi nárok neprodlouží (Owner → Placené moduly →
 * Přístup do aplikace).
 */
export function TrialEnded({
  serviceName,
  services,
  onSwitchService,
  onSignOut,
}: {
  serviceName: string;
  services: Array<{ service_id: string; service_name: string }>;
  onSwitchService: (serviceId: string) => void;
  onSignOut: () => void;
}) {
  const jine = services.filter((s) => s.service_name !== serviceName);
  return (
    <div style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", background: "var(--bg)", padding: 24, overflow: "auto" }}>
      <div style={{ width: "100%", maxWidth: 480, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 20, padding: 28, boxShadow: "var(--shadow-soft)", textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
          <ThemeLogo size={56} />
        </div>
        <h1 style={{ margin: 0, fontSize: 21, fontWeight: 900, color: "var(--text)" }}>Zkušební období skončilo</h1>
        <p style={{ margin: "12px 0 6px", fontSize: 14, lineHeight: 1.6, color: "var(--muted)" }}>
          Servis <b style={{ color: "var(--text)" }}>{serviceName}</b> si vyzkoušel Jobi na měsíc. Abyste mohli pokračovat,
          vyberte si plán.
        </p>
        <p style={{ margin: "0 0 22px", fontSize: 13, lineHeight: 1.6, color: "var(--muted)" }}>
          Zakázky, zákazníci i sklad zůstávají uložené. Jakmile bude plán aktivní, najdete všechno přesně tak, jak jste to nechali.
        </p>

        <a
          href="mailto:podpora@appjobi.com?subject=Jobi%20%E2%80%93%20v%C3%BDb%C4%9Br%20plánu&body=Dobr%C3%BD%20den%2C%20chceme%20pokra%C4%8Dovat%20v%20Jobi."
          style={{ display: "block", padding: "12px 16px", borderRadius: 12, background: "var(--accent)", color: "#fff", fontWeight: 800, fontSize: 15, textDecoration: "none" }}
        >
          Vybrat plán
        </a>

        {jine.length > 0 && (
          <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>Přepnout na jiný servis</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center" }}>
              {jine.map((s) => (
                <button
                  key={s.service_id}
                  type="button"
                  onClick={() => onSwitchService(s.service_id)}
                  style={{ padding: "6px 12px", borderRadius: 999, border: "1px solid var(--border)", background: "var(--panel-2)", color: "var(--text)", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                >
                  {s.service_name}
                </button>
              ))}
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={onSignOut}
          style={{ marginTop: 16, background: "none", border: "none", color: "var(--muted)", fontSize: 12, textDecoration: "underline", cursor: "pointer" }}
        >
          Odhlásit se
        </button>
      </div>
    </div>
  );
}
