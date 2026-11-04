import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Input, PageHeader, Segmented } from "../components/ui";
import { StatusBadge } from "../components/tickets/StatusBadge";
import { showToast } from "../components/Toast";
import { reportError } from "../lib/reportError";
import { supabase } from "../lib/supabaseClient";
import { useBranches } from "../context/BranchContext";
import { useStatuses } from "../state/StatusesStore";
import { useClenoveServisu } from "../hooks/useClenoveServisu";
import { rozpoznejRoleStavu } from "../lib/dnes";
import {
  chybiUzaverka,
  csvPohybu,
  hledejZakazky,
  kategorieKNabidce,
  nactiKZaplaceni,
  nactiPosledniHotovostPredDneskem,
  nactiPohyby,
  nactiPokladny,
  nactiStavy,
  nactiUzaverky,
  prevest,
  souhrnPohybu,
  stavPoZaplaceni,
  stornovat,
  subscribePokladna,
  uzavrit,
  zapisPohyb,
  zaplatit,
  type KZaplaceni,
  type NastaveniPokladny,
  type PohybPokladny,
  type Pokladna as PokladnaTyp,
  type StavPokladny,
  type Uzaverka,
  type ZpusobPlatby,
} from "../lib/pokladna";
import { PlatbaOkno, PrevodOkno, StornoOkno, UzaverkaOkno, ZapisOkno, type VysledekPlatby } from "./Pokladna/Okna";
import { Historie } from "./Pokladna/Historie";
import { Prehled } from "./Pokladna/Prehled";
import { kc } from "./Pokladna/format";

type Zalozka = "zaplatit" | "historie" | "prehled";
type Rozsah = "dnes" | "vcera" | "tyden" | "mesic" | "minuly";

type OknoStav =
  | { typ: "platba"; polozka: KZaplaceni; zpusob: ZpusobPlatby }
  | { typ: "zapis"; smer: "prijem" | "vydej" }
  | { typ: "prevod" }
  | { typ: "uzaverka" }
  | { typ: "storno"; pohyb: PohybPokladny }
  | null;

const ROZSAHY: Array<{ value: Rozsah; label: string }> = [
  { value: "dnes", label: "Dnes" },
  { value: "vcera", label: "Včera" },
  { value: "tyden", label: "7 dní" },
  { value: "mesic", label: "Tento měsíc" },
  { value: "minuly", label: "Minulý měsíc" },
];

function obdobi(r: Rozsah, ted = new Date()): { od: Date; do?: Date } {
  const den = new Date(ted);
  den.setHours(0, 0, 0, 0);
  switch (r) {
    case "dnes": return { od: den };
    case "vcera": return { od: new Date(den.getTime() - 86_400_000), do: den };
    case "tyden": return { od: new Date(den.getTime() - 6 * 86_400_000) };
    case "mesic": return { od: new Date(den.getFullYear(), den.getMonth(), 1) };
    case "minuly": return { od: new Date(den.getFullYear(), den.getMonth() - 1, 1), do: new Date(den.getFullYear(), den.getMonth(), 1) };
  }
}

const klicVybrane = (serviceId: string) => `jobi_pokladna_vybrana_${serviceId}`;

function stahniCsv(obsah: string, nazev: string) {
  const blob = new Blob([obsah], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nazev;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Stránka Pokladna.
 *
 * Nahoře stav vybrané pokladny a čtyři akce (příjem, výdaj, převod,
 * uzávěrka). Pod tím záložky: K zaplacení (zakázky připravené k vydání
 * a nezaplacené faktury – jedno klepnutí na Hotově / Kartou), Historie
 * a Přehled s exportem pro účetní.
 */
export default function Pokladna({ activeServiceId, nastaveni, aktivni, onOpenTicket }: {
  activeServiceId: string | null;
  nastaveni: NastaveniPokladny;
  aktivni: boolean;
  onOpenTicket: (ticketId: string) => void;
}) {
  const { activeBranchId, branchById, isMulti } = useBranches();
  const { statuses, getByKey } = useStatuses();
  const { jmeno } = useClenoveServisu(activeServiceId, true);
  const nazevPobocky = useCallback((id: string | null) => (id ? branchById(id)?.name ?? null : null), [branchById]);

  const [vsechnyPokladny, setVsechnyPokladny] = useState<PokladnaTyp[]>([]);
  const [stavy, setStavy] = useState<Map<string, StavPokladny>>(new Map());
  const [vybranaId, setVybranaId] = useState<string | null>(null);
  const [dnesPohyby, setDnesPohyby] = useState<PohybPokladny[]>([]);
  const [starsiHotovost, setStarsiHotovost] = useState<Map<string, string>>(new Map());
  const [rozsah, setRozsah] = useState<Rozsah>("dnes");
  const [pohyby, setPohyby] = useState<PohybPokladny[]>([]);
  const [jenTato, setJenTato] = useState(true);
  const [uzaverky, setUzaverky] = useState<Uzaverka[]>([]);
  const [kZaplaceni, setKZaplaceni] = useState<KZaplaceni[]>([]);
  const [hledat, setHledat] = useState("");
  const [nalezene, setNalezene] = useState<KZaplaceni[] | null>(null);
  const [kody, setKody] = useState<Map<string, string>>(new Map());
  const [zalozka, setZalozka] = useState<Zalozka>("zaplatit");
  const [okno, setOkno] = useState<OknoStav>(null);
  const [nacitam, setNacitam] = useState(true);
  const [nacitamKZ, setNacitamKZ] = useState(true);

  /* Pokladny k vybrané pobočce: její vlastní a ty bez pobočky (celý servis). */
  const pokladny = useMemo(
    () => vsechnyPokladny.filter((p) => !p.archivovana && (!activeBranchId || !p.branchId || p.branchId === activeBranchId)),
    [vsechnyPokladny, activeBranchId],
  );
  const vybrana = pokladny.find((p) => p.id === vybranaId) ?? pokladny[0] ?? null;
  const stav = vybrana ? stavy.get(vybrana.id) ?? null : null;

  useEffect(() => {
    if (!activeServiceId) return;
    try {
      setVybranaId(localStorage.getItem(klicVybrane(activeServiceId)));
    } catch {
      /* jen pohodlí */
    }
  }, [activeServiceId]);
  const vyber = (id: string) => {
    setVybranaId(id);
    try {
      if (activeServiceId) localStorage.setItem(klicVybrane(activeServiceId), id);
    } catch {
      /* jen pohodlí */
    }
  };

  /* ---------- Načítání ---------- */
  const nactiZaklad = useCallback(async () => {
    if (!activeServiceId) return;
    try {
      const den = new Date();
      den.setHours(0, 0, 0, 0);
      const [p, s, d, h] = await Promise.all([nactiPokladny(activeServiceId), nactiStavy(activeServiceId), nactiPohyby(activeServiceId, { od: den }), nactiPosledniHotovostPredDneskem(activeServiceId)]);
      setVsechnyPokladny(p);
      setStavy(s);
      setDnesPohyby(d);
      setStarsiHotovost(h);
    } catch (e) {
      reportError({ code: "pokladna.load_failed", error: e, userMessage: e instanceof Error ? e.message : "Pokladnu se nepodařilo načíst.", source: "Pokladna", serviceId: activeServiceId });
    } finally {
      setNacitam(false);
    }
  }, [activeServiceId]);

  const nactiRozsah = useCallback(async () => {
    if (!activeServiceId) return;
    try {
      const o = obdobi(rozsah);
      setPohyby(await nactiPohyby(activeServiceId, { od: o.od, do: o.do }));
    } catch (e) {
      reportError({ code: "pokladna.history_failed", error: e, userMessage: "Historii pokladny se nepodařilo načíst.", source: "Pokladna", serviceId: activeServiceId });
    }
  }, [activeServiceId, rozsah]);

  const stavyKVydani = useMemo(() => [...rozpoznejRoleStavu(statuses).kPrevzeti], [statuses]);
  const stavyKlic = stavyKVydani.join("\u0001");
  const nactiKZ = useCallback(async () => {
    if (!activeServiceId) return;
    setNacitamKZ(true);
    try {
      setKZaplaceni(await nactiKZaplaceni(activeServiceId, stavyKlic ? stavyKlic.split("\u0001") : []));
    } catch (e) {
      reportError({ code: "pokladna.to_pay_failed", error: e, userMessage: "Zakázky k zaplacení se nepodařilo načíst.", source: "Pokladna", serviceId: activeServiceId });
    } finally {
      setNacitamKZ(false);
    }
  }, [activeServiceId, stavyKlic]);

  useEffect(() => { void nactiZaklad(); }, [nactiZaklad]);
  useEffect(() => { void nactiRozsah(); }, [nactiRozsah]);
  /* „K zaplacení“ se mění se zakázkami (někdo přepne stav na Připraveno) –
     načte se znovu při každém příchodu na stránku. */
  useEffect(() => { if (aktivni) void nactiKZ(); }, [aktivni, nactiKZ]);

  // Realtime: pohyb zapsaný na jiném počítači (druhá pokladna, kolega).
  const casovac = useRef<number | null>(null);
  useEffect(() => {
    if (!activeServiceId) return;
    return subscribePokladna(activeServiceId, () => {
      if (casovac.current) window.clearTimeout(casovac.current);
      casovac.current = window.setTimeout(() => { void nactiZaklad(); void nactiRozsah(); }, 400);
    });
  }, [activeServiceId, nactiZaklad, nactiRozsah]);

  useEffect(() => {
    if (!vybrana) { setUzaverky([]); return; }
    let zruseno = false;
    void nactiUzaverky(vybrana.id, 20).then((u) => { if (!zruseno) setUzaverky(u); }).catch(() => {});
    return () => { zruseno = true; };
  }, [vybrana?.id, stav?.posledniUzaverkaAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hledání zakázky (záloha, doplatek, zakázka v jiném stavu).
  useEffect(() => {
    if (!activeServiceId || hledat.trim().length < 2) { setNalezene(null); return; }
    const id = window.setTimeout(() => {
      void hledejZakazky(activeServiceId, hledat).then(setNalezene).catch(() => setNalezene([]));
    }, 280);
    return () => window.clearTimeout(id);
  }, [activeServiceId, hledat]);

  // Kódy zakázek k řádkům historie.
  useEffect(() => {
    const chybi = [...new Set([...pohyby, ...dnesPohyby].map((p) => p.ticketId).filter((x): x is string => !!x && !kody.has(x)))];
    if (!chybi.length || !supabase) return;
    void (supabase as any).from("tickets").select("id, code").in("id", chybi.slice(0, 300)).then(({ data }: { data: Array<{ id: string; code: string | null }> | null }) => {
      setKody((prev) => {
        const m = new Map(prev);
        for (const t of data ?? []) m.set(t.id, t.code ?? "—");
        for (const id of chybi) if (!m.has(id)) m.set(id, "—");
        return m;
      });
    });
  }, [pohyby, dnesPohyby]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- Odvozené ---------- */
  const dnesTato = useMemo(() => (vybrana ? dnesPohyby.filter((p) => p.pokladnaId === vybrana.id) : []), [dnesPohyby, vybrana]);
  const dnes = useMemo(() => souhrnPohybu(dnesTato), [dnesTato]);
  const pohybyZobrazene = useMemo(
    () => (jenTato && vybrana ? pohyby.filter((p) => p.pokladnaId === vybrana.id) : pohyby.filter((p) => pokladny.some((x) => x.id === p.pokladnaId))),
    [pohyby, jenTato, vybrana, pokladny],
  );
  const kategorie = useMemo(() => ({ prijem: kategorieKNabidce([...pohyby, ...dnesPohyby], "prijem"), vydej: kategorieKNabidce([...pohyby, ...dnesPohyby], "vydej") }), [pohyby, dnesPohyby]);
  const seznam = useMemo(() => {
    const zdroj = nalezene ?? kZaplaceni;
    return activeBranchId ? zdroj.filter((x) => !x.branchId || x.branchId === activeBranchId) : zdroj;
  }, [nalezene, kZaplaceni, activeBranchId]);
  const cilovyStav = useMemo(() => stavPoZaplaceni(nastaveni, statuses), [nastaveni, statuses]);
  const nazevPokladny = useCallback((id: string) => vsechnyPokladny.find((p) => p.id === id)?.nazev ?? "Pokladna", [vsechnyPokladny]);
  const posledniUzaverka = stav?.posledniUzaverkaAt ?? null;
  const uzaverkaChybi = !!vybrana && chybiUzaverka(posledniUzaverka, starsiHotovost.get(vybrana.id));

  const poZapisu = useCallback(async () => {
    setOkno(null);
    await Promise.all([nactiZaklad(), nactiRozsah()]);
  }, [nactiZaklad, nactiRozsah]);

  /* ---------- Akce ---------- */
  const potvrditPlatbu = async (polozka: KZaplaceni, v: VysledekPlatby) => {
    if (!vybrana) return;
    await zaplatit({
      pokladnaId: vybrana.id,
      druh: v.zaloha ? "zaloha" : polozka.ticketId ? "zakazka" : "faktura",
      castka: v.castka,
      zpusob: v.zpusob,
      ticketId: polozka.ticketId,
      invoiceId: v.zaloha ? null : polozka.invoiceId,
      zaokrouhleni: v.zaokrouhleni,
    });
    setHledat("");
    await poZapisu();
    void nactiKZ();
    const co = polozka.kod || polozka.nazev;
    // Vydání: jen celá platba zakázky, která ještě není v koncovém stavu.
    const meni = !v.zaloha && polozka.ticketId && cilovyStav && polozka.stav !== cilovyStav && !(polozka.stav && getByKey(polozka.stav)?.isFinal);
    if (!meni) {
      showToast(`${v.zaloha ? "Záloha" : "Zaplaceno"} ${kc(v.castka)} · ${co}`, "success");
      return;
    }
    const nazevStavu = getByKey(cilovyStav!)?.label ?? cilovyStav!;
    window.dispatchEvent(new CustomEvent("jobsheet:zmen-stav-zakazky", {
      detail: {
        ticketId: polozka.ticketId,
        statusKey: cilovyStav,
        hotovo: (ok: boolean) => {
          if (ok) showToast(`Zaplaceno ${kc(v.castka)} · ${co} → ${nazevStavu}`, "success");
          else showToast(`Zaplaceno ${kc(v.castka)}, ale stav zakázky ${co} se nezměnil – přepněte ho ručně.`, "error");
          void nactiKZ();
        },
      },
    }));
  };

  const exportovat = () => {
    if (!pohybyZobrazene.length) { showToast("V tomhle období nic není.", "info"); return; }
    const kodZ = (id: string) => kody.get(id) ?? "";
    const csv = csvPohybu(pohybyZobrazene, nazevPokladny, (u) => jmeno(u) ?? "", kodZ);
    const o = obdobi(rozsah);
    const d = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
    stahniCsv(csv, `pokladna-${d(o.od)}${rozsah === "dnes" ? "" : `-${d(o.do ? new Date(o.do.getTime() - 1) : new Date())}`}.csv`);
  };

  /* ---------- Vykreslení ---------- */
  if (!nacitam && pokladny.length === 0) {
    return (
      <div style={{ padding: "var(--space-6, 24px)", maxWidth: 720 }}>
        <PageHeader title="Pokladna" />
        <div style={{ marginTop: 16, padding: 24, borderRadius: 16, border: "1px dashed var(--border)", color: "var(--muted)", fontSize: 14, lineHeight: 1.6 }}>
          {vsechnyPokladny.length === 0 ? "Pokladna zatím nemá žádnou pokladnu." : "Pro vybranou pobočku není pokladna."} Správce ji přidá v Nastavení → Firma → Pokladna.
        </div>
      </div>
    );
  }

  const akce: Array<{ t: string; ikona: string; onClick: () => void; hlavni?: boolean }> = [
    { t: "Příjem", ikona: "+", onClick: () => setOkno({ typ: "zapis", smer: "prijem" }), hlavni: true },
    { t: "Výdaj", ikona: "−", onClick: () => setOkno({ typ: "zapis", smer: "vydej" }) },
    { t: "Převod", ikona: "⇄", onClick: () => setOkno({ typ: "prevod" }) },
    { t: "Uzávěrka", ikona: "✓", onClick: () => setOkno({ typ: "uzaverka" }) },
  ];

  return (
    <div style={{ padding: "var(--space-5, 20px)", display: "grid", gap: 18, maxWidth: 1200, margin: "0 auto", minWidth: 0 }}>
      <PageHeader
        title="Pokladna"
        actions={pokladny.length > 1 ? (
          pokladny.length <= 4 ? (
            <Segmented<string> value={vybrana?.id ?? ""} onChange={vyber} ariaLabel="Pokladna" options={pokladny.map((p) => ({ value: p.id, label: p.nazev }))} />
          ) : (
            <select className="ui-input" value={vybrana?.id ?? ""} onChange={(e) => vyber(e.target.value)} aria-label="Pokladna" style={{ width: "auto" }}>
              {pokladny.map((p) => <option key={p.id} value={p.id}>{p.nazev}{nazevPobocky(p.branchId) ? ` · ${nazevPobocky(p.branchId)}` : ""}</option>)}
            </select>
          )
        ) : undefined}
      />

      {/* Stav a akce */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "stretch" }}>
        <div style={{ flex: "1 1 320px", minWidth: 0, padding: "20px 22px", borderRadius: 20, background: "linear-gradient(135deg, var(--accent-soft), var(--panel))", border: "1px solid var(--border)", display: "grid", gap: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 700 }}>
              V pokladně{vybrana ? ` · ${vybrana.nazev}` : ""}{isMulti && vybrana?.branchId && nazevPobocky(vybrana.branchId) !== vybrana.nazev ? ` · ${nazevPobocky(vybrana.branchId) ?? ""}` : ""}
            </span>
            <span style={{ fontSize: 12, color: uzaverkaChybi ? "var(--danger-text, var(--danger))" : "var(--muted)", fontWeight: uzaverkaChybi ? 700 : 500 }}>
              {uzaverkaChybi ? "Chybí uzávěrka" : posledniUzaverka ? `uzávěrka ${new Date(posledniUzaverka).toLocaleString("cs-CZ", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}` : "bez uzávěrky"}
            </span>
          </div>
          <div style={{ fontSize: "clamp(34px, 6vw, 48px)", fontWeight: 900, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>
            {nacitam && !stav ? "…" : kc(stav?.stav ?? vybrana?.pocatecniStav ?? 0)}
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13, color: "var(--muted)" }}>
            <span>Dnes tržba <strong style={{ color: "var(--text)" }}>{kc(dnes.trzbaCelkem)}</strong></span>
            <span>hotově {kc(dnes.trzba.cash)}</span>
            <span>kartou {kc(dnes.trzba.card)}</span>
            {dnes.vydaje ? <span>výdaje {kc(dnes.vydaje)}</span> : null}
          </div>
        </div>
        <div style={{ flex: "1 1 280px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {akce.map((a) => (
            <button
              key={a.t}
              type="button"
              onClick={a.onClick}
              disabled={!vybrana}
              style={{
                display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderRadius: 16, cursor: "pointer", fontFamily: "inherit",
                border: `1px solid ${a.hlavni ? "var(--accent)" : "var(--border)"}`, background: a.hlavni ? "var(--accent)" : "var(--panel)",
                color: a.hlavni ? "#fff" : "var(--text)", fontWeight: 800, fontSize: 15, textAlign: "left",
              }}
            >
              <span aria-hidden style={{ width: 30, height: 30, borderRadius: 10, display: "inline-flex", alignItems: "center", justifyContent: "center", background: a.hlavni ? "rgba(255,255,255,0.18)" : "var(--panel-2)", fontSize: 17 }}>{a.ikona}</span>
              {a.t}
            </button>
          ))}
        </div>
      </div>

      <Segmented<Zalozka>
        value={zalozka}
        onChange={setZalozka}
        ariaLabel="Část pokladny"
        options={[
          { value: "zaplatit", label: `K zaplacení${seznam.length && !nalezene ? ` (${seznam.length})` : ""}` },
          { value: "historie", label: "Historie" },
          { value: "prehled", label: "Přehled" },
        ]}
      />

      {zalozka === "zaplatit" && (
        <div style={{ display: "grid", gap: 10 }}>
          <Input value={hledat} onChange={(e) => setHledat(e.target.value)} placeholder="Hledat zakázku – číslo, zákazník, telefon (záloha, doplatek…)" aria-label="Hledat zakázku" />
          {!nalezene && !nacitamKZ && seznam.length === 0 && (
            <div style={{ padding: "28px 12px", textAlign: "center", color: "var(--muted)", fontSize: 14, lineHeight: 1.6 }}>
              Nic nečeká na zaplacení.<br />Zakázky ve stavu „připraveno k vydání“ a nezaplacené faktury se tu objeví samy.
            </div>
          )}
          {nalezene && nalezene.length === 0 && <div style={{ padding: 16, color: "var(--muted)", fontSize: 14 }}>Nic nenalezeno.</div>}
          <div style={{ display: "grid", gap: 8 }}>
            {seznam.map((x) => {
              const meta = x.stav ? getByKey(x.stav) : undefined;
              return (
                <div key={x.klic} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 14px", borderRadius: 16, border: "1px solid var(--border)", background: "var(--panel)", flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 220px", minWidth: 0, display: "grid", gap: 3 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      {x.ticketId ? (
                        <button type="button" onClick={() => onOpenTicket(x.ticketId!)} style={{ border: "none", background: "none", padding: 0, fontWeight: 850, fontSize: 15, color: "var(--text)", cursor: "pointer", fontFamily: "inherit" }}>{x.kod || "Zakázka"}</button>
                      ) : <span style={{ fontWeight: 850, fontSize: 15 }}>{x.kod}</span>}
                      {meta ? <StatusBadge label={meta.label} bg={meta.bg ?? "#6b7280"} /> : null}
                      {x.invoiceId ? <span style={{ fontSize: 11, fontWeight: 700, padding: "1px 8px", borderRadius: 999, background: "var(--panel-2)", color: "var(--muted)" }}>faktura</span> : null}
                    </div>
                    <div style={{ fontSize: 13, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {[x.nazev, x.zakaznik].filter(Boolean).join(" · ")}
                      {x.zaplaceno > 0 ? ` · zaplaceno ${kc(x.zaplaceno)}` : ""}
                    </div>
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 900, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                    {x.zbyva > 0 ? kc(x.zbyva) : x.celkem > 0 ? <span style={{ color: "var(--success-text, var(--text))", fontSize: 14 }}>zaplaceno</span> : <span style={{ color: "var(--muted)", fontSize: 14 }}>bez ceny</span>}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <Button variant="primary" onClick={() => setOkno({ typ: "platba", polozka: x, zpusob: "cash" })} disabled={!vybrana}>Hotově</Button>
                    <Button variant="soft" onClick={() => setOkno({ typ: "platba", polozka: x, zpusob: "card" })} disabled={!vybrana}>Kartou</Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {(zalozka === "historie" || zalozka === "prehled") && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Segmented<Rozsah> value={rozsah} onChange={setRozsah} ariaLabel="Období" options={ROZSAHY} size="sm" />
          {zalozka === "historie" && pokladny.length > 1 && (
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--muted)", cursor: "pointer" }}>
              <input type="checkbox" checked={jenTato} onChange={(e) => setJenTato(e.target.checked)} /> jen {vybrana?.nazev ?? "tato pokladna"}
            </label>
          )}
          <span style={{ flex: 1 }} />
          <Button size="sm" variant="ghost" onClick={exportovat}>Export CSV</Button>
        </div>
      )}

      {zalozka === "historie" && (
        <Historie
          pohyby={pohybyZobrazene}
          nazevPokladny={nazevPokladny}
          ukazatPokladnu={!jenTato && pokladny.length > 1}
          jmeno={jmeno}
          kodZakazky={(id) => kody.get(id) ?? null}
          onOpenTicket={onOpenTicket}
          onStorno={(p) => setOkno({ typ: "storno", pohyb: p })}
          nacitam={nacitam}
        />
      )}

      {zalozka === "prehled" && (
        <Prehled
          pohyby={pohyby.filter((p) => pokladny.some((x) => x.id === p.pokladnaId))}
          pokladny={pokladny}
          nazevPobocky={nazevPobocky}
          uzaverky={uzaverky}
          jmeno={jmeno}
        />
      )}

      {/* Okna */}
      {okno?.typ === "platba" && (
        <PlatbaOkno
          polozka={okno.polozka}
          vychoziZpusob={okno.zpusob}
          zaokrouhlovat={nastaveni.zaokrouhlovat}
          stavPoPlatbe={okno.polozka.ticketId && cilovyStav && !(okno.polozka.stav && getByKey(okno.polozka.stav)?.isFinal) && okno.polozka.stav !== cilovyStav ? getByKey(cilovyStav)?.label ?? null : null}
          onClose={() => setOkno(null)}
          onPotvrdit={(v) => potvrditPlatbu(okno.polozka, v)}
        />
      )}
      {okno?.typ === "zapis" && vybrana && (
        <ZapisOkno
          smer={okno.smer}
          pokladna={vybrana}
          kategorie={kategorie}
          onClose={() => setOkno(null)}
          onPotvrdit={async (v) => {
            await zapisPohyb({ pokladnaId: vybrana.id, druh: v.druh, castka: v.castka, zpusob: v.zpusob, kategorie: v.kategorie, popis: v.popis });
            await poZapisu();
            showToast(`Zapsáno ${okno.smer === "prijem" ? "+" : "−"}${kc(v.castka)}`, "success");
          }}
        />
      )}
      {okno?.typ === "prevod" && vybrana && (
        <PrevodOkno
          z={vybrana}
          pokladny={vsechnyPokladny}
          nazevPobocky={nazevPobocky}
          onClose={() => setOkno(null)}
          onPotvrdit={async (v) => {
            await prevest({ z: vybrana.id, do: v.doId, castka: v.castka, popis: v.popis });
            await poZapisu();
            showToast(`Převedeno ${kc(v.castka)} do ${nazevPokladny(v.doId)}`, "success");
          }}
        />
      )}
      {okno?.typ === "uzaverka" && vybrana && (
        <UzaverkaOkno
          pokladna={vybrana}
          ocekavano={stav?.stav ?? vybrana.pocatecniStav}
          posledni={posledniUzaverka}
          onClose={() => setOkno(null)}
          onPotvrdit={async (v) => {
            const u = await uzavrit({ pokladnaId: vybrana.id, napocitano: v.napocitano, platidla: v.platidla, poznamka: v.poznamka });
            await poZapisu();
            showToast(u.rozdil === 0 ? "Uzávěrka sedí." : `Uzávěrka uložena, ${u.rozdil < 0 ? "manko" : "přebytek"} ${kc(Math.abs(u.rozdil))}.`, u.rozdil === 0 ? "success" : "info");
          }}
        />
      )}
      {okno?.typ === "storno" && (
        <StornoOkno
          popis={`${okno.pohyb.smer === "prijem" ? "+" : "−"}${kc(okno.pohyb.castka)} · ${okno.pohyb.kategorie ?? okno.pohyb.popis ?? ""}`}
          onClose={() => setOkno(null)}
          onPotvrdit={async (duvod) => {
            await stornovat(okno.pohyb.id, duvod);
            await poZapisu();
            void nactiKZ();
            showToast("Pohyb stornován.", "success");
          }}
        />
      )}
    </div>
  );
}
