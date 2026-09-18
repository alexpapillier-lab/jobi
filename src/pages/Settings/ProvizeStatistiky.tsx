import { useMemo, useState } from "react";
import { formatCurrency } from "../../lib/invoiceMath";

/**
 * Přehled provizí: hlavní čísla, provize po měsících a tabulka vyúčtování.
 *
 * Graf je jedna řada (provize v měsíci), proto jedna barva a žádná legenda;
 * hodnoty nese text v běžné barvě písma, ne barva sloupce. Popisek má jen
 * nejvyšší a poslední měsíc, zbytek je v bublině po najetí a v tabulce.
 */

export type StatPolozka = { poradi: number; zaklad: number; provize: number; zapsano_at: string; vyrazeno: boolean; vyuctovani_id: number | null };
export type StatVyuctovani = { id: number; oznaceni: string; pocet: number; soucet_zaklad: number; soucet_provize: number; importovano: boolean; created_at: string; vyplaceno_at: string | null };

const kc = (n: number) => formatCurrency(Number(n) || 0, "CZK");
const kcCele = (n: number) => `${Math.round(Number(n) || 0).toLocaleString("cs-CZ")} Kč`;
const MESICE = ["led", "úno", "bře", "dub", "kvě", "čvn", "čvc", "srp", "zář", "říj", "lis", "pro"];
const VYSKA_GRAFU = 120;
const kratkeDatum = (iso: string) => new Date(iso).toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" });

/** 1 zakázka, 2 zakázky, 5 zakázek. */
function sklonuj(n: number, jedna: string, dve: string, pet: string): string {
  return `${n} ${n === 1 ? jedna : n >= 2 && n <= 4 ? dve : pet}`;
}
const zakazek = (n: number) => sklonuj(n, "zakázka", "zakázky", "zakázek");

type Mesic = { klic: string; popis: string; rok: number; provize: number; zaklad: number; pocet: number };

export function poMesicich(polozky: StatPolozka[], ted: Date, kolik = 12): Mesic[] {
  const mesice: Mesic[] = [];
  for (let i = kolik - 1; i >= 0; i--) {
    const d = new Date(ted.getFullYear(), ted.getMonth() - i, 1);
    mesice.push({ klic: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, popis: MESICE[d.getMonth()], rok: d.getFullYear(), provize: 0, zaklad: 0, pocet: 0 });
  }
  const podleKlice = new Map(mesice.map((m) => [m.klic, m]));
  for (const p of polozky) {
    if (p.vyrazeno) continue;
    const d = new Date(p.zapsano_at);
    const m = podleKlice.get(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    if (!m) continue;
    m.provize += Number(p.provize) || 0;
    m.zaklad += Number(p.zaklad) || 0;
    if (p.poradi === 0) m.pocet += 1;
  }
  return mesice;
}

export function ProvizeStatistiky({
  polozky,
  vyuctovani,
  onVyber,
  onMail,
  posilamMail,
  onVyplaceno,
  onVyplacenoVse,
}: {
  polozky: StatPolozka[];
  vyuctovani: StatVyuctovani[];
  onVyber: (id: number) => void;
  onMail: (id: number) => void;
  posilamMail: number | null;
  onVyplaceno: (id: number, vyplaceno: boolean) => void;
  onVyplacenoVse: () => void;
}) {
  const [najeto, setNajeto] = useState<number | null>(null);
  const [vsechna, setVsechna] = useState(false);
  const ted = useMemo(() => new Date(), []);

  const mesice = useMemo(() => poMesicich(polozky, ted), [polozky, ted]);
  const max = Math.max(1, ...mesice.map((m) => m.provize));
  const iMax = mesice.reduce((nej, m, i) => (m.provize > mesice[nej].provize ? i : nej), 0);
  const iPosl = mesice.length - 1;

  const platne = polozky.filter((p) => !p.vyrazeno);
  const letos = platne.filter((p) => new Date(p.zapsano_at).getFullYear() === ted.getFullYear());
  const provizeLetos = letos.reduce((s, p) => s + Number(p.provize), 0);
  const zakazekLetos = letos.filter((p) => p.poradi === 0).length;
  const mesicuSDaty = new Set(letos.map((p) => new Date(p.zapsano_at).getMonth())).size;
  const celkem = platne.reduce((s, p) => s + Number(p.provize), 0);
  const zakazekCelkem = platne.filter((p) => p.poradi === 0 && Number(p.zaklad) > 0).length;
  const posledni = vyuctovani[0] ?? null;
  const nevyplacena = vyuctovani.filter((v) => !v.vyplaceno_at);
  const cekaNaVyplaceni = nevyplacena.reduce((s, v) => s + Number(v.soucet_provize), 0);

  const border = "1px solid var(--border)";
  const dlazdice: React.CSSProperties = { flex: "1 1 150px", padding: 12, borderRadius: 12, border, background: "var(--panel-2)", minWidth: 0 };
  const popisek: React.CSSProperties = { fontSize: 12, color: "var(--muted)" };
  const cislo: React.CSSProperties = { fontSize: 18, fontWeight: 900, color: "var(--text)", whiteSpace: "nowrap" };
  const th: React.CSSProperties = { padding: "8px 10px", borderBottom: border, fontWeight: 600, whiteSpace: "nowrap", textAlign: "left", color: "var(--muted)", fontSize: 12 };
  const td: React.CSSProperties = { padding: "7px 10px", borderBottom: border, whiteSpace: "nowrap", fontSize: 13 };
  const male: React.CSSProperties = { padding: "3px 9px", borderRadius: 8, border, background: "var(--panel)", color: "var(--text)", fontSize: 12, fontWeight: 600, cursor: "pointer" };

  return (
    <details open style={{ marginBottom: 16 }}>
      <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>Přehled a statistika</summary>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div style={dlazdice}>
          <div style={popisek}>Čeká na vyplacení</div>
          <div style={cislo}>{kcCele(cekaNaVyplaceni)}</div>
          <div style={popisek}>{nevyplacena.length === 0 ? "vše vyplaceno" : `${nevyplacena.length} z ${vyuctovani.length} vyúčtování`}</div>
        </div>
        <div style={dlazdice}>
          <div style={popisek}>Provize letos</div>
          <div style={cislo}>{kcCele(provizeLetos)}</div>
          <div style={popisek}>{zakazek(zakazekLetos)}</div>
        </div>
        <div style={dlazdice}>
          <div style={popisek}>Průměr na měsíc (letos)</div>
          <div style={cislo}>{kcCele(mesicuSDaty ? provizeLetos / mesicuSDaty : 0)}</div>
          <div style={popisek}>{sklonuj(mesicuSDaty, "měsíc", "měsíce", "měsíců")} s provizí</div>
        </div>
        <div style={dlazdice}>
          <div style={popisek}>Průměr na zakázku</div>
          <div style={cislo}>{kc(zakazekCelkem ? celkem / zakazekCelkem : 0)}</div>
          <div style={popisek}>{zakazekCelkem === 1 ? "z 1 zakázky" : `z ${zakazekCelkem} zakázek`} s cenou</div>
        </div>
        <div style={dlazdice}>
          <div style={popisek}>Poslední vyúčtování</div>
          <div style={cislo}>{posledni ? kcCele(posledni.soucet_provize) : "—"}</div>
          <div style={popisek}>{posledni ? `${posledni.oznaceni} · ${zakazek(posledni.pocet)}` : "zatím žádné"}</div>
        </div>
      </div>

      <div style={{ border, borderRadius: 12, padding: "14px 16px 10px", marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 2 }}>Provize po měsících</div>
        <div style={{ ...popisek, marginBottom: 10 }}>Posledních 12 měsíců podle data zápisu zakázky, bez vyřazených řádků.</div>
        <div
          role="img"
          aria-label={`Provize po měsících. Nejvíc ${mesice[iMax].popis} ${mesice[iMax].rok}: ${kcCele(mesice[iMax].provize)}.`}
          style={{ position: "relative", display: "flex", alignItems: "flex-end", gap: 2, height: VYSKA_GRAFU + 18, borderBottom: "1px solid var(--border)" }}
          onMouseLeave={() => setNajeto(null)}
        >
          {mesice.map((m, i) => {
            const h = m.provize > 0 ? Math.max(2, Math.round((m.provize / max) * VYSKA_GRAFU)) : 0;
            const sPopiskem = m.provize > 0 && (i === iMax || i === iPosl);
            return (
              <div
                key={m.klic}
                onMouseEnter={() => setNajeto(i)}
                onFocus={() => setNajeto(i)}
                onBlur={() => setNajeto(null)}
                tabIndex={0}
                aria-label={`${m.popis} ${m.rok}: ${kc(m.provize)}, ${zakazek(m.pocet)}`}
                style={{ flex: 1, minWidth: 0, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", outline: "none", background: najeto === i ? "var(--panel-2)" : "transparent", borderRadius: "6px 6px 0 0" }}
              >
                {sPopiskem && <div style={{ fontSize: 11, color: "var(--text)", fontWeight: 700, marginBottom: 3, whiteSpace: "nowrap" }}>{kcCele(m.provize)}</div>}
                <div style={{ width: "100%", maxWidth: 24, height: h, background: "var(--accent)", opacity: najeto === null || najeto === i ? 1 : 0.55, borderRadius: "4px 4px 0 0", transition: "opacity 120ms ease" }} />
              </div>
            );
          })}
          {najeto !== null && (
            <div
              style={{
                position: "absolute",
                bottom: VYSKA_GRAFU + 22,
                left: `clamp(0px, calc(${((najeto + 0.5) / mesice.length) * 100}% - 80px), calc(100% - 160px))`,
                width: 160,
                padding: "8px 10px",
                borderRadius: 10,
                border,
                background: "var(--panel)",
                boxShadow: "var(--shadow-soft)",
                fontSize: 12,
                color: "var(--text)",
                pointerEvents: "none",
                zIndex: 2,
              }}
            >
              <div style={{ fontWeight: 800, marginBottom: 2 }}>
                {mesice[najeto].popis} {mesice[najeto].rok}
              </div>
              <div>Provize: {kc(mesice[najeto].provize)}</div>
              <div style={{ color: "var(--muted)" }}>Základ: {kc(mesice[najeto].zaklad)}</div>
              <div style={{ color: "var(--muted)" }}>Zakázek: {mesice[najeto].pocet}</div>
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 2, marginTop: 4 }}>
          {mesice.map((m, i) => (
            <div key={m.klic} style={{ flex: 1, minWidth: 0, textAlign: "center", fontSize: 11, color: "var(--muted)" }}>
              {m.popis}
              {(i === 0 || m.klic.endsWith("-01")) && <div style={{ fontSize: 10 }}>{m.rok}</div>}
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Vyúčtování ({vyuctovani.length})</div>
        {nevyplacena.length > 1 && (
          <button type="button" style={male} onClick={onVyplacenoVse}>
            Označit všech {nevyplacena.length} jako vyplacené
          </button>
        )}
      </div>
      {vyuctovani.length === 0 ? (
        <div style={{ ...popisek, marginBottom: 8 }}>Zatím žádné vyúčtování.</div>
      ) : (
        <div style={{ overflowX: "auto", border, borderRadius: 12 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Označení", "Období", "Zakázek", "Základ", "Provize", "Ø na zakázku", "Vyplaceno", ""].map((h) => (
                  <th key={h} style={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(vsechna ? vyuctovani : vyuctovani.slice(0, 8)).map((v, i) => (
                <tr key={v.id}>
                  <td style={{ ...td, fontWeight: 700 }}>
                    {v.oznaceni}
                    {v.importovano && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 500, color: "var(--muted)" }}>z tabulky</span>}
                  </td>
                  <td style={{ ...td, color: "var(--muted)" }}>
                    {/* Seznam je od nejnovějšího: období začíná dnem předchozího (staršího) vyúčtování. */}
                    {vyuctovani[i + 1] ? `${kratkeDatum(vyuctovani[i + 1].created_at)} – ` : "do "}
                    {kratkeDatum(v.created_at)}
                  </td>
                  <td style={td}>{v.pocet}</td>
                  <td style={td}>{kc(v.soucet_zaklad)}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{kc(v.soucet_provize)}</td>
                  <td style={{ ...td, color: "var(--muted)" }}>{kc(v.pocet ? Number(v.soucet_provize) / v.pocet : 0)}</td>
                  <td style={td}>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", color: v.vyplaceno_at ? "var(--text)" : "var(--muted)" }}>
                      <input type="checkbox" checked={!!v.vyplaceno_at} onChange={(e) => onVyplaceno(v.id, e.target.checked)} aria-label={`Vyúčtování ${v.oznaceni} vyplaceno`} />
                      {v.vyplaceno_at ? new Date(v.vyplaceno_at).toLocaleDateString("cs-CZ") : "ne"}
                    </label>
                  </td>
                  <td style={{ ...td, textAlign: "right" }}>
                    <span style={{ display: "inline-flex", gap: 6 }}>
                      <button type="button" style={male} onClick={() => onVyber(v.id)}>
                        Řádky
                      </button>
                      <button type="button" style={male} disabled={posilamMail !== null} onClick={() => onMail(v.id)}>
                        {posilamMail === v.id ? "Posílám…" : "E-mail"}
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!vsechna && vyuctovani.length > 8 && (
        <button type="button" style={{ ...male, marginTop: 8, padding: "6px 12px" }} onClick={() => setVsechna(true)}>
          Zobrazit všech {vyuctovani.length}
        </button>
      )}
    </details>
  );
}
