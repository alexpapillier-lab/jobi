import { Selectable } from "../../components/ui";
import { celeCislo } from "./format";

export type RankItem = { name: string; count: number };

/**
 * Pořadí položek (nejčastější opravy, zařízení).
 *
 * Emoji medaile nahradil kroužek s číslem: emoji vykresluje každý systém
 * jinak a na Windows z nich zůstaly barevné skvrny. Za každým řádkem je
 * tenký pruh v poměru k první položce, aby bylo pořadí čitelné bez čtení
 * čísel.
 */
export function RankList({
  items,
  selected,
  onSelect,
  emptyText,
  titlePrefix,
}: {
  items: RankItem[];
  selected: string | null;
  onSelect: (name: string) => void;
  emptyText: string;
  /** Prefix nápovědy tlačítka, např. "Filtrovat opravu". */
  titlePrefix: string;
}) {
  if (items.length === 0) {
    return (
      <div style={{ color: "var(--muted)", fontSize: "var(--text-base)", textAlign: "center", padding: "var(--space-5)" }}>
        {emptyText}
      </div>
    );
  }

  const max = Math.max(1, ...items.map((i) => i.count));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
      {items.map((item, idx) => {
        const rank = idx + 1;
        const isActive = selected === item.name;
        const share = item.count / max;
        const podium = rank <= 3;
        return (
          <Selectable
            key={item.name}
            selected={isActive}
            layout="between"
            variant="plain"
            size="sm"
            onClick={() => onSelect(item.name)}
            title={`${titlePrefix}: ${item.name}`}
            style={{ position: "relative", overflow: "hidden", borderRadius: "var(--radius-xs)" }}
          >
            {/* Pruh podílu – pod obsahem, nezasahuje do rozvržení. */}
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: "0 auto 0 0",
                width: `${Math.max(2, share * 100)}%`,
                background: "var(--accent-soft)",
                opacity: isActive ? 0.9 : 0.45,
                pointerEvents: "none",
                transition: "width 0.3s ease, opacity 0.15s ease",
              }}
            />
            <span style={{ position: "relative", display: "flex", alignItems: "center", gap: "var(--space-2)", minWidth: 0 }}>
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
                  fontVariantNumeric: "tabular-nums",
                  background: podium ? "var(--accent)" : "var(--accent-soft)",
                  color: podium ? "#fff" : "var(--accent)",
                }}
              >
                {rank}
              </span>
              <span style={{ fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {item.name}
              </span>
            </span>
            <span
              style={{
                position: "relative",
                fontWeight: 700,
                color: "var(--text)",
                fontVariantNumeric: "tabular-nums",
                flexShrink: 0,
              }}
            >
              {celeCislo(item.count)}×
            </span>
          </Selectable>
        );
      })}
    </div>
  );
}
