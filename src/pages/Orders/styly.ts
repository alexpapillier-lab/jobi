/**
 * Sdílené inline styly formulářů stránky Zakázky (příjem, detail, úprava).
 *
 * Dřív vznikaly v Orders.tsx přes useMemo se závislostí na konstantě
 * `border`, takže byly fakticky neměnné – tady jsou proto obyčejné konstanty
 * se stejným obsahem. Identita objektů zůstává stabilní stejně jako dřív.
 */
import type React from "react";

export const border = "1px solid var(--border)";
export const borderError = "1px solid rgba(239,68,68,0.9)";

export const inputStyle: React.CSSProperties = {
  // 360 px byla pevná šířka – na 375px displeji přetékala ven.
  // Takhle zůstává na desktopu stejná a na mobilu se smrští.
  width: 360,
  maxWidth: "100%",
  minWidth: 0,
  padding: "10px 12px",
  borderRadius: 12,
  border,
  outline: "none",
  background: "var(--panel)",
  backdropFilter: "var(--blur)",
  WebkitBackdropFilter: "var(--blur)",
  color: "var(--text)",
  fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
  transition: "var(--transition-smooth)",
  boxShadow: "var(--shadow-soft)",
};

export const fieldLabel: React.CSSProperties = { fontSize: 12, color: "var(--muted)", marginTop: 10 };
export const fieldHint: React.CSSProperties = { fontSize: 12, marginTop: 6, color: "rgba(239,68,68,0.95)" };
/** Vysvětlivka pod polem (12 px, tlumená) – místo dlouhých popisků nad polem. */
export const fieldMuted: React.CSSProperties = { fontSize: 12, marginTop: 6, color: "var(--muted)" };
/** Drobný podnadpis skupiny polí v sekci „Další údaje“. */
export const subHeading: React.CSSProperties = { fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 };

export const baseFieldInput: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 12,
  border,
  outline: "none",
  background: "var(--panel)",
  color: "var(--text)",
  fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
};

export const baseFieldTextArea: React.CSSProperties = {
  ...baseFieldInput,
  resize: "vertical",
  minHeight: 88,
  lineHeight: 1.35,
};

export const card: React.CSSProperties = {
  border,
  borderRadius: "var(--radius-lg)",
  background: "var(--panel)",
  backdropFilter: "var(--blur)",
  WebkitBackdropFilter: "var(--blur)",
  padding: 12,
  boxShadow: "var(--shadow-soft)",
  color: "var(--text)",
};
