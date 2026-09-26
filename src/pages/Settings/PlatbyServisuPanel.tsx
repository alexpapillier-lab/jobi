import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { Card } from "../../lib/settingsUi";
import { showToast } from "../../components/Toast";
import { formatCurrency } from "../../lib/invoiceMath";
import { POPIS_STAVU, kPripomenuti, mesicniPrijem, obdobiZData, prevedPlatbu, stavPlatby, type PlatbaServisu, type StavPlatby } from "../../lib/platbyServisu";
import { nazevMesice, posunKlicMesice } from "../../lib/odmeny";

/**
 * Owner → Platby servisů: kolik který servis platí měsíčně, kdy, a jestli
 * za vybraný měsíc zaplatil. Data z RPC platby_prehled, zápis přímo do
 * tabulek platby_nastaveni / platby (RLS jen root owner). Připomínka chodí
 * e-mailem z platby-pripominka a po přihlášení jako upozornění v aplikaci.
 */

const kc = (n: number) => formatCurrency(Number(n) || 0, "CZK");
const datum = (iso: string) => new Date(iso).toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" });

const BARVA: Record<StavPlatby, string> = {
  neaktivni: "var(--muted)",
  zaplaceno: "#15803d",
  ceka: "var(--muted)",
  splatne: "#b45309",
  po_splatnosti: "#b91c1c",
};

export function PlatbyServisuPanel() {
  const [obdobi, setObdobi] = useState(() => obdobiZData(new Date()));
  const [seznam, setSeznam] = useState<PlatbaServisu[] | null>(null);
  const [chyba, setChyba] = useState<string | null>(null);
  const [rozepsane, setRozepsane] = useState<Record<string, { cena: string; den: string }>>({});

  const nacti = useCallback(async () => {
    if (!supabase) return;
    // deno-lint-ignore no-explicit-any
    const { data, error } = await (supabase as any).rpc("platby_prehled", { p_obdobi: obdobi });
    if (error) { setChyba(error.message); setSeznam(null); return; }
    setChyba(null);
    setSeznam(Array.isArray(data) ? data.map(prevedPlatbu) : []);
    setRozepsane({});
  }, [obdobi]);

  useEffect(() => { void nacti(); }, [nacti]);

  const dnes = new Date();
  const tentoMesic = obdobiZData(dnes);
  const prijem = useMemo(() => mesicniPrijem(seznam ?? []), [seznam]);
  const pripomenout = useMemo(() => kPripomenuti(seznam ?? [], dnes), [seznam]); // eslint-disable-line react-hooks/exhaustive-deps
  const zaplacenoCelkem = useMemo(() => (seznam ?? []).reduce((s, p) => s + (p.zaplacenoAt ? Number(p.zaplacenoCastka ?? p.cenaMesicne) || 0 : 0), 0), [seznam]);

  const ulozNastaveni = useCallback(async (p: PlatbaServisu, zmena: Partial<{ cena_mesicne: number; den_platby: number; aktivni: boolean; poznamka: string | null }>) => {
    if (!supabase) return;
    const radek = {
      service_id: p.serviceId,
      cena_mesicne: zmena.cena_mesicne ?? p.cenaMesicne,
      den_platby: zmena.den_platby ?? p.denPlatby,
      aktivni: zmena.aktivni ?? (p.maNastaveni ? p.aktivni : true),
      poznamka: zmena.poznamka === undefined ? p.poznamka : zmena.poznamka,
      updated_at: new Date().toISOString(),
    };
    // deno-lint-ignore no-explicit-any
    const { error } = await (supabase as any).from("platby_nastaveni").upsert(radek, { onConflict: "service_id" });
    if (error) { showToast(`Uložení selhalo: ${error.message}`, "error"); return; }
    void nacti();
  }, [nacti]);

  const prepniZaplaceno = useCallback(async (p: PlatbaServisu) => {
    if (!supabase) return;
    // deno-lint-ignore no-explicit-any
    const tab = (supabase as any).from("platby");
    const { error } = p.zaplacenoAt
      ? await tab.delete().eq("service_id", p.serviceId).eq("obdobi", obdobi)
      : await tab.upsert({ service_id: p.serviceId, obdobi, castka: p.cenaMesicne }, { onConflict: "service_id,obdobi" });
    if (error) { showToast(`Uložení selhalo: ${error.message}`, "error"); return; }
    void nacti();
  }, [obdobi, nacti]);

  const [posilam, setPosilam] = useState(false);
  const zkusebniEmail = useCallback(async () => {
    if (!supabase) return;
    setPosilam(true);
    try {
      const { data, error } = await supabase.functions.invoke("platby-pripominka", { body: { mode: "test" } });
      if (error) throw error;
      const d = data as { error?: string; prijemce?: string };
      if (d?.error) throw new Error(d.error);
      showToast(`Zkušební připomínka odešla na ${d?.prijemce ?? "váš e-mail"}.`, "success");
    } catch (e) {
      showToast(`Odeslání selhalo: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setPosilam(false);
    }
  }, []);

  const border = "1px solid var(--border)";
  const pole: React.CSSProperties = { padding: "6px 8px", borderRadius: 8, border, background: "var(--panel)", color: "var(--text)", fontSize: 13, fontFamily: "inherit", width: 90, textAlign: "right" };
  const th: React.CSSProperties = { padding: "8px 10px", borderBottom: border, fontWeight: 600, whiteSpace: "nowrap", textAlign: "left", color: "var(--muted)", fontSize: 12 };
  const td: React.CSSProperties = { padding: "8px 10px", borderBottom: border, fontSize: 13, whiteSpace: "nowrap" };
  const dlazdice: React.CSSProperties = { flex: "1 1 160px", padding: 12, borderRadius: 12, border, background: "var(--panel)" };
  const tlacitko: React.CSSProperties = { padding: "6px 10px", borderRadius: 8, border, background: "var(--panel)", color: "var(--text)", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" };

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 14 }}>
        <div>
          <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 4, color: "var(--text)" }}>Platby servisů</div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>
            Kolik který servis platí měsíčně a kdy. V den platby (a pak každé 3 dny, dokud není zaplaceno) přijde e-mail a upozornění po přihlášení. Pouze root owner.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <button type="button" style={tlacitko} onClick={() => void zkusebniEmail()} disabled={posilam} title="Pošle připomínku na váš e-mail hned, i když nikdo nedluží">{posilam ? "Posílám…" : "Zkušební e-mail"}</button>
          <button type="button" style={tlacitko} onClick={() => setObdobi((o) => posunKlicMesice(o, -1))} aria-label="Předchozí měsíc">‹</button>
          <span style={{ fontWeight: 800, minWidth: 120, textAlign: "center" }}>{nazevMesice(obdobi)}</span>
          <button type="button" style={tlacitko} onClick={() => setObdobi((o) => posunKlicMesice(o, 1))} disabled={obdobi >= tentoMesic} aria-label="Další měsíc">›</button>
        </div>
      </div>

      {chyba && <div style={{ padding: 12, borderRadius: 10, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.08)", fontSize: 13, marginBottom: 12 }}>{chyba}</div>}

      {seznam && (
        <>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            <div style={dlazdice}>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>Měsíčně celkem</div>
              <div style={{ fontSize: 20, fontWeight: 900 }}>{kc(prijem)}</div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{seznam.filter((p) => p.aktivni && p.aktivniServis).length} platících servisů</div>
            </div>
            <div style={dlazdice}>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>Zaplaceno za {nazevMesice(obdobi)}</div>
              <div style={{ fontSize: 20, fontWeight: 900 }}>{kc(zaplacenoCelkem)}</div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{seznam.filter((p) => p.zaplacenoAt).length} plateb</div>
            </div>
            <div style={{ ...dlazdice, borderColor: pripomenout.length > 0 ? "#b45309" : undefined }}>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>K zaplacení teď</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: pripomenout.length > 0 ? "#b45309" : "var(--text)" }}>{pripomenout.length}</div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{obdobi === tentoMesic ? pripomenout.map((p) => p.nazev).join(", ") || "nikdo nedluží" : "jen pro aktuální měsíc"}</div>
            </div>
          </div>

          <div style={{ overflowX: "auto", border, borderRadius: 12 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>{["Servis", "Platí", "Kč / měsíc", "Den platby", "Stav", "Zaplaceno", "Poslední platba", ""].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {seznam.map((p) => {
                  const stav = stavPlatby(p, dnes);
                  const r = rozepsane[p.serviceId] ?? { cena: String(p.cenaMesicne || ""), den: String(p.denPlatby) };
                  const nastav = (zmena: Partial<{ cena: string; den: string }>) => setRozepsane((x) => ({ ...x, [p.serviceId]: { ...r, ...zmena } }));
                  return (
                    <tr key={p.serviceId} style={{ opacity: p.aktivniServis ? 1 : 0.55 }}>
                      <td style={{ ...td, fontWeight: 700 }}>{p.nazev}{!p.aktivniServis && <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 6 }}>deaktivovaný</span>}</td>
                      <td style={td}><input type="checkbox" checked={p.maNastaveni && p.aktivni} onChange={(e) => void ulozNastaveni(p, { aktivni: e.target.checked })} aria-label={`Servis ${p.nazev} platí`} /></td>
                      <td style={td}>
                        <input inputMode="decimal" value={r.cena} onChange={(e) => nastav({ cena: e.target.value })} onBlur={() => { const n = Number(r.cena.replace(/\s/g, "").replace(",", ".")); if (Number.isFinite(n) && n >= 0 && n !== p.cenaMesicne) void ulozNastaveni(p, { cena_mesicne: n }); }} style={pole} aria-label="Měsíční platba" placeholder="0" />
                      </td>
                      <td style={td}>
                        <input inputMode="numeric" value={r.den} onChange={(e) => nastav({ den: e.target.value })} onBlur={() => { const n = parseInt(r.den, 10); if (Number.isInteger(n) && n >= 1 && n <= 28 && n !== p.denPlatby) void ulozNastaveni(p, { den_platby: n }); }} style={{ ...pole, width: 56 }} aria-label="Den platby v měsíci" />
                        <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: 4 }}>. den</span>
                      </td>
                      <td style={{ ...td, color: BARVA[stav], fontWeight: stav === "splatne" || stav === "po_splatnosti" ? 700 : 500 }}>{POPIS_STAVU[stav]}</td>
                      <td style={td}>
                        {(p.aktivni && p.aktivniServis) || p.zaplacenoAt ? (
                          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                            <input type="checkbox" checked={!!p.zaplacenoAt} onChange={() => void prepniZaplaceno(p)} aria-label={`Zaplaceno ${p.nazev} za ${nazevMesice(obdobi)}`} />
                            <span style={{ fontSize: 12, color: "var(--muted)" }}>{p.zaplacenoAt ? `${datum(p.zaplacenoAt)} · ${kc(p.zaplacenoCastka ?? p.cenaMesicne)}` : "ne"}</span>
                          </label>
                        ) : <span style={{ color: "var(--muted)" }}>—</span>}
                      </td>
                      <td style={{ ...td, color: "var(--muted)" }}>{p.posledniObdobi ? nazevMesice(p.posledniObdobi) : "—"}</td>
                      <td style={td}>
                        <input key={`${p.serviceId}:${p.poznamka ?? ""}`} defaultValue={p.poznamka ?? ""} placeholder="poznámka" onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== (p.poznamka ?? null)) void ulozNastaveni(p, { poznamka: v }); }} style={{ ...pole, width: 160, textAlign: "left" }} aria-label="Poznámka k platbě" />
                      </td>
                    </tr>
                  );
                })}
                {seznam.length === 0 && <tr><td colSpan={8} style={{ padding: 16, textAlign: "center", color: "var(--muted)" }}>Žádné servisy.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
