import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { StatusMeta } from "../../../state/StatusesStore";

type StatusPickerProps = {
  value: string;
  statuses: StatusMeta[];
  getByKey: (k: string) => StatusMeta | undefined;
  onChange: (k: string) => void;
  size?: "sm" | "md";
};

export function StatusPicker({ value, statuses, getByKey, onChange, size = "md" }: StatusPickerProps) {
  const [open, setOpen] = useState(false);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const current = getByKey(value);

  const [pos, setPos] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
    openUp: boolean;
  }>({
    top: 0,
    left: 0,
    width: 320,
    maxHeight: 420,
    openUp: false,
  });

  const padY = size === "sm" ? 8 : 10;
  const padX = size === "sm" ? 10 : 12;
  const fontSize = size === "sm" ? 12 : 13;

  const recompute = () => {
    const btn = btnRef.current;
    if (!btn) return;

    const r = btn.getBoundingClientRect();
    const w = 320;

    const margin = 10;
    const gap = 8;

    let left = r.right - w;
    left = Math.max(margin, Math.min(left, window.innerWidth - w - margin));

    const spaceBelow = window.innerHeight - r.bottom - margin;
    const spaceAbove = r.top - margin;

    const wantHeight = 420;
    const openUp = spaceBelow < Math.min(220, wantHeight) && spaceAbove > spaceBelow;

    const maxHeight = Math.max(160, Math.min(wantHeight, openUp ? spaceAbove - gap : spaceBelow - gap));

    const top = openUp ? Math.max(margin, r.top - gap - maxHeight) : r.bottom + gap;

    setPos({ top, left, width: w, maxHeight, openUp });
  };

  useLayoutEffect(() => {
    if (!open) return;
    recompute();
     
  }, [open, value, size]);

  useEffect(() => {
    if (!open) return;

    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      const wrap = wrapRef.current;
      const menu = menuRef.current;

      if (wrap?.contains(t)) return;
      if (menu?.contains(t)) return;

      setOpen(false);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    const onScroll = () => recompute();
    const onResize = () => recompute();

    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
     
  }, [open]);

  const menu = open ? (
    <div
      ref={menuRef}
      role="listbox"
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        width: pos.width,
        borderRadius: 14,
        border: "1px solid var(--border)",
        background: "var(--panel)",
        boxShadow: "0 25px 60px rgba(0,0,0,0.22)",
        padding: 6,
        zIndex: 10000,
        maxHeight: pos.maxHeight,
        overflowY: "auto",
      }}
    >
      {statuses.map((s) => {
        const active = s.key === value;
        const rowBg = active ? "var(--panel-2)" : "transparent";

        return (
          <button
            key={s.key}
            type="button"
            onClick={() => {
              onChange(s.key);
              setOpen(false);
            }}
            style={{
              width: "100%",
              textAlign: "left",
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 10px",
              borderRadius: 12,
              border: "none",
              background: rowBg,
              cursor: "pointer",
              color: "var(--text)",
              fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
            }}
          >
            <span
              style={{
                width: 4,
                height: 26,
                borderRadius: 999,
                background: s.bg ?? "rgba(0,0,0,0.12)",
                boxShadow: s.bg ? `0 0 8px ${s.bg}40` : "none",
              }}
            />
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 999,
                background: s.bg ?? "rgba(0,0,0,0.12)",
                boxShadow: s.bg ? `0 2px 8px ${s.bg}30` : "none",
                border: `1px solid ${s.bg ? `${s.bg}60` : "transparent"}`,
              }}
            />

            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 950, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {s.label}
              </div>
            </div>

            {active && <div style={{ fontSize: 12, fontWeight: 950, opacity: 0.8 }}>✓</div>}
          </button>
        );
      })}
    </div>
  ) : null;

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-flex" }}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 10,
          padding: `${padY}px ${padX}px`,
          borderRadius: 12,
          border: "1px solid var(--border)",
          background: "var(--panel)",
          color: "var(--text)",
          fontWeight: 900,
          fontSize,
          cursor: "pointer",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
          boxShadow: "0 10px 25px rgba(0,0,0,0.06)",
          transition: "transform 120ms ease, box-shadow 160ms ease",
          userSelect: "none",
          whiteSpace: "nowrap",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "translateY(-1px)";
          e.currentTarget.style.boxShadow = "0 16px 34px rgba(0,0,0,0.10)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "translateY(0)";
          e.currentTarget.style.boxShadow = "0 10px 25px rgba(0,0,0,0.06)";
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Změnit stav"
      >
        <span
          style={{
            width: 12,
            height: 12,
            borderRadius: 999,
            background: current?.bg ?? "rgba(0,0,0,0.15)",
            boxShadow: current?.bg
              ? `0 0 0 2px ${current.bg}40, 0 2px 8px ${current.bg}30`
              : "0 0 0 3px rgba(0,0,0,0.06)",
            flex: "0 0 auto",
            border: `1px solid ${current?.bg ? `${current.bg}60` : "transparent"}`,
          }}
        />
        <span style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>{current?.label ?? "Status"}</span>
        <span style={{ opacity: 0.65, fontWeight: 900, marginLeft: 2 }}>▾</span>
      </button>

      {open ? createPortal(menu, document.body) : null}
    </div>
  );
}

