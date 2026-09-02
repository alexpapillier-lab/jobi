import type { ReactNode } from "react";

/**
 * Nadpis stránky s podtitulkem a volitelnými akcemi vpravo.
 *
 * Sjednocuje tři různé způsoby, jak se dosud psal nadpis obrazovky
 * (viz docs/AUDIT_UI_2026-09.md, 7.5).
 */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-4)", flexWrap: "wrap" }}>
      <div className="ui-page-header" style={{ flex: 1, minWidth: 0 }}>
        <div className="ui-page-header__title">{title}</div>
        {subtitle && <div className="ui-page-header__subtitle">{subtitle}</div>}
      </div>
      {actions && <div className="ui-toolbar">{actions}</div>}
    </div>
  );
}
