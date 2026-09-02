import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Karta nebo řádek, který je zároveň přepínačem – ve Statistikách se jím
 * zapíná a vypíná filtr (drill-down).
 *
 * Vybraný stav nese `aria-pressed`, takže ho ohlásí i odečítač obrazovky;
 * dřív byl poznat jen podle barvy. Vzhled navazuje v ui.css.
 */
export function Selectable({
  selected,
  variant = "card",
  layout = "block",
  size = "md",
  className = "",
  children,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  selected: boolean;
  /** `plain` = bez vlastního pozadí a rámečku (řádek s pruhem grafu). */
  variant?: "card" | "plain";
  /** Rozvržení obsahu: na výšku, do řádku, nebo do řádku s mezerou mezi kraji. */
  layout?: "block" | "row" | "between";
  size?: "sm" | "md" | "lg";
  children: ReactNode;
}) {
  const classes = [
    "ui-selectable",
    variant === "plain" ? "ui-selectable--plain" : "",
    layout !== "block" ? `ui-selectable--${layout}` : "",
    size === "sm" ? "ui-selectable--sm" : "",
    size === "lg" ? "ui-selectable--lg" : "",
    className,
  ].filter(Boolean).join(" ");

  return (
    <button type="button" className={classes} aria-pressed={selected} {...rest}>
      {children}
    </button>
  );
}
