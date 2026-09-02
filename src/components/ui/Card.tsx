import type { HTMLAttributes } from "react";

/** Panel s pozadím, rámečkem a zaoblením podle tokenů. */
export function Card({
  flush = false,
  className = "",
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { flush?: boolean }) {
  return (
    <div className={["ui-card", flush ? "ui-card--flush" : "", className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </div>
  );
}
