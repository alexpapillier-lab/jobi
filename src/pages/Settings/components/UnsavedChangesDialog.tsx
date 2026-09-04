import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../../components/ui";
import { normalizeError } from "../../../utils/errorNormalizer";

/**
 * „Máte neuložené změny“ – tři volby, ne dvě.
 *
 * ConfirmDialog umí jen Potvrdit/Zrušit; tady musí jít i „Zahodit“, protože
 * uživatel, který odchází ze sekce, chce často právě to a nutit ho nejdřív
 * ručně vracet hodnoty by bylo horší než dialog navíc.
 */
export function UnsavedChangesDialog(props: {
  open: boolean;
  onSave: () => Promise<void> | void;
  onDiscard: () => void;
  onBack: () => void;
}) {
  // Obsah se montuje jen když je dialog otevřený – stav (ukládám, chyba)
  // se tak resetuje sám a nepotřebuje efekt.
  return props.open ? <DialogBody {...props} /> : null;
}

function DialogBody({
  onSave,
  onDiscard,
  onBack,
}: {
  onSave: () => Promise<void> | void;
  onDiscard: () => void;
  onBack: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onBack(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onBack]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave();
    } catch (err) {
      setError(normalizeError(err));
      setSaving(false);
    }
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="unsaved-dialog-title"
      onClick={onBack}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--panel)", borderRadius: "var(--radius-md)", padding: "var(--space-6)",
          maxWidth: 420, width: "90%", boxShadow: "var(--shadow)", border: "1px solid var(--border)",
        }}
      >
        <div id="unsaved-dialog-title" style={{ fontWeight: 900, fontSize: "var(--text-lg)", marginBottom: "var(--space-2)", color: "var(--text)" }}>
          Máte neuložené změny
        </div>
        <div style={{ fontSize: "var(--text-base)", color: "var(--muted)", marginBottom: "var(--space-5)", lineHeight: 1.5 }}>
          Chcete je před odchodem uložit? Bez uložení se změny ztratí.
        </div>
        {error && (
          <div style={{ color: "var(--danger-text)", fontSize: "var(--text-base)", marginBottom: "var(--space-4)", padding: "var(--space-3)", background: "var(--danger-soft)", borderRadius: "var(--radius-xs)" }}>
            {error}
          </div>
        )}
        <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end", flexWrap: "wrap" }}>
          <Button variant="ghost" onClick={onBack} disabled={saving}>Zpět</Button>
          <Button variant="soft" onClick={onDiscard} disabled={saving}>Zahodit</Button>
          <Button variant="primary" onClick={save} disabled={saving}>{saving ? "Ukládám…" : "Uložit"}</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
