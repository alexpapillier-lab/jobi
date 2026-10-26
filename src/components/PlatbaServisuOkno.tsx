import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { ibanZCislaUctu } from "../lib/banka";
import { nazevObdobi, prevedPlatbuMehoServisu, spaydPlatbyServisu, type PlatbaMehoServisu } from "../lib/platbyServisu";
import { qrDataUrl } from "../../jobidocs/src/qr";
import { CopyButton } from "./CopyButton";
import { Button } from "./ui";
import { showToast } from "./Toast";
import { useIsNarrow } from "../hooks/useIsNarrow";

/**
 * Okno „Platba za Jobi“ s QR platbou pro vlastníka a adminy servisu, který
 * platí majiteli aplikace (Owner → Platby servisů). Ukáže se od dne platby,
 * dokud majitel platbu nezapíše; po zavření se znovu ukáže až další den.
 * Kdo má okno vidět, rozhoduje databáze (platba_meho_servisu vrací null
 * technikům, majiteli aplikace i servisům, které nic nedluží).
 */
const klicZavreni = (serviceId: string, obdobi: string) => `jobi:platba-servisu-zavreno:${serviceId}:${obdobi}:${new Date().toISOString().slice(0, 10)}`;

export function PlatbaServisuOkno({ serviceId, skryt }: { serviceId: string | null; skryt: boolean }) {
  const [platba, setPlatba] = useState<PlatbaMehoServisu | null>(null);
  const [posilam, setPosilam] = useState(false);
  /* Na telefonu je dole navigační lišta – okno nad ní. */
  const uzke = useIsNarrow();

  useEffect(() => {
    setPlatba(null);
    if (!serviceId || skryt || !supabase) return;
    let zruseno = false;
    void (supabase as any).rpc("platba_meho_servisu", { p_service_id: serviceId }).then(({ data }: { data: unknown }) => {
      if (zruseno) return;
      const p = prevedPlatbuMehoServisu(data);
      if (!p) return;
      try { if (localStorage.getItem(klicZavreni(serviceId, p.obdobi))) return; } catch { /* bez úložiště ukázat */ }
      setPlatba(p);
    });
    return () => { zruseno = true; };
  }, [serviceId, skryt]);

  if (!platba || !serviceId) return null;

  const iban = ibanZCislaUctu(platba.ucet);
  const qr = iban ? qrDataUrl(spaydPlatbyServisu(platba, iban), 180) : "";
  const castka = `${new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 2 }).format(platba.castka)} Kč`;
  const nahlasit = async () => {
    if (!supabase) return;
    setPosilam(true);
    const { error } = await (supabase as any).rpc("platba_nahlasit_zaplaceno", { p_service_id: serviceId });
    setPosilam(false);
    if (error) { showToast(`Nepodařilo se uložit: ${error.message}`, "error"); return; }
    showToast("Díky, platba je nahlášená.", "success");
    setPlatba(null);
  };
  const zavrit = () => {
    try { localStorage.setItem(klicZavreni(serviceId, platba.obdobi), "1"); } catch { /* ignorovat */ }
    setPlatba(null);
  };
  const radek = (popis: string, hodnota: string, kopie?: string) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, minWidth: 0 }}>
      <span style={{ color: "var(--muted)", minWidth: 42 }}>{popis}</span>
      <strong style={{ color: "var(--text)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{hodnota}</strong>
      {kopie && <CopyButton value={kopie} label={popis.toLowerCase()} />}
    </div>
  );

  return (
    <div
      role="dialog"
      aria-label="Platba za Jobi"
      data-platba-servisu
      style={{
        position: "fixed", right: 16, bottom: uzke ? 84 : 16, zIndex: 4500, width: "min(380px, calc(100vw - 32px))", boxSizing: "border-box",
        background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16, boxShadow: "var(--shadow-soft)", padding: 16,
        display: "grid", gap: 12,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div>
          <div style={{ fontWeight: 900, fontSize: 16, color: "var(--text)" }}>Platba za Jobi – {nazevObdobi(platba.obdobi)}</div>
          <div style={{ fontSize: 12, color: platba.dniPoSplatnosti > 3 ? "var(--danger, #c0392b)" : "var(--muted)", marginTop: 2 }}>
            {platba.dniPoSplatnosti === 0 ? "Splatné dnes" : `Splatné ${new Date(`${platba.splatnost}T12:00:00`).toLocaleDateString("cs-CZ")} (${platba.dniPoSplatnosti} ${platba.dniPoSplatnosti === 1 ? "den" : platba.dniPoSplatnosti < 5 ? "dny" : "dní"} po splatnosti)`}
          </div>
        </div>
        <button type="button" onClick={zavrit} aria-label="Zavřít" title="Zavřít – připomene se zítra" style={{ background: "transparent", border: "none", color: "var(--muted)", fontSize: 18, cursor: "pointer", lineHeight: 1 }}>✕</button>
      </div>
      <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        {qr ? (
          <img src={qr} alt="QR platba" width={136} height={136} style={{ background: "#fff", padding: 6, borderRadius: 8, border: "1px solid var(--border)", imageRendering: "pixelated" }} />
        ) : null}
        <div style={{ display: "grid", gap: 6, minWidth: 0, flex: 1 }}>
          {radek("Částka", castka)}
          {platba.ucet && radek("Účet", platba.ucet, platba.ucet)}
          {platba.vs && radek("VS", platba.vs, platba.vs)}
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Button size="sm" variant="primary" disabled={posilam} onClick={() => void nahlasit()}>{posilam ? "Ukládám…" : "Zaplaceno"}</Button>
      </div>
    </div>
  );
}
