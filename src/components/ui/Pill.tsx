import type { HTMLAttributes, ReactNode } from "react";

/**
 * Odznak / štítek.
 *
 * `color` obarví text i tečku; pozadí zůstává neutrální, aby pilulky
 * nepřebíjely obsah. Bez `color` je pilulka tlumená.
 */
export function Pill({
  color,
  dot = false,
  icon,
  className = "",
  children,
  style,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { color?: string; dot?: boolean; icon?: ReactNode }) {
  return (
    <span
      className={["ui-pill", className].filter(Boolean).join(" ")}
      style={color ? { color, borderColor: color, ...style } : style}
      {...rest}
    >
      {dot && (
        <span
          aria-hidden="true"
          style={{ width: 6, height: 6, borderRadius: "50%", background: color || "currentColor", flexShrink: 0 }}
        />
      )}
      {icon}
      {children}
    </span>
  );
}
