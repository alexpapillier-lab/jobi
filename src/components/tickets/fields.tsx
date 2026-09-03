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

/** Datum přijetí. Bez data se vypíše pomlčka, ne "NaN.NaN.NaN". */
export function TicketDate({ value }: { value: string | number | Date | null | undefined }) {
  if (value === null || value === undefined || value === "") {
    return <span style={{ fontSize: "var(--text-xs)", color: "var(--muted)", whiteSpace: "nowrap", flexShrink: 0 }}>—</span>;
  }
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

/**
 * Zařízení včetně ikony. Zkrátí se třemi tečkami, když se nevejde.
 *
 * `iconColor` je tu kvůli seskupeným pohledům (podle stavu, kanban),
 * kde se ikona barví podle stavu zakázky místo akcentem. Je to smysluplný
 * rozdíl, ne nahodilost – proto se nesjednocuje pryč.
 */
export function TicketDevice({
  label,
  dense,
  iconColor = "var(--accent)",
}: { label?: string | null; iconColor?: string } & Dense) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", minWidth: 0, overflow: "hidden" }}>
      <DeviceIcon size={12} color={iconColor} />
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

/**
 * Jméno zákazníka.
 *
 * flexShrink: 1 a minWidth: 0 jsou tu schválně – bez nich se jméno odmítá
 * zkrátit a v úzkém okně vytlačí celý řádek přes okraj. Takhle se místo
 * toho ořízne třemi tečkami. Ověřeno až do šířky 440 px.
 */
export function TicketCustomer({ name }: { name?: string | null }) {
  return (
    <span
      style={{
        fontWeight: 500,
        fontSize: "var(--text-xs)",
        color: "var(--muted)",
        whiteSpace: "nowrap",
        flexShrink: 1,
        minWidth: 0,
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

/**
 * Akcent reklamací.
 *
 * Tmavší odstín tyrkysové než dřívějších #0d9488: odznak je plný a text na
 * něm bílý, a #0d9488 dává s bílou kontrast jen 3,7:1 – na drobné písmo je
 * to podle měření v docs/AUDIT_UI_2026-09.md málo. Tenhle odstín má 5,5:1.
 */
const CLAIM_ACCENT = "#0f766e";

/**
 * Odznak "Reklamace".
 *
 * Reklamace se dřív kreslily úplně jinak než zakázky: čárkovaný rámeček,
 * zelenkavé pozadí, kód tyrkysově místo barvou textu, jiné velikosti písma
 * a v režimech compact a list dokonce dva řádky místo jednoho. Ve smíšeném
 * seznamu se pak sloupce nepotkávaly a každý druhý řádek byl jinak vysoký.
 *
 * Teď má reklamace stejné rozvržení, rámeček i velikosti písma jako zakázka
 * a liší se jen tímhle odznakem. Aby přesto byla poznat na první pohled,
 * je odznak plný (bílá na tyrkysové, ne bledá výplň) a sedí hned za kódem,
 * tedy na začátku řádku, kde oko čte první. Vpravo u ovládacích prvků se
 * ztrácel.
 *
 * Odznak nemění výšku řádku: písmo je stejné jako u data a svislé odsazení
 * 2 px se vejde do minHeight řádku.
 */
export function ClaimBadge({ dense }: Dense) {
  return (
    <span
      style={{
        fontSize: "var(--text-xs)",
        fontWeight: 800,
        lineHeight: 1.2,
        padding: dense ? "2px 5px" : "2px 7px",
        borderRadius: "var(--radius-2xs)",
        background: CLAIM_ACCENT,
        color: "#fff",
        textTransform: "uppercase",
        letterSpacing: "0.5px",
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      Reklamace
    </span>
  );
}
