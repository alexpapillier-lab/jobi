import { Card } from "../../lib/settingsUi";
import { showToast } from "../../components/Toast";
import { type ShortcutId, isModifierOnlyKey, keyEventToCombo, setShortcut, formatShortcutForDisplay, resetShortcuts, ALL_SHORTCUT_IDS, getShortcut, DEFAULT_SHORTCUTS, SHORTCUT_LABELS } from "../../lib/keyboardShortcuts";
import { useState, useEffect } from "react";

export function ShortcutsSettingsSection() {
  const [recordingId, setRecordingId] = useState<ShortcutId | null>(null);
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    if (recordingId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (isModifierOnlyKey(e)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const combo = keyEventToCombo(e);
      setShortcut(recordingId, combo);
      setRecordingId(null);
      forceUpdate((n) => n + 1);
      showToast(`Zkratka nastavena: ${formatShortcutForDisplay(combo)}`, "success");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recordingId]);

  const handleReset = () => {
    resetShortcuts();
    forceUpdate((n) => n + 1);
    showToast("Zkratky obnoveny na výchozí", "success");
  };

  const border = "1px solid var(--border)";
  return (
    <Card>
      <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 12, color: "var(--text)" }}>Klávesové zkratky</div>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>
        Klikněte na zkratku a stiskněte novou kombinaci kláves. Na macOS použijte Cmd místo Ctrl.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {ALL_SHORTCUT_IDS.map((id) => {
          const isRecording = recordingId === id;
          const current = getShortcut(id);
          const isDefault = current === DEFAULT_SHORTCUTS[id];
          return (
            <div
              key={id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 16,
                padding: "12px 14px",
                borderRadius: 10,
                border,
                background: isRecording ? "var(--accent-soft)" : "var(--panel)",
                transition: "background 0.15s ease",
              }}
            >
              <span style={{ color: "var(--text)", fontSize: 13, flex: 1 }}>{SHORTCUT_LABELS[id]}</span>
              <button
                type="button"
                onClick={() => setRecordingId(isRecording ? null : id)}
                style={{
                  padding: "6px 12px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: isRecording ? "var(--accent)" : "var(--bg)",
                  color: isRecording ? "var(--accent-fg)" : "var(--text)",
                  fontSize: 12,
                  fontFamily: "monospace",
                  cursor: "pointer",
                  minWidth: 100,
                }}
              >
                {isRecording ? "Stiskněte klávesy…" : formatShortcutForDisplay(current)}
              </button>
              {!isDefault && (
                <button
                  type="button"
                  onClick={() => {
                    setShortcut(id, DEFAULT_SHORTCUTS[id]);
                    forceUpdate((n) => n + 1);
                  }}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "none",
                    background: "var(--panel-2)",
                    color: "var(--muted)",
                    fontSize: 11,
                    cursor: "pointer",
                  }}
                  title="Obnovit výchozí"
                >
                  Výchozí
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 16 }}>
        <button
          type="button"
          onClick={handleReset}
          style={{
            padding: "10px 16px",
            borderRadius: 10,
            border: "1px solid var(--border)",
            background: "var(--panel-2)",
            color: "var(--text)",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Obnovit všechny výchozí zkratky
        </button>
      </div>
    </Card>
  );
}
