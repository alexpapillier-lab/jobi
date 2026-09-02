import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Tlačítko.
 *
 * Nahrazuje pět různých definic `primaryBtn` rozesetých po stránkách,
 * které se lišily odsazením, poloměrem, tloušťkou písma i pozadím.
 * Vzhled je v `src/styles/ui.css` (třídy .ui-btn*), aby fungoval
 * :hover, :focus-visible a :disabled – to inline styl neumí.
 */
export type ButtonVariant = "primary" | "soft" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Ikona vlevo od popisku. */
  icon?: ReactNode;
  /** Jen ikona, bez popisku – vyžaduje aria-label. */
  iconOnly?: boolean;
};

export function Button({
  variant = "soft",
  size = "md",
  icon,
  iconOnly = false,
  className = "",
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  const cls = [
    "ui-btn",
    `ui-btn--${variant}`,
    size !== "md" ? `ui-btn--${size}` : "",
    iconOnly ? "ui-btn--icon" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button type={type} className={cls} {...rest}>
      {icon}
      {!iconOnly && children}
    </button>
  );
}
