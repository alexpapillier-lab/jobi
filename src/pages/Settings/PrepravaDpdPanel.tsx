import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "../../lib/settingsUi";
import { showToast } from "../../components/Toast";
import { reportError } from "../../lib/reportError";
import { nactiVsechnaNastaveniDpd, ulozNastaveniDpd, type NastaveniDpd } from "../../lib/prepravaDpd";

/**
 * Owner → Přeprava DPD: komu je objednávání DPD ze Zásilek zapnuté a s jakým
 * účtem. Jen pro majitele aplikace (RPC preprava_dpd_nastav to hlídá i na
 * serveru). Klíč API jde rovnou do Vaultu a zpátky se nečte – pole je
 * prázdné a vyplňuje se jen při zadání nebo výměně klíče.
 */

type Service = { service_id: string; service_name: string };

export function PrepravaDpdPanel({ services }: { services: Service[] }) {
  const [vsechna, setVsechna] = useState<NastaveniDpd[]>([]);
  const [serviceId, setServiceId] = useState("");
  const [zapnuto, setZapnuto] = useState(false);
  const [dsw, setDsw] = useState("");
  const [testovaci, setTestovaci] = useState(false);
  const [klic, setKlic] = useState("");
  const [ukladam, setUkladam] = useState(false);

  const nacti = useCallback(async () => {
    try {
      setVsechna(await nactiVsechnaNastaveniDpd());
    } catch (error) {
      reportError({ code: "owner.dpd_load_failed", error, userMessage: "Nastavení přepravy DPD se nepodařilo načíst.", source: "PrepravaDpdPanel" });
    }
  }, []);
  useEffect(() => { void nacti(); }, [nacti]);

  const aktualni = useMemo(() => vsechna.find((n) => n.serviceId === serviceId) ?? null, [vsechna, serviceId]);
  useEffect(() => {
    setZapnuto(aktualni?.zapnuto ?? false);
    setDsw(aktualni?.dsw ?? "");
    setTestovaci(aktualni?.testovaci ?? false);
    setKlic("");
  }, [aktualni, serviceId]);

  const ulozit = async () => {
    if (!serviceId || ukladam) return;
    if (zapnuto && !dsw.trim()) { showToast("Vyplňte číslo zákazníka DPD (DSW).", "error"); return; }
    if (zapnuto && !klic.trim() && !aktualni?.maKlic) { showToast("Zadejte klíč DPD API.", "error"); return; }
    setUkladam(true);
    try {
      await ulozNastaveniDpd({ serviceId, zapnuto, dsw, testovaci, klic });
      showToast(zapnuto ? "Přeprava DPD zapnutá." : "Nastavení uloženo.", "success");
      await nacti();
    } catch (error) {
      reportError({ code: "owner.dpd_save_failed", error, userMessage: error instanceof Error ? error.message : "Uložení se nepodařilo.", source: "PrepravaDpdPanel", serviceId });
    } finally {
      setUkladam(false);
    }
  };

  const border = "1px solid var(--border)";
  const pole: React.CSSProperties = { padding: "8px 10px", borderRadius: 10, border, background: "var(--bg)", color: "var(--text)", fontSize: 13 };
  const nazev = (id: string) => services.find((s) => s.service_id === id)?.service_name ?? id.slice(0, 8);
  const zapnute = vsechna.filter((n) => n.zapnuto);

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 4, color: "var(--text)" }}>Přeprava DPD</div>
          <div style={{ fontSize: 13, color: "var(--muted)", maxWidth: 560 }}>
            Objednání DPD (štítek nebo kurýr) přímo ze Zásilek mezi pobočkami. Servis bez zapnutí tlačítko vůbec nevidí.
            {zapnute.length > 0 ? ` Zapnuto: ${zapnute.map((n) => nazev(n.serviceId)).join(", ")}.` : " Zatím není zapnuté nikde."}
          </div>
        </div>
        <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} style={{ ...pole, minWidth: 220 }} aria-label="Servis">
          <option value="">Vyber servis…</option>
          {services.map((s) => <option key={s.service_id} value={s.service_id}>{s.service_name}</option>)}
        </select>
      </div>

      {serviceId && (
        <div style={{ display: "grid", gap: 10, maxWidth: 520 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={zapnuto} onChange={(e) => setZapnuto(e.target.checked)} />
            Zapnout přepravu DPD pro tento servis
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--muted)" }}>
            Číslo zákazníka DPD (DSW)
            <input value={dsw} onChange={(e) => setDsw(e.target.value.replace(/\s/g, ""))} placeholder="např. 15500476" style={pole} />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--muted)" }}>
            Klíč DPD API {aktualni?.maKlic ? "(uložený – vyplňte jen při výměně)" : ""}
            <input type="password" autoComplete="off" value={klic} onChange={(e) => setKlic(e.target.value)} placeholder={aktualni?.maKlic ? "••••••••" : "x-api-key z MojeDPD"} style={pole} />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={testovaci} onChange={(e) => setTestovaci(e.target.checked)} />
            Testovací prostředí DPD (geoapi-test.dpd.cz – potřebuje testovací klíč)
          </label>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            Adresy odesílatele a příjemce se berou z poboček (Nastavení → Firma → Pobočky): ulice s číslem, město, PSČ, telefon, u pobočky s jinou firmou její název.
          </div>
          <div>
            <button type="button" onClick={() => void ulozit()} disabled={ukladam} style={{ padding: "8px 14px", borderRadius: 10, border: "none", background: "var(--accent)", color: "white", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
              {ukladam ? "Ukládám…" : "Uložit"}
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}
