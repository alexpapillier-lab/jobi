export function ModernCheckbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: checked ? "var(--accent-soft)" : "var(--panel)", transition: "var(--transition-smooth)" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ width: 18, height: 18, accentColor: "var(--accent)" }} />
      <span style={{ fontSize: 14, color: "var(--text)" }}>{label}</span>
    </label>
  );
}
