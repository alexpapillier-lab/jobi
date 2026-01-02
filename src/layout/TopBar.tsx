
export function TopBar({ title }: { title: string }) {
  return (
    <div style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em", color: "var(--text)" }}>{title}</div>
      </div>
    </div>
  );
}
