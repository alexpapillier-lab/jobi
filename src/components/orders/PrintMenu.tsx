import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "../ui/Button";
import { ChevronDownIcon, DownloadIcon, PrintIcon } from "../icons";
import { isJobiDocsRunning, launchJobiDocsApp } from "../../lib/jobidocs";
import { isWeb } from "../../lib/platform";

export type PrintMenuRow = {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  onPrint: () => void;
  onExport: () => void;
};

/**
 * Tlačítko „Tisk ▾“ v hlavičce detailu: jedna nabídka se všemi dokumenty,
 * u každého dvě malé akce (Tisk / PDF). Nahrazuje řadu samostatných
 * DocumentActionPickerů, které hlavičku roztahovaly na dva řádky.
 *
 * Na desktopu se v hlavičce nabídky ukazuje, jestli běží JobiDocs
 * (dotazuje se, jen dokud je nabídka otevřená). Když neběží, jsou akce
 * neaktivní a je tu tlačítko Spustit. Na webu se tiskne v prohlížeči,
 * takže tam žádná kontrola není.
 */
export function PrintMenu({
  rows,
  label = "Tisk",
  size = "md",
}: {
  rows: PrintMenuRow[];
  label?: ReactNode;
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0, maxHeight: 400 });
  const web = isWeb();
  /** null = ještě nevíme */
  const [running, setRunning] = useState<boolean | null>(web ? true : null);
  const [launching, setLaunching] = useState(false);

  const MENU_WIDTH = 300;

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const margin = 10;
    const gap = 6;
    const estimated = 56 * rows.length + (web ? 12 : 60);
    const spaceBelow = window.innerHeight - r.bottom - margin;
    const spaceAbove = r.top - margin;
    const openUp = spaceBelow < estimated && spaceAbove > spaceBelow;
    const maxHeight = Math.max(160, Math.min(480, openUp ? spaceAbove - gap : spaceBelow - gap));
    let left = r.left;
    left = Math.max(margin, Math.min(left, window.innerWidth - MENU_WIDTH - margin));
    setPos({ left, top: openUp ? Math.max(margin, r.top - gap - Math.min(estimated, maxHeight)) : r.bottom + gap, maxHeight });
  }, [open, rows.length, web]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Stav JobiDocs se zjišťuje jen na desktopu a jen dokud je nabídka otevřená.
  useEffect(() => {
    if (!open || web) return;
    let cancelled = false;
    const check = () => {
      isJobiDocsRunning().then((ok) => {
        if (!cancelled) setRunning(ok);
      });
    };
    check();
    const id = window.setInterval(check, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [open, web]);

  const gated = !web && running === false;
  const disabledTitle = gated ? "Nejdřív spusťte JobiDocs" : undefined;

  const menu = open ? (
    <div
      ref={menuRef}
      role="menu"
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        width: MENU_WIDTH,
        maxWidth: "calc(100vw - 20px)",
        maxHeight: pos.maxHeight,
        overflowY: "auto",
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        boxShadow: "0 10px 25px rgba(0,0,0,0.15)",
        zIndex: 10000,
        padding: 6,
      }}
    >
      {!web && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 8px 8px",
            marginBottom: 4,
            borderBottom: "1px solid var(--border)",
            fontSize: 12,
            color: "var(--muted)",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              flex: "0 0 auto",
              background: running === true ? "#22c55e" : running === false ? "#ef4444" : "var(--border)",
              boxShadow: running === true ? "0 0 0 3px rgba(34,197,94,0.18)" : "none",
            }}
          />
          <span style={{ flex: 1 }}>
            {running === true ? "JobiDocs připojen" : running === false ? "JobiDocs neběží" : "Zjišťuji JobiDocs…"}
          </span>
          {running === false && (
            <Button
              size="sm"
              variant="primary"
              disabled={launching}
              onClick={async () => {
                setLaunching(true);
                try {
                  await launchJobiDocsApp();
                } finally {
                  setLaunching(false);
                }
              }}
            >
              {launching ? "Spouštím…" : "Spustit"}
            </Button>
          )}
        </div>
      )}

      {rows.map((row) => (
        <div
          key={row.key}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 8px",
            borderRadius: 8,
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: gated ? "var(--muted)" : "var(--text)" }}>
            {row.icon}
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.label}</span>
          </span>
          <Button
            size="sm"
            variant="soft"
            icon={<PrintIcon size={13} />}
            disabled={gated}
            title={disabledTitle ?? "Vytisknout"}
            onClick={() => {
              setOpen(false);
              row.onPrint();
            }}
          >
            Tisk
          </Button>
          <Button
            size="sm"
            variant="soft"
            icon={<DownloadIcon size={13} />}
            disabled={gated}
            title={disabledTitle ?? "Uložit jako PDF"}
            onClick={() => {
              setOpen(false);
              row.onExport();
            }}
          >
            PDF
          </Button>
        </div>
      ))}
    </div>
  ) : null;

  return (
    <>
      <span ref={btnRef} style={{ display: "inline-flex", flex: "0 0 auto" }}>
      <Button
        variant="soft"
        size={size}
        icon={<PrintIcon size={16} />}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Tisk a export dokumentů"
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        <ChevronDownIcon size={14} />
      </Button>
      </span>
      {open ? createPortal(menu, document.body) : null}
    </>
  );
}
