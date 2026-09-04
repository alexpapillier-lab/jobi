import type { CSSProperties, ReactNode } from "react";
import { BoxIcon, CoinsIcon, WarningIcon, XIcon } from "../../components/icons";

export type StockFilter = "all" | "inStock" | "lowStock" | "outOfStock" | "noModels";

/** Hranice „pod minimem“ – stejná jako ve filtru seznamu (1–4 ks). */
export const LOW_STOCK_LIMIT = 5;

const formatKc = new Intl.NumberFormat("cs-CZ", { style: "currency", currency: "CZK", maximumFractionDigits: 0 });

/**
 * Čtyři dlaždice nad seznamem: počet produktů, pod minimem, vyprodáno,
 * hodnota skladu. Dvě prostřední jsou zároveň zkratka k filtru seznamu –
 * proto jsou to tlačítka s `aria-pressed`, ne jen čísla.
 */
export function KpiStrip({
  pocetProduktu,
  podMinimem,
  vyprodano,
  hodnotaSkladu,
  bezNakupniCeny,
  aktivniFiltr,
  onFiltr,
}: {
  pocetProduktu: number;
  podMinimem: number;
  vyprodano: number;
  hodnotaSkladu: number;
  /** Kolik produktů se do hodnoty počítá prodejní cenou, protože nákupní chybí. */
  bezNakupniCeny: number;
  aktivniFiltr: StockFilter;
  onFiltr: (f: StockFilter) => void;
}) {
  const zaklad =
    bezNakupniCeny > 0
      ? `Součet kusů × nákupní cena. U ${bezNakupniCeny} produktů nákupní cena chybí, počítá se prodejní.`
      : "Součet kusů × nákupní cena za všechny sklady.";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
        gap: "var(--space-3)",
      }}
    >
      <Tile icon={<BoxIcon size={14} />} label="Produktů" value={String(pocetProduktu)} title="Počet produktů ve skladu" />
      <Tile
        icon={<WarningIcon size={14} />}
        label="Pod minimem"
        value={String(podMinimem)}
        tone={podMinimem > 0 ? "warning" : undefined}
        title={`Produkty s 1–${LOW_STOCK_LIMIT - 1} ks. Kliknutím vyfiltrujete seznam.`}
        pressed={aktivniFiltr === "lowStock"}
        onClick={() => onFiltr(aktivniFiltr === "lowStock" ? "all" : "lowStock")}
      />
      <Tile
        icon={<XIcon size={14} />}
        label="Vyprodáno"
        value={String(vyprodano)}
        tone={vyprodano > 0 ? "danger" : undefined}
        title="Produkty s 0 ks. Kliknutím vyfiltrujete seznam."
        pressed={aktivniFiltr === "outOfStock"}
        onClick={() => onFiltr(aktivniFiltr === "outOfStock" ? "all" : "outOfStock")}
      />
      <Tile icon={<CoinsIcon size={14} />} label="Hodnota skladu" value={formatKc.format(hodnotaSkladu)} title={zaklad} />
    </div>
  );
}

function Tile({
  icon,
  label,
  value,
  title,
  tone,
  pressed,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  title: string;
  tone?: "warning" | "danger";
  pressed?: boolean;
  onClick?: () => void;
}) {
  const barva = tone === "warning" ? "var(--warning-text)" : tone === "danger" ? "var(--danger-text)" : "var(--text)";
  const pozadi = pressed
    ? "var(--accent-soft)"
    : tone === "warning"
      ? "var(--warning-soft)"
      : tone === "danger"
        ? "var(--danger-soft)"
        : "var(--panel)";
  const style: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-1)",
    padding: "var(--space-3) var(--space-4)",
    borderRadius: "var(--radius-md)",
    border: pressed ? "1px solid var(--accent)" : "1px solid var(--border)",
    background: pozadi,
    color: "var(--text)",
    textAlign: "left",
    minWidth: 0,
    fontFamily: "inherit",
    cursor: onClick ? "pointer" : "default",
    boxShadow: pressed ? "0 0 0 3px var(--accent-soft)" : "var(--shadow-soft)",
    transition: "border-color 0.15s ease, box-shadow 0.15s ease",
  };
  const obsah = (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-1)",
          fontSize: "var(--text-xs)",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: "var(--muted)",
        }}
      >
        {icon}
        <span>{label}</span>
      </div>
      <div style={{ fontSize: "var(--text-xl)", fontWeight: 900, color: barva, lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {value}
      </div>
    </>
  );
  if (onClick) {
    return (
      <button type="button" title={title} aria-pressed={pressed} onClick={onClick} style={style}>
        {obsah}
      </button>
    );
  }
  return (
    <div title={title} style={style}>
      {obsah}
    </div>
  );
}
