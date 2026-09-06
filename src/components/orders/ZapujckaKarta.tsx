import { useState } from "react";
import { Button } from "../ui";
import { formatCurrency } from "../../lib/invoiceMath";
import { dnesDatum, type NahradniZarizeni, type ZapujckaData } from "../../lib/zapujcka";

/**
 * Karta „Náhradní zařízení“ v detailu zakázky.
 *
 * Bez půjčky jedno tlačítko; po vyplnění souhrn, tisk smlouvy a „Vráceno“.
 * Ukládá se hned (rodič) – smlouva se tiskne vzápětí po vyplnění.
 */
export function ZapujckaKarta({
  zapujcka,
  onChange,
  onTisk,
  katalog = [],
  pujcenaJinde = {},
}: {
  zapujcka: ZapujckaData | undefined;
  onChange: (zapujcka: ZapujckaData | null) => void;
  onTisk: () => void;
  /** Náhradní zařízení servisu ze Nastavení – vyplní formulář jedním výběrem. */
  katalog?: NahradniZarizeni[];
  /** id položky katalogu → kód zakázky, u které je zařízení právě půjčené. */
  pujcenaJinde?: Record<string, string>;
}) {
  const [upravuji, setUpravuji] = useState(false);
  const [navrh, setNavrh] = useState<ZapujckaData>(() => zapujcka ?? { nazev: "", pujceno: dnesDatum() });

  const zacitUpravu = () => {
    setNavrh(zapujcka ?? { nazev: "", pujceno: dnesDatum() });
    setUpravuji(true);
  };

  const input: React.CSSProperties = { padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: 13, fontFamily: "inherit", width: "100%", boxSizing: "border-box" };
  const stitek: React.CSSProperties = { display: "grid", gap: 4, fontSize: 12, color: "var(--muted)" };

  if (upravuji) {
    const platne = navrh.nazev.trim() !== "" && !!navrh.pujceno && (!navrh.vraceno || navrh.vraceno >= navrh.pujceno);
    return (
      <div style={{ display: "grid", gap: 8 }}>
        {katalog.length > 0 && (
          <label style={stitek}>
            Vybrat ze seznamu servisu
            <select
              value={navrh.katalogId ?? ""}
              onChange={(e) => {
                const z = katalog.find((k) => k.id === e.target.value);
                if (!z) {
                  setNavrh({ ...navrh, katalogId: undefined });
                  return;
                }
                setNavrh({ ...navrh, katalogId: z.id, nazev: z.nazev, seriove: z.seriove ?? "", prislusenstvi: z.prislusenstvi ?? "", kauce: z.kauce });
              }}
              style={input}
            >
              <option value="">– vyplnit ručně –</option>
              {katalog.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.nazev}{k.seriove ? ` · ${k.seriove}` : ""}{pujcenaJinde[k.id] ? ` (půjčeno – ${pujcenaJinde[k.id]})` : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))", gap: 8 }}>
          <label style={stitek}>
            Zařízení
            <input type="text" value={navrh.nazev} onChange={(e) => setNavrh({ ...navrh, nazev: e.target.value })} placeholder="např. iPhone SE 2020, černý" style={input} autoFocus={katalog.length === 0} />
          </label>
          <label style={stitek}>
            Sériové číslo / IMEI
            <input type="text" value={navrh.seriove ?? ""} onChange={(e) => setNavrh({ ...navrh, seriove: e.target.value })} style={input} />
          </label>
          <label style={stitek}>
            Příslušenství
            <input type="text" value={navrh.prislusenstvi ?? ""} onChange={(e) => setNavrh({ ...navrh, prislusenstvi: e.target.value })} placeholder="nabíječka, kryt…" style={input} />
          </label>
          <label style={stitek}>
            Kauce (Kč)
            <input type="number" min={0} step={100} value={navrh.kauce ?? ""} onChange={(e) => setNavrh({ ...navrh, kauce: e.target.value === "" ? undefined : Number(e.target.value) })} placeholder="0 = bez kauce" style={input} />
          </label>
          <label style={stitek}>
            Půjčeno dne
            <input type="date" value={navrh.pujceno} onChange={(e) => setNavrh({ ...navrh, pujceno: e.target.value })} style={input} />
          </label>
          <label style={stitek}>
            Vráceno dne
            <input type="date" value={navrh.vraceno ?? ""} onChange={(e) => setNavrh({ ...navrh, vraceno: e.target.value || null })} style={input} />
          </label>
        </div>
        <label style={stitek}>
          Poznámka (stav zařízení při půjčení, dohodnuté podmínky)
          <input type="text" value={navrh.poznamka ?? ""} onChange={(e) => setNavrh({ ...navrh, poznamka: e.target.value })} style={input} />
        </label>
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
          <Button size="sm" variant="ghost" onClick={() => setUpravuji(false)}>Zrušit</Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!platne}
            onClick={() => {
              onChange({
                ...navrh,
                nazev: navrh.nazev.trim(),
                seriove: navrh.seriove?.trim() || undefined,
                prislusenstvi: navrh.prislusenstvi?.trim() || undefined,
                poznamka: navrh.poznamka?.trim() || undefined,
                kauce: navrh.kauce && navrh.kauce > 0 ? navrh.kauce : undefined,
              });
              setUpravuji(false);
            }}
          >
            Uložit půjčení
          </Button>
        </div>
      </div>
    );
  }

  if (!zapujcka) {
    return (
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <Button size="sm" variant="soft" onClick={zacitUpravu}>Půjčit náhradní zařízení</Button>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {katalog.length > 0
            ? `Vyberete ze seznamu servisu (${katalog.length}) nebo vyplníte ručně; vytiskne se smlouva o zápůjčce.`
            : "Zapíše se, co si zákazník odnáší, a vytiskne se smlouva o zápůjčce. Stálý seznam zařízení jde sepsat v Nastavení → Zakázky → Náhradní zařízení."}
        </span>
      </div>
    );
  }

  const vraceno = !!zapujcka.vraceno;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "grid", gap: 2, fontSize: 13 }}>
          <div style={{ fontWeight: 700 }}>
            {zapujcka.nazev}
            {zapujcka.seriove ? <span style={{ color: "var(--muted)", fontWeight: 500 }}> · {zapujcka.seriove}</span> : null}
          </div>
          <div style={{ color: "var(--muted)" }}>
            {zapujcka.prislusenstvi ? `${zapujcka.prislusenstvi} · ` : ""}
            {zapujcka.kauce ? `kauce ${formatCurrency(zapujcka.kauce)}` : "bez kauce"}
            {" · půjčeno "}{new Date(zapujcka.pujceno).toLocaleDateString("cs-CZ")}
            {vraceno ? ` · vráceno ${new Date(zapujcka.vraceno!).toLocaleDateString("cs-CZ")}` : ""}
          </div>
          {zapujcka.poznamka && <div style={{ color: "var(--muted)" }}>{zapujcka.poznamka}</div>}
          <div style={{ marginTop: 4 }}>
            <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: vraceno ? "var(--panel-2)" : "var(--accent-soft)", color: vraceno ? "var(--muted)" : "var(--accent)" }}>
              {vraceno ? "Vráceno" : "U zákazníka"}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Button size="sm" variant="soft" onClick={onTisk}>Smlouva o zápůjčce</Button>
          {!vraceno && (
            <Button size="sm" variant="primary" onClick={() => onChange({ ...zapujcka, vraceno: dnesDatum() })}>Vráceno</Button>
          )}
          <Button size="sm" variant="ghost" onClick={zacitUpravu}>Upravit</Button>
          <Button size="sm" variant="ghost" onClick={() => onChange(null)} title="Odebrat záznam o půjčení">Odebrat</Button>
        </div>
      </div>
    </div>
  );
}
