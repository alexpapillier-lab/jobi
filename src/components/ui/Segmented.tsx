import type { ReactNode } from "react";

/**
 * Výběr z několika voleb (filtrační pilulky, měřítko, období…).
 *
 * Nahrazuje ručně psaný vzor, který se v aplikaci opakoval 34× v deseti
 * souborech – včetně hover efektu řešeného přes onMouseEnter/onMouseLeave,
 * který nefungoval pro klávesnici.
 *
 * Vybraná volba se značí `aria-pressed`, takže stav zná i odečítač
 * obrazovky; vzhled na to navazuje v ui.css.
 */
export type SegmentedOption<T> = {
  value: T;
  label: ReactNode;
  disabled?: boolean;
  title?: string;
  /** Kotva pro průvodce aplikací (AppTourOverlay). */
  dataTour?: string;
};

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  size = "md",
  ariaLabel,
  className = "",
}: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  size?: "sm" | "md";
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={["ui-segmented", size === "sm" ? "ui-segmented--sm" : "", className].filter(Boolean).join(" ")}
    >
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          className="ui-segmented__option"
          aria-pressed={o.value === value}
          disabled={o.disabled}
          title={o.title}
          data-tour={o.dataTour}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
