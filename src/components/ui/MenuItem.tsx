import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Položka rozbalovací nabídky – řádek na celou šířku zarovnaný vlevo.
 *
 * Rozlišuje dva stavy, které se v aplikaci mísily: `selected` je zvolená
 * hodnota (nese ji i `aria-pressed`, takže ji ohlásí odečítač obrazovky),
 * `highlighted` je jen kurzor při procházení klávesnicí.
 *
 * Hover a stav pro klávesnici řeší ui.css; dřív to byla dvojice
 * onMouseEnter/onMouseLeave, která na klávesnici nefungovala.
 */
export function MenuItem({
  selected,
  highlighted = false,
  layout = "block",
  size = "sm",
  variant = "default",
  divider = false,
  className = "",
  children,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  /**
   * Zvolená hodnota. Nechat nevyplněné u obyčejných akcí („Odhlásit se“) –
   * ty nejsou přepínač a `aria-pressed="false"` by je za přepínač vydávalo.
   */
  selected?: boolean;
  /** Kurzor při procházení šipkami – neznamená, že je hodnota zvolená. */
  highlighted?: boolean;
  layout?: "block" | "row" | "between";
  size?: "sm" | "md";
  variant?: "default" | "danger";
  /** Oddělovací linka pod položkou. */
  divider?: boolean;
  children: ReactNode;
}) {
  const classes = [
    "ui-menu-item",
    layout !== "block" ? `ui-menu-item--${layout}` : "",
    size === "md" ? "ui-menu-item--md" : "",
    variant === "danger" ? "ui-menu-item--danger" : "",
    divider ? "ui-menu-item--divider" : "",
    className,
  ].filter(Boolean).join(" ");

  return (
    <button
      type="button"
      className={classes}
      aria-pressed={selected}
      data-highlighted={highlighted || undefined}
      {...rest}
    >
      {children}
    </button>
  );
}
