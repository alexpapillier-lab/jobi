import { useMemo, useState, type CSSProperties } from "react";
import { Button, Segmented } from "../../components/ui";
import { celeCislo, zakazky } from "./format";
import {
  DNY_DLOUZE,
  DNY_KRATCE,
  NEUVEDENO,
  podleZpusobu,
  popisHodiny,
  rozlozeniHodin,
  rozsahHodin,
  shrnutiHodin,
  zpusobyPredani,
  type Udalost,
  type ZakazkaProHodiny,
} from "./hodiny";

/**
 * Heatmapa den v týdnu × hodina: kdy lidé nosí zařízení a kdy si je berou.
 *
 * Jedna barva (akcent servisu) od světlé po tmavou – jde o množství, ne
 * o rozlišení kategorií. Číslo v buňce je jen tam, kde je co číst; zbytek
 * říká barva a titulek. Tabulka pod grafem je pro ty, kdo barvy nerozliší,
 * a pro kopírování do mailu.
 */
export function HodinyChart({
  prijate,
  vydane,
  jeStorno,
}: {
  /** Zakázky přijaté v období. */
  prijate: ZakazkaProHodiny[];
  /** Zakázky vydané v období. */
  vydane: ZakazkaProHodiny[];
  jeStorno: (status: string) => boolean;
}) {
  const [udalost, setUdalost] = useState<Udalost>("prijem");
  /* Způsob převzetí / předání: „Osobně“ ukáže, kdy lidé chodí na pobočku,
     „Poštou“ kdy přijíždí kurýr. Null = vše. */
  const [zpusob, setZpusob] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [hover, setHover] = useState<{ den: number; hodina: number } | null>(null);

  const zdroj = udalost === "prijem" ? prijate : vydane;
  const zpusoby = useMemo(() => zpusobyPredani(zdroj, udalost), [zdroj, udalost]);
  // Po přepnutí události nemusí vybraný způsob existovat – pak zpátky na vše.
  const zpusobPlatny = zpusob !== null && zpusoby.some((z) => z.zpusob === zpusob) ? zpusob : null;

  const r = useMemo(
    () => rozlozeniHodin(podleZpusobu(zdroj, udalost, zpusobPlatny), udalost, { jeStorno }),
    [zdroj, udalost, zpusobPlatny, jeStorno],
  );
  const { od, do: doH } = rozsahHodin(r);
  const hodiny = Array.from({ length: doH - od + 1 }, (_, i) => od + i);
  const max = Math.max(1, ...r.matice.flat());
  const shrnuti = shrnutiHodin(r, udalost);
  const slovo = udalost === "prijem" ? "příjmů" : "výdejů";

  const ovladani = (
    <>
      <Prepinac udalost={udalost} onChange={setUdalost} />
      {zpusoby.length > 1 && (
        <VyberZpusobu udalost={udalost} zpusoby={zpusoby} vybrany={zpusobPlatny} onChange={setZpusob} />
      )}
    </>
  );

  if (r.celkem === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>{ovladani}</div>
        <div style={{ color: "var(--muted)", fontSize: "var(--text-base)" }}>
          {udalost === "prijem" ? "V období nebyla přijata žádná zakázka." : "V období nebyla vydána žádná zakázka."}
        </div>
      </div>
    );
  }

  /* Pět stupňů jedné barvy. Prázdná buňka je jen rám; plná sytost patří
     špičce, ať je na první pohled vidět, kam se provoz soustředí. */
  const barva = (n: number): string => {
    if (n === 0) return "transparent";
    const podil = n / max;
    const pct = podil >= 0.8 ? 100 : podil >= 0.6 ? 78 : podil >= 0.4 ? 56 : podil >= 0.2 ? 36 : 18;
    return `color-mix(in srgb, var(--accent) ${pct}%, var(--panel))`;
  };
  const inkoust = (n: number): string => (n / max >= 0.6 ? "var(--accent-contrast, #fff)" : "var(--text)");

  const hovered = hover ? r.matice[hover.den][hover.hodina] : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
        {ovladani}
        <span style={{ fontSize: "var(--text-sm)", color: "var(--muted)" }}>
          {zakazky(r.celkem)}{zpusobPlatny ? ` z ${celeCislo(zdroj.length)}` : ""} · čas servisu (Praha)
        </span>
        <span style={{ marginLeft: "auto" }}>
          <Button variant="ghost" size="sm" onClick={() => setShowTable((v) => !v)} aria-expanded={showTable}>
            {showTable ? "Skrýt tabulku" : "Zobrazit tabulku"}
          </Button>
        </span>
      </div>

      {shrnuti && <div style={{ fontSize: "var(--text-base)", color: "var(--text)" }}>{shrnuti}</div>}

      <div style={{ overflowX: "auto" }}>
        <div
          role="img"
          aria-label={`Rozložení ${slovo} podle dne v týdnu a hodiny`}
          style={{
            display: "grid",
            gridTemplateColumns: `36px repeat(${hodiny.length}, minmax(28px, 1fr)) 48px`,
            gap: 2,
            minWidth: 36 + hodiny.length * 30 + 48,
            fontVariantNumeric: "tabular-nums",
            fontSize: "var(--text-xs)",
          }}
          onMouseLeave={() => setHover(null)}
        >
          <div />
          {hodiny.map((h) => (
            <div key={`h${h}`} style={{ textAlign: "center", color: "var(--muted)", padding: "2px 0" }}>{h}</div>
          ))}
          <div style={{ textAlign: "right", color: "var(--muted)", padding: "2px 4px" }}>celkem</div>

          {r.matice.map((den, d) => (
            <RadekDne key={d} d={d} den={den} hodiny={hodiny} barva={barva} inkoust={inkoust} max={max} hover={hover} setHover={setHover} celkemDne={r.podleDne[d]} celkem={r.celkem} slovo={slovo} />
          ))}

          <div style={{ textAlign: "right", color: "var(--muted)", padding: "4px 4px 0 0" }}>Σ</div>
          {hodiny.map((h) => (
            <div key={`s${h}`} style={{ textAlign: "center", color: "var(--muted)", padding: "4px 0 0" }}>
              {r.podleHodiny[h] > 0 ? celeCislo(r.podleHodiny[h]) : ""}
            </div>
          ))}
          <div style={{ textAlign: "right", color: "var(--text)", fontWeight: 700, padding: "4px 4px 0 0" }}>{celeCislo(r.celkem)}</div>
        </div>
      </div>

      <div aria-live="polite" style={{ minHeight: "1.4em", fontSize: "var(--text-sm)", color: "var(--muted)" }}>
        {hover
          ? `${DNY_DLOUZE[hover.den][0].toUpperCase()}${DNY_DLOUZE[hover.den].slice(1)} ${popisHodiny(hover.hodina)}: ${zakazky(hovered)}` +
            (hovered > 0 ? ` (${Math.round((hovered / r.celkem) * 100)} % ${slovo})` : "")
          : "Najeďte na buňku pro podrobnosti."}
      </div>

      {showTable && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: "var(--text-sm)", fontVariantNumeric: "tabular-nums" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                <th style={th("left")}>Hodina</th>
                {DNY_KRATCE.map((dn) => <th key={dn} style={th("right")}>{dn}</th>)}
                <th style={th("right")}>Celkem</th>
              </tr>
            </thead>
            <tbody>
              {hodiny.map((h) => (
                <tr key={h} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ ...td, textAlign: "left" }}>{popisHodiny(h)}</td>
                  {r.matice.map((den, d) => (
                    <td key={d} style={{ ...td, textAlign: "right", color: den[h] === 0 ? "var(--muted)" : "var(--text)" }}>{den[h] === 0 ? "–" : celeCislo(den[h])}</td>
                  ))}
                  <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{celeCislo(r.podleHodiny[h])}</td>
                </tr>
              ))}
              <tr>
                <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>Celkem</td>
                {r.podleDne.map((n, d) => <td key={d} style={{ ...td, textAlign: "right", fontWeight: 700 }}>{celeCislo(n)}</td>)}
                <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{celeCislo(r.celkem)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Prepinac({ udalost, onChange }: { udalost: Udalost; onChange: (u: Udalost) => void }) {
  return (
    <Segmented<Udalost>
      ariaLabel="Událost"
      size="sm"
      value={udalost}
      onChange={onChange}
      options={[
        { value: "prijem", label: "Příjem", title: "Kdy lidé zakázky přinášejí (založení zakázky)" },
        { value: "vydej", label: "Výdej", title: "Kdy si je berou (přepnutí do koncového stavu)" },
      ]}
    />
  );
}

/**
 * Filtr způsobu převzetí / předání. Do čtyř hodnot přepínač vedle
 * události, víc hodnot (servis píše vlastní texty) už je na roletku.
 */
function VyberZpusobu({
  udalost,
  zpusoby,
  vybrany,
  onChange,
}: {
  udalost: Udalost;
  zpusoby: Array<{ zpusob: string; pocet: number }>;
  vybrany: string | null;
  onChange: (z: string | null) => void;
}) {
  const popisek = udalost === "prijem" ? "Způsob převzetí" : "Způsob předání";
  const nazev = (z: string) => (z === NEUVEDENO ? "Neuvedeno" : z);
  const VSE = "\u0000vse";
  if (zpusoby.length <= 4) {
    return (
      <Segmented<string>
        ariaLabel={popisek}
        size="sm"
        value={vybrany ?? VSE}
        onChange={(v) => onChange(v === VSE ? null : v)}
        options={[
          { value: VSE, label: "Vše" },
          ...zpusoby.map((z) => ({ value: z.zpusob, label: nazev(z.zpusob), title: `${nazev(z.zpusob)}: ${zakazky(z.pocet)}` })),
        ]}
      />
    );
  }
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)", fontSize: "var(--text-sm)", color: "var(--muted)" }}>
      {popisek}
      <select
        value={vybrany ?? VSE}
        onChange={(e) => onChange(e.target.value === VSE ? null : e.target.value)}
        style={{
          padding: "6px 10px", borderRadius: "var(--radius-xs)", border: "1px solid var(--border)",
          background: "var(--panel)", color: "var(--text)", font: "inherit",
        }}
      >
        <option value={VSE}>Vše</option>
        {zpusoby.map((z) => (
          <option key={z.zpusob} value={z.zpusob}>{nazev(z.zpusob)} ({z.pocet})</option>
        ))}
      </select>
    </label>
  );
}

function RadekDne({
  d, den, hodiny, barva, inkoust, max, hover, setHover, celkemDne, celkem, slovo,
}: {
  d: number;
  den: number[];
  hodiny: number[];
  barva: (n: number) => string;
  inkoust: (n: number) => string;
  max: number;
  hover: { den: number; hodina: number } | null;
  setHover: (h: { den: number; hodina: number } | null) => void;
  celkemDne: number;
  celkem: number;
  slovo: string;
}) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", color: "var(--muted)", fontWeight: 600 }}>{DNY_KRATCE[d]}</div>
      {hodiny.map((h) => {
        const n = den[h];
        const aktivni = hover?.den === d && hover.hodina === h;
        return (
          <div
            key={h}
            title={`${DNY_DLOUZE[d]} ${popisHodiny(h)}: ${zakazky(n)}`}
            onMouseEnter={() => setHover({ den: d, hodina: h })}
            onFocus={() => setHover({ den: d, hodina: h })}
            tabIndex={0}
            style={{
              height: 28,
              borderRadius: 4,
              background: barva(n),
              border: `1px solid ${n === 0 ? "var(--border)" : "transparent"}`,
              outline: aktivni ? "2px solid var(--accent)" : "none",
              outlineOffset: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: inkoust(n),
              fontWeight: n / max >= 0.6 ? 700 : 500,
              cursor: "default",
            }}
          >
            {n > 0 && n / max >= 0.4 ? celeCislo(n) : ""}
          </div>
        );
      })}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 4, color: "var(--text)", fontWeight: 600 }} title={`${DNY_DLOUZE[d]}: ${zakazky(celkemDne)}${celkem > 0 ? ` (${Math.round((celkemDne / celkem) * 100)} % ${slovo})` : ""}`}>
        {celkemDne > 0 ? celeCislo(celkemDne) : ""}
      </div>
    </>
  );
}

function th(align: "left" | "right"): CSSProperties {
  return { padding: "var(--space-1) var(--space-2)", textAlign: align, color: "var(--muted)", fontWeight: 600, whiteSpace: "nowrap" };
}

const td: CSSProperties = { padding: "var(--space-1) var(--space-2)", whiteSpace: "nowrap" };
