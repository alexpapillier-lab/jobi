import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, MenuItem } from "../../components/ui";
import { ChevronDownIcon, DocumentIcon, DownloadIcon, PrintIcon } from "../../components/icons";
import { isJobiDocsRunning, launchJobiDocsApp } from "../../lib/jobidocs";
import { isWeb } from "../../lib/platform";

/**
 * Tlačítko „Tisk ▾“ v detailu faktury: Tisk, Uložit PDF, Náhled.
 *
 * Na desktopu se v hlavičce nabídky ukazuje, jestli běží JobiDocs
 * (dotazuje se, jen dokud je nabídka otevřená); když neběží, jsou akce
 * neaktivní a je tu tlačítko Spustit. Na webu se tiskne v prohlížeči.
 * Nabídka se vykresluje do body s `position: fixed` jako ostatní nabídky.
 */
export function InvoicePrintMenu({
  onPrint,
  onExport,
  onPreview,
  size = "md",
}: {
  onPrint: () => void;
  onExport: () => void;
  onPreview?: () => void;
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const web = isWeb();
  /** null = ještě nevíme */
  const [running, setRunning] = useState<boolean | null>(web ? true : null);
  const [launching, setLaunching] = useState(false);

  const MENU_WIDTH = 240;

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const margin = 10;
    const gap = 6;
    const estimated = 44 * 3 + (web ? 12 : 60);
    const openUp = window.innerHeight - r.bottom < estimated + margin && r.top > window.innerHeight - r.bottom;
    let left = r.left;
    left = Math.max(margin, Math.min(left, window.innerWidth - MENU_WIDTH - margin));
    setPos({ left, top: openUp ? Math.max(margin, r.top - gap - estimated) : r.bottom + gap });
  }, [open, web]);

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

  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

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
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        boxShadow: "0 10px 25px rgba(0,0,0,0.15)",
        zIndex: 10000,
        padding: 4,
      }}
    >
      {!web && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
            padding: "6px 8px 8px",
            marginBottom: 4,
            borderBottom: "1px solid var(--border)",
            fontSize: "var(--text-sm)",
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
              background: running === true ? "var(--success)" : running === false ? "var(--danger)" : "var(--border)",
              boxShadow: running === true ? "0 0 0 3px var(--success-soft)" : "none",
            }}
          />
          <span style={{ flex: 1 }}>{running === true ? "JobiDocs připojen" : running === false ? "JobiDocs neběží" : "Zjišťuji JobiDocs…"}</span>
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
      <MenuItem layout="row" role="menuitem" disabled={gated} title={disabledTitle} onClick={pick(onPrint)}>
        <PrintIcon size={15} />
        <span>Tisk</span>
      </MenuItem>
      <MenuItem layout="row" role="menuitem" disabled={gated} title={disabledTitle} onClick={pick(onExport)}>
        <DownloadIcon size={15} />
        <span>Uložit PDF</span>
      </MenuItem>
      {onPreview && (
        <MenuItem layout="row" role="menuitem" disabled={gated} title={disabledTitle} onClick={pick(onPreview)}>
          <DocumentIcon size={15} />
          <span>Náhled</span>
        </MenuItem>
      )}
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
          title="Tisk a export"
          onClick={() => setOpen((v) => !v)}
        >
          Tisk
          <ChevronDownIcon size={14} />
        </Button>
      </span>
      {open ? createPortal(menu, document.body) : null}
    </>
  );
}
