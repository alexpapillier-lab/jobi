import { useEffect, useCallback } from "react";
import { createPortal } from "react-dom";

type JobiDocsGuideModalProps = {
  open: boolean;
  onClose: () => void;
};

const STEPS = [
  "Vyberte v JobiDocs výchozí tiskárnu pro tisk dokumentů.",
  "Nastavte logo firmy (barvy a styl se berou z Nastavení v Jobi).",
  "Doplňte právní texty a záhlaví/zápatí dle potřeby.",
  "Přidejte razítko – např. pro záruční listy nebo potvrzení.",
];

export function JobiDocsGuideModal({ open, onClose }: JobiDocsGuideModalProps) {
  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, handleClose]);

  if (!open) return null;

  const overlay = (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10000,
      }}
      onClick={handleClose}
    >
      <div
        style={{
          background: "var(--panel)",
          borderRadius: 16,
          padding: 24,
          maxWidth: 420,
          width: "90%",
          boxShadow: "0 25px 60px rgba(0,0,0,0.3)",
          border: "1px solid var(--border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 8, color: "var(--text)" }}>
          Nastavení JobiDocs
        </div>
        <p style={{ fontSize: 14, color: "var(--muted)", marginBottom: 16, lineHeight: 1.45 }}>
          JobiDocs je připojen. Pro pěkné tisky a PDF doporučujeme v aplikaci JobiDocs zkontrolovat:
        </p>
        <ul
          style={{
            margin: 0,
            paddingLeft: 20,
            fontSize: 14,
            color: "var(--text)",
            lineHeight: 1.6,
            marginBottom: 24,
          }}
        >
          {STEPS.map((text, i) => (
            <li key={i} style={{ marginBottom: 6 }}>
              {text}
            </li>
          ))}
        </ul>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={handleClose}
            style={{
              padding: "10px 20px",
              borderRadius: 10,
              border: "none",
              background: "var(--accent)",
              color: "white",
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Rozumím
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
