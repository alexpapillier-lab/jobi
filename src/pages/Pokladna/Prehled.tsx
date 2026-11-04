import { useMemo } from "react";
import { poDnech, souhrnPohybu, type PohybPokladny, type Pokladna, type Uzaverka } from "../../lib/pokladna";
import { denNadpis, kc } from "./format";

/**
 * Přehled za období: hlavní čísla, tržba po dnech (sloupce), rozpad po
 * pokladnách a poslední uzávěrky vybrané pokladny.
 */
export function Prehled({ pohyby, pokladny, nazevPobocky, uzaverky, jmeno }: {
  pohyby: PohybPokladny[];
  pokladny: Pokladna[];
  nazevPobocky: (id: string | null) => string | null;
  uzaverky: Uzaverka[];
  jmeno: (userId: string | null) => string | null;
}) {
  const s = useMemo(() => souhrnPohybu(pohyby), [pohyby]);
  const dny = useMemo(() => poDnech(pohyby).reverse(), [pohyby]);
  const max = Math.max(1, ...dny.map((d) => d.trzba));
  const poPokladnach = useMemo(
    () => pokladny
      .map((p) => ({ p, s: souhrnPohybu(pohyby.filter((h) => h.pokladnaId === p.id)) }))
      .filter((x) => x.s.trzbaCelkem !== 0 || x.s.vydaje !== 0),
    [pokladny, pohyby],
  );

  const dlazdice: React.CSSProperties = { flex: "1 1 150px", padding: "14px 16px", borderRadius: 14, border: "1px solid var(--border)", background: "var(--panel)", minWidth: 0 };
  const popisek: React.CSSProperties = { fontSize: 12, color: "var(--muted)", fontWeight: 700 };
  const cislo: React.CSSProperties = { fontSize: 22, fontWeight: 900, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
  const th: React.CSSProperties = { padding: "8px 10px", borderBottom: "1px solid var(--border)", fontSize: 12, color: "var(--muted)", fontWeight: 700, textAlign: "left", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "8px 10px", borderBottom: "1px solid var(--border)", fontSize: 13, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <div style={dlazdice}><div style={popisek}>Tržba</div><div style={cislo}>{kc(s.trzbaCelkem)}</div><div style={popisek}>{s.plateb} {s.plateb === 1 ? "platba" : s.plateb >= 2 && s.plateb <= 4 ? "platby" : "plateb"}</div></div>
        <div style={dlazdice}><div style={popisek}>Hotově</div><div style={cislo}>{kc(s.trzba.cash)}</div></div>
        <div style={dlazdice}><div style={popisek}>Kartou</div><div style={cislo}>{kc(s.trzba.card)}</div>{s.trzba.transfer ? <div style={popisek}>převodem {kc(s.trzba.transfer)}</div> : null}</div>
        <div style={dlazdice}><div style={popisek}>Výdaje</div><div style={cislo}>{kc(s.vydaje)}</div></div>
      </div>

      {dny.length > 1 && (
        <div style={{ padding: 16, borderRadius: 14, border: "1px solid var(--border)", background: "var(--panel)" }}>
          <div style={{ ...popisek, marginBottom: 10 }}>Tržba po dnech</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 120, overflowX: "auto" }}>
            {dny.map((d) => (
              <div key={d.den} title={`${denNadpis(d.den)}: ${kc(d.trzba)} (hotově ${kc(d.hotove)}, kartou ${kc(d.kartou)})`} style={{ flex: "1 0 14px", display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%" }}>
                <div style={{ height: `${Math.max(2, (Math.max(0, d.trzba) / max) * 100)}%`, borderRadius: "6px 6px 2px 2px", background: "var(--accent)", opacity: d.trzba > 0 ? 0.85 : 0.2 }} />
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
            <span>{denNadpis(dny[0].den)}</span>
            <span>{denNadpis(dny[dny.length - 1].den)}</span>
          </div>
        </div>
      )}

      {poPokladnach.length > 1 && (
        <div style={{ borderRadius: 14, border: "1px solid var(--border)", background: "var(--panel)", overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead><tr><th style={th}>Pokladna</th><th style={{ ...th, textAlign: "right" }}>Tržba</th><th style={{ ...th, textAlign: "right" }}>Hotově</th><th style={{ ...th, textAlign: "right" }}>Kartou</th><th style={{ ...th, textAlign: "right" }}>Výdaje</th></tr></thead>
            <tbody>
              {poPokladnach.map(({ p, s: x }) => (
                <tr key={p.id}>
                  <td style={{ ...td, fontWeight: 700 }}>{p.nazev}{nazevPobocky(p.branchId) ? <span style={{ color: "var(--muted)", fontWeight: 500 }}> · {nazevPobocky(p.branchId)}</span> : null}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 800 }}>{kc(x.trzbaCelkem)}</td>
                  <td style={{ ...td, textAlign: "right" }}>{kc(x.trzba.cash)}</td>
                  <td style={{ ...td, textAlign: "right" }}>{kc(x.trzba.card)}</td>
                  <td style={{ ...td, textAlign: "right" }}>{kc(x.vydaje)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: "grid", gap: 6 }}>
        <div style={{ ...popisek, padding: "0 4px" }}>Uzávěrky vybrané pokladny</div>
        {uzaverky.length === 0 ? (
          <div style={{ color: "var(--muted)", fontSize: 13, padding: "0 4px" }}>Zatím žádná uzávěrka.</div>
        ) : (
          <div style={{ borderRadius: 14, border: "1px solid var(--border)", background: "var(--panel)", overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead><tr><th style={th}>Kdy</th><th style={th}>Kdo</th><th style={{ ...th, textAlign: "right" }}>Má být</th><th style={{ ...th, textAlign: "right" }}>Napočítáno</th><th style={{ ...th, textAlign: "right" }}>Rozdíl</th><th style={th}>Poznámka</th></tr></thead>
              <tbody>
                {uzaverky.map((u) => (
                  <tr key={u.id}>
                    <td style={td}>{new Date(u.createdAt).toLocaleString("cs-CZ", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                    <td style={td}>{jmeno(u.createdBy) ?? "—"}</td>
                    <td style={{ ...td, textAlign: "right" }}>{kc(u.ocekavano)}</td>
                    <td style={{ ...td, textAlign: "right" }}>{kc(u.napocitano)}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 800, color: u.rozdil === 0 ? "var(--success-text, var(--text))" : "var(--danger-text, var(--danger))" }}>{u.rozdil > 0 ? "+" : ""}{kc(u.rozdil)}</td>
                    <td style={{ ...td, whiteSpace: "normal", color: "var(--muted)" }}>{u.poznamka ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
