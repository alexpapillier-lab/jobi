import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { formatCurrency } from "../lib/invoiceMath";
import { GiftIcon } from "../components/icons";
import { Button } from "../components/ui";
import { showToast } from "../components/Toast";
import { useClenoveServisu } from "../hooks/useClenoveServisu";
import { hraniceMesice, klicMesice, nazevMesice, posunKlicMesice, zamestnanecMesice, type ClovekOdmeny } from "../lib/odmeny";

/**
 * Odměny týmu – kdo má za měsíc kolik za nabídnuté opravy.
 *
 * Data dává RPC odmeny_prehled (migrace 20260926190000): řádky za měsíc
 * podle data vydání zakázky, součty na člověka, měsíční řada rok zpět a
 * vyplaceno. Pravidla se nastavují v Nastavení → Tým → Odměny za opravy.
 * Majitel a správce tu můžou u řádku změnit příjemce, řádek vyřadit a
 * zaškrtnout vyplaceno; člen vidí svoje a – při veřejném žebříčku – i
 * kolegy a zaměstnance měsíce.
 */

type Radek = {
  ticketId: string;
  kod: string | null;
  zakaznik: string | null;
  zarizeni: string | null;
  polozkaId: string;
  oprava: string;
  cena: number;
  pravidloId: string;
  pravidlo: string;
  komu: "pridal" | "technik";
  userId: string | null;
  jmeno: string | null;
  castka: number;
  vydanoAt: string;
  vyrazeno: boolean;
  prepsano: boolean;
  poznamka: string | null;
};

type Mesic = { mesic: string; userId: string | null; jmeno: string; pocet: number; castka: number };
type Vyplata = { userId: string; obdobi: string; castka: number; vyplacenoAt: string };

type Prehled = {
  zapnuto: boolean;
  verejny: boolean;
  admin: boolean;
  ja: string | null;
  radky: Radek[];
  lide: ClovekOdmeny[];
  mesice: Mesic[];
  vyplaty: Vyplata[];
};

const kc = (n: number) => formatCurrency(Number(n) || 0, "CZK");
const datum = (iso: string) => new Date(iso).toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" });
const cislo = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

function prevedPrehled(raw: unknown): Prehled {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pole = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
  return {
    zapnuto: o.zapnuto === true,
    verejny: o.verejny !== false,
    admin: o.admin === true,
    ja: typeof o.ja === "string" ? o.ja : null,
    radky: pole(o.radky).map((r) => ({
      ticketId: String(r.ticketId ?? ""),
      kod: typeof r.kod === "string" ? r.kod : null,
      zakaznik: typeof r.zakaznik === "string" ? r.zakaznik : null,
      zarizeni: typeof r.zarizeni === "string" ? r.zarizeni : null,
      polozkaId: String(r.polozkaId ?? ""),
      oprava: String(r.oprava ?? ""),
      cena: cislo(r.cena),
      pravidloId: String(r.pravidloId ?? ""),
      pravidlo: String(r.pravidlo ?? ""),
      komu: r.komu === "technik" ? "technik" : "pridal",
      userId: typeof r.userId === "string" ? r.userId : null,
      jmeno: typeof r.jmeno === "string" ? r.jmeno : null,
      castka: cislo(r.castka),
      vydanoAt: String(r.vydanoAt ?? ""),
      vyrazeno: r.vyrazeno === true,
      prepsano: r.prepsano === true,
      poznamka: typeof r.poznamka === "string" ? r.poznamka : null,
    })),
    lide: pole(o.lide).map((l) => ({ userId: typeof l.userId === "string" ? l.userId : null, jmeno: String(l.jmeno ?? "Kolega"), pocet: cislo(l.pocet), castka: cislo(l.castka) })),
    mesice: pole(o.mesice).map((m) => ({ mesic: String(m.mesic ?? ""), userId: typeof m.userId === "string" ? m.userId : null, jmeno: String(m.jmeno ?? "Kolega"), pocet: cislo(m.pocet), castka: cislo(m.castka) })),
    vyplaty: pole(o.vyplaty).map((v) => ({ userId: String(v.userId ?? ""), obdobi: String(v.obdobi ?? ""), castka: cislo(v.castka), vyplacenoAt: String(v.vyplacenoAt ?? "") })),
  };
}

export function Odmeny({ activeServiceId, onOpenTicket, onOtevritNastaveni }: { activeServiceId: string | null; onOpenTicket?: (ticketId: string) => void; onOtevritNastaveni?: () => void }) {
  const [mesic, setMesic] = useState(() => klicMesice(new Date()));
  const [data, setData] = useState<Prehled | null>(null);
  const [chyba, setChyba] = useState<string | null>(null);
  const [nacitam, setNacitam] = useState(false);
  const [filtrClovek, setFiltrClovek] = useState<string | "vse">("vse");
  const { clenove } = useClenoveServisu(activeServiceId, !!data?.admin);

  const nacti = useCallback(async () => {
    if (!supabase || !activeServiceId) return;
    setNacitam(true);
    setChyba(null);
    const h = hraniceMesice(mesic);
    // deno-lint-ignore no-explicit-any
    const { data: d, error } = await (supabase as any).rpc("odmeny_prehled", {
      p_service_id: activeServiceId,
      p_od: h.od.toISOString(),
      p_do: h.do.toISOString(),
      p_tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Prague",
    });
    setNacitam(false);
    if (error) {
      setChyba(error.message);
      setData(null);
      return;
    }
    setData(prevedPrehled(d));
  }, [activeServiceId, mesic]);

  useEffect(() => {
    setData(null);
    setFiltrClovek("vse");
    void nacti();
  }, [nacti]);

  const tentoMesic = klicMesice(new Date());
  const vitezove = useMemo(() => zamestnanecMesice(data?.lide ?? []), [data]);
  const celkem = useMemo(() => (data?.lide ?? []).reduce((s, l) => s + l.castka, 0), [data]);
  const moje = useMemo(() => (data?.lide ?? []).find((l) => l.userId && l.userId === data?.ja) ?? null, [data]);
  const vyplaceno = useMemo(() => new Map((data?.vyplaty ?? []).filter((v) => v.obdobi === mesic).map((v) => [v.userId, v])), [data, mesic]);
  const zobrazene = useMemo(() => (data?.radky ?? []).filter((r) => filtrClovek === "vse" || (r.userId ?? "") === filtrClovek), [data, filtrClovek]);

  /** Síň slávy: vítěz každého měsíce z posledních 12 (podle dat, která volající smí vidět). */
  const sinSlavy = useMemo(() => {
    const podleMesice = new Map<string, ClovekOdmeny[]>();
    for (const m of data?.mesice ?? []) {
      const l = podleMesice.get(m.mesic) ?? [];
      l.push({ userId: m.userId, jmeno: m.jmeno, pocet: m.pocet, castka: m.castka });
      podleMesice.set(m.mesic, l);
    }
    return [...podleMesice.entries()]
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .map(([klic, lide]) => ({ klic, vitezove: zamestnanecMesice(lide), celkem: lide.reduce((s, l) => s + l.castka, 0) }));
  }, [data]);

  // --- akce správce ---------------------------------------------------------
  const ulozUpravu = useCallback(async (r: Radek, zmena: { userId?: string | null; vyrazeno?: boolean }) => {
    if (!supabase || !activeServiceId || !data?.admin) return;
    const userId = zmena.userId === undefined ? (r.prepsano ? r.userId : null) : zmena.userId;
    const vyrazeno = zmena.vyrazeno ?? r.vyrazeno;
    // deno-lint-ignore no-explicit-any
    const tab = (supabase as any).from("odmeny_upravy");
    const { error } = userId === null && !vyrazeno
      ? await tab.delete().eq("ticket_id", r.ticketId).eq("polozka_id", r.polozkaId)
      : await tab.upsert({ service_id: activeServiceId, ticket_id: r.ticketId, polozka_id: r.polozkaId, user_id: userId, vyrazeno, updated_by: data.ja, updated_at: new Date().toISOString() }, { onConflict: "ticket_id,polozka_id" });
    if (error) { showToast(`Uložení selhalo: ${error.message}`, "error"); return; }
    void nacti();
  }, [activeServiceId, data, nacti]);

  const prepniVyplaceno = useCallback(async (l: ClovekOdmeny) => {
    if (!supabase || !activeServiceId || !data?.admin || !l.userId) return;
    // deno-lint-ignore no-explicit-any
    const tab = (supabase as any).from("odmeny_vyplaty");
    const uz = vyplaceno.get(l.userId);
    const { error } = uz
      ? await tab.delete().eq("service_id", activeServiceId).eq("user_id", l.userId).eq("obdobi", mesic)
      : await tab.upsert({ service_id: activeServiceId, user_id: l.userId, obdobi: mesic, castka: l.castka, created_by: data.ja }, { onConflict: "service_id,user_id,obdobi" });
    if (error) { showToast(`Uložení selhalo: ${error.message}`, "error"); return; }
    void nacti();
  }, [activeServiceId, data, mesic, vyplaceno, nacti]);

  // --- styly ------------------------------------------------------------------
  const border = "1px solid var(--border)";
  const dlazdice: React.CSSProperties = { flex: "1 1 200px", padding: 14, borderRadius: 14, border, background: "var(--panel)", minWidth: 0 };
  const popisek: React.CSSProperties = { fontSize: 12, color: "var(--muted)" };
  const velke: React.CSSProperties = { fontSize: 22, fontWeight: 900, color: "var(--text)", whiteSpace: "nowrap" };
  const th: React.CSSProperties = { padding: "8px 10px", borderBottom: border, fontWeight: 600, whiteSpace: "nowrap", textAlign: "left", color: "var(--muted)", fontSize: 12 };
  const td: React.CSSProperties = { padding: "8px 10px", borderBottom: border, fontSize: 13, whiteSpace: "nowrap" };
  const pole: React.CSSProperties = { padding: "8px 10px", borderRadius: 10, border, background: "var(--panel)", color: "var(--text)", fontSize: 13, fontFamily: "inherit" };

  return (
    <div style={{ display: "grid", gap: 16, padding: "0 0 24px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 950, color: "var(--text)", display: "flex", alignItems: "center", gap: 10 }}>
            <GiftIcon size={22} /> Odměny
          </div>
          <div style={{ ...popisek, marginTop: 4 }}>Prémie za nabídnuté opravy. Počítá se ze zakázek vydaných v měsíci; storno nic nedostane.</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Button size="sm" variant="soft" onClick={() => setMesic((m) => posunKlicMesice(m, -1))} aria-label="Předchozí měsíc">‹</Button>
          <span style={{ fontWeight: 800, minWidth: 130, textAlign: "center" }}>{nazevMesice(mesic)}</span>
          <Button size="sm" variant="soft" onClick={() => setMesic((m) => posunKlicMesice(m, 1))} disabled={mesic >= tentoMesic} aria-label="Další měsíc">›</Button>
          {mesic !== tentoMesic && <Button size="sm" variant="ghost" onClick={() => setMesic(tentoMesic)}>Tento měsíc</Button>}
        </div>
      </div>

      {chyba && <div style={{ padding: 16, borderRadius: 12, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.08)", color: "var(--text)", fontSize: 13 }}>{chyba}</div>}
      {!chyba && nacitam && !data && <div style={popisek}>Načítám…</div>}

      {data && !data.zapnuto && (
        <div style={{ padding: 16, borderRadius: 12, border, background: "var(--panel)", fontSize: 13, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span>Servis zatím nemá žádné pravidlo odměn.</span>
          {data.admin && onOtevritNastaveni && <Button size="sm" variant="primary" onClick={onOtevritNastaveni}>Nastavit pravidla</Button>}
        </div>
      )}

      {data && (
        <>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ ...dlazdice, borderColor: vitezove.length > 0 ? "var(--accent)" : undefined, background: vitezove.length > 0 ? "var(--accent-soft)" : "var(--panel)" }}>
              <div style={popisek}>{vitezove.length > 1 ? "Zaměstnanci měsíce" : "Zaměstnanec měsíce"}</div>
              <div style={velke}>{vitezove.length > 0 ? `🏆 ${vitezove.map((v) => v.jmeno).join(" a ")}` : "—"}</div>
              <div style={popisek}>{vitezove.length > 0 ? `${kc(vitezove[0].castka)} · ${vitezove[0].pocet} ${vitezove[0].pocet === 1 ? "oprava" : vitezove[0].pocet <= 4 ? "opravy" : "oprav"}` : "zatím nikdo nemá odměnu"}</div>
            </div>
            <div style={dlazdice}>
              <div style={popisek}>Celkem odměn za měsíc</div>
              <div style={velke}>{kc(celkem)}</div>
              <div style={popisek}>{(data.lide.filter((l) => l.userId).length)} lidí · {data.radky.filter((r) => !r.vyrazeno).length} oprav</div>
            </div>
            <div style={dlazdice}>
              <div style={popisek}>Moje odměny</div>
              <div style={velke}>{kc(moje?.castka ?? 0)}</div>
              <div style={popisek}>
                {moje ? `${moje.pocet} ${moje.pocet === 1 ? "oprava" : moje.pocet <= 4 ? "opravy" : "oprav"}` : "žádná oprava s odměnou"}
                {moje && data.ja && vyplaceno.get(data.ja) ? ` · vyplaceno ${datum(vyplaceno.get(data.ja)!.vyplacenoAt)}` : ""}
              </div>
            </div>
          </div>

          {(data.admin || data.verejny) && (
            <div style={{ overflowX: "auto", border, borderRadius: 14, background: "var(--panel)" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["#", "Kdo", "Oprav", "Odměna", "Vyplaceno"].map((h) => (
                      <th key={h} style={th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.lide.map((l, i) => {
                    const v = l.userId ? vyplaceno.get(l.userId) : undefined;
                    const vitez = vitezove.some((x) => x.userId === l.userId && !!l.userId);
                    return (
                      <tr key={l.userId ?? "nikdo"} style={{ cursor: "pointer", background: filtrClovek === (l.userId ?? "") ? "var(--accent-soft)" : "transparent" }} onClick={() => setFiltrClovek((f) => (f === (l.userId ?? "") ? "vse" : (l.userId ?? "")))}>
                        <td style={{ ...td, color: "var(--muted)" }}>{i + 1}.</td>
                        <td style={{ ...td, fontWeight: 700 }}>{vitez ? "🏆 " : ""}{l.jmeno}{!l.userId && <span style={{ ...popisek, marginLeft: 6 }}>– nejde určit, komu</span>}</td>
                        <td style={td}>{l.pocet}</td>
                        <td style={{ ...td, fontWeight: 700 }}>{kc(l.castka)}</td>
                        <td style={td} onClick={(e) => e.stopPropagation()}>
                          {data.admin && l.userId ? (
                            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                              <input type="checkbox" checked={!!v} onChange={() => void prepniVyplaceno(l)} />
                              <span style={popisek}>{v ? `${datum(v.vyplacenoAt)} · ${kc(v.castka)}` : "ne"}</span>
                            </label>
                          ) : (
                            <span style={{ color: v ? "var(--text)" : "var(--muted)" }}>{v ? datum(v.vyplacenoAt) : "ne"}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {data.lide.length === 0 && (
                    <tr><td colSpan={5} style={{ padding: 16, textAlign: "center", color: "var(--muted)" }}>V tomto měsíci zatím žádná odměna.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select value={filtrClovek} onChange={(e) => setFiltrClovek(e.target.value)} style={pole} aria-label="Filtr podle člověka">
              <option value="vse">Všichni ({data.radky.length})</option>
              {data.lide.map((l) => (
                <option key={l.userId ?? "nikdo"} value={l.userId ?? ""}>{l.jmeno} ({l.pocet})</option>
              ))}
            </select>
            <Button size="sm" variant="soft" onClick={() => void nacti()} disabled={nacitam}>{nacitam ? "Načítám…" : "Obnovit"}</Button>
            {data.admin && onOtevritNastaveni && <Button size="sm" variant="ghost" onClick={onOtevritNastaveni}>Pravidla</Button>}
          </div>

          <div style={{ overflowX: "auto", border, borderRadius: 14, background: "var(--panel)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Zakázka", "Vydáno", "Oprava", "Cena", "Pravidlo", "Komu", "Odměna", ...(data.admin ? [""] : [])].map((h, i) => (
                    <th key={`${h}-${i}`} style={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {zobrazene.map((r) => (
                  <tr key={`${r.ticketId}-${r.polozkaId}`} style={{ opacity: r.vyrazeno ? 0.5 : 1 }}>
                    <td style={{ ...td, fontWeight: 700 }}>
                      {onOpenTicket ? (
                        <button type="button" onClick={() => onOpenTicket(r.ticketId)} style={{ background: "transparent", border: "none", padding: 0, color: "var(--accent)", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}>{r.kod ?? "—"}</button>
                      ) : (r.kod ?? "—")}
                      <div style={{ ...popisek, fontWeight: 500, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>{[r.zakaznik, r.zarizeni].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td style={{ ...td, color: "var(--muted)" }}>{r.vydanoAt ? datum(r.vydanoAt) : "—"}</td>
                    <td style={{ ...td, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }} title={r.oprava}>{r.oprava}</td>
                    <td style={{ ...td, color: "var(--muted)" }}>{kc(r.cena)}</td>
                    <td style={{ ...td, color: "var(--muted)" }}>{r.pravidlo}</td>
                    <td style={td}>
                      {data.admin ? (
                        <select value={r.userId ?? ""} onChange={(e) => void ulozUpravu(r, { userId: e.target.value || null })} style={{ ...pole, padding: "4px 8px" }} aria-label="Komu se odměna připíše" title={r.prepsano ? "Ručně změněno" : r.komu === "technik" ? "Přidělený technik" : "Kdo opravu přidal"}>
                          <option value="">— nepřiřazeno —</option>
                          {clenove.map((c) => (
                            <option key={c.userId} value={c.userId}>{c.jmeno}</option>
                          ))}
                          {r.userId && !clenove.some((c) => c.userId === r.userId) && <option value={r.userId}>{r.jmeno ?? "Bývalý člen"}</option>}
                        </select>
                      ) : (
                        r.jmeno ?? "—"
                      )}
                      {r.prepsano && <span style={{ ...popisek, marginLeft: 6 }} title="Příjemce ručně změněn">✎</span>}
                    </td>
                    <td style={{ ...td, fontWeight: 700, textDecoration: r.vyrazeno ? "line-through" : undefined }}>{kc(r.castka)}</td>
                    {data.admin && (
                      <td style={td}>
                        <Button size="sm" variant="ghost" onClick={() => void ulozUpravu(r, { vyrazeno: !r.vyrazeno })}>{r.vyrazeno ? "Vrátit" : "Vyřadit"}</Button>
                      </td>
                    )}
                  </tr>
                ))}
                {zobrazene.length === 0 && (
                  <tr><td colSpan={data.admin ? 8 : 7} style={{ padding: 16, textAlign: "center", color: "var(--muted)" }}>Žádné opravy s odměnou.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {sinSlavy.length > 0 && (data.admin || data.verejny) && (
            <div>
              <div style={{ fontWeight: 800, marginBottom: 8 }}>Síň slávy</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {sinSlavy.map((m) => (
                  <button key={m.klic} type="button" onClick={() => setMesic(m.klic)} style={{ ...pole, cursor: "pointer", textAlign: "left", minWidth: 150, borderColor: m.klic === mesic ? "var(--accent)" : "var(--border)" }}>
                    <div style={popisek}>{nazevMesice(m.klic)}</div>
                    <div style={{ fontWeight: 800 }}>{m.vitezove.length > 0 ? `🏆 ${m.vitezove.map((v) => v.jmeno).join(", ")}` : "—"}</div>
                    <div style={popisek}>{m.vitezove.length > 0 ? kc(m.vitezove[0].castka) : "bez odměn"} · celkem {kc(m.celkem)}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
