export function Breadcrumbs({ items }: { items: { label: string; current?: boolean }[] }) {
  return (
    <nav aria-label="Breadcrumb" style={{ marginBottom: 12, fontSize: 13, color: "var(--muted)" }}>
      {items.map((item, i) => (
        <span key={i}>
          {i > 0 && <span style={{ margin: "0 6px", opacity: 0.6 }}>›</span>}
          <span style={{ color: item.current ? "var(--text)" : "var(--muted)", fontWeight: item.current ? 600 : 400 }}>
            {item.label}
          </span>
        </span>
      ))}
    </nav>
  );
}
