import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { formatCurrency } from "../lib/invoiceMath";
import { CoinsIcon } from "../components/icons";

/**
 * Provize sdílené majitelem aplikace s tímhle účtem – jen pro čtení.
 *
 * Data dává RPC provize_moje: řádky spočítané v Jobi (bez historie
 * z Google tabulky a bez vyřazených) a vyúčtování z nich. Bez nastavení,
 * sazby a bez možnosti cokoli měnit – to má jen majitel v Owner → Provize.
 */

type Polozka = {
  id: number;
  kod: string;
  poradi: number;
  zaklad: number;
  provize: number;
  zapsano_at: string;
  vyuctovani_id: number | null;
  ticket_id: string | null;
  zarizeni: string | null;
  zakaznik: string | null;
  stav: string | null;
};

type Vyuctovani = {
  id: number;
  oznaceni: string;
  pocet: number;
  soucet_zaklad: number;
  soucet_provize: number;
  created_at: string;
  vyplaceno_at: string | null;
};

const kc = (n: number) => formatCurrency(Number(n) || 0, "CZK");
const datum = (iso: string) => new Date(iso).toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" });

export function ProvizeSdilene({ activeServiceId, onOpenTicket }: { activeServiceId: string | null; onOpenTicket?: (ticketId: string) => void }) {
  const [data, setData] = useState<{ polozky: Polozka[]; vyuctovani: Vyuctovani[] } | null>(null);
  const [chyba, setChyba] = useState<string | null>(null);
  const [nacitam, setNacitam] = useState(false);
  const [filtr, setFiltr] = useState<"nevyuctovane" | number>("nevyuctovane");

  const nacti = useCallback(async () => {
    if (!supabase || !activeServiceId) return;
    setNacitam(true);
    setChyba(null);
    // deno-lint-ignore no-explicit-any
    const { data: d, error } = await (supabase as any).rpc("provize_moje", { p_service_id: activeServiceId });
    setNacitam(false);
    if (error) {
      setChyba(error.message);
      setData(null);
      return;
    }
    setData(d as { polozky: Polozka[]; vyuctovani: Vyuctovani[] });
  }, [activeServiceId]);

  useEffect(() => {
    setData(null);
    setFiltr("nevyuctovane");
    void nacti();
  }, [nacti]);

  const nevyuctovane = useMemo(() => (data?.polozky ?? []).filter((p) => p.vyuctovani_id === null), [data]);
  const soucet = nevyuctovane.reduce((s, p) => s + Number(p.provize), 0);
  const soucetZaklad = nevyuctovane.reduce((s, p) => s + Number(p.zaklad), 0);
  const cekaNaVyplaceni = (data?.vyuctovani ?? []).filter((v) => !v.vyplaceno_at).reduce((s, v) => s + Number(v.soucet_provize), 0);
  const oznaceni = useMemo(() => new Map((data?.vyuctovani ?? []).map((v) => [v.id, v.oznaceni])), [data]);
  const zobrazene = useMemo(
    () => (data?.polozky ?? []).filter((p) => (filtr === "nevyuctovane" ? p.vyuctovani_id === null : p.vyuctovani_id === filtr)),
    [data, filtr]
  );

  const border = "1px solid var(--border)";
  const dlazdice: React.CSSProperties = { flex: "1 1 180px", padding: 14, borderRadius: 14, border, background: "var(--panel)", minWidth: 0 };
  const popisek: React.CSSProperties = { fontSize: 12, color: "var(--muted)" };
  const cislo: React.CSSProperties = { fontSize: 22, fontWeight: 900, color: "var(--text)", whiteSpace: "nowrap" };
  const th: React.CSSProperties = { padding: "8px 10px", borderBottom: border, fontWeight: 600, whiteSpace: "nowrap", textAlign: "left", color: "var(--muted)", fontSize: 12 };
  const td: React.CSSProperties = { padding: "8px 10px", borderBottom: border, fontSize: 13, whiteSpace: "nowrap" };
  const pole: React.CSSProperties = { padding: "8px 10px", borderRadius: 10, border, background: "var(--panel)", color: "var(--text)", fontSize: 13 };

  return (
    <div style={{ display: "grid", gap: 16, padding: "0 0 24px" }}>
      <div>
        <div style={{ fontSize: 22, fontWeight: 950, color: "var(--text)", display: "flex", alignItems: "center", gap: 10 }}>
          <CoinsIcon size={22} /> Provize
        </div>
        <div style={{ ...popisek, marginTop: 4 }}>Sdílené majitelem aplikace, jen pro čtení. Zakázky spočítané v Jobi.</div>
      </div>

      {chyba && <div style={{ padding: 16, borderRadius: 12, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.08)", color: "var(--text)", fontSize: 13 }}>{chyba}</div>}
      {!chyba && nacitam && !data && <div style={popisek}>Načítám…</div>}

      {data && (
        <>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={dlazdice}>
              <div style={popisek}>Zatím nevyúčtováno</div>
              <div style={cislo}>{kc(soucet)}</div>
              <div style={popisek}>
                {nevyuctovane.length} {nevyuctovane.length === 1 ? "zakázka" : nevyuctovane.length >= 2 && nevyuctovane.length <= 4 ? "zakázky" : "zakázek"} · základ {kc(soucetZaklad)}
              </div>
            </div>
            <div style={dlazdice}>
              <div style={popisek}>Vyúčtováno, čeká na vyplacení</div>
              <div style={cislo}>{kc(cekaNaVyplaceni)}</div>
              <div style={popisek}>{data.vyuctovani.filter((v) => !v.vyplaceno_at).length} vyúčtování</div>
            </div>
          </div>

          {data.vyuctovani.length > 0 && (
            <div style={{ overflowX: "auto", border, borderRadius: 14, background: "var(--panel)" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Vyúčtování", "Datum", "Zakázek", "Základ", "Provize", "Vyplaceno"].map((h) => (
                      <th key={h} style={th}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.vyuctovani.map((v) => (
                    <tr key={v.id} style={{ cursor: "pointer", background: filtr === v.id ? "var(--accent-soft)" : "transparent" }} onClick={() => setFiltr(filtr === v.id ? "nevyuctovane" : v.id)}>
                      <td style={{ ...td, fontWeight: 700 }}>{v.oznaceni}</td>
                      <td style={{ ...td, color: "var(--muted)" }}>{datum(v.created_at)}</td>
                      <td style={td}>{v.pocet}</td>
                      <td style={td}>{kc(v.soucet_zaklad)}</td>
                      <td style={{ ...td, fontWeight: 700 }}>{kc(v.soucet_provize)}</td>
                      <td style={{ ...td, color: v.vyplaceno_at ? "var(--text)" : "var(--muted)" }}>{v.vyplaceno_at ? datum(v.vyplaceno_at) : "ne"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select value={String(filtr)} onChange={(e) => setFiltr(e.target.value === "nevyuctovane" ? "nevyuctovane" : Number(e.target.value))} style={pole}>
              <option value="nevyuctovane">Nevyúčtované ({nevyuctovane.length})</option>
              {data.vyuctovani.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.oznaceni} · {v.pocet} zakázek
                </option>
              ))}
            </select>
            <button type="button" onClick={() => void nacti()} disabled={nacitam} style={{ ...pole, cursor: "pointer", fontWeight: 600 }}>
              {nacitam ? "Načítám…" : "Obnovit"}
            </button>
          </div>

          <div style={{ overflowX: "auto", border, borderRadius: 14, background: "var(--panel)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Zakázka", "Zařízení", "Zákazník", "Stav", "Základ", "Provize", "Zapsáno"].map((h) => (
                    <th key={h} style={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {zobrazene.map((p) => (
                  <tr key={p.id}>
                    <td style={{ ...td, fontWeight: 700 }}>
                      {onOpenTicket && p.ticket_id ? (
                        <button type="button" onClick={() => onOpenTicket(p.ticket_id!)} style={{ background: "transparent", border: "none", padding: 0, color: "var(--accent)", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}>
                          {p.kod}
                        </button>
                      ) : (
                        p.kod
                      )}
                      {p.poradi > 0 && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 600, color: "var(--accent)" }}>doplatek</span>}
                    </td>
                    <td style={{ ...td, color: "var(--muted)", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }} title={p.zarizeni ?? undefined}>{p.zarizeni ?? "—"}</td>
                    <td style={{ ...td, color: "var(--muted)", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}>{p.zakaznik ?? "—"}</td>
                    <td style={{ ...td, color: "var(--muted)" }}>{p.stav ?? "—"}</td>
                    <td style={td}>{kc(p.zaklad)}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{kc(p.provize)}</td>
                    <td style={{ ...td, color: "var(--muted)" }}>{datum(p.zapsano_at)}</td>
                  </tr>
                ))}
                {zobrazene.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ padding: 16, textAlign: "center", color: "var(--muted)" }}>
                      {filtr === "nevyuctovane" ? "Nic nevyúčtovaného." : `Vyúčtování ${oznaceni.get(filtr as number) ?? ""} nemá žádné řádky.`}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
