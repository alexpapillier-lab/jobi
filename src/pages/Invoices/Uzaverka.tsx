import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../components/ui";
import { formatCurrency } from "../../lib/invoiceMath";
import { ZPUSOB_PLATBY_LABELS, asZpusobPlatby, type Invoice, type ZpusobPlatby } from "./types";

/**
 * Denní uzávěrka: co bylo ten den zaplaceno, rozdělené podle způsobu platby.
 * Hotovost v pokladně musí sedět s řádkem „Hotově“; karty a převody
 * se párují s výpisem. Bere se datum zaplacení (paid_at) v místním čase.
 */
function mistniDatum(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dnes(): string {
  return mistniDatum(new Date().toISOString());
}

export function UzaverkaDialog({ open, onClose, invoices, nazevServisu }: { open: boolean; onClose: () => void; invoices: Invoice[]; nazevServisu?: string }) {
  const [datum, setDatum] = useState(dnes);

  const data = useMemo(() => {
    const radky = invoices
      .filter((i) => i.status === "paid" && i.paid_at && !i.deleted_at && mistniDatum(i.paid_at) === datum)
      .sort((a, b) => (a.paid_at ?? "").localeCompare(b.paid_at ?? ""));
    const souhrn: Record<ZpusobPlatby | "neurceno", number> = { cash: 0, card: 0, transfer: 0, other: 0, neurceno: 0 };
    for (const i of radky) {
      const z = asZpusobPlatby(i.payment_method);
      // Dobropis snižuje tržbu daného způsobu; total už je záporný.
      souhrn[z ?? "neurceno"] += Number(i.total) || 0;
    }
    const celkem = radky.reduce((a, i) => a + (Number(i.total) || 0), 0);
    return { radky, souhrn, celkem };
  }, [invoices, datum]);

  if (!open) return null;

  const datumCz = new Date(`${datum}T12:00:00`).toLocaleDateString("cs-CZ", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  const vytisknout = () => {
    const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const radky = data.radky
      .map((i) => `<tr><td>${esc(i.number)}</td><td>${esc(i.customer_name ?? "")}</td><td>${esc(new Date(i.paid_at!).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" }))}</td><td>${esc(asZpusobPlatby(i.payment_method) ? ZPUSOB_PLATBY_LABELS[asZpusobPlatby(i.payment_method)!] : "—")}</td><td style="text-align:right">${esc(formatCurrency(Number(i.total) || 0))}</td></tr>`)
      .join("");
    const souhrn = (Object.keys(ZPUSOB_PLATBY_LABELS) as ZpusobPlatby[])
      .filter((z) => data.souhrn[z] !== 0)
      .map((z) => `<tr><td colspan="4">${ZPUSOB_PLATBY_LABELS[z]}</td><td style="text-align:right">${esc(formatCurrency(data.souhrn[z]))}</td></tr>`)
      .join("");
    const neurceno = data.souhrn.neurceno !== 0 ? `<tr><td colspan="4">Bez uvedeného způsobu</td><td style="text-align:right">${esc(formatCurrency(data.souhrn.neurceno))}</td></tr>` : "";
    const html = `<!doctype html><html lang="cs"><head><meta charset="utf-8"><title>Uzávěrka ${esc(datumCz)}</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:13px;margin:24px;color:#111}h1{font-size:18px;margin:0 0 4px}table{border-collapse:collapse;width:100%;margin-top:14px}td,th{padding:6px 8px;border-bottom:1px solid #ddd;text-align:left}tfoot td{font-weight:700;border-top:2px solid #111}.muted{color:#666}</style></head>
<body><h1>Denní uzávěrka – ${esc(datumCz)}</h1><div class="muted">${esc(nazevServisu ?? "")} · vytištěno ${esc(new Date().toLocaleString("cs-CZ"))}</div>
<table><thead><tr><th>Doklad</th><th>Odběratel</th><th>Čas</th><th>Platba</th><th style="text-align:right">Částka</th></tr></thead>
<tbody>${radky || '<tr><td colspan="5" class="muted">Žádná platba</td></tr>'}</tbody>
<tfoot>${souhrn}${neurceno}<tr><td colspan="4">Celkem</td><td style="text-align:right">${esc(formatCurrency(data.celkem))}</td></tr></tfoot></table>
<p style="margin-top:40px">Pokladnu předal: ______________________ &nbsp;&nbsp; převzal: ______________________</p>
<script>window.onload=function(){window.print();}</script></body></html>`;
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) return;
    w.document.open();
    w.document.write(html);
    w.document.close();
  };

  const bunka: React.CSSProperties = { padding: "6px 8px", borderBottom: "1px solid var(--border)", fontSize: 13 };

  return createPortal(
    <div role="dialog" aria-modal="true" aria-labelledby="uzaverka-nadpis" data-escape-vlastni onMouseDown={(e) => e.stopPropagation()} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10_000, padding: 16 }}>
      <div style={{ background: "var(--panel)", color: "var(--text)", borderRadius: 14, border: "1px solid var(--border)", padding: 20, width: "min(100%, 760px)", maxHeight: "90vh", overflow: "auto", display: "grid", gap: 14, boxShadow: "0 20px 60px rgba(0,0,0,0.35)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h2 id="uzaverka-nadpis" style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>Denní uzávěrka</h2>
            <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>Zaplacené doklady podle způsobu platby. Hotovost má sedět s pokladnou, karty a převody s výpisem.</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="date" aria-label="Den uzávěrky" value={datum} onChange={(e) => e.target.value && setDatum(e.target.value)} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel-2)", color: "var(--text)", fontFamily: "inherit" }} />
            <Button size="sm" variant="soft" onClick={vytisknout} disabled={data.radky.length === 0}>Tisk</Button>
            <Button size="sm" variant="ghost" onClick={onClose}>Zavřít</Button>
          </div>
        </div>

        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              {["Doklad", "Odběratel", "Čas", "Platba", "Částka"].map((h, i) => (
                <th key={h} style={{ ...bunka, textAlign: i === 4 ? "right" : "left", color: "var(--muted)", fontWeight: 700, fontSize: 12 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.radky.length === 0 && (
              <tr><td colSpan={5} style={{ ...bunka, color: "var(--muted)" }}>V tento den nebyla zaplacena žádná faktura.</td></tr>
            )}
            {data.radky.map((i) => {
              const z = asZpusobPlatby(i.payment_method);
              return (
                <tr key={i.id}>
                  <td style={{ ...bunka, fontWeight: 700 }}>{i.number}</td>
                  <td style={bunka}>{i.customer_name ?? "—"}</td>
                  <td style={bunka}>{new Date(i.paid_at!).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}</td>
                  <td style={bunka}>{z ? ZPUSOB_PLATBY_LABELS[z] : <span style={{ color: "var(--muted)" }}>neuvedeno</span>}</td>
                  <td style={{ ...bunka, textAlign: "right" }}>{formatCurrency(Number(i.total) || 0)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            {(Object.keys(ZPUSOB_PLATBY_LABELS) as ZpusobPlatby[]).filter((z) => data.souhrn[z] !== 0).map((z) => (
              <tr key={z}>
                <td colSpan={4} style={{ ...bunka, fontWeight: 700 }}>{ZPUSOB_PLATBY_LABELS[z]}</td>
                <td style={{ ...bunka, textAlign: "right", fontWeight: 700 }}>{formatCurrency(data.souhrn[z])}</td>
              </tr>
            ))}
            {data.souhrn.neurceno !== 0 && (
              <tr>
                <td colSpan={4} style={{ ...bunka, color: "var(--muted)" }}>Bez uvedeného způsobu</td>
                <td style={{ ...bunka, textAlign: "right", color: "var(--muted)" }}>{formatCurrency(data.souhrn.neurceno)}</td>
              </tr>
            )}
            <tr>
              <td colSpan={4} style={{ ...bunka, fontWeight: 900, borderTop: "2px solid var(--text)" }}>Celkem</td>
              <td style={{ ...bunka, textAlign: "right", fontWeight: 900, borderTop: "2px solid var(--text)" }}>{formatCurrency(data.celkem)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>,
    document.body,
  );
}

/** Otázka při označení Zaplaceno: čím zákazník platil. */
export function ZpusobPlatbyDialog({ open, cislo, onVybrat, onZrusit }: { open: boolean; cislo: string; onVybrat: (z: ZpusobPlatby) => void; onZrusit: () => void }) {
  if (!open) return null;
  return createPortal(
    <div role="dialog" aria-modal="true" aria-labelledby="platba-nadpis" data-escape-vlastni onMouseDown={(e) => e.stopPropagation()} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10_000, padding: 16 }}>
      <div style={{ background: "var(--panel)", color: "var(--text)", borderRadius: 14, border: "1px solid var(--border)", padding: 20, width: "min(100%, 420px)", display: "grid", gap: 12, boxShadow: "0 20px 60px rgba(0,0,0,0.35)" }}>
        <h2 id="platba-nadpis" style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>Jak zákazník zaplatil {cislo}?</h2>
        <div style={{ color: "var(--muted)", fontSize: 13 }}>Způsob platby jde do denní uzávěrky.</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {(Object.keys(ZPUSOB_PLATBY_LABELS) as ZpusobPlatby[]).map((z) => (
            <Button key={z} variant={z === "cash" ? "primary" : "soft"} onClick={() => onVybrat(z)}>{ZPUSOB_PLATBY_LABELS[z]}</Button>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={onZrusit}>Zpět</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
