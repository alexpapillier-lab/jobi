import type React from "react";

/**
 * Řádek zakázky/reklamace na telefonu – pevné rozložení místo zalamování.
 *
 * Na počítači se prvky řádku skládají vedle sebe a na úzké obrazovce se
 * zalamovaly podle délky textů: jednou byla cena vedle zákazníka, jindy pod
 * zařízením, jindy sama na řádku. Každá zakázka tak vypadala jinak (hlášení
 * majitele 26. 10. 2026). Tady je pořadí vždycky stejné:
 *
 *   číslo · datum ……………… cena
 *   zařízení
 *   zákazník · štítky · oprava
 *   [stav ………………………] [tisk]
 */
export function RadekMobil({
  kod,
  datum,
  cena,
  zarizeni,
  info,
  ovladani,
  styl,
  onClick,
}: {
  kod: React.ReactNode;
  datum: React.ReactNode;
  cena: React.ReactNode | null;
  zarizeni: React.ReactNode;
  /** Zákazník, štítky, požadovaná oprava – jeden řádek, co se nevejde, ořízne se. */
  info: React.ReactNode;
  ovladani: React.ReactNode;
  /** Barvy a rámeček podle stavu (z nadřazeného řádku). */
  styl: React.CSSProperties;
  onClick: () => void;
}) {
  const radek: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, minWidth: 0 };
  return (
    <div onClick={onClick} style={{ ...styl, padding: "8px 12px", borderRadius: 8, cursor: "pointer", display: "grid", gap: 4, minWidth: 0 }}>
      <div style={{ ...radek, justifyContent: "space-between" }}>
        <div style={{ ...radek, gap: 10 }}>
          {kod}
          {datum}
        </div>
        {cena}
      </div>
      <div style={{ ...radek, overflow: "hidden" }}>{zarizeni}</div>
      <div style={{ ...radek, gap: 6, overflow: "hidden", whiteSpace: "nowrap", fontSize: "var(--text-xs)", color: "var(--muted)" }}>{info}</div>
      {/* Výběr stavu má v seznamu pevnou šířku (156 px, ať na počítači neskáče
          sloupec cen); na telefonu ho roztáhnout, jinak se název stavu zbytečně ořízne. */}
      <style>{`[data-radek-mobil-ovladani] > div:first-child > div { display: flex !important; width: 100%; } [data-radek-mobil-ovladani] > div:first-child button { width: 100% !important; }`}</style>
      <div
        data-radek-mobil-ovladani=""
        style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6, alignItems: "center", marginTop: 2 }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {ovladani}
      </div>
    </div>
  );
}
