import { Button } from "../ui";
import { CheckIcon } from "../icons";

/**
 * Asistent postupu v detailu zakázky.
 *
 * Řádek kroků od přijetí po předání se zvýrazněným dalším krokem a jedním
 * tlačítkem, které tam skočí. Nový člověk u pultu nemusí vědět, co po čem
 * následuje – vidí, kde zakázka je a co je na řadě. Kroky se odškrtávají
 * z dat zakázky, nic se zvlášť neukládá.
 *
 * Inspirace: MyRepair má „Postup 1/8" s dalším krokem; tam je to pevná
 * osmikroková pipeline. Tady je kroků méně a dva jsou nepovinné (fotky,
 * nabídka), protože ne každá oprava je potřebuje a povinný krok, který se
 * nedá splnit, by asistenta znehodnotil.
 */
export type KrokPostupu = {
  id: string;
  label: string;
  hotovo: boolean;
  /** Nepovinný krok se nezapočítá do „dalšího kroku", ale jde na něj skočit. */
  volitelny?: boolean;
  /** Text tlačítka u dalšího kroku. */
  akce?: string;
  /** Co udělat po kliknutí (obvykle sjet na kartu). */
  onAkce?: () => void;
  /** Krátká poznámka místo tlačítka, když akce nemá smysl (čeká se na zákazníka). */
  poznamka?: string;
};

export function PostupZakazky({ kroky, onSkryt }: {
  kroky: KrokPostupu[];
  /** Křížek vpravo: uživatel už asistenta nepotřebuje. Vypíná ho natrvalo (předvolba), ne jen pro tuhle zakázku. */
  onSkryt?: () => void;
}) {
  const hotovych = kroky.filter((k) => k.hotovo).length;
  const dalsi = kroky.find((k) => !k.hotovo && !k.volitelny);
  // Všechno povinné hotové: asistent už nemá co radit a jen by zabíral místo.
  if (!dalsi) return null;

  return (
    <div
      role="group"
      aria-label={`Postup zakázky, hotovo ${hotovych} z ${kroky.length}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
        padding: "10px 14px",
        borderRadius: 12,
        border: "1px solid var(--border)",
        background: "var(--panel-2)",
        marginBottom: 16,
      }}
    >
      <ol style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", listStyle: "none", margin: 0, padding: 0, flex: 1, minWidth: 0 }}>
        {kroky.map((k, i) => {
          const jeDalsi = k.id === dalsi.id;
          return (
            <li key={k.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span
                aria-hidden
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  display: "grid",
                  placeItems: "center",
                  fontSize: 11,
                  fontWeight: 800,
                  flexShrink: 0,
                  background: k.hotovo ? "var(--success-text, #16a34a)" : jeDalsi ? "var(--accent)" : "transparent",
                  color: k.hotovo || jeDalsi ? "#fff" : "var(--muted)",
                  border: k.hotovo || jeDalsi ? "none" : "2px solid var(--border)",
                }}
              >
                {k.hotovo ? <CheckIcon size={12} /> : i + 1}
              </span>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: jeDalsi ? 800 : 600,
                  color: k.hotovo ? "var(--muted)" : jeDalsi ? "var(--text)" : "var(--muted)",
                  textDecoration: k.hotovo ? "line-through" : "none",
                  whiteSpace: "nowrap",
                }}
              >
                {k.label}
                {k.volitelny && !k.hotovo && <span style={{ fontWeight: 500 }}> · nepovinné</span>}
              </span>
              {i < kroky.length - 1 && (
                <span aria-hidden style={{ width: 14, height: 2, background: "var(--border)", margin: "0 2px", flexShrink: 0 }} />
              )}
            </li>
          );
        })}
      </ol>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>Další krok</span>
        {dalsi.onAkce && dalsi.akce ? (
          <Button size="sm" variant="primary" onClick={dalsi.onAkce}>{dalsi.akce}</Button>
        ) : (
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>{dalsi.poznamka ?? dalsi.label}</span>
        )}
        {onSkryt && (
          <button
            type="button"
            onClick={onSkryt}
            aria-label="Skrýt asistenta postupu"
            title="Skrýt asistenta postupu (znovu zapnete v Nastavení → Rozhraní)"
            style={{
              marginLeft: 4,
              width: 24,
              height: 24,
              borderRadius: 6,
              border: "none",
              background: "transparent",
              color: "var(--muted)",
              cursor: "pointer",
              fontSize: 16,
              lineHeight: 1,
              display: "grid",
              placeItems: "center",
            }}
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}

/** Sjede na kartu v detailu a na okamžik ji zvýrazní, aby bylo jasné, kam se skočilo. */
export function sjetNaKartu(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  el.style.transition = "box-shadow 0.2s ease";
  el.style.boxShadow = "0 0 0 3px var(--accent-soft)";
  window.setTimeout(() => { el.style.boxShadow = ""; }, 1400);
}
