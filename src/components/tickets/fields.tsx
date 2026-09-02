import { DeviceIcon, WrenchIcon } from "./icons";
import { formatCZDate } from "./types";

/**
 * Sdílené prvky karty zakázky.
 *
 * Audit UI (docs/AUDIT_UI_2026-09.md) našel devatenáct velikostí písma.
 * Nevznikly nedbalostí – vznikly tím, že každý režim zobrazení si stejnou
 * informaci vykresloval znovu a pokaždé o chlup jinak: kód zakázky jednou
 * 12px, jindy 13px, zařízení jednou váha 600, jindy 700.
 *
 * Tyhle komponenty tomu dělají konec. Režim si vybírá jen rozvržení,
 * ne jak vypadá datum. Změna hustoty nebo vzhledu se pak dělá na jednom
 * místě místo v sedmi.
 *
 * Varianta `dense` je pro úspornější režimy (compact, stripe, grid…),
 * kde bylo písmo o stupeň menší.
 */

type Dense = { dense?: boolean };

/**
 * Kód zakázky – nejvýraznější údaj na kartě.
 *
 * `children` je místo pro doplněk hned za kódem, typicky odznak
 * nepřečtených SMS. Proto je i display inline-flex.
 */
export function TicketCode({
  code,
  dense,
  children,
}: { code: string; children?: import("react").ReactNode } & Dense) {
  return (
    <span
      style={{
        fontWeight: 800,
        fontSize: dense ? "var(--text-sm)" : "var(--text-base)",
        color: "var(--text)",
        whiteSpace: "nowrap",
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
      }}
    >
      {code}
      {children}
    </span>
  );
}

/** Datum přijetí. */
export function TicketDate({ value }: { value: string | number | Date | null | undefined }) {
  return (
    <span
      style={{
        fontSize: "var(--text-xs)",
        color: "var(--muted)",
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {formatCZDate(value as never)}
    </span>
  );
}

/** Zařízení včetně ikony. Zkrátí se třemi tečkami, když se nevejde. */
export function TicketDevice({ label, dense }: { label?: string | null } & Dense) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", minWidth: 0, overflow: "hidden" }}>
      <DeviceIcon size={12} color="var(--accent)" />
      <span
        style={{
          fontWeight: 700,
          fontSize: dense ? "var(--text-sm)" : "var(--text-base)",
          color: "var(--text)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label || "—"}
      </span>
    </div>
  );
}

/** Jméno zákazníka. */
export function TicketCustomer({ name }: { name?: string | null }) {
  return (
    <span
      style={{
        fontWeight: 500,
        fontSize: "var(--text-xs)",
        color: "var(--muted)",
        whiteSpace: "nowrap",
        flexShrink: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {name}
    </span>
  );
}

/** Požadovaná oprava nebo popis závady. */
export function TicketRepair({ text }: { text?: string | null }) {
  if (!text) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", minWidth: 0, overflow: "hidden" }}>
      <WrenchIcon size={11} color="var(--muted)" />
      <span
        style={{
          fontSize: "var(--text-xs)",
          fontWeight: 600,
          color: "var(--muted)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {text}
      </span>
    </div>
  );
}

/** Tečka mezi údaji. */
export function MetaSeparator() {
  return <span style={{ color: "var(--border)", flexShrink: 0 }}>·</span>;
}
