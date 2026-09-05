import { useState } from "react";
import { Button } from "../ui";
import {
  type KontrolaPoOpraveData,
  type SablonaKontroly,
  type StavPolozky,
  shrnutiKontroly,
  vyberSablonu,
  zalozKontrolu,
} from "../../lib/kontrolniSeznamy";

/**
 * Karta „Kontrola po opravě“ v detailu zakázky.
 *
 * Dokud kontrola není založená, nabídne šablonu podle zařízení. Pak seznam
 * položek, každá OK / Chyba / Neověřeno, u chyby poznámka. Každá změna se
 * ukládá hned (rodič), stejně jako provedené opravy – kontrola se dělá u
 * stolu s otevřeným detailem a nesmí se ztratit při změně stavu kolegou.
 */
export function KontrolaPoOprave({
  kontrola,
  sablony,
  nazevZarizeni,
  onChange,
}: {
  kontrola: KontrolaPoOpraveData | undefined;
  sablony: SablonaKontroly[];
  nazevZarizeni?: string | null;
  onChange: (kontrola: KontrolaPoOpraveData | null) => void;
}) {
  const navrzena = vyberSablonu(sablony, nazevZarizeni);
  const [vybranaId, setVybranaId] = useState<string>(navrzena?.id ?? "");

  if (!kontrola) {
    const vybrana = sablony.find((s) => s.id === vybranaId) ?? navrzena;
    return (
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <select
          aria-label="Šablona kontroly"
          value={vybrana?.id ?? ""}
          onChange={(e) => setVybranaId(e.target.value)}
          style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: 13, fontFamily: "inherit" }}
        >
          {sablony.map((s) => (
            <option key={s.id} value={s.id}>{s.nazev} ({s.polozky.length})</option>
          ))}
        </select>
        <Button size="sm" variant="soft" disabled={!vybrana} onClick={() => vybrana && onChange(zalozKontrolu(vybrana))}>
          Načíst kontrolní seznam
        </Button>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>Šablony upravíte v Nastavení → Zakázky → Kontrola po opravě.</span>
      </div>
    );
  }

  const shrnuti = shrnutiKontroly(kontrola);
  const nastav = (i: number, zmena: Partial<KontrolaPoOpraveData["polozky"][number]>) => {
    onChange({
      ...kontrola,
      polozky: kontrola.polozky.map((p, idx) => (idx === i ? { ...p, ...zmena } : p)),
      upraveno: new Date().toISOString(),
    });
  };
  const tlacitko = (i: number, stav: StavPolozky, text: string, popisek: string, barva: string) => {
    const aktivni = kontrola.polozky[i].stav === stav;
    return (
      <button
        type="button"
        aria-label={`${popisek} – ${text}`}
        aria-pressed={aktivni}
        onClick={() => nastav(i, { stav: aktivni ? null : stav })}
        style={{
          minWidth: 34,
          height: 28,
          padding: "0 8px",
          borderRadius: 8,
          border: `1px solid ${aktivni ? barva : "var(--border)"}`,
          background: aktivni ? barva : "transparent",
          color: aktivni ? "#fff" : "var(--muted)",
          fontSize: 12,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        {popisek}
      </button>
    );
  };

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>
          {kontrola.sablonaNazev} · ověřeno {shrnuti.hotovo} z {shrnuti.celkem}
          {shrnuti.chyb > 0 ? ` · ${shrnuti.chyb} s chybou` : shrnuti.dokonceno ? " · vše v pořádku" : ""}
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          {!shrnuti.dokonceno && (
            <Button size="sm" variant="ghost" onClick={() => onChange({ ...kontrola, polozky: kontrola.polozky.map((p) => (p.stav === null ? { ...p, stav: "ok" } : p)), upraveno: new Date().toISOString() })}>
              Zbytek OK
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => onChange(null)} title="Odebrat kontrolní seznam ze zakázky">
            Odebrat
          </Button>
        </div>
      </div>
      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
        {kontrola.polozky.map((p, i) => (
          <li key={`${i}_${p.text}`} style={{ display: "grid", gap: 6, padding: "8px 10px", borderRadius: 10, border: "1px solid var(--border)", background: p.stav === "chyba" ? "rgba(239,68,68,0.08)" : "var(--panel-2)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, fontWeight: 600, textDecoration: p.stav === "ok" ? "none" : "none", color: p.stav === "neoverovano" ? "var(--muted)" : "var(--text)" }}>{p.text}</span>
              <span style={{ display: "flex", gap: 4 }}>
                {tlacitko(i, "ok", p.text, "OK", "var(--success-text, #16a34a)")}
                {tlacitko(i, "chyba", p.text, "Chyba", "#dc2626")}
                {tlacitko(i, "neoverovano", p.text, "Neověřeno", "var(--muted)")}
              </span>
            </div>
            {p.stav === "chyba" && (
              <input
                type="text"
                value={p.poznamka ?? ""}
                onChange={(e) => nastav(i, { poznamka: e.target.value })}
                placeholder="Co je špatně a co s tím (zákazník to uvidí v protokolu)"
                aria-label={`Poznámka – ${p.text}`}
                style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: 13, fontFamily: "inherit", width: "100%", boxSizing: "border-box" }}
              />
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
