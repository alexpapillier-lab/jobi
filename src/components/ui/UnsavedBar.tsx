import { useEffect } from "react";
import { Button } from "./Button";

/**
 * Lišta „Neuložené změny“.
 *
 * Jedno pravidlo ukládání pro celé Nastavení: přepínače a výběry se ukládají
 * hned, vícepolní textové formuláře mají tuhle jednu lištu. Nahrazuje
 * tlačítka „Uložit základní údaje“, „Uložit kontaktní údaje“, „Uložit profil“…
 * která každé vypadalo jinak a stálo jinde.
 *
 * Když není co ukládat, nevykreslí nic – uživatel tak vidí lištu jen ve
 * chvíli, kdy má rozdělanou změnu. ⌘/Ctrl+S uloží, dokud je co.
 *
 * Vzhled je v ui.css (.ui-unsaved-bar): lepí se ke spodní hraně posuvné
 * oblasti, takže je vidět i u dlouhých formulářů bez rolování dolů.
 */
export function UnsavedBar({
  dirty,
  saving = false,
  onSave,
  onDiscard,
  label = "Neuložené změny",
}: {
  dirty: boolean;
  saving?: boolean;
  onSave: () => void;
  onDiscard: () => void;
  label?: string;
}) {
  useEffect(() => {
    if (!dirty) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!saving) onSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, saving, onSave]);

  if (!dirty) return null;

  return (
    <div className="ui-unsaved-bar" role="status" aria-live="polite">
      <span className="ui-unsaved-bar__label">
        <span className="ui-unsaved-bar__dot" aria-hidden="true" />
        {label}
      </span>
      <span className="ui-unsaved-bar__actions">
        <Button variant="soft" size="sm" onClick={onDiscard} disabled={saving}>
          Zahodit
        </Button>
        <Button variant="primary" size="sm" onClick={onSave} disabled={saving} title="⌘/Ctrl+S">
          {saving ? "Ukládám…" : "Uložit"}
        </Button>
      </span>
    </div>
  );
}
