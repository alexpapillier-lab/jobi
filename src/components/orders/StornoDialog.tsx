import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../ui";

/**
 * Otázky při stornu zakázky.
 *
 * Když zakázka končí bez opravy, servis chce vědět proč – kvůli statistice
 * (kolik lidí odradila cena) i kvůli sporům („řekl jste, že to nejde“).
 * Dialog se ukáže při přepnutí do stavu, který vypadá jako storno; odpověď
 * jde do historie zakázky, stav se změní až po potvrzení.
 */
export const DUVODY_STORNA = [
  "Zákazník si opravu rozmyslel",
  "Cena byla pro zákazníka vysoká",
  "Zařízení je neopravitelné",
  "Díl není k dispozici",
  "Zákazník si zařízení nevyzvedl",
  "Jiný důvod",
] as const;

export type DuvodStorna = (typeof DUVODY_STORNA)[number];

export function StornoDialog({
  open,
  nazevStavu,
  onPotvrdit,
  onZrusit,
}: {
  open: boolean;
  /** Název cílového stavu, ať je jasné, kam zakázka půjde. */
  nazevStavu: string;
  onPotvrdit: (odpoved: { duvod: DuvodStorna; poznamka: string }) => Promise<void> | void;
  onZrusit: () => void;
}) {
  const [duvod, setDuvod] = useState<DuvodStorna>(DUVODY_STORNA[0]);
  const [poznamka, setPoznamka] = useState("");
  const [ceka, setCeka] = useState(false);

  useEffect(() => {
    if (!open) {
      setDuvod(DUVODY_STORNA[0]);
      setPoznamka("");
      setCeka(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Capture fáze: Escape jinak zavře celý detail zakázky.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onZrusit();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, onZrusit]);

  if (!open) return null;

  const potvrdit = async () => {
    setCeka(true);
    try {
      await onPotvrdit({ duvod, poznamka: poznamka.trim() });
    } finally {
      setCeka(false);
    }
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="storno-dialog-nadpis"
      data-escape-vlastni
      onMouseDown={(e) => e.stopPropagation()}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10_000, padding: 16 }}
    >
      <div style={{ background: "var(--panel)", color: "var(--text)", borderRadius: 14, border: "1px solid var(--border)", padding: 20, width: "min(100%, 460px)", display: "grid", gap: 14, boxShadow: "0 20px 60px rgba(0,0,0,0.35)" }}>
        <div>
          <h2 id="storno-dialog-nadpis" style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>Proč zakázka končí?</h2>
          <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
            Zakázka přejde do stavu „{nazevStavu}“. Důvod se zapíše do historie zakázky.
          </div>
        </div>

        <div role="radiogroup" aria-label="Důvod storna" style={{ display: "grid", gap: 6 }}>
          {DUVODY_STORNA.map((d) => (
            <label key={d} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 10, border: "1px solid var(--border)", background: duvod === d ? "var(--accent-soft)" : "transparent", cursor: "pointer", fontSize: 13 }}>
              <input type="radio" name="duvod-storna" checked={duvod === d} onChange={() => setDuvod(d)} />
              {d}
            </label>
          ))}
        </div>

        <textarea
          value={poznamka}
          onChange={(e) => setPoznamka(e.target.value)}
          placeholder="Poznámka (nepovinné) – co přesně zákazník řekl, co se zkoušelo…"
          rows={3}
          style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--panel-2)", color: "var(--text)", fontSize: 13, fontFamily: "inherit", resize: "vertical" }}
        />

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button variant="ghost" onClick={onZrusit} disabled={ceka}>Zpět</Button>
          <Button variant="primary" onClick={potvrdit} disabled={ceka}>{ceka ? "Ukládám…" : "Potvrdit storno"}</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
