import { useEffect, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon, XIcon } from "../icons";

export type StatusFilterOption = { key: string; label: string; bg?: string; count: number };

/**
 * Rozbalovací filtr přehledu zakázek podle statusu. Nabízí jen statusy, které
 * se v aktuálním výběru (Vše / Aktivní / Moje…) opravdu vyskytují, s počtem.
 */
export function StatusFilter({
  value,
  onChange,
  options,
  total,
}: {
  value: string | null;
  onChange: (key: string | null) => void;
  options: StatusFilterOption[];
  total: number;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const current = value ? options.find((o) => o.key === value) ?? null : null;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const tecka = (bg?: string) => <span aria-hidden style={{ width: 10, height: 10, borderRadius: 999, background: bg || "var(--muted)", flexShrink: 0 }} />;

  const polozka = (key: string | null, label: string, count: number, bg?: string) => {
    const vybrano = value === key;
    return (
      <button
        key={key ?? "__vse"}
        type="button"
        role="option"
        aria-selected={vybrano}
        onClick={() => {
          onChange(key);
          setOpen(false);
        }}
        className="status-filter-item"
        style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 10px", border: "none", borderRadius: 8, background: vybrano ? "var(--accent-soft)" : "transparent", color: "var(--text)", fontSize: 13, fontWeight: vybrano ? 700 : 500, cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}
      >
        {key === null ? <span style={{ width: 10, flexShrink: 0 }} /> : tecka(bg)}
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        <span style={{ color: "var(--muted)", fontWeight: 500, fontSize: 12 }}>{count}</span>
        <span style={{ width: 14, display: "inline-flex", color: "var(--accent)" }}>{vybrano && <CheckIcon size={14} />}</span>
      </button>
    );
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-flex" }} data-tour="orders-status-filter">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={current ? `Filtr podle stavu: ${current.label}` : "Filtr podle stavu"}
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: current ? "8px 34px 8px 12px" : "8px 12px",
          borderRadius: 12,
          border: `1px solid ${current ? "var(--accent)" : "var(--border)"}`,
          background: current ? "var(--accent-soft)" : "var(--panel)",
          color: "var(--text)",
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
          maxWidth: 260,
          fontFamily: "inherit",
        }}
      >
        {current ? tecka(current.bg) : null}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{current ? current.label : "Všechny stavy"}</span>
        {current && <span style={{ color: "var(--muted)", fontWeight: 500 }}>{current.count}</span>}
        {!current && <ChevronDownIcon size={14} />}
      </button>
      {current && (
        <button
          type="button"
          aria-label="Zrušit filtr podle stavu"
          title="Zrušit filtr podle stavu"
          onClick={() => onChange(null)}
          style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", width: 22, height: 22, display: "grid", placeItems: "center", border: "none", borderRadius: 7, background: "transparent", color: "var(--muted)", cursor: "pointer" }}
        >
          <XIcon size={13} />
        </button>
      )}
      {open && (
        <div
          role="listbox"
          aria-label="Stavy zakázek"
          style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 60, width: 280, maxWidth: "calc(100vw - 32px)", maxHeight: 380, overflowY: "auto", padding: 6, borderRadius: 12, border: "1px solid var(--border)", background: "var(--panel)", backdropFilter: "var(--blur)", WebkitBackdropFilter: "var(--blur)", boxShadow: "var(--shadow)" }}
        >
          {polozka(null, "Všechny stavy", total)}
          {options.map((o) => polozka(o.key, o.label, o.count, o.bg))}
          {options.length === 0 && <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--muted)" }}>V tomto výběru nejsou žádné zakázky.</div>}
        </div>
      )}
    </div>
  );
}
