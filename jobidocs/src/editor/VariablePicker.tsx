import { useEffect, useRef, useState } from "react";
import { variableGroups } from "../../core/index";

/** Tlačítko „{{ }}“ s výběrem proměnné. */
export function VariablePicker({ onPick, align = "left", label = "Vložit proměnnou" }: { onPick: (key: string) => void; align?: "left" | "right"; label?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const groups = variableGroups()
    .map((g) => ({ ...g, items: g.items.filter((v) => !q || v.label.toLowerCase().includes(q.toLowerCase()) || v.key.includes(q.toLowerCase())) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="vp-root" ref={rootRef}>
      <button type="button" className="ui-btn ui-btn-sm" onClick={() => setOpen((o) => !o)} title={label}>
        {"{{ }}"} {label}
      </button>
      {open && (
        <div className={`vp-menu ${align}`}>
          <input className="ui-input vp-search" placeholder="Hledat…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          {groups.map((g) => (
            <div key={g.group}>
              <div className="vp-group">{g.group}</div>
              {g.items.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  className="vp-item"
                  onClick={() => {
                    onPick(v.key);
                    setOpen(false);
                    setQ("");
                  }}
                >
                  <span>{v.label}</span>
                  <code>{`{{${v.key}}}`}</code>
                </button>
              ))}
            </div>
          ))}
          {groups.length === 0 && <div className="vp-group">Nic nenalezeno</div>}
        </div>
      )}
    </div>
  );
}

/** Vloží text na pozici kurzoru v poli. */
export function insertAtCursor(el: HTMLInputElement | HTMLTextAreaElement | null, value: string, text: string): string {
  if (!el) return value + text;
  const start = el.selectionStart ?? value.length;
  const end = el.selectionEnd ?? value.length;
  const next = value.slice(0, start) + text + value.slice(end);
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(start + text.length, start + text.length);
  });
  return next;
}
