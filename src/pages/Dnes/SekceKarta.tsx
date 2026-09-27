import { useState, type ReactNode } from "react";
import { Card } from "../../components/ui";

/**
 * Jedna sekce stránky Dnes: karta s nadpisem, počtem a seznamem řádků.
 *
 * Dlouhý seznam ukáže prvních pár řádků a tlačítko „Zobrazit všech N“ –
 * karta, která se roztáhne přes tři obrazovky, přebije všechny ostatní
 * a přesně tomu se Dnes má vyhnout.
 */

export type TonSekce = "danger" | "warning" | "accent" | "success" | "info" | "muted";

const BARVA: Record<TonSekce, { text: string; pozadi: string }> = {
  danger: { text: "var(--danger-text)", pozadi: "var(--danger-soft)" },
  warning: { text: "var(--warning-text)", pozadi: "var(--warning-soft)" },
  accent: { text: "var(--accent)", pozadi: "var(--accent-soft)" },
  success: { text: "var(--success-text)", pozadi: "var(--success-soft)" },
  info: { text: "var(--info-text)", pozadi: "var(--info-soft)" },
  muted: { text: "var(--muted)", pozadi: "var(--panel-2)" },
};

const LIMIT_RADKU = 8;

export function SekceKarta({
  titulek,
  popis,
  pocet,
  ton,
  prazdno,
  nacitam,
  dataTour,
  children,
  akce,
}: {
  titulek: string;
  /** Jedna věta pod nadpisem: podle čeho se sekce plní. */
  popis?: string;
  pocet: number;
  ton: TonSekce;
  /** Věta pro prázdnou sekci – co udělat, aby se sem něco dostalo. */
  prazdno: ReactNode;
  nacitam?: boolean;
  dataTour: string;
  /** Řádky; každý prvek pole je jeden řádek. */
  children: ReactNode[];
  /** Tlačítko vpravo v hlavičce (Otevřít chat, Kalendář…). */
  akce?: ReactNode;
}) {
  const [vse, setVse] = useState(false);
  const barva = BARVA[ton];
  const radky = vse ? children : children.slice(0, LIMIT_RADKU);
  const zbyva = children.length - radky.length;

  return (
    <Card data-tour={dataTour} style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-3)" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: "var(--text-lg)", fontWeight: 800, color: "var(--text)" }}>{titulek}</h2>
            <span
              aria-label={`${pocet} položek`}
              style={{
                minWidth: 24,
                padding: "1px var(--space-2)",
                borderRadius: "var(--radius-pill)",
                background: pocet > 0 ? barva.pozadi : "var(--panel-2)",
                color: pocet > 0 ? barva.text : "var(--muted)",
                fontSize: "var(--text-sm)",
                fontWeight: 800,
                textAlign: "center",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {nacitam && pocet === 0 ? "…" : pocet}
            </span>
          </div>
          {popis && <div style={{ marginTop: 2, fontSize: "var(--text-sm)", color: "var(--muted)" }}>{popis}</div>}
        </div>
        {akce}
      </div>

      {children.length === 0 ? (
        <div style={{ fontSize: "var(--text-base)", color: "var(--muted)", lineHeight: 1.45 }}>{nacitam ? "Načítám…" : prazdno}</div>
      ) : (
        <div role="list" style={{ display: "flex", flexDirection: "column", gap: 2, margin: "0 calc(-1 * var(--space-2))" }}>
          {radky}
        </div>
      )}

      {(zbyva > 0 || (vse && children.length > LIMIT_RADKU)) && (
        <button
          type="button"
          onClick={() => setVse((v) => !v)}
          style={{
            alignSelf: "flex-start",
            border: "none",
            background: "none",
            padding: 0,
            color: "var(--accent)",
            fontWeight: 700,
            fontSize: "var(--text-sm)",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {vse ? "Zobrazit méně" : `Zobrazit všech ${children.length}`}
        </button>
      )}
    </Card>
  );
}

/** Řádek sekce – celý je tlačítko, na telefonu se text zalomí, nic nepřeteče. */
export function RadekSekce({
  onClick,
  titulek,
  kod,
  podtitulek,
  vpravo,
  poznamka,
  poznamkaTon,
  title,
}: {
  onClick: () => void;
  titulek: ReactNode;
  kod?: string | null;
  podtitulek?: ReactNode;
  /** Štítek stavu, počet… */
  vpravo?: ReactNode;
  /** Krátký údaj (termín, jak dlouho čeká) – barevně podle sekce. */
  poznamka?: ReactNode;
  poznamkaTon?: TonSekce;
  title?: string;
}) {
  return (
    <div role="listitem">
      <button
        type="button"
        onClick={onClick}
        title={title}
        className="dnes-radek"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
          width: "100%",
          minWidth: 0,
          padding: "var(--space-2)",
          border: "none",
          borderRadius: "var(--radius-xs)",
          background: "transparent",
          color: "var(--text)",
          textAlign: "left",
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-2)", minWidth: 0 }}>
            {kod && <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--muted)", flexShrink: 0 }}>{kod}</span>}
            <span style={{ fontSize: "var(--text-base)", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{titulek}</span>
          </div>
          {(podtitulek || poznamka) && (
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", columnGap: "var(--space-2)", rowGap: 0, marginTop: 1, fontSize: "var(--text-sm)", color: "var(--muted)", minWidth: 0 }}>
              {poznamka && <span style={{ color: poznamkaTon ? BARVA[poznamkaTon].text : "var(--muted)", fontWeight: 700 }}>{poznamka}</span>}
              {podtitulek && <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, maxWidth: "100%" }}>{podtitulek}</span>}
            </div>
          )}
        </div>
        {vpravo && <div style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>{vpravo}</div>}
      </button>
    </div>
  );
}
