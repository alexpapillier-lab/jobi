import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button, Card, Input, useSavedHint } from "../../components/ui";
import { nactiServiceConfig, mergeServiceConfig, subscribeServiceConfig } from "../../lib/serviceSettingsSync";
import { useConfigNacteno } from "./useConfigNacteno";
import { showToast } from "../../components/Toast";
import { formatCurrency } from "../../lib/invoiceMath";
import { supabase } from "../../lib/supabaseClient";
import { useClenoveServisu } from "../../hooks/useClenoveServisu";
import { useStatuses } from "../../state/StatusesStore";
import {
  MAX_PRAVIDEL_ODMEN,
  VOLBY_KDY_ODMENY,
  VYCHOZI_NASTAVENI_ODMEN,
  castkaOdmeny,
  normalizujOdmeny,
  noveIdPravidla,
  stavyProOdmeny,
  vychoziStavOdmen,
  type KdyOdmeny,
  type KomuOdmena,
  type RezimOdmen,
  type NastaveniOdmen,
  type PravidloOdmeny,
  type TypOdmeny,
} from "../../lib/odmeny";

/** Stejná hlavička karty jako v Settings.tsx (tam je jen lokální). */
function CardHeader({ title, description, right }: { title: ReactNode; description?: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ marginBottom: "var(--space-3)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-2)" }}>
        <div style={{ fontWeight: 900, fontSize: "var(--text-base)", color: "var(--text)" }}>{title}</div>
        {right}
      </div>
      {description ? <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)", marginTop: 2, lineHeight: 1.5 }}>{description}</div> : null}
    </div>
  );
}

const pole: React.CSSProperties = { padding: "8px 10px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: 13, fontFamily: "inherit" };

/**
 * Nastavení → Tým → Odměny za opravy.
 *
 * Pravidlo = text v názvu opravy + částka (Kč nebo % z ceny) + komu
 * (kdo opravu na zakázku přidal, nebo přidělený technik). Ukládá se do
 * service_settings.config.odmeny; počítá databáze (odmeny_prehled),
 * výsledek je na stránce Odměny. Kdy se odměna připočítá (po vydání, po
 * přidání opravy, nebo po dosažení stavu) určuje `odmeny.kdy` – blok
 * „Kdy se odměna připočítá“ níž. Sekce je jen pro majitele a správce
 * (Settings.tsx, isAdmin), stejně jako pravidla.
 */
export function OdmenySettingsSection({ activeServiceId, onOtevritOdmeny }: { activeServiceId: string | null; onOtevritOdmeny?: () => void }) {
  const [nastaveni, setNastaveni] = useState<NastaveniOdmen>(VYCHOZI_NASTAVENI_ODMEN);
  const { statuses } = useStatuses();
  const stavyKVyberu = stavyProOdmeny(statuses);
  const { nacteno, oznacNacteno } = useConfigNacteno(activeServiceId);
  const [chybaNacteni, setChybaNacteni] = useState(false);
  const hint = useSavedHint();
  const [nove, setNove] = useState<{ nazev: string; hledat: string; typ: TypOdmeny; hodnota: string; komu: KomuOdmena }>({ nazev: "", hledat: "", typ: "castka", hodnota: "", komu: "pridal" });
  const [zkouska, setZkouska] = useState("");

  useEffect(() => {
    if (!activeServiceId) return;
    let zruseno = false;
    nactiServiceConfig(activeServiceId).then((r) => {
      if (zruseno) return;
      if (r.stav === "chyba") {
        // Bez jistoty, co je v databázi, se nesmí ukládat – přepsal by se
        // celý seznam pravidel prázdným.
        setChybaNacteni(true);
        return;
      }
      setChybaNacteni(false);
      setNastaveni(normalizujOdmeny(r.stav === "ok" ? r.config.odmeny : undefined));
      oznacNacteno();
    });
    const unsubscribe = subscribeServiceConfig(activeServiceId, (config) => setNastaveni(normalizujOdmeny(config.odmeny)), "odmeny-nastaveni");
    return () => { zruseno = true; unsubscribe(); };
  }, [activeServiceId, oznacNacteno]);

  const ulozit = useCallback(async (next: NastaveniOdmen) => {
    if (!nacteno || !activeServiceId) return;
    setNastaveni(next);
    const r = await mergeServiceConfig(activeServiceId, { odmeny: next });
    if (r.error) {
      showToast(`Uložení selhalo: ${r.error}`, "error");
      return;
    }
    hint.show();
  }, [nacteno, activeServiceId, hint]);

  const pridat = () => {
    const hledat = nove.hledat.trim();
    const hodnota = Number(nove.hodnota.replace(/\s/g, "").replace(",", "."));
    if (!hledat) { showToast("Zadejte, co má být v názvu opravy.", "error"); return; }
    if (!Number.isFinite(hodnota) || hodnota <= 0) { showToast("Zadejte kladnou částku nebo procento.", "error"); return; }
    if (nastaveni.pravidla.length >= MAX_PRAVIDEL_ODMEN) { showToast(`Nejvýš ${MAX_PRAVIDEL_ODMEN} pravidel.`, "error"); return; }
    const pravidlo: PravidloOdmeny = { id: noveIdPravidla(), nazev: nove.nazev.trim(), hledat, typ: nove.typ, hodnota, komu: nove.komu, aktivni: true };
    void ulozit({ ...nastaveni, pravidla: [...nastaveni.pravidla, pravidlo] });
    setNove({ nazev: "", hledat: "", typ: "castka", hodnota: "", komu: "pridal" });
  };

  const uprav = (id: string, zmena: Partial<PravidloOdmeny>) => {
    void ulozit({ ...nastaveni, pravidla: nastaveni.pravidla.map((p) => (p.id === id ? { ...p, ...zmena } : p)) });
  };
  const smazat = (id: string) => {
    if (!window.confirm("Smazat pravidlo? Odměny za dřívější měsíce se přepočítají bez něj.")) return;
    void ulozit({ ...nastaveni, pravidla: nastaveni.pravidla.filter((p) => p.id !== id) });
  };
  const posun = (id: string, smer: -1 | 1) => {
    const i = nastaveni.pravidla.findIndex((p) => p.id === id);
    const j = i + smer;
    if (i < 0 || j < 0 || j >= nastaveni.pravidla.length) return;
    const next = [...nastaveni.pravidla];
    [next[i], next[j]] = [next[j], next[i]];
    void ulozit({ ...nastaveni, pravidla: next });
  };

  const nastavKdy = (kdy: KdyOdmeny) => void ulozit({ ...nastaveni, kdy });
  const zvolRezim = (rezim: RezimOdmen) => {
    if (rezim === "stav") {
      const stav = nastaveni.kdy.stav ?? vychoziStavOdmen(statuses);
      if (!stav) { showToast("Servis nemá žádný stav, který by šel vybrat.", "error"); return; }
      nastavKdy({ rezim: "stav", stav });
      return;
    }
    nastavKdy({ rezim });
  };
  // Uložený stav, který mezitím někdo smazal nebo přejmenoval na storno – databáze pak počítá po vydání.
  const stavNeplatny = nastaveni.kdy.rezim === "stav" && !!nastaveni.kdy.stav && statuses.length > 0 && !stavyKVyberu.some((s) => s.key === nastaveni.kdy.stav);

  const zkouskaVysledek = (() => {
    const t = zkouska.trim();
    if (!t) return null;
    const p = nastaveni.pravidla.find((x) => x.aktivni && t.toLowerCase().includes(x.hledat.toLowerCase()));
    return p ? `Sedí pravidlo „${p.nazev || p.hledat}“ – ${p.typ === "procento" ? `${p.hodnota} % z ceny` : formatCurrency(castkaOdmeny(p, 0), "CZK")}.` : "Žádné pravidlo nesedí.";
  })();

  return (
    <Card>
      <CardHeader
        title="Odměny za opravy"
        description="Prémie pro tým za opravy nabídnuté zákazníkovi navíc: kdo mu prodá servisní čištění, dostane třeba 100 Kč. Když zákazník s čištěním rovnou přijde, odměna není. U opravy, na kterou sedí pravidlo, se v detailu zakázky ukáže přepínač „Nabídnuto navíc?“ – výchozí je nenabídnuto a kdo opravu zákazníkovi prodal, ho jedním klikem zapne. Kdy odměna vznikne (po vydání, po přidání opravy, nebo ve vybraném stavu), nastavíte níž; storno nic nedostane. Přehled i zaměstnanec měsíce jsou na stránce Odměny. Starší zakázky bez příznaku se nepočítají."
        right={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            {hint.node}
            {onOtevritOdmeny && (
              <Button size="sm" variant="soft" onClick={onOtevritOdmeny}>Otevřít Odměny</Button>
            )}
          </span>
        }
      />

      {chybaNacteni && (
        <div style={{ padding: 12, borderRadius: 10, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.08)", fontSize: 13, marginBottom: 12 }}>
          Nastavení se nepodařilo načíst – změny se teď neukládají, ať se nepřepíše, co je v databázi.
        </div>
      )}

      {nastaveni.pravidla.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>Zatím žádné pravidlo. Přidejte první níže; majitel a správce se na stránku Odměny dostanou vždy tlačítkem nahoře, tým ji uvidí podle přepínače níže.</div>
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 12, marginBottom: 12 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                {["Pravidlo", "V názvu opravy", "Odměna", "Komu", "Aktivní", ""].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid var(--border)", color: "var(--muted)", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {nastaveni.pravidla.map((p, i) => (
                <tr key={p.id} style={{ opacity: p.aktivni ? 1 : 0.55 }}>
                  <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--border)" }}>
                    <input aria-label="Název pravidla" value={p.nazev} placeholder={p.hledat} onChange={(e) => setNastaveni((n) => ({ ...n, pravidla: n.pravidla.map((x) => (x.id === p.id ? { ...x, nazev: e.target.value } : x)) }))} onBlur={(e) => uprav(p.id, { nazev: e.target.value.trim() })} style={{ ...pole, width: 160 }} />
                  </td>
                  <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--border)" }}>
                    <input aria-label="Text v názvu opravy" value={p.hledat} onChange={(e) => setNastaveni((n) => ({ ...n, pravidla: n.pravidla.map((x) => (x.id === p.id ? { ...x, hledat: e.target.value } : x)) }))} onBlur={(e) => { const v = e.target.value.trim(); if (v) uprav(p.id, { hledat: v }); }} style={{ ...pole, width: 180 }} />
                  </td>
                  <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>
                    <input aria-label="Hodnota odměny" inputMode="decimal" value={String(p.hodnota)} onChange={(e) => setNastaveni((n) => ({ ...n, pravidla: n.pravidla.map((x) => (x.id === p.id ? { ...x, hodnota: Number(e.target.value.replace(",", ".")) || 0 } : x)) }))} onBlur={(e) => { const v = Number(e.target.value.replace(",", ".")); if (Number.isFinite(v) && v > 0) uprav(p.id, { hodnota: v }); }} style={{ ...pole, width: 80, textAlign: "right" }} />
                    <select aria-label="Typ odměny" value={p.typ} onChange={(e) => uprav(p.id, { typ: e.target.value as TypOdmeny })} style={{ ...pole, marginLeft: 6 }}>
                      <option value="castka">Kč</option>
                      <option value="procento">% z ceny</option>
                    </select>
                  </td>
                  <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--border)" }}>
                    <select aria-label="Komu" value={p.komu} onChange={(e) => uprav(p.id, { komu: e.target.value as KomuOdmena })} style={pole}>
                      <option value="pridal">Kdo opravu přidal</option>
                      <option value="technik">Přidělený technik</option>
                    </select>
                  </td>
                  <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--border)", textAlign: "center" }}>
                    <input type="checkbox" aria-label="Aktivní" checked={p.aktivni} onChange={(e) => uprav(p.id, { aktivni: e.target.checked })} />
                  </td>
                  <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>
                    <Button size="sm" variant="ghost" onClick={() => posun(p.id, -1)} disabled={i === 0} title="Výš (pořadí rozhoduje, když sedí víc pravidel)">↑</Button>
                    <Button size="sm" variant="ghost" onClick={() => posun(p.id, 1)} disabled={i === nastaveni.pravidla.length - 1} title="Níž">↓</Button>
                    <Button size="sm" variant="ghost" onClick={() => smazat(p.id)} title="Smazat">Smazat</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div data-tour="odmeny-nove-pravidlo" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
        <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--muted)" }}>
          Název (nepovinné)
          <Input value={nove.nazev} onChange={(e) => setNove((n) => ({ ...n, nazev: e.target.value }))} placeholder="Servisní čištění" style={{ width: 170 }} />
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--muted)" }}>
          V názvu opravy je
          <Input value={nove.hledat} onChange={(e) => setNove((n) => ({ ...n, hledat: e.target.value }))} placeholder="servisní čištění" style={{ width: 190 }} />
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--muted)" }}>
          Odměna
          <span style={{ display: "inline-flex", gap: 6 }}>
            <Input inputMode="decimal" value={nove.hodnota} onChange={(e) => setNove((n) => ({ ...n, hodnota: e.target.value }))} placeholder="100" style={{ width: 90, textAlign: "right" }} />
            <select value={nove.typ} onChange={(e) => setNove((n) => ({ ...n, typ: e.target.value as TypOdmeny }))} style={pole}>
              <option value="castka">Kč</option>
              <option value="procento">% z ceny</option>
            </select>
          </span>
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--muted)" }}>
          Komu
          <select value={nove.komu} onChange={(e) => setNove((n) => ({ ...n, komu: e.target.value as KomuOdmena }))} style={pole}>
            <option value="pridal">Kdo opravu přidal</option>
            <option value="technik">Přidělený technik</option>
          </select>
        </label>
        <Button data-tour="odmeny-pridat-pravidlo" variant="primary" size="sm" onClick={pridat} disabled={!nacteno || chybaNacteni}>Přidat pravidlo</Button>
      </div>

      <div data-tour="odmeny-vyzkouset" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <Input value={zkouska} onChange={(e) => setZkouska(e.target.value)} placeholder="Vyzkoušet název opravy, např. Servisní čištění + výměna filtru" style={{ width: 360, maxWidth: "100%" }} />
        {zkouskaVysledek && <span style={{ fontSize: 13, color: "var(--muted)" }}>{zkouskaVysledek}</span>}
      </div>

      <div data-tour="settings-odmeny-kdy" role="radiogroup" aria-label="Kdy se odměna připočítá" style={{ marginBottom: 14, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
        <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 6 }}>Kdy se odměna připočítá</div>
        <div style={{ display: "grid", gap: 8 }}>
          {VOLBY_KDY_ODMENY.map((v) => (
            <label key={v.rezim} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, cursor: "pointer" }}>
              <input type="radio" name="odmeny-kdy" checked={nastaveni.kdy.rezim === v.rezim} onChange={() => zvolRezim(v.rezim)} disabled={!nacteno || chybaNacteni} style={{ marginTop: 3 }} />
              <span>
                <b>{v.nazev}</b>
                {v.rezim === "vydani" && <span style={{ color: "var(--muted)" }}> (výchozí)</span>}
                <div style={{ color: "var(--muted)", fontSize: 12, lineHeight: 1.5 }}>{v.popis}</div>
                {v.rezim === "stav" && nastaveni.kdy.rezim === "stav" && (
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
                    <select
                      aria-label="Stav, ve kterém se odměna připočítá"
                      value={nastaveni.kdy.stav ?? ""}
                      onChange={(e) => { if (e.target.value) nastavKdy({ rezim: "stav", stav: e.target.value }); }}
                      disabled={!nacteno || chybaNacteni}
                      style={pole}
                    >
                      {stavNeplatny && <option value={nastaveni.kdy.stav}>{nastaveni.kdy.stav} (stav už neexistuje)</option>}
                      {stavyKVyberu.map((s) => (
                        <option key={s.key} value={s.key}>{s.label}{s.isFinal ? " (koncový)" : ""}</option>
                      ))}
                    </select>
                    {stavNeplatny && <span style={{ fontSize: 12, color: "var(--muted)" }}>Vybraný stav v servisu není – dokud nevyberete jiný, počítá se po vydání.</span>}
                  </div>
                )}
              </span>
            </label>
          ))}
        </div>
      </div>

      <label data-tour="odmeny-v-navigaci" style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, cursor: "pointer", marginBottom: 10 }}>
        <input type="checkbox" checked={nastaveni.zobrazit_v_navigaci} onChange={(e) => void ulozit({ ...nastaveni, zobrazit_v_navigaci: e.target.checked })} disabled={!nacteno || chybaNacteni} style={{ marginTop: 3 }} />
        <span>
          <b>Zobrazit Odměny v navigaci</b>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>Stránka Odměny v postranním panelu pro celý tým. Majitel a správce se na ni dostanou vždy tlačítkem „Otevřít Odměny“.</div>
        </span>
      </label>

      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, cursor: "pointer" }}>
        <input type="checkbox" checked={nastaveni.verejny_zebricek} onChange={(e) => void ulozit({ ...nastaveni, verejny_zebricek: e.target.checked })} disabled={!nacteno || chybaNacteni} style={{ marginTop: 3 }} />
        <span>
          <b>Kolegové vidí celý žebříček</b>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>Vypnuto: každý vidí jen své odměny, žebříček a zaměstnance měsíce vidí jen majitel a správce.</div>
        </span>
      </label>

      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 12, lineHeight: 1.5 }}>
        Komu se odměna připíše: u „kdo opravu přidal“ ten, kdo opravu na zakázku zapsal (u starších zakázek podle historie, jinak kdo zakázku založil); u „přidělený technik“ technik z karty Technik. Na stránce Odměny jde u každého řádku příjemce změnit nebo řádek vyřadit. Sedí‑li víc pravidel, platí první v pořadí.
        {" "}Podle stejných pravidel si zaměstnanec může na stránce Odměny přidat odměnu i ručně (tlačítko Přidat odměnu, s povinnou poznámkou a případně číslem zakázky) – do součtů se započítá, až ji majitel nebo správce schválí; vaše ruční odměny platí hned.
      </div>

      <AutoSchvalovani activeServiceId={activeServiceId} />
    </Card>
  );
}

/**
 * Automatické schvalování ručních odměn (tabulka odmeny_auto_schvaleni,
 * migrace 20261009100000). Zapnutému členovi se jeho ruční odměny na
 * stránce Odměny uloží rovnou jako schválené. Zapisovat smí jen majitel
 * a správce (RLS) – proto samostatná tabulka, ne klíč v configu servisu.
 */
function AutoSchvalovani({ activeServiceId }: { activeServiceId: string | null }) {
  const { clenove } = useClenoveServisu(activeServiceId, !!activeServiceId);
  const [zapnuti, setZapnuti] = useState<Set<string>>(new Set());
  const [nacteno, setNacteno] = useState(false);
  const [chyba, setChyba] = useState<string | null>(null);
  const [ukladam, setUkladam] = useState<string | null>(null);

  useEffect(() => {
    if (!activeServiceId || !supabase) return;
    let zruseno = false;
    // deno-lint-ignore no-explicit-any
    void (supabase as any).from("odmeny_auto_schvaleni").select("user_id").eq("service_id", activeServiceId)
      .then(({ data, error }: { data: { user_id: string }[] | null; error: { message: string } | null }) => {
        if (zruseno) return;
        if (error) { setChyba(error.message); setNacteno(false); return; }
        setChyba(null);
        setZapnuti(new Set((data ?? []).map((r) => String(r.user_id))));
        setNacteno(true);
      });
    return () => { zruseno = true; };
  }, [activeServiceId]);

  const prepni = async (userId: string, zapnout: boolean) => {
    if (!activeServiceId || !supabase) return;
    setUkladam(userId);
    // deno-lint-ignore no-explicit-any
    const tab = (supabase as any).from("odmeny_auto_schvaleni");
    const { error } = zapnout
      ? await tab.upsert({ service_id: activeServiceId, user_id: userId }, { onConflict: "service_id,user_id", ignoreDuplicates: true })
      : await tab.delete().eq("service_id", activeServiceId).eq("user_id", userId);
    setUkladam(null);
    if (error) { showToast(`Uložení selhalo: ${error.message}`, "error"); return; }
    setZapnuti((s) => {
      const n = new Set(s);
      if (zapnout) n.add(userId); else n.delete(userId);
      return n;
    });
  };

  // Majitel a správce mají své ruční odměny schválené vždy – přepínač u nich nedává smysl.
  const clenoveBezSpravcu = clenove.filter((c) => c.role !== "owner" && c.role !== "admin");

  return (
    <div data-tour="odmeny-auto-schvaleni" style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
      <div style={{ fontWeight: 800, fontSize: 13 }}>Automatické schvalování ručních odměn</div>
      <div style={{ fontSize: 12, color: "var(--muted)", margin: "2px 0 8px", lineHeight: 1.5 }}>
        Zapnutému členovi se ruční odměna uloží rovnou jako schválená (v přehledu se štítkem „schváleno automaticky“). Ostatním čeká, dokud ji neschválíte na stránce Odměny.
      </div>
      {chyba && <div style={{ fontSize: 13, color: "var(--muted)" }}>Nepodařilo se načíst: {chyba}</div>}
      {!chyba && clenoveBezSpravcu.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)" }}>V týmu zatím nejsou členové bez role správce.</div>}
      <div style={{ display: "grid", gap: 6 }}>
        {clenoveBezSpravcu.map((c) => (
          <label key={c.userId} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={zapnuti.has(c.userId)} disabled={!nacteno || ukladam === c.userId} onChange={(e) => void prepni(c.userId, e.target.checked)} />
            <span>{c.jmeno}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
