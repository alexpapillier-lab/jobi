import { useEffect, useRef, useState } from "react";
import { CheckIcon, CopyIcon } from "./icons";

async function zkopiruj(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Starší WebView nebo stránka bez oprávnění ke schránce.
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** Malé tlačítko „zkopírovat“ vedle údaje. Po zkopírování na chvíli ukáže fajfku. */
export function CopyButton({ value, label, size = 13 }: { value: string | null | undefined; label: string; size?: number }) {
  const [hotovo, setHotovo] = useState(false);
  const casovac = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (casovac.current) clearTimeout(casovac.current);
  }, []);

  const text = (value ?? "").trim();
  if (!text) return null;

  return (
    <button
      type="button"
      className="copy-btn"
      aria-label={hotovo ? `${label} – zkopírováno` : `Zkopírovat ${label}`}
      title={hotovo ? "Zkopírováno" : `Zkopírovat ${label}`}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={async (e) => {
        e.stopPropagation();
        if (!(await zkopiruj(text))) return;
        setHotovo(true);
        if (casovac.current) clearTimeout(casovac.current);
        casovac.current = setTimeout(() => setHotovo(false), 1500);
      }}
      style={{
        display: "inline-grid",
        placeItems: "center",
        flexShrink: 0,
        width: size + 11,
        height: size + 11,
        padding: 0,
        border: "none",
        borderRadius: 7,
        background: "transparent",
        color: hotovo ? "var(--accent)" : "var(--muted)",
        cursor: "pointer",
        verticalAlign: "middle",
      }}
    >
      {hotovo ? <CheckIcon size={size} /> : <CopyIcon size={size} />}
    </button>
  );
}
