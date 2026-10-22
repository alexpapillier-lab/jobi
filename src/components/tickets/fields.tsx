import { DeviceIcon, WrenchIcon } from "./icons";
import { formatCZDate } from "./types";
import { textTerminu, type StavTerminu } from "../../lib/terminZakazky";

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

/** Přidělený technik – štítek na kartě; bez technika nic. */
export function TicketTechnik({ name }: { name?: string | null }) {
  if (!name) return null;
  return (
    <span
      title={`Technik: ${name}`}
      style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--accent)", background: "var(--accent-soft)", borderRadius: 999, padding: "1px 8px", whiteSpace: "nowrap", flexShrink: 0 }}
    >
      {name}
    </span>
  );
}

/**
 * Pobočka přijetí zakázky – ukazuje se, když není ta právě vybraná.
 *
 * Barvy jdou z `currentColor` (barva písma řádku), ne z motivu: plně
 * obarvený řádek přepisuje --muted na světlou, ale --panel-2 zůstává
 * světlé pozadí, takže štítek na tmavých stavech zmizel.
 */
export function TicketPobocka({ label }: { label?: string | null }) {
  if (!label) return null;
  return (
    <span
      title={`Přijato na pobočce ${label}`}
      style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--muted)", background: "color-mix(in srgb, currentColor 10%, transparent)", border: "1px solid color-mix(in srgb, currentColor 35%, transparent)", borderRadius: 999, padding: "0 7px", whiteSpace: "nowrap", flexShrink: 0 }}
    >
      {label}
    </span>
  );
}

/** Zakázka je vyfakturovaná – číslo dokladu (i souhrnné faktury za víc zakázek). */
export function TicketFaktura({ cislo }: { cislo?: string | null }) {
  if (!cislo) return null;
  return (
    <span
      title={`Vyfakturováno v ${cislo}`}
      style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--success-text)", background: "color-mix(in srgb, currentColor 10%, transparent)", border: "1px solid color-mix(in srgb, currentColor 35%, transparent)", borderRadius: 999, padding: "0 7px", whiteSpace: "nowrap", flexShrink: 0 }}
    >
      {cislo}
    </span>
  );
}

/**
 * Kde zakázka fyzicky je, když ne na své pobočce (zásilky mezi pobočkami).
 * `varovani` = leží tam moc dlouho bez změny (Nastavení → Přesuny mezi pobočkami).
 */
export function TicketUmisteni({ label, varovani }: { label?: string | null; varovani?: number | null }) {
  if (!label) return null;
  // „Brno → Hlavní pobočka“ (odkud → kam), bez známé odchozí pobočky „→ Hlavní pobočka“.
  const naCeste = label.includes("→");
  const zaklad = naCeste ? `Na cestě: ${label.replace(/^→\s*/, "")}` : `Fyzicky na pobočce ${label}`;
  const barva = varovani ? "var(--danger)" : "var(--warning)";
  return (
    <span
      title={varovani ? `${zaklad} · ${varovani} dní bez změny` : zaklad}
      style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: "inherit", background: `color-mix(in srgb, ${barva} 28%, transparent)`, border: `1px solid ${barva}`, borderRadius: 999, padding: "0 7px", whiteSpace: "nowrap", flexShrink: 0 }}
    >
      {label}{varovani ? ` · ${varovani} d` : ""}
    </span>
  );
}

/**
 * Termín dokončení, když hoří: červeně po termínu, oranžově dnes, jemně
 * když se blíží. Vzhled jako štítek umístění – barva ze stavu termínu,
 * písmo z řádku, aby držel i na plně obarveném stavu.
 */
export function TicketTermin({ stav }: { stav?: StavTerminu | null }) {
  const text = textTerminu(stav ?? null);
  if (!stav || !text) return null;
  const barva = stav.druh === "po" ? "var(--danger)" : stav.druh === "dnes" ? "var(--warning)" : "var(--muted)";
  const datum = new Date(stav.cas).toLocaleString("cs-CZ", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
  return (
    <span
      title={`Předpokládané dokončení ${datum}`}
      style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: "inherit", background: `color-mix(in srgb, ${barva} ${stav.druh === "blizi" ? 14 : 28}%, transparent)`, border: `1px solid ${barva}`, borderRadius: 999, padding: "0 7px", whiteSpace: "nowrap", flexShrink: 0 }}
    >
      {text}
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
 * Štítky řádku: technik, pobočka přijetí, umístění/přesun, faktura, termín. Stejná
 * sada pro všechna zobrazení seznamu – dřív je časová osa a seskupení podle
 * stavu neukazovaly, takže přesuny mezi pobočkami v nich nebyly vidět.
 */
export function TicketStitky({ t }: { t: { technik?: string | null; pobocka?: string | null; umisteni?: string | null; umisteniVaruje?: number | null; faktura?: string | null; termin?: StavTerminu | null } }) {
  if (!t.technik && !t.pobocka && !t.umisteni && !t.faktura && !t.termin) return null;
  return (
    <>
      <TicketTechnik name={t.technik} />
      <TicketPobocka label={t.pobocka} />
      <TicketUmisteni label={t.umisteni} varovani={t.umisteniVaruje} />
      <TicketFaktura cislo={t.faktura} />
      <TicketTermin stav={t.termin} />
    </>
  );
}
