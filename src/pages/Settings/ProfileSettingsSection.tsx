import { Card, FieldLabel, TextInput } from "../../lib/settingsUi";
import { UnsavedBar } from "../../components/ui";
import { reportError } from "../../lib/reportError";
import { showToast } from "../../components/Toast";
import { useState, useEffect, type ChangeEvent } from "react";
import { useUserProfile } from "../../hooks/useUserProfile";
import { useRegisterUnsaved } from "./hooks/useUnsavedGuard";

type Draft = { nickname: string; avatarUrl: string };

export function ProfileSettingsSection() {
  const { profile, loading, error, setProfile } = useUserProfile();
  const [draft, setDraft] = useState<Draft>({ nickname: "", avatarUrl: "" });
  const [snapshot, setSnapshot] = useState<Draft>({ nickname: "", avatarUrl: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile) {
      const loaded = { nickname: profile.nickname ?? "", avatarUrl: profile.avatarUrl ?? "" };
      setDraft(loaded);
      setSnapshot(loaded);
    }
  }, [profile]);

  const dirty = draft.nickname.trim() !== snapshot.nickname.trim() || draft.avatarUrl.trim() !== snapshot.avatarUrl.trim();

  const handleSave = async () => {
    setSaving(true);
    try {
      const next = { nickname: draft.nickname.trim(), avatarUrl: draft.avatarUrl.trim() };
      await setProfile({ nickname: next.nickname || null, avatarUrl: next.avatarUrl || null });
      setDraft(next);
      setSnapshot(next);
      showToast("Profil uložen", "success");
    } catch (e) {
      reportError({
        code: "settings.save_profile_failed",
        error: e,
        userMessage: "Nepodařilo se uložit profil",
        source: "Settings.saveProfile",
      });
      throw e;
    } finally {
      setSaving(false);
    }
  };

  const discard = () => setDraft(snapshot);

  useRegisterUnsaved({ dirty, save: handleSave, discard });

  const border = "1px solid var(--border)";
  return (
    <>
      <Card>
        <div style={{ fontWeight: 900, fontSize: "var(--text-base)", marginBottom: "var(--space-2)", color: "var(--text)" }}>Fotka a přezdívka</div>
        <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)", marginBottom: "var(--space-4)" }}>
          Vaše přezdívka a fotka se zobrazí u komentářů a u aktivit v zakázkách, aby ostatní viděli, kdo co napsal nebo upravil.
        </div>
        {loading ? (
          <div style={{ color: "var(--muted)", fontSize: "var(--text-base)" }}>Načítání…</div>
        ) : (
          <div style={{ display: "grid", gap: "var(--space-4)" }}>
            {error && (
              <div style={{ padding: "var(--space-3)", borderRadius: "var(--radius-sm)", background: "var(--panel-2)", border, color: "var(--text)", fontSize: "var(--text-base)" }}>
                {error}
              </div>
            )}
            <div>
              <FieldLabel>Přezdívka (nick)</FieldLabel>
              <TextInput
                value={draft.nickname}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, nickname: e.target.value }))}
                placeholder="např. Honza, Servisák"
              />
            </div>
            <div>
              <FieldLabel>URL fotky (avatar)</FieldLabel>
              <TextInput
                type="url"
                value={draft.avatarUrl}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, avatarUrl: e.target.value }))}
                placeholder="https://… nebo nechte prázdné"
              />
            </div>
            {draft.avatarUrl && (
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                <span style={{ fontSize: "var(--text-base)", color: "var(--muted)" }}>Náhled:</span>
                <img
                  src={draft.avatarUrl}
                  alt="Avatar"
                  style={{ width: 40, height: 40, borderRadius: "var(--radius-sm)", objectFit: "cover", border }}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              </div>
            )}
          </div>
        )}
      </Card>
      <UnsavedBar dirty={dirty} saving={saving} onSave={() => { handleSave().catch(() => {}); }} onDiscard={discard} />
    </>
  );
}
