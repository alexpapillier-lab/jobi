import { useEffect, useState } from "react";
import { naFrontu, odesliFrontu, type PolozkaFronty } from "../lib/frontaZapisu";

/**
 * Ukazatel neuložených změn.
 *
 * Zápis, který neprošel kvůli spojení, čeká ve frontě (lib/frontaZapisu) a
 * odešle se sám. Uživatel o tom ale musí vědět – jinak vypne počítač
 * s pocitem, že je vše uložené. Proužek zmizí, jakmile je fronta prázdná.
 */
export function NeulozeneZmeny() {
  const [polozky, setPolozky] = useState<PolozkaFronty[]>([]);
  const [rozbaleno, setRozbaleno] = useState(false);
  const [odesila, setOdesila] = useState(false);

  useEffect(() => naFrontu(setPolozky), []);

  if (polozky.length === 0) return null;
  const zaseknute = polozky.filter((p) => p.zaseknuto).length;

  return (
    <div
      role="status"
      aria-label={`Neuložené změny: ${polozky.length}`}
      data-neulozene-zmeny={polozky.length}
      style={{
        position: "fixed",
        /*
         * Uprostřed a nad spodní lištou.
         *
         * Vlevo dole proužek ležel přes tlačítko účtu – tedy přes přepnutí
         * servisu a odhlášení. Zrovna když něco čeká na uložení, se k nim
         * člověk musí dostat; místo toho mu kliknutí spolklo hlášení
         * o neuložených změnách. Vpravo dole sedí kulaté tlačítko Nová
         * zakázka, vlevo v širokém okně postranní lišta – zbývá střed.
         */
        left: "50%",
        transform: "translateX(-50%)",
        bottom: "calc(var(--bottom-nav-h, 0px) + var(--safe-bottom, 0px) + 16px)",
        /*
         * Nad vším, i nad přihlašovací obrazovkou (ta má 99999 a překrývá
         * celé okno). Kdo se odhlásí s neuloženou změnou, musí ji vidět –
         * proužek schovaný za přihlašovacím pozadím je stejně k ničemu,
         * jako by tam nebyl.
         */
        zIndex: 100000,
        maxWidth: 380,
        borderRadius: 12,
        border: `1px solid ${zaseknute > 0 ? "var(--danger, #dc2626)" : "var(--border)"}`,
        background: "var(--panel)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => setRozbaleno((r) => !r)}
        aria-expanded={rozbaleno}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          padding: "10px 14px",
          border: "none",
          background: "transparent",
          color: "var(--text)",
          cursor: "pointer",
          font: "inherit",
          fontSize: 13,
          fontWeight: 700,
          textAlign: "left",
        }}
      >
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: zaseknute > 0 ? "var(--danger, #dc2626)" : "var(--warning, #f59e0b)",
            flexShrink: 0,
          }}
        />
        {polozky.length === 1 ? "1 změna čeká na uložení" : `${polozky.length} změn čeká na uložení`}
      </button>

      {rozbaleno && (
        <div style={{ padding: "0 14px 12px", display: "grid", gap: 8 }}>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6, maxHeight: 220, overflowY: "auto" }}>
            {polozky.map((p) => (
              <li key={p.klic} style={{ fontSize: 12, color: "var(--muted)" }}>
                <span style={{ color: "var(--text)" }}>{p.popis}</span>
                {p.zaseknuto && (
                  <span style={{ color: "var(--danger, #dc2626)" }}>
                    {" "}
                    · nedaří se uložit{p.posledniChyba ? `: ${p.posledniChyba}` : ""}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>
            Změny se uloží samy, jakmile bude spojení. Zůstávají uložené i po zavření aplikace.
            {zaseknute > 0 ? " U změn, které se nedaří uložit, to sama nezkouší – použijte tlačítko níž." : ""}
          </p>
          <button
            type="button"
            disabled={odesila}
            onClick={async () => {
              setOdesila(true);
              try {
                await odesliFrontu(true);
              } finally {
                setOdesila(false);
              }
            }}
            style={{
              justifySelf: "start",
              padding: "6px 12px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--panel-2)",
              color: "var(--text)",
              cursor: odesila ? "default" : "pointer",
              font: "inherit",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {odesila ? "Zkouším…" : "Zkusit uložit hned"}
          </button>
        </div>
      )}
    </div>
  );
}
