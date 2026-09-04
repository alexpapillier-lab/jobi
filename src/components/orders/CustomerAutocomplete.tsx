import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { MenuItem } from "../ui/MenuItem";
import { UserIcon } from "../icons";

export type CustomerMatch = {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  company?: string | null;
  city?: string | null;
};

/**
 * Pole „Zákazník“ v nové zakázce: našeptává existující zákazníky podle
 * jména, telefonu, e-mailu nebo firmy. Výběr vyplní celý blok zákazníka;
 * jméno, které nikdo nemá, znamená nového zákazníka – bez další otázky.
 *
 * Hledání dodává rodič (`search`), tady je jen debounce 250 ms, nabídka
 * a ovládání klávesnicí. Nabídka se vykresluje do body s `position: fixed`
 * jako ostatní nabídky v aplikaci.
 */
export function CustomerAutocomplete({
  value,
  onChange,
  onSelect,
  search,
  inputStyle,
  placeholder = "Jan Novák",
  autoFocus,
  id,
  invalid,
}: {
  value: string;
  onChange: (text: string) => void;
  onSelect: (customer: CustomerMatch) => void;
  search: (query: string) => Promise<CustomerMatch[]>;
  inputStyle?: CSSProperties;
  placeholder?: string;
  autoFocus?: boolean;
  id?: string;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [matches, setMatches] = useState<CustomerMatch[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const requestSeq = useRef(0);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0, maxHeight: 280 });

  const recompute = () => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margin = 10;
    const gap = 6;
    const spaceBelow = window.innerHeight - r.bottom - margin;
    const spaceAbove = r.top - margin;
    const openUp = spaceBelow < 200 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(120, Math.min(320, openUp ? spaceAbove - gap : spaceBelow - gap));
    setPos({
      left: r.left,
      top: openUp ? Math.max(margin, r.top - gap - maxHeight) : r.bottom + gap,
      width: r.width,
      maxHeight,
    });
  };

  useLayoutEffect(() => {
    if (open) recompute();
  }, [open, matches.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || inputRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onScroll = () => recompute();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  const runSearch = (q: string) => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setMatches([]);
      setOpen(false);
      setLoading(false);
      return;
    }
    timerRef.current = window.setTimeout(async () => {
      const seq = ++requestSeq.current;
      setLoading(true);
      try {
        const res = await search(trimmed);
        if (seq !== requestSeq.current) return;
        setMatches(res);
        setHighlight(0);
        setOpen(res.length > 0);
      } catch {
        if (seq === requestSeq.current) {
          setMatches([]);
          setOpen(false);
        }
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    }, 250);
  };

  const pick = (m: CustomerMatch) => {
    setOpen(false);
    setMatches([]);
    onSelect(m);
  };

  const describe = (m: CustomerMatch) =>
    [m.phone, m.email, m.city, m.company].filter((x): x is string => !!x && x.trim().length > 0);

  const menu = open ? (
    <div
      ref={menuRef}
      role="listbox"
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        width: pos.width,
        maxHeight: pos.maxHeight,
        overflowY: "auto",
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        boxShadow: "0 10px 25px rgba(0,0,0,0.15)",
        zIndex: 10000,
        padding: 4,
      }}
    >
      {matches.map((m, i) => (
        <MenuItem
          key={m.id}
          layout="row"
          role="option"
          aria-selected={i === highlight}
          highlighted={i === highlight}
          onMouseEnter={() => setHighlight(i)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => pick(m)}
        >
          <span style={{ color: "var(--muted)", display: "inline-flex", flex: "0 0 auto" }}>
            <UserIcon size={14} />
          </span>
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <span style={{ fontWeight: 700 }}>{m.name || "Bez jména"}</span>
            {describe(m).map((part, j) => (
              <span key={j} style={{ color: "var(--muted)" }}>
                {" · "}
                {part}
              </span>
            ))}
          </span>
        </MenuItem>
      ))}
    </div>
  ) : null;

  return (
    <>
      <input
        ref={inputRef}
        id={id}
        value={value}
        autoFocus={autoFocus}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-invalid={invalid || undefined}
        aria-busy={loading || undefined}
        placeholder={placeholder}
        style={inputStyle}
        onChange={(e) => {
          onChange(e.target.value);
          runSearch(e.target.value);
        }}
        onFocus={() => {
          if (matches.length > 0) setOpen(true);
        }}
        onKeyDown={(e) => {
          if (!open || matches.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            const m = matches[highlight];
            if (m) pick(m);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          } else if (e.key === "Tab") {
            setOpen(false);
          }
        }}
      />
      {open ? createPortal(menu, document.body) : null}
    </>
  );
}
