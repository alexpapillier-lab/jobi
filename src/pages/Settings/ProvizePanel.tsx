import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { Card } from "../../lib/settingsUi";
import { showToast } from "../../components/Toast";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { CopyButton } from "../../components/CopyButton";
import { formatCurrency } from "../../lib/invoiceMath";
import { radkyZCsv, type RadekImportuProvizi } from "../../lib/provizeImport";
import { useAuth } from "../../auth/AuthProvider";
import { ProvizeStatistiky } from "./ProvizeStatistiky";

/**
 * Provize majitele aplikace ze zakázek servisu. Jen pro root ownera – data
 * drží tabulky provize_*, které RLS pouští jen jemu (ani vlastník servisu je
 * nevidí), a funkce provize_* si totéž ověřují uvnitř.
 *
 * Nahrazuje Google tabulku: zakázka se zapíše, jakmile je „Připraveno
 * k převzetí“ nebo „Vydáno“, tlačítko Vyúčtovat uzavře nevyúčtované řádky pod
 * označením týdne a zdražení po vyúčtování jde do doplatku.
 */

type Service = { service_id: string; service_name: string };

type Nastaveni = {
  service_id: string;
  zapnuto: boolean;
  sazba: number;
  statusy: string[];
  od: string | null;
  filtr: string | null;
  email: string | null;
  posledni_sync_at: string | null;
};

type Polozka = {
  id: number;
  kod: string;
  poradi: number;
  zaklad: number;
  provize: number;
  status: string | null;
  stav_ted: string | null;
  zarizeni: string | null;
  poznamka: string | null;
  zapsano_at: string;
  vyuctovani_id: number | null;
  vyrazeno: boolean;
  importovano: boolean;
};

type Vyuctovani = {
  id: number;
  oznaceni: string;
  pocet: number;
  soucet_zaklad: number;
  soucet_provize: number;
  importovano: boolean;
  created_at: string;
  vyplaceno_at: string | null;
};

type Prehled = { nastaveni: Nastaveni | null; statusy_servisu: string[]; vyuctovani: Vyuctovani[]; polozky: Polozka[] };

const KLIC_SERVISU = "jobsheet_owner_provize_service";
const kc = (n: number) => formatCurrency(Number(n) || 0, "CZK");
const datum = (iso: string) => new Date(iso).toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" });

export function ProvizePanel({ services }: { services: Service[] }) {
  const [serviceId, setServiceId] = useState<string>(() => {
    try {
      return localStorage.getItem(KLIC_SERVISU) ?? "";
    } catch {
      return "";
    }
  });
  const [data, setData] = useState<Prehled | null>(null);
  const [nacitam, setNacitam] = useState(false);
  const [pracuji, setPracuji] = useState(false);
  const [filtr, setFiltr] = useState<"nevyuctovane" | "vse" | number>("nevyuctovane");
  const [hledat, setHledat] = useState("");
  const [vse, setVse] = useState(false);
  const [oznaceni, setOznaceni] = useState("");
  const [potvrditVyuctovani, setPotvrditVyuctovani] = useState(false);
  const [zrusit, setZrusit] = useState<Vyuctovani | null>(null);
  const [potvrditVyplacenoVse, setPotvrditVyplacenoVse] = useState(false);
  const [importRadky, setImportRadky] = useState<RadekImportuProvizi[] | null>(null);
  const [vysledek, setVysledek] = useState<string | null>(null);
  const [formSazba, setFormSazba] = useState("7,5");
  const [formOd, setFormOd] = useState("");
  const [formFiltr, setFormFiltr] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [posilamMail, setPosilamMail] = useState<number | null>(null);
  const { session } = useAuth();
  const [formStatusy, setFormStatusy] = useState<string[]>([]);
  const souborRef = useRef<HTMLInputElement>(null);
  const seznamRef = useRef<HTMLDivElement>(null);

  // deno-lint-ignore no-explicit-any
  const db = supabase as any;

  const nacti = useCallback(
    async (sid: string, sync: boolean) => {
      if (!db || !sid) return;
      setNacitam(true);
      try {
        if (sync) {
          const { error: eSync } = await db.rpc("provize_synchronizuj", { p_service_id: sid, p_nanecisto: false });
          if (eSync) throw eSync;
        }
        const { data: d, error } = await db.rpc("provize_prehled", { p_service_id: sid });
        if (error) throw error;
        const p = d as Prehled;
        setData(p);
        setFormSazba(String(Math.round((p.nastaveni?.sazba ?? 0.075) * 10000) / 100).replace(".", ","));
        setFormOd(p.nastaveni?.od ?? "");
        setFormFiltr(p.nastaveni?.filtr ?? "");
        setFormEmail(p.nastaveni?.email ?? "");
        setFormStatusy(p.nastaveni?.statusy ?? ["Připraveno k převzetí", "Vydáno"]);
      } catch (e) {
        showToast(`Provize: ${e instanceof Error ? e.message : (e as { message?: string })?.message ?? String(e)}`, "error");
        setData(null);
      } finally {
        setNacitam(false);
      }
    },
    [db]
  );

  useEffect(() => {
    setData(null);
    setVysledek(null);
    setFiltr("nevyuctovane");
    if (!serviceId) return;
    try {
      localStorage.setItem(KLIC_SERVISU, serviceId);
    } catch {
      /* jen pohodlí */
    }
    void nacti(serviceId, true);
  }, [serviceId, nacti]);

  const nevyuctovane = useMemo(() => (data?.polozky ?? []).filter((p) => p.vyuctovani_id === null), [data]);
  const kVyuctovani = useMemo(() => nevyuctovane.filter((p) => !p.vyrazeno), [nevyuctovane]);
  const soucetZaklad = kVyuctovani.reduce((s, p) => s + Number(p.zaklad), 0);
  const soucetProvize = kVyuctovani.reduce((s, p) => s + Number(p.provize), 0);
  const vyuctovanoCelkem = (data?.vyuctovani ?? []).reduce((s, v) => s + Number(v.soucet_provize), 0);
  const oznaceniPodleId = useMemo(() => new Map((data?.vyuctovani ?? []).map((v) => [v.id, v.oznaceni])), [data]);

  const zobrazene = useMemo(() => {
    const q = hledat.trim().toLowerCase();
    return (data?.polozky ?? []).filter((p) => {
      if (filtr === "nevyuctovane" && p.vyuctovani_id !== null) return false;
      if (typeof filtr === "number" && p.vyuctovani_id !== filtr) return false;
      return !q || p.kod.toLowerCase().includes(q);
    });
  }, [data, filtr, hledat]);

  const ulozNastaveni = async (zapnuto: boolean) => {
    if (!db || !serviceId) return;
    const sazba = Number(formSazba.replace(",", ".")) / 100;
    if (!Number.isFinite(sazba) || sazba <= 0 || sazba >= 1) {
      showToast("Sazba musí být mezi 0 a 100 %.", "error");
      return;
    }
    if (formStatusy.length === 0) {
      showToast("Vyber aspoň jeden sledovaný status.", "error");
      return;
    }
    setPracuji(true);
    const { error } = await db
      .from("provize_nastaveni")
      .upsert({ service_id: serviceId, zapnuto, sazba, statusy: formStatusy, od: formOd || null, filtr: formFiltr.trim() || null, email: formEmail.trim() || null, updated_at: new Date().toISOString() }, { onConflict: "service_id" });
    setPracuji(false);
    if (error) {
      showToast(`Uložení selhalo: ${error.message}`, "error");
      return;
    }
    showToast("Nastavení provizí uloženo", "success");
    await nacti(serviceId, zapnuto);
  };

  const vyuctuj = async () => {
    if (!db) return;
    setPracuji(true);
    const { data: r, error } = await db.rpc("provize_vyuctuj", { p_service_id: serviceId, p_oznaceni: oznaceni.trim() || null });
    setPracuji(false);
    setPotvrditVyuctovani(false);
    if (error) {
      showToast(`Vyúčtování selhalo: ${error.message}`, "error");
      return;
    }
    if (!r?.pocet) {
      showToast("Není co vyúčtovat.", "info");
    } else {
      setVysledek(`Vyúčtování ${r.oznaceni}\nPočet zakázek: ${r.pocet}\nSoučet cen: ${kc(r.soucet_zaklad)}\nSoučet provizí: ${kc(r.soucet_provize)}`);
      setOznaceni("");
      if (r.id) void posliMail(r.id);
    }
    await nacti(serviceId, false);
  };

  const posliMail = async (id: number) => {
    if (!db) return;
    setPosilamMail(id);
    try {
      const { data: r, error } = await db.functions.invoke("provize-mail", { body: { vyuctovaniId: id } });
      if (error || r?.error) throw new Error(r?.error ?? error?.message ?? "neznámá chyba");
      showToast(`Souhrn vyúčtování odeslán na ${r.prijemce}`, "success");
    } catch (e) {
      showToast(`E-mail se nepodařilo odeslat: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setPosilamMail(null);
    }
  };

  const zrusVyuctovani = async () => {
    if (!db || !zrusit) return;
    const { error } = await db.rpc("provize_zrus_vyuctovani", { p_id: zrusit.id });
    setZrusit(null);
    if (error) {
      showToast(`Zrušení selhalo: ${error.message}`, "error");
      return;
    }
    showToast("Vyúčtování zrušeno, řádky jsou zpět mezi nevyúčtovanými", "success");
    await nacti(serviceId, false);
  };

  const nastavVyplaceno = async (id: number | null, vyplaceno: boolean) => {
    if (!db) return;
    let q = db.from("provize_vyuctovani").update({ vyplaceno_at: vyplaceno ? new Date().toISOString() : null }).eq("service_id", serviceId);
    // id = jedno vyúčtování; null = všechna, která ještě vyplacená nejsou
    q = id === null ? q.is("vyplaceno_at", null) : q.eq("id", id);
    const { error } = await q;
    setPotvrditVyplacenoVse(false);
    if (error) {
      showToast(`Změna selhala: ${error.message}`, "error");
      return;
    }
    await nacti(serviceId, false);
  };

  const prepniVyrazeni = async (p: Polozka) => {
    if (!db) return;
    const { error } = await db.from("provize_polozky").update({ vyrazeno: !p.vyrazeno }).eq("id", p.id);
    if (error) {
      showToast(`Změna selhala: ${error.message}`, "error");
      return;
    }
    await nacti(serviceId, false);
  };

  const vyberSoubor = async (f: File | undefined) => {
    if (!f) return;
    const { radky } = radkyZCsv(await f.text());
    if (souborRef.current) souborRef.current.value = "";
    if (radky.length === 0) {
      showToast("V souboru nejsou žádné řádky se zakázkami. Je to export listu RAW?", "error");
      return;
    }
    setImportRadky(radky);
  };

  const importuj = async () => {
    if (!db || !importRadky) return;
    setPracuji(true);
    const { data: r, error } = await db.rpc("provize_import", { p_service_id: serviceId, p_radky: importRadky, p_od: formOd || null, p_filtr: formFiltr.trim() || null });
    setPracuji(false);
    setImportRadky(null);
    if (error) {
      showToast(`Import selhal: ${error.message}`, "error");
      return;
    }
    showToast(`Import: ${r.vlozeno} řádků, ${r.vyuctovani} vyúčtování${r.preskoceno ? `, ${r.preskoceno} už tu bylo` : ""}${r.mimo_filtr ? `, ${r.mimo_filtr} vyřazeno (jiné zařízení)` : ""}`, "success");
    await nacti(serviceId, true);
  };

  const border = "1px solid var(--border)";
  const tlacitko: React.CSSProperties = { padding: "8px 14px", borderRadius: 10, border, background: "var(--panel)", color: "var(--text)", fontWeight: 700, fontSize: 13, cursor: "pointer" };
  const primarni: React.CSSProperties = { ...tlacitko, background: "var(--accent)", color: "white", border: "none" };
  const pole: React.CSSProperties = { padding: "8px 10px", borderRadius: 10, border, background: "var(--bg)", color: "var(--text)", fontSize: 13 };
  const dlazdice: React.CSSProperties = { flex: "1 1 160px", padding: 12, borderRadius: 12, border, background: "var(--panel-2)" };
  const n = data?.nastaveni ?? null;
  const tydnuVImportu = importRadky ? new Set(importRadky.map((r) => r.tyden).filter(Boolean)).size : 0;

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 950, fontSize: 14, marginBottom: 4, color: "var(--text)" }}>Provize</div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>Provize ze zakázek servisu. Vidí jen majitel aplikace – ani vlastník servisu k nim nemá přístup.</div>
        </div>
        <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} style={{ ...pole, minWidth: 220 }}>
          <option value="">Vyber servis…</option>
          {services.map((s) => (
            <option key={s.service_id} value={s.service_id}>
              {s.service_name}
            </option>
          ))}
        </select>
      </div>

      {serviceId && nacitam && !data && <div style={{ fontSize: 13, color: "var(--muted)" }}>Načítám…</div>}

      {serviceId && data && (
        <>
          <details open={!n} style={{ marginBottom: 16 }}>
            <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
              Nastavení {n ? `· ${String(Math.round(n.sazba * 10000) / 100).replace(".", ",")} % · ${n.filtr ? `jen „${n.filtr}“` : "všechna zařízení"} · ${n.zapnuto ? "zapnuto" : "vypnuto"}` : "· provize pro tento servis zatím nejsou zapnuté"}
            </summary>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginTop: 12 }}>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "grid", gap: 4 }}>
                Sazba (%)
                <input value={formSazba} onChange={(e) => setFormSazba(e.target.value)} style={{ ...pole, width: 90 }} inputMode="decimal" />
              </label>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "grid", gap: 4 }} title="Zakázky, které v provizích ještě nejsou, se přidají jen když se do sledovaného stavu dostaly od tohoto data. Prázdné = všechny.">
                Počítat od
                <input type="date" value={formOd} onChange={(e) => setFormOd(e.target.value)} style={pole} />
              </label>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "grid", gap: 4 }} title="Provize jen ze zakázek, jejichž zařízení tenhle text obsahuje (název zakázky, zařízení, značka, model). Prázdné = všechny zakázky.">
                Jen zařízení obsahující
                <input value={formFiltr} onChange={(e) => setFormFiltr(e.target.value)} placeholder="např. dyson" style={{ ...pole, width: 140 }} />
              </label>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "grid", gap: 4 }} title="Kam přijde souhrn po vyúčtování. Prázdné = tvůj přihlašovací e-mail.">
                E-mail pro vyúčtování
                <input type="email" value={formEmail} onChange={(e) => setFormEmail(e.target.value)} placeholder={session?.user?.email ?? "e-mail"} style={{ ...pole, width: 220 }} />
              </label>
              <div style={{ fontSize: 12, color: "var(--muted)", display: "grid", gap: 4 }}>
                Sledované statusy
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", maxWidth: 520 }}>
                  {data.statusy_servisu.map((s) => {
                    const on = formStatusy.includes(s);
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setFormStatusy((prev) => (on ? prev.filter((x) => x !== s) : [...prev, s]))}
                        style={{ ...tlacitko, padding: "5px 10px", fontSize: 12, fontWeight: on ? 800 : 500, background: on ? "var(--accent-soft)" : "var(--panel)", borderColor: on ? "var(--accent)" : "var(--border)" }}
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>
              </div>
              <button type="button" style={primarni} disabled={pracuji} onClick={() => ulozNastaveni(true)}>
                {n?.zapnuto ? "Uložit" : "Zapnout provize"}
              </button>
              {n?.zapnuto && (
                <button type="button" style={tlacitko} disabled={pracuji} onClick={() => ulozNastaveni(false)}>
                  Vypnout
                </button>
              )}
              <button type="button" style={tlacitko} disabled={pracuji} onClick={() => souborRef.current?.click()} title="Export listu RAW z Google tabulky: Soubor → Stáhnout → CSV">
                Import z Google tabulky (CSV)
              </button>
              <input ref={souborRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => void vyberSoubor(e.target.files?.[0])} />
            </div>
          </details>

          {n && (
            <>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
                <div style={dlazdice}>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>K vyúčtování</div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: "var(--text)" }}>{kc(soucetProvize)}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    {kVyuctovani.length} řádků · základ {kc(soucetZaklad)}
                  </div>
                </div>
                <div style={dlazdice}>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>Vyúčtováno celkem</div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: "var(--text)" }}>{kc(vyuctovanoCelkem)}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{data.vyuctovani.length} vyúčtování</div>
                </div>
                <div style={{ ...dlazdice, display: "flex", flexDirection: "column", gap: 8, justifyContent: "center" }}>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input value={oznaceni} onChange={(e) => setOznaceni(e.target.value)} placeholder="označení (výchozí: týden)" style={{ ...pole, flex: 1, minWidth: 0 }} />
                    <button type="button" style={primarni} disabled={pracuji || kVyuctovani.length === 0} onClick={() => setPotvrditVyuctovani(true)}>
                      Vyúčtovat
                    </button>
                  </div>
                  <button type="button" style={{ ...tlacitko, fontSize: 12, padding: "5px 10px" }} disabled={nacitam} onClick={() => nacti(serviceId, true)}>
                    {nacitam ? "Přepočítávám…" : `Přepočítat ze zakázek${n.posledni_sync_at ? ` · naposledy ${new Date(n.posledni_sync_at).toLocaleString("cs-CZ", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}`}
                  </button>
                </div>
              </div>

              {vysledek && (
                <div style={{ marginBottom: 16, padding: 12, borderRadius: 12, border: "1px solid var(--accent)", background: "var(--accent-soft)", display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <pre style={{ margin: 0, fontFamily: "inherit", fontSize: 13, color: "var(--text)", whiteSpace: "pre-wrap", flex: 1 }}>{vysledek}</pre>
                  <CopyButton value={vysledek} label="souhrn vyúčtování" size={14} />
                </div>
              )}

              <ProvizeStatistiky
                polozky={data.polozky}
                vyuctovani={data.vyuctovani}
                posilamMail={posilamMail}
                onMail={(id) => void posliMail(id)}
                onVyplaceno={(id, vyplaceno) => void nastavVyplaceno(id, vyplaceno)}
                onVyplacenoVse={() => setPotvrditVyplacenoVse(true)}
                onVyber={(id) => {
                  setFiltr(id);
                  setVse(false);
                  seznamRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              />

              <div ref={seznamRef} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
                <select
                  value={String(filtr)}
                  onChange={(e) => {
                    const v = e.target.value;
                    setFiltr(v === "nevyuctovane" || v === "vse" ? v : Number(v));
                    setVse(false);
                  }}
                  style={pole}
                >
                  <option value="nevyuctovane">Nevyúčtované ({nevyuctovane.length})</option>
                  <option value="vse">Vše ({data.polozky.length})</option>
                  {data.vyuctovani.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.oznaceni} · {v.pocet} ř. · {kc(v.soucet_provize)}
                    </option>
                  ))}
                </select>
                <input value={hledat} onChange={(e) => setHledat(e.target.value)} placeholder="Hledat číslo zakázky…" style={{ ...pole, width: 200 }} />
                {typeof filtr === "number" && (
                  <button type="button" style={{ ...tlacitko, color: "var(--danger, #dc2626)" }} onClick={() => setZrusit(data.vyuctovani.find((v) => v.id === filtr) ?? null)}>
                    Zrušit toto vyúčtování
                  </button>
                )}
              </div>

              <div style={{ overflowX: "auto", border, borderRadius: 12 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 12 }}>
                      {["Zakázka", "Zařízení", "Stav teď", "Základ", "Provize", "Zapsáno", "Vyúčtování", ""].map((h) => (
                        <th key={h} style={{ padding: "8px 10px", borderBottom: border, fontWeight: 600, whiteSpace: "nowrap" }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(vse ? zobrazene : zobrazene.slice(0, 100)).map((p) => (
                      <tr key={p.id} style={{ opacity: p.vyrazeno ? 0.5 : 1 }}>
                        <td style={{ padding: "7px 10px", borderBottom: border, fontWeight: 700, whiteSpace: "nowrap" }}>
                          {p.kod}
                          {p.poradi > 0 && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 600, color: "var(--accent)" }}>doplatek</span>}
                        </td>
                        <td style={{ padding: "7px 10px", borderBottom: border, color: "var(--muted)", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.zarizeni ?? undefined}>{p.zarizeni ?? "—"}</td>
                        <td style={{ padding: "7px 10px", borderBottom: border, color: "var(--muted)" }}>{p.stav_ted ?? p.status ?? "—"}</td>
                        <td style={{ padding: "7px 10px", borderBottom: border, whiteSpace: "nowrap" }}>{kc(p.zaklad)}</td>
                        <td style={{ padding: "7px 10px", borderBottom: border, whiteSpace: "nowrap", fontWeight: 700 }}>{kc(p.provize)}</td>
                        <td style={{ padding: "7px 10px", borderBottom: border, color: "var(--muted)", whiteSpace: "nowrap" }}>{datum(p.zapsano_at)}</td>
                        <td style={{ padding: "7px 10px", borderBottom: border, color: "var(--muted)", whiteSpace: "nowrap" }}>
                          {p.vyuctovani_id !== null ? oznaceniPodleId.get(p.vyuctovani_id) ?? "ano" : p.vyrazeno ? `vyřazeno${p.poznamka ? ` (${p.poznamka})` : ""}` : "—"}
                        </td>
                        <td style={{ padding: "7px 10px", borderBottom: border, textAlign: "right" }}>
                          {p.vyuctovani_id === null && (
                            <button type="button" style={{ ...tlacitko, padding: "3px 9px", fontSize: 12, fontWeight: 600 }} onClick={() => prepniVyrazeni(p)}>
                              {p.vyrazeno ? "Vrátit" : "Vyřadit"}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {zobrazene.length === 0 && (
                      <tr>
                        <td colSpan={8} style={{ padding: 16, textAlign: "center", color: "var(--muted)" }}>
                          Žádné řádky.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {!vse && zobrazene.length > 100 && (
                <button type="button" style={{ ...tlacitko, marginTop: 10 }} onClick={() => setVse(true)}>
                  Zobrazit všech {zobrazene.length}
                </button>
              )}
            </>
          )}
        </>
      )}

      <ConfirmDialog
        open={potvrditVyuctovani}
        title="Vyúčtovat provize"
        message={`Uzavřít ${kVyuctovani.length} řádků pod označením „${oznaceni.trim() || "aktuální týden"}“?\nZáklad ${kc(soucetZaklad)}, provize ${kc(soucetProvize)}.\nVyúčtované řádky se už nemění – pozdější zdražení půjde do doplatku.`}
        confirmLabel="Vyúčtovat"
        onConfirm={vyuctuj}
        onCancel={() => setPotvrditVyuctovani(false)}
      />
      <ConfirmDialog
        open={potvrditVyplacenoVse}
        title="Označit jako vyplacené"
        message={`Všechna vyúčtování, která ještě nejsou vyplacená (${(data?.vyuctovani ?? []).filter((v) => !v.vyplaceno_at).length}), se označí jako vyplacená s dnešním datem. Jednotlivě to jde kdykoli vrátit.`}
        confirmLabel="Označit vše"
        onConfirm={() => nastavVyplaceno(null, true)}
        onCancel={() => setPotvrditVyplacenoVse(false)}
      />
      <ConfirmDialog
        open={!!zrusit}
        title="Zrušit vyúčtování"
        message={zrusit ? `Vyúčtování ${zrusit.oznaceni} (${zrusit.pocet} řádků, ${kc(zrusit.soucet_provize)}) se smaže a řádky se vrátí mezi nevyúčtované.` : ""}
        confirmLabel="Zrušit vyúčtování"
        variant="danger"
        onConfirm={zrusVyuctovani}
        onCancel={() => setZrusit(null)}
      />
      <ConfirmDialog
        open={!!importRadky}
        title="Import z Google tabulky"
        message={importRadky ? `Načteno ${importRadky.length} řádků (${importRadky.filter((r) => r.tyden).length} vyúčtovaných v ${tydnuVImportu} týdnech, ${importRadky.filter((r) => r.priznak.toLowerCase() === "a").length} vyřazených). Co už v provizích je, zůstane beze změny.` : ""}
        confirmLabel="Importovat"
        onConfirm={importuj}
        onCancel={() => setImportRadky(null)}
      />
    </Card>
  );
}
