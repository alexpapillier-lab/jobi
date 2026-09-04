import type { ReactNode } from "react";
import { Button } from "../../components/ui";

/**
 * Drobnosti sdílené stromem zařízení a panelem oprav.
 */

/** České skloňování podle počtu: plural(3, ["značka", "značky", "značek"]). */
export function plural(n: number, forms: [string, string, string]) {
  const abs = Math.abs(n);
  if (abs === 1) return forms[0];
  if (abs >= 2 && abs <= 4) return forms[1];
  return forms[2];
}

export function formatKc(n: number) {
  return `${n.toLocaleString("cs-CZ")} Kč`;
}

/** 45 → „45 min“, 90 → „1 h 30 min“, 120 → „2 h“. */
export function formatMinutes(min: number) {
  if (!min || min < 60) return `${min || 0} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Ikonové tlačítko akce – ghost, malé, jen s ikonou. */
export function IconButton({
  label,
  icon,
  onClick,
  danger = false,
  disabled = false,
  className,
}: {
  label: string;
  icon: ReactNode;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  danger?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      iconOnly
      icon={icon}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={className}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      style={danger ? { color: "var(--danger-text)" } : undefined}
    />
  );
}

/**
 * Štítek „v API“ / „mimo API“ s přepnutím.
 *
 * Text, ne ikona: „jde tahle položka na web?“ nevystihne žádný piktogram.
 */
export function ApiPill({
  hidden,
  onToggle,
  cascade = false,
  size = "sm",
}: {
  hidden: boolean;
  onToggle: () => void;
  /** Skrytí se dědí dolů (značka schová i kategorie a modely). */
  cascade?: boolean;
  size?: "sm" | "md";
}) {
  const title = hidden
    ? `Neposílá se do veřejného ceníku${cascade ? ", včetně všeho pod tím" : ""}. Kliknutím zařadíte.`
    : `Ve veřejném ceníku. Kliknutím vyřadíte${cascade ? " i všechno pod tím" : ""}.`;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      title={title}
      aria-pressed={!hidden}
      style={{
        flexShrink: 0,
        border: `1px solid ${hidden ? "var(--warning)" : "var(--border)"}`,
        background: hidden ? "var(--warning-soft)" : "var(--panel-2)",
        borderRadius: "var(--radius-pill)",
        padding: size === "md" ? "3px var(--space-2)" : "1px var(--space-2)",
        fontSize: size === "md" ? "var(--text-sm)" : "var(--text-xs)",
        fontWeight: 700,
        lineHeight: 1.5,
        cursor: "pointer",
        fontFamily: "inherit",
        color: hidden ? "var(--warning-text)" : "var(--muted)",
        whiteSpace: "nowrap",
      }}
    >
      {hidden ? "mimo API" : "v API"}
    </button>
  );
}
