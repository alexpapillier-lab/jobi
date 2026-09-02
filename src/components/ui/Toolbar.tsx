import type { HTMLAttributes } from "react";

/**
 * Vodorovná řada ovládacích prvků, která se umí zalomit.
 *
 * `flexWrap` a `minWidth: 0` jsou tu záměrně: bez nich panely přetékaly
 * na úzkých obrazovkách místo zalomení (naměřeno 488 oříznutých prvků
 * na šířce 375 px).
 */
export function Toolbar({ className = "", children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={["ui-toolbar", className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </div>
  );
}

/** Mezera, která odtlačí zbytek panelu doprava. */
export function ToolbarSpacer() {
  return <span className="ui-toolbar__spacer" />;
}
