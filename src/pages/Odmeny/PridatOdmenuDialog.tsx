import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../../lib/supabaseClient";
import { formatCurrency } from "../../lib/invoiceMath";
import { Button, Input } from "../../components/ui";
import type { ClenServisu } from "../../hooks/useClenoveServisu";
import { castkaRucniOdmeny, chybaRucniOdmeny, popisPravidla, prectiCenu, type PravidloRucni } from "../../lib/odmeny";

/**
 * Dialog „Přidat odměnu“ na stránce Odměny.
 *
 * Odměna podle pravidla z Nastavení (stejná pravidla jako u oprav), s
 * povinnou poznámkou a volitelně navázaná na zakázku. Ukládá se funkcí
 * `odmeny_rucni_pridat` (migrace 20261009100000) – částku spočítá server
 * z pravidla, tady je jen náhled. Zaměstnanec přidává jen sám sobě a jeho
 * odměna čeká na schválení (pokud mu správce nezapnul automatické
 * schvalování); správce vybírá komu a jeho odměna je rovnou schválená.
 */

type Zakazka = { id: string; kod: string; detail: string };

const pole: React.CSSProperties = { padding: "8px 10px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: 13, fontFamily: "inherit", width: "100%", boxSizing: "border-box" };
const popisek: React.CSSProperties = { display: "grid", gap: 4, fontSize: 12, color: "var(--muted)" };

export function PridatOdmenuDialog({
  open,
  onClose,
  onUlozeno,
  serviceId,
  pravidla,
  vychoziMesic,
  vychoziPravidloId,
  admin,
  ja,
  clenove,
  autoSchvalovani,
}: {
  open: boolean;
  onClose: () => void;
  /** Po uložení – stránka si přenačte přehled. */
  onUlozeno: (stav: string) => void;
  serviceId: string;
  pravidla: PravidloRucni[];
  /** Měsíc zobrazený na stránce („2026-10“). */
  vychoziMesic: string;
  /** Předvybrané pravidlo (rychlé tlačítko u procentního pravidla potřebuje cenu). */
  vychoziPravidloId?: string;
  admin: boolean;
  ja: string | null;
  /** Členové servisu (načtené jen pro správce). */
  clenove: ClenServisu[];
  /** Zaměstnanci se odměny schvalují automaticky (jen text v dialogu, rozhoduje server). */
  autoSchvalovani: boolean;
}) {
  const [pravidloId, setPravidloId] = useState(vychoziPravidloId ?? "");
  const [zakladText, setZakladText] = useState("");
  const [poznamka, setPoznamka] = useState("");
  const [obdobi, setObdobi] = useState(vychoziMesic);
  const [komu, setKomu] = useState<string>(ja ?? "");
  const [zakazka, setZakazka] = useState<Zakazka | null>(null);
  const [hledani, setHledani] = useState("");
  const [napovedy, setNapovedy] = useState<Zakazka[]>([]);
  const [ukladam, setUkladam] = useState(false);
  const [chyba, setChyba] = useState<string | null>(null);
  const poznamkaRef = useRef<HTMLTextAreaElement>(null);

  // Napovídání zakázky podle čísla (nebo jména zákazníka). RLS pustí jen
  // zakázky, které uživatel vidí (pobočka). Kratší dotaz = nápovědy se
  // nezobrazují (viz `viditelneNapovedy`).
  useEffect(() => {
    if (!open || !supabase) return;
    const d = hledani.trim();
    if (d.length < 2) return;
    let zruseno = false;
    const casovac = window.setTimeout(async () => {
      const vzor = `%${d.replace(/[%_,()]/g, "")}%`;
      // deno-lint-ignore no-explicit-any
      const { data } = await (supabase as any)
        .from("tickets")
        .select("id, code, customer_name, title")
        .eq("service_id", serviceId)
        .is("deleted_at", null)
        .or(`code.ilike.${vzor},customer_name.ilike.${vzor}`)
        .order("created_at", { ascending: false })
        .limit(8);
      if (zruseno) return;
      setNapovedy(((data ?? []) as Record<string, unknown>[]).map((t) => ({
        id: String(t.id),
        kod: String(t.code ?? "—"),
        detail: [t.customer_name, t.title].filter((x) => typeof x === "string" && x).join(" · "),
      })));
    }, 250);
    return () => { zruseno = true; window.clearTimeout(casovac); };
  }, [open, hledani, serviceId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !ukladam) { e.preventDefault(); onClose(); } };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, ukladam, onClose]);

  // Nevybráno (nebo pravidlo mezitím zmizelo) = první v pořadí.
  const pravidlo = useMemo(() => pravidla.find((p) => p.id === pravidloId) ?? pravidla[0] ?? null, [pravidla, pravidloId]);
  const zaklad = prectiCenu(zakladText);
  const nahled = pravidlo ? castkaRucniOdmeny(pravidlo, zaklad) : null;
  const jinemu = admin && !!komu && komu !== ja;
  const viditelneNapovedy = hledani.trim().length >= 2 ? napovedy : [];

  if (!open) return null;

  const ulozit = async () => {
    const c = chybaRucniOdmeny({ pravidlo, poznamka, zaklad, obdobi });
    if (c) { setChyba(c); if (c.startsWith("Poznámka")) poznamkaRef.current?.focus(); return; }
    if (!supabase || !pravidlo) return;
    setUkladam(true);
    setChyba(null);
    // deno-lint-ignore no-explicit-any
    const { data, error } = await (supabase as any).rpc("odmeny_rucni_pridat", {
      p_service_id: serviceId,
      p_pravidlo_id: pravidlo.id,
      p_poznamka: poznamka.trim() || null,
      p_obdobi: obdobi,
      p_ticket_id: zakazka?.id ?? null,
      p_zaklad: pravidlo.typ === "procento" ? zaklad : null,
      p_user_id: admin && komu ? komu : null,
    });
    setUkladam(false);
    if (error) { setChyba(error.message || "Uložení selhalo."); return; }
    const stav = data && typeof data === "object" && typeof (data as Record<string, unknown>).stav === "string" ? String((data as Record<string, unknown>).stav) : "ceka";
    onUlozeno(stav);
  };

  const dialog = (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000, padding: 16 }}
      onClick={() => { if (!ukladam) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pridat-odmenu-titulek"
        style={{ background: "var(--panel)", borderRadius: 16, padding: 20, maxWidth: 480, width: "100%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 25px 60px rgba(0,0,0,0.3)", border: "1px solid var(--border)", display: "grid", gap: 12, color: "var(--text)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <div id="pridat-odmenu-titulek" style={{ fontWeight: 900, fontSize: 18 }}>Přidat odměnu</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, lineHeight: 1.5 }}>
            {admin
              ? "Odměna podle pravidla z Nastavení. Od vás je rovnou schválená a počítá se do součtů za vybraný měsíc."
              : autoSchvalovani
                ? "Odměna podle pravidla z Nastavení. Máte zapnuté automatické schvalování – počítá se hned po uložení."
                : "Odměna podle pravidla z Nastavení. Do součtů se započítá, až ji majitel nebo správce schválí."}
          </div>
        </div>

        {pravidla.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--muted)" }}>Servis nemá žádné aktivní pravidlo odměn – nejdřív ho musí majitel nastavit.</div>
        ) : (
          <>
            <label style={popisek}>
              Pravidlo
              <select value={pravidlo?.id ?? ""} onChange={(e) => setPravidloId(e.target.value)} style={pole} autoFocus>
                {pravidla.map((p) => (
                  <option key={p.id} value={p.id}>{p.nazev} – {popisPravidla(p)}</option>
                ))}
              </select>
            </label>

            {pravidlo?.typ === "procento" && (
              <label style={popisek}>
                Cena, ze které se počítá (Kč)
                <Input inputMode="decimal" value={zakladText} onChange={(e) => setZakladText(e.target.value)} placeholder="např. 1290" />
              </label>
            )}

            <label style={popisek}>
              Poznámka (nepovinná)
              <textarea ref={poznamkaRef} value={poznamka} onChange={(e) => setPoznamka(e.target.value)} rows={3} maxLength={1000} placeholder="Za co odměna je – např. prodal ochranné sklo k telefonu u pultu" style={{ ...pole, resize: "vertical" }} />
            </label>

            <div style={popisek}>
              Zakázka (nepovinné)
              {zakazka ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text)" }}>
                  <b>{zakazka.kod}</b>
                  <span style={{ color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{zakazka.detail}</span>
                  <Button size="sm" variant="ghost" onClick={() => setZakazka(null)}>Odebrat</Button>
                </div>
              ) : (
                <div style={{ position: "relative" }}>
                  <Input value={hledani} onChange={(e) => setHledani(e.target.value)} placeholder="Číslo zakázky nebo zákazník" aria-label="Hledat zakázku" />
                  {viditelneNapovedy.length > 0 && (
                    <div style={{ position: "absolute", left: 0, right: 0, top: "100%", marginTop: 4, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "0 10px 30px rgba(0,0,0,0.2)", zIndex: 1, maxHeight: 240, overflowY: "auto" }}>
                      {viditelneNapovedy.map((z) => (
                        <button
                          key={z.id}
                          type="button"
                          onClick={() => { setZakazka(z); setHledani(""); setNapovedy([]); }}
                          style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 10px", border: "none", borderBottom: "1px solid var(--border)", background: "transparent", color: "var(--text)", cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}
                        >
                          <b>{z.kod}</b> <span style={{ color: "var(--muted)" }}>{z.detail}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <label style={{ ...popisek, flex: "1 1 140px" }}>
                Měsíc
                <input type="month" value={obdobi} onChange={(e) => setObdobi(e.target.value)} style={pole} />
              </label>
              {admin && (
                <label style={{ ...popisek, flex: "2 1 200px" }}>
                  Komu
                  <select value={komu} onChange={(e) => setKomu(e.target.value)} style={pole}>
                    {ja && !clenove.some((c) => c.userId === ja) && <option value={ja}>Já</option>}
                    {clenove.map((c) => (
                      <option key={c.userId} value={c.userId}>{c.userId === ja ? `${c.jmeno} (já)` : c.jmeno}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            <div style={{ fontSize: 13 }}>
              Odměna: <b>{nahled === null ? "—" : formatCurrency(nahled, "CZK")}</b>
              {pravidlo?.typ === "procento" && nahled === null && <span style={{ color: "var(--muted)" }}> (zadejte cenu)</span>}
              {jinemu && <span style={{ color: "var(--muted)" }}> · připíše se vybranému kolegovi</span>}
            </div>
          </>
        )}

        {chyba && (
          <div role="alert" style={{ color: "var(--text)", fontSize: 13, padding: 10, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8 }}>{chyba}</div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="soft" onClick={onClose} disabled={ukladam}>Zrušit</Button>
          <Button variant="primary" onClick={() => void ulozit()} disabled={ukladam || pravidla.length === 0}>{ukladam ? "Ukládám…" : admin || autoSchvalovani ? "Přidat odměnu" : "Odeslat ke schválení"}</Button>
        </div>
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}
