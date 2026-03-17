import { useState, useMemo, useEffect } from "react";
import { useStatuses, type StatusMeta } from "../../state/StatusesStore";
import { STATUS_COLOR_PALETTE, getContrastText } from "../../utils/statusColors";
import { StatusRow } from "./components/StatusRow";
import { Card, FieldLabel, TextInput } from "../../lib/settingsUi";

type StatusesSettingsProps = {
  uiCfg: {
    home: {
      orderFilters: {
        selectedQuickStatusFilters: string[];
      };
    };
  };
  setUiCfg: React.Dispatch<React.SetStateAction<{
    home: {
      orderFilters: {
        selectedQuickStatusFilters: string[];
      };
    };
  }>>;
  onCreateStatus: (status: StatusMeta) => Promise<void>;
  onDeleteStatus: (key: string) => Promise<void>;
};

export function StatusesSettings({ uiCfg, setUiCfg, onCreateStatus, onDeleteStatus }: StatusesSettingsProps) {
  const { statuses, fallbackKey } = useStatuses();

  const [draft, setDraft] = useState<StatusMeta>({
    key: "",
    label: "",
    bg: STATUS_COLOR_PALETTE[0].bg,
    fg: STATUS_COLOR_PALETTE[0].fg,
    isFinal: false,
  });
  
  const [showCustomColor, setShowCustomColor] = useState(false);

  // Generate unique key from label automatically
  const generateKeyFromLabel = (label: string, existingKeys: Set<string> = new Set()): string => {
    if (!label) return "";
    
    // Convert to lowercase
    let baseKey = label.toLowerCase();
    
    // Remove diacritics (Czech characters)
    const diacriticsMap: Record<string, string> = {
      'á': 'a', 'č': 'c', 'ď': 'd', 'é': 'e', 'ě': 'e', 'í': 'i', 'ň': 'n',
      'ó': 'o', 'ř': 'r', 'š': 's', 'ť': 't', 'ú': 'u', 'ů': 'u', 'ý': 'y', 'ž': 'z'
    };
    baseKey = baseKey.replace(/[áčďéěíňóřšťúůýž]/g, (char) => diacriticsMap[char] || char);
    
    // Replace spaces and special characters with underscores
    baseKey = baseKey.replace(/[^a-z0-9]+/g, '_');
    
    // Remove leading/trailing underscores
    baseKey = baseKey.replace(/^_+|_+$/g, '');
    
    // Limit length to 50 characters
    if (baseKey.length > 50) {
      baseKey = baseKey.substring(0, 50);
      baseKey = baseKey.replace(/_+$/, ''); // Remove trailing underscores after truncation
    }
    
    // Ensure uniqueness by appending a number if needed
    let key = baseKey;
    let counter = 1;
    while (existingKeys.has(key)) {
      key = `${baseKey}_${counter}`;
      counter++;
      // Prevent infinite loop
      if (counter > 1000) break;
    }
    
    return key;
  };

  const keyTrim = draft.key.trim();
  const labelTrim = draft.label.trim();

  const keyExists = useMemo(() => {
    if (!keyTrim) return false;
    return statuses.some((s) => s.key === keyTrim);
  }, [keyTrim, statuses]);

  const canSave = keyTrim.length > 0 && labelTrim.length > 0;

  const selectedQuick = uiCfg.home.orderFilters.selectedQuickStatusFilters;

  useEffect(() => {
    const existingKeys = new Set(statuses.map((s) => s.key));
    const cleaned = selectedQuick.filter((k) => existingKeys.has(k));
    if (cleaned.length !== selectedQuick.length) {
      setUiCfg((p) => ({
        ...p,
        home: { ...p.home, orderFilters: { ...p.home.orderFilters, selectedQuickStatusFilters: cleaned } },
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statuses]);

  const border = "1px solid var(--border)";
  const primaryBtn: React.CSSProperties = {
    padding: "10px 14px",
    borderRadius: 12,
    border,
    background: "var(--accent)",
    color: "white",
    fontWeight: 900,
    cursor: "pointer",
    fontFamily: "system-ui",
    fontSize: 13,
  };

  const softBtn: React.CSSProperties = {
    padding: "10px 14px",
    borderRadius: 12,
    border,
    background: "var(--panel)",
    color: "var(--text)",
    fontWeight: 900,
    cursor: "pointer",
    fontFamily: "system-ui",
    fontSize: 13,
  };

  return (
    <>
      <Card>
        <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 12, color: "var(--text)" }}>Přidat / upravit status</div>

        <div style={{ display: "grid", gap: 10 }}>
          <div>
            <FieldLabel>Název (zobrazovaný text)</FieldLabel>
            <TextInput
              placeholder="Přijato, V opravě, Hotovo"
              value={draft.label}
              onChange={(e: any) => {
                const newLabel = e.target.value;
                // Generate key automatically only for new statuses (when key is empty)
                // For existing statuses, keep the original key
                if (!draft.key) {
                  // Only generate new key if we're creating a new status
                  const existingKeys = new Set(statuses.map((s) => s.key));
                  const generatedKey = generateKeyFromLabel(newLabel, existingKeys);
                  setDraft((p) => ({ 
                    ...p, 
                    label: newLabel, 
                    key: generatedKey
                  }));
                } else {
                  // Keep existing key when editing
                  setDraft((p) => ({ 
                    ...p, 
                    label: newLabel
                  }));
                }
              }}
            />
          </div>

          <div>
            <FieldLabel>Barva statusu</FieldLabel>
            <div style={{ display: "grid", gap: 12 }}>
              {/* Paleta předvybraných barev */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(40px, 1fr))", gap: 8 }}>
                {STATUS_COLOR_PALETTE.map((color, idx) => {
                  const isSelected = draft.bg === color.bg;
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setDraft((p) => ({ ...p, bg: color.bg, fg: color.fg }));
                        setShowCustomColor(false);
                      }}
                      style={{
                        width: "100%",
                        aspectRatio: "1",
                        borderRadius: 12,
                        border: isSelected ? "3px solid var(--accent)" : "2px solid var(--border)",
                        background: color.bg,
                        cursor: "pointer",
                        transition: "var(--transition-smooth)",
                        transform: isSelected ? "scale(1.1)" : "scale(1)",
                        boxShadow: isSelected ? `0 4px 12px var(--accent-glow)` : "var(--shadow-soft)",
                        position: "relative",
                        overflow: "hidden",
                      }}
                      title={color.name}
                      onMouseEnter={(e) => {
                        if (!isSelected) {
                          e.currentTarget.style.transform = "scale(1.05)";
                          e.currentTarget.style.boxShadow = "var(--shadow)";
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected) {
                          e.currentTarget.style.transform = "scale(1)";
                          e.currentTarget.style.boxShadow = "var(--shadow-soft)";
                        }
                      }}
                    >
                      {isSelected && (
                        <div
                          style={{
                            position: "absolute",
                            top: "50%",
                            left: "50%",
                            transform: "translate(-50%, -50%)",
                            width: 20,
                            height: 20,
                            borderRadius: "50%",
                            background: "var(--accent)",
                            display: "grid",
                            placeItems: "center",
                            color: "white",
                            fontWeight: 900,
                            fontSize: 12,
                            boxShadow: `0 2px 8px var(--accent-glow)`,
                          }}
                        >
                          ✓
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
              
              {/* Tlačítko pro vlastní barvu */}
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  type="button"
                  onClick={() => setShowCustomColor(!showCustomColor)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 12,
                    border: "1px solid var(--border)",
                    background: showCustomColor ? "var(--accent-soft)" : "var(--panel)",
                    backdropFilter: "var(--blur)",
                    WebkitBackdropFilter: "var(--blur)",
                    color: showCustomColor ? "var(--accent)" : "var(--text)",
                    fontWeight: 700,
                    fontSize: 12,
                    cursor: "pointer",
                    transition: "var(--transition-smooth)",
                    boxShadow: "var(--shadow-soft)",
                  }}
                >
                  {showCustomColor ? "✕" : "+"} Vlastní barva
                </button>
                {showCustomColor && (
                  <div style={{ display: "flex", gap: 8, flex: 1 }}>
                    <div style={{ flex: 1 }}>
                      <FieldLabel>Pozadí (hex)</FieldLabel>
                      <TextInput
                        placeholder="#DCFCE7"
                        value={draft.bg ?? ""}
                        onChange={(e: any) => {
                          const bg = e.target.value;
                          setDraft((p) => ({ ...p, bg, fg: getContrastText(bg) }));
                        }}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <FieldLabel>Text (hex)</FieldLabel>
                      <TextInput
                        placeholder="#14532D"
                        value={draft.fg ?? ""}
                        onChange={(e: any) => setDraft((p) => ({ ...p, fg: e.target.value }))}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
            <input
              type="checkbox"
              checked={!!draft.isFinal}
              onChange={(e) => setDraft((p) => ({ ...p, isFinal: e.target.checked }))}
            />
            <span style={{ color: "var(--text)", fontWeight: 700, fontSize: 13 }}>Je finální stav</span>
          </label>

          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8 }}>
            <div
              style={{
                padding: "8px 14px",
                borderRadius: 999,
                border: `1px solid ${draft.bg ? `${draft.bg}40` : "var(--border)"}`,
                background: draft.bg || "var(--panel-2)",
                color: draft.fg || "var(--text)",
                fontWeight: 900,
                fontSize: 12,
                boxShadow: draft.bg ? `0 2px 8px ${draft.bg}30` : "var(--shadow-soft)",
                transition: "var(--transition-smooth)",
              }}
            >
              {draft.label || "Náhled"}
            </div>

            <button
              type="button"
              disabled={!canSave}
              onClick={async () => {
                if (!canSave) return;
                await onCreateStatus({
                  key: keyTrim,
                  label: labelTrim,
                  bg: draft.bg?.trim() || undefined,
                  fg: draft.fg?.trim() || undefined,
                  isFinal: !!draft.isFinal,
                });
                setDraft({ key: "", label: "", bg: STATUS_COLOR_PALETTE[0].bg, fg: STATUS_COLOR_PALETTE[0].fg, isFinal: false });
                setShowCustomColor(false);
              }}
              style={{
                ...primaryBtn,
                opacity: canSave ? 1 : 0.4,
                cursor: canSave ? "pointer" : "not-allowed",
              }}
            >
              {keyExists ? "Aktualizovat" : "Přidat"}
            </button>
          </div>
        </div>
      </Card>

      <Card>
        <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 12, color: "var(--text)" }}>Existující statusy</div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
          Fallback status (nelze smazat): <b>{fallbackKey}</b>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {statuses.map((s) => (
            <StatusRow
              key={s.key}
              status={s}
              fallbackKey={fallbackKey}
              border={border}
              softBtn={softBtn}
              onEdit={(status) => setDraft({ ...status })}
              onDelete={onDeleteStatus}
            />
          ))}
        </div>
      </Card>
    </>
  );
}


