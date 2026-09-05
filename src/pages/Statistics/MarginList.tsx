import { useMemo, useState, type CSSProperties } from "react";
import { Button, Segmented } from "../../components/ui";
import { celeCislo, cislo, formatCurrencyRounded } from "./format";
import { marginColor, sortMarginRows, type MarginRow, type MarginSort } from "./margin";

const SORT_OPTIONS: Array<{ value: MarginSort; label: string; title: string }> = [
  { value: "margin", label: "Marže Kč", title: "Řadit podle marže v korunách" },
  { value: "pct", label: "Marže %", title: "Řadit podle marže v procentech" },
  { value: "count", label: "Počet", title: "Řadit podle počtu" },
];

/**
 * Žebříček marže (podle oprav, podle zařízení).
 *
 * Řádek: pořadí, název, počet, příjem, náklady, marže Kč a marže % jako
 * pruh v poměru k 100 %. Barva pruhu říká, jestli je marže zdravá – čísla
 * jsou vedle, pruh je jen pro rychlé přelétnutí očima. Skupiny bez jakýchkoli
 * nákladů se místo 100 % označí „bez nákladů“, aby nevypadaly jako nejlepší.
 */
export function MarginList({
  rows,
  limit,
  countLabel,
  selected,
  onSelect,
  emptyText,
  titlePrefix,
}: {
  rows: MarginRow[];
  /** Kolik řádků ukázat, než uživatel klikne na „Zobrazit vše“. */
  limit: number;
  /** Popisek sloupce s počtem („Provedeno“, „Zakázek“). */
  countLabel: string;
  selected?: string | null;
  onSelect?: (name: string) => void;
  emptyText: string;
  /** Prefix nápovědy řádku, např. "Filtrovat opravu". */
  titlePrefix: string;
}) {
  const [sort, setSort] = useState<MarginSort>("margin");
  const [showAll, setShowAll] = useState(false);

  const sorted = useMemo(() => sortMarginRows(rows, sort), [rows, sort]);
  const visible = showAll ? sorted : sorted.slice(0, limit);

  if (rows.length === 0) {
    return (
      <div style={{ color: "var(--muted)", fontSize: "var(--text-base)", textAlign: "center", padding: "var(--space-5)" }}>
        {emptyText}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
        <span style={{ fontSize: "var(--text-sm)", color: "var(--muted)" }}>Řadit podle</span>
        <Segmented<MarginSort> ariaLabel="Řazení žebříčku marže" size="sm" value={sort} onChange={setSort} options={SORT_OPTIONS} />
      </div>

      <div style={{ overflowX: "auto" }}>
        <div role="table" aria-label="Marže" style={{ minWidth: 560, display: "flex", flexDirection: "column", fontVariantNumeric: "tabular-nums" }}>
          <div role="row" style={{ ...rowGrid, padding: "0 var(--space-2) var(--space-1)", borderBottom: "1px solid var(--border)" }}>
            <span role="columnheader" style={headerCell}>
              Název
            </span>
            <span role="columnheader" style={{ ...headerCell, textAlign: "right" }}>
              {countLabel}
            </span>
            <span role="columnheader" style={{ ...headerCell, textAlign: "right" }}>
              Příjem
            </span>
            <span role="columnheader" style={{ ...headerCell, textAlign: "right" }}>
              Náklady
            </span>
            <span role="columnheader" style={{ ...headerCell, textAlign: "right" }}>
              Marže
            </span>
            <span role="columnheader" style={headerCell}>
              Marže %
            </span>
          </div>

          {visible.map((row, idx) => {
            const rank = idx + 1;
            const isActive = !!selected && selected === row.name;
            const pct = row.marginPct;
            const barWidth = Math.max(0, Math.min(100, pct));
            const clickable = !!onSelect;
            const content = (
              <>
                <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", minWidth: 0 }}>
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      fontSize: "var(--text-xs)",
                      fontWeight: 800,
                      background: rank <= 3 && sort !== "count" ? "var(--accent)" : "var(--accent-soft)",
                      color: rank <= 3 && sort !== "count" ? "#fff" : "var(--accent)",
                    }}
                  >
                    {rank}
                  </span>
                  <span
                    title={row.name}
                    style={{ fontWeight: isActive ? 700 : 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {row.name}
                  </span>
                </span>
                <span style={{ ...numCell, color: "var(--muted)" }}>{celeCislo(row.count)}×</span>
                <span style={numCell}>{formatCurrencyRounded(row.revenue)}</span>
                <span style={{ ...numCell, color: row.noCostData ? "var(--muted)" : "var(--text)" }}>
                  {row.noCostData ? "—" : formatCurrencyRounded(row.cost)}
                </span>
                <span
                  style={{
                    ...numCell,
                    fontWeight: 700,
                    color: row.noCostData ? "var(--muted)" : row.margin < 0 ? "var(--danger-text)" : "var(--text)",
                  }}
                >
                  {formatCurrencyRounded(row.margin)}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", minWidth: 0 }}>
                  {row.noCostData ? (
                    <span style={{ fontSize: "var(--text-sm)", color: "var(--muted)", fontStyle: "italic" }} title="Žádná z položek nemá náklady ani díl s nákupní cenou">
                      bez nákladů
                    </span>
                  ) : (
                    <>
                      <span
                        aria-hidden="true"
                        style={{
                          flex: 1,
                          height: 8,
                          minWidth: 40,
                          borderRadius: "var(--radius-2xs)",
                          background: "var(--panel-2)",
                          border: "1px solid var(--border)",
                          overflow: "hidden",
                        }}
                      >
                        <span
                          style={{
                            display: "block",
                            height: "100%",
                            width: `${barWidth}%`,
                            minWidth: pct > 0 ? 3 : 0,
                            background: marginColor(pct),
                            borderRadius: "var(--radius-2xs)",
                            transition: "width 0.3s ease",
                          }}
                        />
                      </span>
                      <span
                        style={{
                          flex: "0 0 52px",
                          textAlign: "right",
                          fontSize: "var(--text-sm)",
                          fontWeight: 700,
                          color: pct < 0 ? "var(--danger-text)" : "var(--text)",
                        }}
                      >
                        {cislo(pct, Math.abs(pct) < 10 ? 1 : 0)} %
                      </span>
                    </>
                  )}
                </span>
              </>
            );

            const baseStyle: CSSProperties = {
              ...rowGrid,
              padding: "var(--space-2) var(--space-2)",
              borderRadius: "var(--radius-xs)",
              background: isActive ? "var(--accent-soft)" : "transparent",
              fontSize: "var(--text-base)",
              width: "100%",
              textAlign: "left",
              border: "none",
              color: "inherit",
              font: "inherit",
            };

            return clickable ? (
              <button
                type="button"
                role="row"
                key={row.key}
                onClick={() => onSelect?.(row.name)}
                aria-pressed={isActive}
                title={`${titlePrefix}: ${row.name}`}
                className="stats-margin-row"
                style={{ ...baseStyle, cursor: "pointer" }}
              >
                {content}
              </button>
            ) : (
              <div role="row" key={row.key} style={baseStyle}>
                {content}
              </div>
            );
          })}
        </div>
      </div>

      {sorted.length > limit && (
        <div>
          <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
            {showAll ? `Zobrazit jen prvních ${limit}` : `Zobrazit vše (${celeCislo(sorted.length)})`}
          </Button>
        </div>
      )}
      <style>{`.stats-margin-row:hover{background:var(--panel-2)!important}.stats-margin-row:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}`}</style>
    </div>
  );
}

const rowGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(140px, 1fr) 64px 110px 110px 110px minmax(120px, 160px)",
  columnGap: "var(--space-3)",
  alignItems: "center",
};

const headerCell: CSSProperties = {
  fontSize: "var(--text-xs)",
  color: "var(--muted)",
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};

const numCell: CSSProperties = {
  textAlign: "right",
  whiteSpace: "nowrap",
  color: "var(--text)",
};
