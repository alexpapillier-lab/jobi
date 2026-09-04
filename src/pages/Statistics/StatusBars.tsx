import { Selectable } from "../../components/ui";
import { celeCislo, cislo } from "./format";

export type StatusBarItem = {
  key: string;
  label: string;
  count: number;
  /** Barva stavu z nastavení servisu; bez ní se použije akcent. */
  color?: string;
};

/**
 * Zakázky podle stavu – vodorovné pruhy v barvách stavů.
 *
 * Šířka pruhu je podíl na nejpočetnějším stavu (ne na celku), aby i při
 * jednom dominantním stavu zůstaly ostatní pruhy viditelné; procento
 * z celku je vedle čísla.
 */
export function StatusBars({
  items,
  selected,
  onSelect,
}: {
  items: StatusBarItem[];
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  if (items.length === 0) {
    return <div style={{ color: "var(--muted)", fontSize: "var(--text-base)" }}>Žádné zakázky ve vybraném období.</div>;
  }

  const max = Math.max(1, ...items.map((i) => i.count));
  const total = items.reduce((s, i) => s + i.count, 0) || 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
      {items.map((item) => {
        const isActive = selected === item.key;
        const pct = (item.count / total) * 100;
        return (
          <Selectable
            key={item.key}
            selected={isActive}
            layout="row"
            variant="plain"
            size="sm"
            onClick={() => onSelect(item.key)}
            title={`Filtrovat stav: ${item.label} (${celeCislo(item.count)})`}
            style={{ borderRadius: "var(--radius-xs)" }}
          >
            <span
              style={{
                flex: "0 0 clamp(120px, 28%, 220px)",
                minWidth: 0,
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
                fontSize: "var(--text-base)",
                color: "var(--text)",
                fontWeight: isActive ? 700 : 500,
              }}
            >
              <span
                aria-hidden="true"
                style={{ width: 8, height: 8, borderRadius: "50%", background: item.color || "var(--accent)", flexShrink: 0 }}
              />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</span>
            </span>
            <span
              style={{
                flex: 1,
                height: 22,
                background: "var(--panel-2)",
                borderRadius: "var(--radius-2xs)",
                overflow: "hidden",
                display: "flex",
                minWidth: 60,
              }}
            >
              <span
                style={{
                  width: `${(item.count / max) * 100}%`,
                  minWidth: item.count > 0 ? 6 : 0,
                  height: "100%",
                  background: item.color || "var(--accent)",
                  opacity: selected && !isActive ? 0.45 : 1,
                  borderRadius: "var(--radius-2xs)",
                  transition: "width 0.3s ease, opacity 0.15s ease",
                }}
              />
            </span>
            <span
              style={{
                flex: "0 0 auto",
                minWidth: 96,
                textAlign: "right",
                fontVariantNumeric: "tabular-nums",
                fontSize: "var(--text-base)",
                color: "var(--text)",
              }}
            >
              <strong style={{ fontWeight: 700 }}>{celeCislo(item.count)}</strong>
              <span style={{ color: "var(--muted)", marginLeft: "var(--space-2)", fontSize: "var(--text-sm)" }}>
                {cislo(pct, pct < 10 && pct > 0 ? 1 : 0)} %
              </span>
            </span>
          </Selectable>
        );
      })}
    </div>
  );
}
