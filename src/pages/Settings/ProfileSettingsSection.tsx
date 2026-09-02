import { Card, FieldLabel, TextInput } from "../../lib/settingsUi";
import { reportError } from "../../lib/reportError";
import { showToast } from "../../components/Toast";
import { useState, useEffect, type ChangeEvent } from "react";
import { useUserProfile } from "../../hooks/useUserProfile";

export function ProfileSettingsSection() {
  const { profile, loading, error, setProfile } = useUserProfile();
  const [nickname, setNickname] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile) {
      setNickname(profile.nickname ?? "");
      setAvatarUrl(profile.avatarUrl ?? "");
    }
  }, [profile]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await setProfile({ nickname: nickname.trim() || null, avatarUrl: avatarUrl.trim() || null });
      showToast("Profil uložen", "success");
    } catch (e) {
      reportError({
        code: "settings.save_profile_failed",
        error: e,
        userMessage: "Nepodařilo se uložit profil",
        source: "Settings.saveProfile",
      });
    } finally {
      setSaving(false);
    }
  };

  const border = "1px solid var(--border)";
  return (
    <Card>
      <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 12, color: "var(--text)" }}>Fotka a přezdívka</div>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>
        Vaše přezdívka a fotka se zobrazí u komentářů a u aktivit v zakázkách, aby ostatní viděli, kdo co napsal nebo upravil.
      </div>
      {loading ? (
        <div style={{ color: "var(--muted)", fontSize: 13 }}>Načítání…</div>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          {error && (
            <div style={{ padding: 12, borderRadius: 12, background: "var(--panel-2)", border, color: "var(--text)", fontSize: 13 }}>
              {error}
            </div>
          )}
          <div>
            <FieldLabel>Přezdívka (nick)</FieldLabel>
            <TextInput
              value={nickname}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setNickname(e.target.value)}
              placeholder="např. Honza, Servisák"
            />
          </div>
          <div>
            <FieldLabel>URL fotky (avatar)</FieldLabel>
            <TextInput
              type="url"
              value={avatarUrl}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setAvatarUrl(e.target.value)}
              placeholder="https://… nebo nechte prázdné"
            />
          </div>
          {avatarUrl && (
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 13, color: "var(--muted)" }}>Náhled:</span>
              <img
                src={avatarUrl}
                alt="Avatar"
                style={{ width: 40, height: 40, borderRadius: 12, objectFit: "cover", border }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            </div>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: "12px 24px",
              borderRadius: 12,
              border: "none",
              background: "var(--accent)",
              color: "var(--accent-fg)",
              fontWeight: 900,
              fontSize: 13,
              cursor: saving ? "not-allowed" : "pointer",
              opacity: saving ? 0.7 : 1,
              transition: "var(--transition-smooth)",
              boxShadow: "var(--shadow-soft)",
            }}
          >
            {saving ? "Ukládám…" : "Uložit profil"}
          </button>
        </div>
      )}
    </Card>
  );
}
