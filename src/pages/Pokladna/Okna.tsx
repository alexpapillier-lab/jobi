import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button, Input, Segmented } from "../../components/ui";
import {
  PLATIDLA,
  ZPUSOB_TEXT,
  ctiCastku,
  kolikVratit,
  soucetPlatidel,
  zaokrouhliHotovost,
  type KZaplaceni,
  type Pokladna,
  type ZpusobPlatby,
} from "../../lib/pokladna";
import { kc } from "./format";

/**
 * Okna pokladny. Všechna jdou ovládat klávesnicí: částka má fokus hned po
 * otevření, Enter potvrdí, Escape zavře.
 */
export function Okno({ titulek, podtitulek, onClose, children, sirka = 460 }: { titulek: ReactNode; podtitulek?: ReactNode; onClose: () => void; children: ReactNode; sirka?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      data-escape-vlastni
      onMouseDown={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10_000, padding: 16 }}
    >
      <div style={{ background: "var(--panel)", color: "var(--text)", borderRadius: 18, border: "1px solid var(--border)", padding: 20, width: `min(100%, ${sirka}px)`, maxHeight: "92vh", overflow: "auto", display: "grid", gap: 16, boxShadow: "0 24px 70px rgba(0,0,0,0.35)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 850 }}>{titulek}</h2>
            {podtitulek ? <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>{podtitulek}</div> : null}
          </div>
          <button type="button" aria-label="Zavřít" onClick={onClose} style={{ border: "none", background: "transparent", color: "var(--muted)", fontSize: 22, lineHeight: 1, cursor: "pointer", padding: 4 }}>×</button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** Velké pole na částku – hlavní věc každého okna. */
export function PoleCastky({ value, onChange, autoFocus = true, label = "Částka", onEnter }: { value: string; onChange: (v: string) => void; autoFocus?: boolean; label?: string; onEnter?: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) window.setTimeout(() => { ref.current?.focus(); ref.current?.select(); }, 30);
  }, [autoFocus]);
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 700 }}>{label}</span>
      <span style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "10px 14px", borderRadius: 14, border: "1px solid var(--border)", background: "var(--panel-2)" }}>
        <input
          ref={ref}
          value={value}
          inputMode="decimal"
          aria-label={label}
          placeholder="0"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && onEnter) { e.preventDefault(); onEnter(); } }}
          style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", color: "var(--text)", fontSize: 30, fontWeight: 850, fontFamily: "inherit", fontVariantNumeric: "tabular-nums" }}
        />
        <span style={{ fontSize: 18, color: "var(--muted)", fontWeight: 700 }}>Kč</span>
      </span>
    </label>
  );
}

function VolbaZpusobu({ value, onChange, moznosti = ["cash", "card"] }: { value: ZpusobPlatby; onChange: (z: ZpusobPlatby) => void; moznosti?: ZpusobPlatby[] }) {
  return <Segmented<ZpusobPlatby> value={value} onChange={onChange} ariaLabel="Způsob platby" options={moznosti.map((z) => ({ value: z, label: ZPUSOB_TEXT[z] }))} />;
}

function Chyba({ text }: { text: string | null }) {
  if (!text) return null;
  return <div role="alert" style={{ fontSize: 13, color: "var(--danger-text, var(--danger))", background: "var(--danger-soft, transparent)", borderRadius: 10, padding: "8px 10px" }}>{text}</div>;
}

// ---------------------------------------------------------------------------
// Platba
// ---------------------------------------------------------------------------

export type VysledekPlatby = { castka: number; zaokrouhleni: number; zpusob: ZpusobPlatby; zaloha: boolean };

/**
 * Platba zakázky nebo faktury. Hotově: na celé koruny (podle nastavení)
 * a výpočet, kolik vrátit. Záloha jen u zakázky – zaplatí se část a zakázka
 * zůstane, kde je.
 */
export function PlatbaOkno({
  polozka,
  vychoziZpusob,
  zaokrouhlovat,
  stavPoPlatbe,
  onClose,
  onPotvrdit,
}: {
  polozka: KZaplaceni;
  vychoziZpusob: ZpusobPlatby;
  zaokrouhlovat: boolean;
  /** Název stavu, na který se zakázka po zaplacení přepne; null = nepřepne se. */
  stavPoPlatbe: string | null;
  onClose: () => void;
  onPotvrdit: (v: VysledekPlatby) => Promise<void>;
}) {
  const [zpusob, setZpusob] = useState<ZpusobPlatby>(vychoziZpusob);
  const [zaloha, setZaloha] = useState(false);
  const [castkaText, setCastkaText] = useState("");
  const [dalText, setDalText] = useState("");
  const [pracuji, setPracuji] = useState(false);
  const [chyba, setChyba] = useState<string | null>(null);

  const zbyva = polozka.zbyva;
  const bezCeny = zbyva <= 0;
  // Částka k zaplacení: zbytek (po zálohách), u zálohy nebo zakázky bez ceny zadaná ručně.
  const zadana = ctiCastku(castkaText);
  const zaklad = zaloha || bezCeny ? zadana : zbyva;
  const zaokr = zaklad !== null && zpusob === "cash" && zaokrouhlovat ? zaokrouhliHotovost(zaklad) : zaklad !== null ? { castka: zaklad, zaokrouhleni: 0 } : null;
  const dal = dalText.trim() ? ctiCastku(dalText) : null;
  const vratit = zaokr ? kolikVratit(zaokr.castka, dal) : null;

  // Rychlé volby „zákazník dal“: přesně a nejbližší vyšší částky v bankovkách.
  const navrhy: number[] = [];
  if (zaokr && zpusob === "cash") {
    const c = zaokr.castka;
    const out = new Set<number>([c]);
    for (const h of [500, 1000, 2000, 5000]) {
      const n = Math.ceil(c / h) * h;
      if (n > c) out.add(n);
      if (out.size >= 4) break;
    }
    navrhy.push(...out);
  }

  const potvrdit = async () => {
    if (pracuji) return;
    if (!zaokr || zaokr.castka <= 0) { setChyba(zaloha ? "Zadejte výši zálohy." : "Zadejte částku."); return; }
    if (zaloha && zaokr.castka >= zbyva && zbyva > 0) { setChyba("Záloha je stejná nebo vyšší než cena – zaplaťte celou částku."); return; }
    setPracuji(true);
    setChyba(null);
    try {
      await onPotvrdit({ castka: zaokr.castka, zaokrouhleni: zaokr.zaokrouhleni, zpusob, zaloha });
    } catch (e) {
      setChyba(e instanceof Error ? e.message : "Platbu se nepodařilo zapsat.");
      setPracuji(false);
    }
  };

  const zakazka = !!polozka.ticketId;
  return (
    <Okno
      titulek={zaloha ? "Záloha" : "Platba"}
      podtitulek={<>{polozka.kod ? <strong>{polozka.kod}</strong> : null}{polozka.kod ? " · " : ""}{polozka.nazev}{polozka.zakaznik ? ` · ${polozka.zakaznik}` : ""}</>}
      onClose={onClose}
    >
      <VolbaZpusobu value={zpusob} onChange={setZpusob} moznosti={["cash", "card", "transfer"]} />

      {zaloha || bezCeny ? (
        <PoleCastky value={castkaText} onChange={setCastkaText} label={zaloha ? "Výše zálohy" : "Částka (zakázka nemá cenu)"} onEnter={() => void potvrdit()} />
      ) : (
        <div style={{ display: "grid", gap: 4, padding: "14px 16px", borderRadius: 14, background: "var(--panel-2)", border: "1px solid var(--border)" }}>
          <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 700 }}>K zaplacení</span>
          <span style={{ fontSize: 34, fontWeight: 900, fontVariantNumeric: "tabular-nums" }}>{kc(zaokr?.castka ?? zbyva)}</span>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            {polozka.zaplaceno > 0 ? `cena ${kc(polozka.celkem)}, zálohy ${kc(polozka.zaplaceno)}` : ""}
            {zaokr && zaokr.zaokrouhleni !== 0 ? `${polozka.zaplaceno > 0 ? " · " : ""}zaokrouhleno z ${kc(zbyva)} (${zaokr.zaokrouhleni > 0 ? "+" : ""}${kc(zaokr.zaokrouhleni)})` : ""}
          </span>
        </div>
      )}

      {zpusob === "cash" && zaokr && (
        <div style={{ display: "grid", gap: 8 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 700 }}>Zákazník dal</span>
            <Input value={dalText} onChange={(e) => setDalText(e.target.value)} inputMode="decimal" placeholder="nepovinné" aria-label="Zákazník dal" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void potvrdit(); } }} />
          </label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {navrhy.map((n) => (
              <button key={n} type="button" onClick={() => setDalText(String(n))} style={{ padding: "6px 12px", borderRadius: 999, border: "1px solid var(--border)", background: dal === n ? "var(--accent-soft)" : "var(--panel)", color: "var(--text)", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
                {n === zaokr.castka ? "Přesně" : kc(n)}
              </button>
            ))}
          </div>
          {vratit !== null && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "10px 14px", borderRadius: 12, background: "var(--success-soft, var(--accent-soft))" }}>
              <span style={{ fontWeight: 700 }}>Vrátit</span>
              <span style={{ fontSize: 24, fontWeight: 900, fontVariantNumeric: "tabular-nums" }}>{kc(vratit)}</span>
            </div>
          )}
          {dal !== null && vratit === null && <div style={{ fontSize: 13, color: "var(--danger-text, var(--danger))" }}>Zákazník dal méně, než je k zaplacení.</div>}
        </div>
      )}

      {zakazka && !bezCeny && (
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={zaloha} onChange={(e) => { setZaloha(e.target.checked); setChyba(null); }} />
          Jen záloha (zakázka zůstane v práci)
        </label>
      )}

      <Chyba text={chyba} />

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
        <Button variant="ghost" onClick={onClose}>Zrušit</Button>
        <Button variant="primary" size="lg" onClick={() => void potvrdit()} disabled={pracuji}>
          {pracuji ? "Zapisuji…" : zaloha ? `Přijmout zálohu${zaokr ? ` ${kc(zaokr.castka)}` : ""}` : `Zaplaceno${zaokr ? ` ${kc(zaokr.castka)}` : ""}`}
        </Button>
      </div>
      {zakazka && !zaloha && stavPoPlatbe && (
        <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "right", marginTop: -8 }}>Zakázka se přepne na „{stavPoPlatbe}“.</div>
      )}
    </Okno>
  );
}

// ---------------------------------------------------------------------------
// Ruční příjem / výdaj
// ---------------------------------------------------------------------------

export type DruhZapisu = "prijem" | "vklad" | "vydej" | "vyber" | "odvod";

const DRUHY_PRIJMU: Array<{ value: DruhZapisu; label: string }> = [{ value: "prijem", label: "Příjem" }, { value: "vklad", label: "Vklad" }];
const DRUHY_VYDAJE: Array<{ value: DruhZapisu; label: string }> = [{ value: "vydej", label: "Výdaj" }, { value: "vyber", label: "Výběr" }, { value: "odvod", label: "Do banky" }];

const POPIS_DRUHU: Record<DruhZapisu, string> = {
  prijem: "Peníze, které nejsou za zakázku – prodej příslušenství, drobný prodej.",
  vklad: "Peníze vložené do pokladny (drobné na vracení, doplnění).",
  vydej: "Nákup z pokladny – díly, poštovné, kancelář.",
  vyber: "Peníze vybrané z pokladny (majitel, výplata).",
  odvod: "Tržba odnesená do banky.",
};

export function ZapisOkno({
  smer,
  pokladna,
  kategorie,
  onClose,
  onPotvrdit,
}: {
  smer: "prijem" | "vydej";
  pokladna: Pokladna;
  kategorie: { prijem: string[]; vydej: string[] };
  onClose: () => void;
  onPotvrdit: (v: { druh: DruhZapisu; castka: number; zpusob: ZpusobPlatby; kategorie: string | null; popis: string | null }) => Promise<void>;
}) {
  const [druh, setDruh] = useState<DruhZapisu>(smer);
  const [castkaText, setCastkaText] = useState("");
  const [kat, setKat] = useState<string>("");
  const [popis, setPopis] = useState("");
  const [zpusob, setZpusob] = useState<ZpusobPlatby>("cash");
  const [pracuji, setPracuji] = useState(false);
  const [chyba, setChyba] = useState<string | null>(null);
  const sKategorii = druh === "prijem" || druh === "vydej";
  const nabidka = druh === "vydej" ? kategorie.vydej : kategorie.prijem;

  const potvrdit = async () => {
    if (pracuji) return;
    const castka = ctiCastku(castkaText);
    if (castka === null) { setChyba("Zadejte částku."); return; }
    setPracuji(true);
    setChyba(null);
    try {
      await onPotvrdit({ druh, castka, zpusob: sKategorii ? zpusob : "cash", kategorie: sKategorii ? kat.trim() || null : null, popis: popis.trim() || null });
    } catch (e) {
      setChyba(e instanceof Error ? e.message : "Pohyb se nepodařilo zapsat.");
      setPracuji(false);
    }
  };

  return (
    <Okno titulek={smer === "prijem" ? "Příjem do pokladny" : "Výdaj z pokladny"} podtitulek={pokladna.nazev} onClose={onClose}>
      <Segmented<DruhZapisu> value={druh} onChange={(d) => { setDruh(d); setChyba(null); }} ariaLabel="Druh pohybu" options={smer === "prijem" ? DRUHY_PRIJMU : DRUHY_VYDAJE} />
      <div style={{ fontSize: 13, color: "var(--muted)", marginTop: -6 }}>{POPIS_DRUHU[druh]}</div>
      <PoleCastky value={castkaText} onChange={setCastkaText} onEnter={() => void potvrdit()} />
      {sKategorii && (
        <div style={{ display: "grid", gap: 8 }}>
          <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 700 }}>Kategorie</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {nabidka.map((k) => {
              const vybrana = kat.trim().toLowerCase() === k.toLowerCase();
              return (
                <button key={k} type="button" onClick={() => setKat(vybrana ? "" : k)} aria-pressed={vybrana} style={{ padding: "6px 12px", borderRadius: 999, border: `1px solid ${vybrana ? "var(--accent)" : "var(--border)"}`, background: vybrana ? "var(--accent-soft)" : "var(--panel)", color: "var(--text)", fontWeight: 650, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
                  {k}
                </button>
              );
            })}
          </div>
          <Input value={kat} onChange={(e) => setKat(e.target.value)} placeholder="nebo napište vlastní" aria-label="Vlastní kategorie" maxLength={60} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void potvrdit(); } }} />
        </div>
      )}
      <label style={{ display: "grid", gap: 6 }}>
        <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 700 }}>Poznámka</span>
        <Input value={popis} onChange={(e) => setPopis(e.target.value)} placeholder={druh === "vydej" ? "např. displej iPhone 13, Mobilparts" : "nepovinné"} aria-label="Poznámka" maxLength={500} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void potvrdit(); } }} />
      </label>
      {sKategorii && <VolbaZpusobu value={zpusob} onChange={setZpusob} />}
      <Chyba text={chyba} />
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Button variant="ghost" onClick={onClose}>Zrušit</Button>
        <Button variant={smer === "vydej" ? "danger" : "primary"} size="lg" onClick={() => void potvrdit()} disabled={pracuji}>{pracuji ? "Zapisuji…" : "Zapsat"}</Button>
      </div>
    </Okno>
  );
}

// ---------------------------------------------------------------------------
// Převod
// ---------------------------------------------------------------------------

export function PrevodOkno({ z, pokladny, nazevPobocky, onClose, onPotvrdit }: {
  z: Pokladna;
  pokladny: Pokladna[];
  nazevPobocky: (id: string | null) => string | null;
  onClose: () => void;
  onPotvrdit: (v: { doId: string; castka: number; popis: string | null }) => Promise<void>;
}) {
  const cile = pokladny.filter((p) => p.id !== z.id && !p.archivovana);
  const [doId, setDoId] = useState(cile[0]?.id ?? "");
  const [castkaText, setCastkaText] = useState("");
  const [popis, setPopis] = useState("");
  const [pracuji, setPracuji] = useState(false);
  const [chyba, setChyba] = useState<string | null>(null);
  const potvrdit = async () => {
    const castka = ctiCastku(castkaText);
    if (!doId) { setChyba("Vyberte cílovou pokladnu."); return; }
    if (castka === null) { setChyba("Zadejte částku."); return; }
    setPracuji(true);
    setChyba(null);
    try {
      await onPotvrdit({ doId, castka, popis: popis.trim() || null });
    } catch (e) {
      setChyba(e instanceof Error ? e.message : "Převod se nepodařilo zapsat.");
      setPracuji(false);
    }
  };
  const popisek = (p: Pokladna) => [p.nazev, nazevPobocky(p.branchId)].filter(Boolean).join(" · ");
  return (
    <Okno titulek="Převod mezi pokladnami" podtitulek={`Z pokladny ${popisek(z)}`} onClose={onClose}>
      {cile.length === 0 ? (
        <div style={{ color: "var(--muted)", fontSize: 14 }}>Jiná pokladna není. Další přidáte v Nastavení → Firma → Pokladna.</div>
      ) : (
        <>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 700 }}>Do pokladny</span>
            <select className="ui-input" value={doId} onChange={(e) => setDoId(e.target.value)} aria-label="Cílová pokladna">
              {cile.map((p) => <option key={p.id} value={p.id}>{popisek(p)}</option>)}
            </select>
          </label>
          <PoleCastky value={castkaText} onChange={setCastkaText} onEnter={() => void potvrdit()} />
          <Input value={popis} onChange={(e) => setPopis(e.target.value)} placeholder="Poznámka (nepovinné)" aria-label="Poznámka" maxLength={500} />
        </>
      )}
      <Chyba text={chyba} />
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Button variant="ghost" onClick={onClose}>Zrušit</Button>
        {cile.length > 0 && <Button variant="primary" size="lg" onClick={() => void potvrdit()} disabled={pracuji}>{pracuji ? "Zapisuji…" : "Převést"}</Button>}
      </div>
    </Okno>
  );
}

// ---------------------------------------------------------------------------
// Uzávěrka
// ---------------------------------------------------------------------------

export function UzaverkaOkno({ pokladna, ocekavano, posledni, onClose, onPotvrdit }: {
  pokladna: Pokladna;
  ocekavano: number;
  posledni: string | null;
  onClose: () => void;
  onPotvrdit: (v: { napocitano: number; platidla: Record<string, number> | null; poznamka: string | null }) => Promise<void>;
}) {
  const [poBankovkach, setPoBankovkach] = useState(true);
  const [pocty, setPocty] = useState<Record<string, string>>({});
  const [celkemText, setCelkemText] = useState("");
  const [poznamka, setPoznamka] = useState("");
  const [pracuji, setPracuji] = useState(false);
  const [chyba, setChyba] = useState<string | null>(null);

  const napocitano = poBankovkach ? soucetPlatidel(pocty) : celkemText.trim() === "0" ? 0 : ctiCastku(celkemText);
  const rozdil = napocitano === null ? null : Math.round((napocitano - ocekavano) * 100) / 100;

  const potvrdit = async () => {
    if (napocitano === null) { setChyba("Zadejte napočítanou částku."); return; }
    if (rozdil !== 0 && !poznamka.trim() && rozdil !== null && Math.abs(rozdil) >= 1) {
      setChyba("Při rozdílu napište krátce proč (poznámka).");
      return;
    }
    setPracuji(true);
    setChyba(null);
    try {
      const platidla = poBankovkach
        ? Object.fromEntries(Object.entries(pocty).map(([k, v]) => [k, Math.floor(Number(v) || 0)]).filter(([, v]) => (v as number) > 0))
        : null;
      await onPotvrdit({ napocitano, platidla, poznamka: poznamka.trim() || null });
    } catch (e) {
      setChyba(e instanceof Error ? e.message : "Uzávěrku se nepodařilo uložit.");
      setPracuji(false);
    }
  };

  return (
    <Okno
      titulek="Uzávěrka pokladny"
      podtitulek={`${pokladna.nazev}${posledni ? ` · minulá ${new Date(posledni).toLocaleString("cs-CZ", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}` : " · první uzávěrka"}`}
      onClose={onClose}
      sirka={520}
    >
      <Segmented<"bankovky" | "celkem"> value={poBankovkach ? "bankovky" : "celkem"} onChange={(v) => setPoBankovkach(v === "bankovky")} ariaLabel="Způsob počítání" options={[{ value: "bankovky", label: "Spočítat bankovky" }, { value: "celkem", label: "Zadat celkem" }]} />
      {poBankovkach ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
          {PLATIDLA.map((h) => {
            const n = Math.floor(Number(pocty[String(h)]) || 0);
            return (
              <label key={h} style={{ display: "grid", gridTemplateColumns: "64px 1fr", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 10, border: "1px solid var(--border)", background: n > 0 ? "var(--accent-soft)" : "var(--panel-2)" }}>
                <span style={{ fontWeight: 800, fontSize: 13, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{h.toLocaleString("cs-CZ")} Kč</span>
                <input
                  value={pocty[String(h)] ?? ""}
                  onChange={(e) => setPocty((p) => ({ ...p, [String(h)]: e.target.value.replace(/\D/g, "") }))}
                  inputMode="numeric"
                  placeholder="0"
                  aria-label={`Počet ${h} Kč`}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void potvrdit(); } }}
                  style={{ width: "100%", minWidth: 0, border: "none", background: "transparent", color: "var(--text)", fontSize: 16, fontWeight: 700, fontFamily: "inherit", outline: "none" }}
                />
              </label>
            );
          })}
        </div>
      ) : (
        <PoleCastky value={celkemText} onChange={setCelkemText} label="Napočítáno celkem" onEnter={() => void potvrdit()} />
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        {[
          { t: "Má být", v: kc(ocekavano), barva: "var(--text)" },
          { t: "Napočítáno", v: napocitano === null ? "—" : kc(napocitano), barva: "var(--text)" },
          { t: rozdil !== null && rozdil < 0 ? "Manko" : rozdil !== null && rozdil > 0 ? "Přebytek" : "Rozdíl", v: rozdil === null ? "—" : kc(rozdil), barva: rozdil === null || rozdil === 0 ? "var(--success-text, var(--text))" : "var(--danger-text, var(--danger))" },
        ].map((x) => (
          <div key={x.t} style={{ padding: "10px 12px", borderRadius: 12, background: "var(--panel-2)", border: "1px solid var(--border)", minWidth: 0 }}>
            <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 700 }}>{x.t}</div>
            <div style={{ fontSize: 18, fontWeight: 900, color: x.barva, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.v}</div>
          </div>
        ))}
      </div>
      <Input value={poznamka} onChange={(e) => setPoznamka(e.target.value)} placeholder={rozdil ? "Proč je rozdíl (povinné)" : "Poznámka (nepovinné)"} aria-label="Poznámka k uzávěrce" maxLength={500} />
      {rozdil !== null && rozdil !== 0 && <div style={{ fontSize: 12, color: "var(--muted)" }}>Rozdíl se zapíše do pokladny, stav pak bude odpovídat napočítané hotovosti.</div>}
      <Chyba text={chyba} />
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Button variant="ghost" onClick={onClose}>Zrušit</Button>
        <Button variant="primary" size="lg" onClick={() => void potvrdit()} disabled={pracuji}>{pracuji ? "Ukládám…" : "Uzavřít"}</Button>
      </div>
    </Okno>
  );
}

// ---------------------------------------------------------------------------
// Storno
// ---------------------------------------------------------------------------

export function StornoOkno({ popis, onClose, onPotvrdit }: { popis: ReactNode; onClose: () => void; onPotvrdit: (duvod: string | null) => Promise<void> }) {
  const [duvod, setDuvod] = useState("");
  const [pracuji, setPracuji] = useState(false);
  const [chyba, setChyba] = useState<string | null>(null);
  const potvrdit = async () => {
    setPracuji(true);
    setChyba(null);
    try {
      await onPotvrdit(duvod.trim() || null);
    } catch (e) {
      setChyba(e instanceof Error ? e.message : "Storno se nepodařilo zapsat.");
      setPracuji(false);
    }
  };
  return (
    <Okno titulek="Stornovat pohyb?" podtitulek={popis} onClose={onClose}>
      <div style={{ fontSize: 13, color: "var(--muted)" }}>Pohyb zůstane v historii a vedle něj se zapíše opačný. Platba faktury vrátí fakturu mezi nezaplacené; stav zakázky se nemění.</div>
      <Input value={duvod} onChange={(e) => setDuvod(e.target.value)} placeholder="Důvod (např. překlep v částce)" aria-label="Důvod storna" maxLength={500} autoFocus onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void potvrdit(); } }} />
      <Chyba text={chyba} />
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Button variant="ghost" onClick={onClose}>Zpět</Button>
        <Button variant="danger" onClick={() => void potvrdit()} disabled={pracuji}>{pracuji ? "Stornuji…" : "Stornovat"}</Button>
      </div>
    </Okno>
  );
}
