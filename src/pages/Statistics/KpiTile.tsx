import type { ReactNode } from "react";
import { Card } from "../../components/ui";
import { cislo } from "./format";

/**
 * Porovnání s předchozím obdobím pod hodnotou dlaždice.
 *
 * Procenta dávají smysl jen tehdy, když bylo předchozí období nenulové;
 * jinak se zobrazí absolutní rozdíl (formátovaný volajícím).
 */
export type KpiDelta = {
  current: number;
  previous: number;
  /** Formát absolutního rozdílu (částka, počet, dny). Dostává už kladné číslo. */
  formatAbsolute: (n: number) => string;
  /** true = procenta nedávají smysl, vždy ukázat absolutní rozdíl (např. dny). */
  absolute?: boolean;
  /** true = růst je špatná zpráva (náklady, slevy, doba zakázky). */
  invert?: boolean;
};

function DeltaChip({ delta }: { delta: KpiDelta }) {
  const diff = delta.current - delta.previous;
  const direction: "up" | "down" | "flat" = diff > 0 ? "up" : diff < 0 ? "down" : "flat";

  let text: string;
  if (direction === "flat") {
    text = "beze změny";
  } else {
    const sign = diff > 0 ? "+" : "−";
    if (!delta.absolute && delta.previous > 0) {
      const pct = (Math.abs(diff) / delta.previous) * 100;
      text = `${sign}${cislo(pct, pct < 10 ? 1 : 0)} % vs. předchozí`;
    } else {
      text = `${sign}${delta.formatAbsolute(Math.abs(diff))} vs. předchozí`;
    }
  }

  // Zelená = dobrá zpráva. U nákladů, slev a doby zakázky je dobrá zpráva pokles.
  const good = direction === "flat" ? null : delta.invert ? direction === "down" : direction === "up";
  const color = good === null ? "var(--muted)" : good ? "var(--success-text)" : "var(--danger-text)";
  const background = good === null ? "var(--panel-2)" : good ? "var(--success-soft)" : "var(--danger-soft)";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-1)",
        marginTop: "var(--space-2)",
        padding: "2px var(--space-2)",
        borderRadius: "var(--radius-pill)",
        fontSize: "var(--text-xs)",
        fontWeight: 700,
        lineHeight: 1.4,
        color,
        background,
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
      }}
      title="Změna oproti předchozímu období stejné délky"
    >
      {direction !== "flat" && (
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
          {direction === "up" ? <path d="M5 1.5 9 7.5H1z" fill="currentColor" /> : <path d="M5 8.5 1 2.5h8z" fill="currentColor" />}
        </svg>
      )}
      {text}
    </span>
  );
}

/**
 * Dlaždice s jedním klíčovým číslem.
 *
 * Hodnota je vždy v barvě textu – dřív byl zisk zvýrazněný akcentem, což
 * v řadě sedmi dlaždic vypadalo jako odkaz. Velikost písma se zmenšuje
 * podle délky textu, aby se dlouhé částky nelámaly na dva řádky.
 */
export function KpiTile({
  title,
  value,
  icon,
  delta,
  subtitle,
}: {
  title: string;
  value: string | number;
  icon: ReactNode;
  /** Zobrazí se jen při zapnutém porovnání. */
  delta?: KpiDelta;
  /** Doplněk pod hodnotou (např. absolutní částka u procentní marže). */
  subtitle?: string;
}) {
  // Částka se nesmí zalomit uprostřed ("8 200 334 K / č"), tak se místo
  // zalamování zmenšuje písmo podle délky textu.
  const valueLength = String(value).length;
  const valueFontSize = valueLength > 13 ? "var(--text-lg)" : valueLength > 9 ? "var(--text-xl)" : "var(--text-2xl)";

  return (
    <Card style={{ display: "flex", flexDirection: "column", minWidth: 0, padding: "var(--pad-20)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          marginBottom: "var(--space-2)",
          color: "var(--muted)",
          fontSize: "var(--text-xs)",
          fontWeight: 700,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}
      >
        <span style={{ display: "flex", flexShrink: 0 }}>{icon}</span>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
      </div>
      <div
        style={{
          fontWeight: 800,
          fontSize: valueFontSize,
          color: "var(--text)",
          lineHeight: 1.2,
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
        title={String(value)}
      >
        {value}
      </div>
      {subtitle && (
        <div
          style={{
            marginTop: "var(--space-1)",
            fontSize: "var(--text-sm)",
            color: "var(--muted)",
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={subtitle}
        >
          {subtitle}
        </div>
      )}
      {delta && (
        <div style={{ marginTop: "auto" }}>
          <DeltaChip delta={delta} />
        </div>
      )}
    </Card>
  );
}

/** Zástupná dlaždice při načítání – drží stejnou výšku jako hotová. */
export function KpiTileSkeleton() {
  const block = (width: string, height: number) => (
    <span
      className="stats-skeleton"
      style={{
        display: "block",
        width,
        height,
        borderRadius: "var(--radius-xs)",
        background: "var(--panel-2)",
        border: "1px solid var(--border)",
      }}
    />
  );
  return (
    <Card aria-hidden="true" style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", padding: "var(--pad-20)" }}>
      {block("55%", 12)}
      {block("75%", 30)}
    </Card>
  );
}
