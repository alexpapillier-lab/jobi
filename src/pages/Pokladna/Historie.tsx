import { useMemo } from "react";
import { DRUH_TEXT, ZPUSOB_TEXT, souhrnPohybu, stornovane, type PohybPokladny } from "../../lib/pokladna";
import { cas, denNadpis, kc } from "./format";

function mistniDen(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Barevná tečka podle druhu – rychlá orientace v dlouhém seznamu. */
function barvaDruhu(p: PohybPokladny): string {
  if (p.druh === "storno" || p.druh === "rozdil") return "var(--muted)";
  if (p.druh === "prevod") return "var(--accent)";
  return p.smer === "prijem" ? "var(--success, #16a34a)" : "var(--danger, #dc2626)";
}

/**
 * Historie pohybů po dnech. Každý řádek: čas, co to bylo (druh, kategorie,
 * zakázka), kdo, částka. Stornovaný pohyb je přeškrtnutý a jeho storno je
 * hned pod ním vidět jako samostatný řádek.
 */
export function Historie({
  pohyby,
  nazevPokladny,
  ukazatPokladnu,
  jmeno,
  kodZakazky,
  onOpenTicket,
  onStorno,
  nacitam,
}: {
  pohyby: PohybPokladny[];
  nazevPokladny: (id: string) => string;
  ukazatPokladnu: boolean;
  jmeno: (userId: string | null) => string | null;
  kodZakazky: (ticketId: string) => string | null;
  onOpenTicket: (ticketId: string) => void;
  onStorno: (p: PohybPokladny) => void;
  nacitam: boolean;
}) {
  const zrusene = useMemo(() => stornovane(pohyby), [pohyby]);
  const dny = useMemo(() => {
    const m = new Map<string, PohybPokladny[]>();
    for (const p of pohyby) {
      const d = mistniDen(p.createdAt);
      m.set(d, [...(m.get(d) ?? []), p]);
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [pohyby]);

  if (!nacitam && pohyby.length === 0) {
    return <div style={{ padding: "28px 8px", textAlign: "center", color: "var(--muted)", fontSize: 14 }}>V tomhle období se nic nezapsalo.</div>;
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      {dny.map(([den, xs]) => {
        const s = souhrnPohybu(xs);
        return (
          <section key={den} style={{ display: "grid", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap", padding: "0 4px" }}>
              <span style={{ fontWeight: 850, fontSize: 14 }}>{denNadpis(den)}</span>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                tržba {kc(s.trzbaCelkem)}{s.vydaje ? ` · výdaje ${kc(s.vydaje)}` : ""}
              </span>
            </div>
            <div style={{ borderRadius: 14, border: "1px solid var(--border)", background: "var(--panel)", overflow: "hidden" }}>
              {xs.map((p, i) => {
                const zrusen = zrusene.has(p.id);
                const druh = p.druh === "storno" && p.puvodniDruh ? `Storno · ${DRUH_TEXT[p.puvodniDruh]}` : DRUH_TEXT[p.druh];
                const kod = p.ticketId ? kodZakazky(p.ticketId) : null;
                const kdo = jmeno(p.createdBy);
                const lze = !zrusen && p.druh !== "storno" && p.druh !== "rozdil";
                return (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderTop: i === 0 ? "none" : "1px solid var(--border)", opacity: zrusen ? 0.55 : 1 }}>
                    <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: barvaDruhu(p), flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: "var(--muted)", fontVariantNumeric: "tabular-nums", width: 40, flexShrink: 0 }}>{cas(p.createdAt)}</span>
                    <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 2 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, textDecoration: zrusen ? "line-through" : undefined, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {p.kategorie ? `${p.kategorie}` : druh}
                        {kod && p.ticketId ? (
                          <>
                            {" · "}
                            <button type="button" onClick={() => onOpenTicket(p.ticketId!)} style={{ border: "none", background: "none", padding: 0, color: "var(--accent)", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: "inherit" }}>{kod}</button>
                          </>
                        ) : null}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {[p.kategorie ? druh : null, p.popis, p.zpusob !== "cash" ? ZPUSOB_TEXT[p.zpusob] : null, ukazatPokladnu ? nazevPokladny(p.pokladnaId) : null, kdo].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    <span style={{ fontWeight: 850, fontSize: 15, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", color: p.smer === "prijem" ? "var(--success-text, var(--text))" : "var(--text)", textDecoration: zrusen ? "line-through" : undefined }}>
                      {p.smer === "prijem" ? "+" : "−"}{kc(p.castka)}
                    </span>
                    {lze ? (
                      <button type="button" onClick={() => onStorno(p)} title="Stornovat" aria-label="Stornovat pohyb" style={{ border: "none", background: "none", color: "var(--muted)", cursor: "pointer", fontSize: 16, padding: "2px 4px", flexShrink: 0 }}>↺</button>
                    ) : <span style={{ width: 24, flexShrink: 0 }} />}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
