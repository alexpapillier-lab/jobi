import { useState } from "react";
import { Button } from "../../components/ui";
import { Card } from "../../lib/settingsUi";
import { SectionHeading } from "../../components/SectionHeading";
import { showToast } from "../../components/Toast";
import { reportError } from "../../lib/reportError";
import { detectPlatform } from "../../lib/errorLog";
import { supabase, supabaseUrl, supabaseFetch } from "../../lib/supabaseClient";

/**
 * Nastavení → Aplikace → Nápověda a podpora.
 *
 * Dvě věci na jednom místě: odkaz do nápovědy a formulář na hlášení chyby.
 * Formulář existuje proto, že hlášení e-mailem přicházela bez verze,
 * platformy a bez toho, co se dělo v logu. Uživatel napíše jen větu o tom,
 * co se stalo; zbytek si server dohledá sám.
 */
const NAPOVEDA_URL = "https://appjobi.com/napoveda";
export const PODPORA_MAIL = "podpora@appjobi.com";

const KAPITOLY: { kotva: string; nazev: string }[] = [
  { kotva: "prvni-kroky", nazev: "První kroky" },
  { kotva: "prijem-zakazky", nazev: "Příjem zakázky" },
  { kotva: "stavy-a-automatizace", nazev: "Stavy a automatizace" },
  { kotva: "tisk-a-jobidocs", nazev: "Tisk a JobiDocs" },
  { kotva: "nabidka-a-portal", nazev: "Nabídka a portál" },
  { kotva: "sms", nazev: "SMS zákazníkům" },
  { kotva: "faktury", nazev: "Faktury a účetnictví" },
  { kotva: "sklad", nazev: "Sklad a marže" },
  { kotva: "tym-a-pobocky", nazev: "Tým a pobočky" },
  { kotva: "import-a-api", nazev: "Import a API" },
];

async function odeslatHlaseni(zprava: string, serviceId: string | null): Promise<{ ok?: boolean; error?: string }> {
  if (!supabase || !supabaseUrl) return { error: "Aplikace není připojená ke cloudu." };
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) return { error: "Nejste přihlášeni." };
  const res = await supabaseFetch(`${supabaseUrl}/functions/v1/support-report`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      message: zprava,
      serviceId,
      appVersion: import.meta.env.VITE_APP_VERSION ?? null,
      platform: detectPlatform(),
    }),
  });
  const raw = await res.text();
  const odpoved = raw ? JSON.parse(raw) : {};
  if (!res.ok) return { error: odpoved?.error ?? `Chyba ${res.status}` };
  return { ok: true };
}

export function HelpSupportSettings({ activeServiceId }: { activeServiceId: string | null }) {
  const [zprava, setZprava] = useState("");
  const [odesila, setOdesila] = useState(false);
  const [odeslano, setOdeslano] = useState(false);

  const otevri = (kotva?: string) => {
    window.open(kotva ? `${NAPOVEDA_URL}#${kotva}` : NAPOVEDA_URL, "_blank", "noopener");
  };

  const odeslat = async () => {
    const text = zprava.trim();
    if (text.length < 10) {
      showToast("Napište prosím aspoň větu o tom, co se stalo.", "error");
      return;
    }
    setOdesila(true);
    try {
      const res = await odeslatHlaseni(text, activeServiceId);
      if (res.error) {
        showToast(res.error, "error");
        return;
      }
      setZprava("");
      setOdeslano(true);
      showToast("Hlášení odesláno. Ozveme se na váš e-mail.", "success");
    } catch (error) {
      reportError({
        code: "support.report_failed",
        error,
        userMessage: "Hlášení se nepodařilo odeslat. Napište nám prosím e-mailem.",
        source: "HelpSupportSettings",
        serviceId: activeServiceId,
      });
    } finally {
      setOdesila(false);
    }
  };

  return (
    <>
      <Card>
        <SectionHeading size="sm">Nápověda</SectionHeading>
        <div style={{ color: "var(--muted)", fontSize: "var(--text-sm)", marginTop: "calc(-1 * var(--space-2))" }}>
          Deset kapitol o tom, jak se v Jobi dělá příjem, tisk, nabídka, SMS, faktury a sklad.
        </div>
        <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {KAPITOLY.map((k) => (
            <button
              key={k.kotva}
              type="button"
              onClick={() => otevri(k.kotva)}
              style={{
                padding: "6px 12px",
                borderRadius: 999,
                border: "1px solid var(--border)",
                background: "var(--panel-2)",
                color: "var(--text)",
                fontSize: "var(--text-sm)",
                cursor: "pointer",
              }}
            >
              {k.nazev}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 14 }}>
          <Button variant="soft" onClick={() => otevri()}>Otevřít nápovědu</Button>
        </div>
      </Card>

      <Card>
        <SectionHeading size="sm">Nahlásit chybu</SectionHeading>
        <div style={{ color: "var(--muted)", fontSize: "var(--text-sm)", marginTop: "calc(-1 * var(--space-2))" }}>
          Popište, co jste dělali a co se stalo. K hlášení se automaticky přiloží verze aplikace, platforma
          a posledních deset chyb z logu vašeho servisu, takže nemusíte nic dohledávat.
        </div>
        <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
          <textarea
            value={zprava}
            onChange={(e) => { setZprava(e.target.value); setOdeslano(false); }}
            rows={5}
            maxLength={4000}
            placeholder="Např. Při tisku zakázkového listu se okno zavře a nic se nevytiskne. Stalo se to poprvé dnes ráno."
            className="ui-input"
            style={{ resize: "vertical", fontFamily: "inherit", lineHeight: 1.6, padding: "10px 12px" }}
          />
          <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--muted)" }}>
              {odeslano ? "Hlášení odesláno, ozveme se na váš e-mail." : `Nebo napište na ${PODPORA_MAIL}.`}
            </span>
            <Button variant="primary" onClick={() => void odeslat()} disabled={odesila || zprava.trim().length < 10}>
              {odesila ? "Odesílám…" : "Odeslat hlášení"}
            </Button>
          </div>
        </div>
      </Card>
    </>
  );
}
