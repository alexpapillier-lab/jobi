import { useRef, useState } from "react";
import { Button } from "../../components/ui";
import { WarningIcon } from "../../components/icons";
import { prectiXlsx } from "../../lib/xlsxCteni";
import { aplikujAktualizaci, naplanujAktualizaci, popisHodnoty, POPIS_POLE, type PlanAktualizace, type PoleOpravy } from "./importCeniku";
import type { DevicesData } from "./types";

/**
 * Karta „Aktualizace z XLSX“ na stránce importu: nahrát sešit stažený
 * z Exportu XLSX a upravený v Excelu, ukázat, co se změní, a potvrdit.
 *
 * Náhled je povinný krok – sešit po úpravách v tabulce snadno nese
 * překlep (cena 149 místo 1490) a bez náhledu by se propsal tiše.
 */
export function AktualizaceZXlsx({
  data,
  onAplikovat,
  card,
  inputStyle,
}: {
  data: DevicesData;
  onAplikovat: (nova: DevicesData, pocetOprav: number) => void;
  card: React.CSSProperties;
  inputStyle: React.CSSProperties;
}) {
  const [plan, setPlan] = useState<PlanAktualizace | null>(null);
  const [nazevSouboru, setNazevSouboru] = useState<string | null>(null);
  const [chybaSouboru, setChybaSouboru] = useState<string | null>(null);
  const [ctu, setCtu] = useState(false);
  const vstup = useRef<HTMLInputElement>(null);

  const vyberSoubor = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const soubor = e.target.files?.[0];
    if (!soubor) return;
    setCtu(true);
    setPlan(null);
    setChybaSouboru(null);
    setNazevSouboru(soubor.name);
    try {
      const radky = await prectiXlsx(new Uint8Array(await soubor.arrayBuffer()));
      setPlan(naplanujAktualizaci(data, radky));
    } catch (err) {
      setChybaSouboru(err instanceof Error ? err.message : String(err));
    } finally {
      setCtu(false);
    }
  };

  const pouzit = () => {
    if (!plan || plan.zmeny.length === 0) return;
    onAplikovat(aplikujAktualizaci(data, plan.zmeny), plan.zmeny.length);
    setPlan(null);
    setNazevSouboru(null);
    if (vstup.current) vstup.current.value = "";
  };

  const UKAZAT = 60;
  const nadpis: React.CSSProperties = { fontWeight: 950, fontSize: "var(--text-lg)", marginBottom: 16, color: "var(--text)" };
  const odstavec: React.CSSProperties = { fontSize: "var(--text-sm)", color: "var(--text)", lineHeight: 1.6, marginBottom: 12 };
  const varovani: React.CSSProperties = { marginTop: 12, padding: 12, background: "rgba(239, 68, 68, 0.1)", borderRadius: 8, border: "1px solid rgba(239, 68, 68, 0.3)" };

  return (
    <div style={card} data-tour="devices-aktualizace-xlsx">
      <div style={nadpis}>Aktualizace z XLSX</div>
      <p style={odstavec}>
        Stáhněte si ceník tlačítkem <strong>Export XLSX</strong>, v Excelu doplňte náklady nebo upravte ceny,
        časy, záruku, popis či sloupec V API, a sešit nahrajte sem. Opravy se poznají podle sloupce
        <strong> ID opravy</strong>, takže na pořadí řádků ani na názvech nezáleží.
      </p>
      <p style={{ ...odstavec, color: "var(--muted)" }}>
        Prázdná buňka znamená „nechat, jak je“ – sešit, ve kterém doplníte jen pár nákladů, nic jiného nepřepíše.
        Značka, kategorie a modely se z tabulky neberou; ty se mění ve stromu vlevo.
      </p>
      <input
        ref={vstup}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={(e) => void vyberSoubor(e)}
        disabled={ctu}
        style={{ ...inputStyle, padding: "8px 12px", cursor: "pointer" }}
      />

      {ctu && <div style={{ ...odstavec, marginTop: 12, color: "var(--muted)" }}>Čtu sešit…</div>}

      {chybaSouboru && (
        <div style={varovani}>
          <div style={{ fontWeight: 700, color: "rgba(239, 68, 68, 0.9)" }}>
            <WarningIcon size={13} /> Sešit se nepodařilo přečíst
          </div>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text)", marginTop: 6 }}>{chybaSouboru}</div>
        </div>
      )}

      {plan && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 800, fontSize: "var(--text-base)", color: "var(--text)", marginBottom: 8 }}>
            Náhled změn{nazevSouboru ? ` – ${nazevSouboru}` : ""}
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: "var(--text-sm)", color: "var(--muted)", marginBottom: 12 }}>
            <span><strong style={{ color: "var(--text)" }}>{plan.zmeny.length}</strong> ke změně</span>
            <span><strong style={{ color: "var(--text)" }}>{plan.bezeZmeny}</strong> beze změny</span>
            {plan.neznama.length > 0 && <span><strong style={{ color: "var(--warning-text)" }}>{plan.neznama.length}</strong> neznámých ID</span>}
            {plan.chyby.length > 0 && <span><strong style={{ color: "rgba(239, 68, 68, 0.9)" }}>{plan.chyby.length}</strong> řádků s chybou</span>}
          </div>

          {plan.zmeny.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 320, overflowY: "auto", marginBottom: 12 }}>
              {plan.zmeny.slice(0, UKAZAT).map((z) => (
                <div key={z.id} style={{ fontSize: "var(--text-xs)", color: "var(--text)", padding: "6px 8px", background: "var(--panel-2)", borderRadius: 6 }}>
                  <strong>{z.nazev}</strong>
                  {" · "}
                  {(Object.keys(z.nove) as Array<keyof PoleOpravy>).map((pole, i) => (
                    <span key={pole}>
                      {i > 0 && ", "}
                      {POPIS_POLE[pole]} {popisHodnoty(pole, z.puvodni[pole])} → <strong>{popisHodnoty(pole, z.nove[pole])}</strong>
                    </span>
                  ))}
                </div>
              ))}
              {plan.zmeny.length > UKAZAT && (
                <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)", padding: "4px 8px" }}>
                  … a dalších {plan.zmeny.length - UKAZAT}
                </div>
              )}
            </div>
          )}

          {plan.chyby.length > 0 && (
            <div style={varovani}>
              <div style={{ fontWeight: 700, color: "rgba(239, 68, 68, 0.9)", marginBottom: 6 }}>
                <WarningIcon size={13} /> Tyhle řádky se přeskočí
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 150, overflowY: "auto" }}>
                {plan.chyby.map((ch, i) => (
                  <div key={i} style={{ fontSize: "var(--text-xs)", color: "var(--text)" }}>{ch}</div>
                ))}
              </div>
            </div>
          )}

          {plan.neznama.length > 0 && (
            <div style={{ ...varovani, background: "var(--warning-soft)", border: "1px solid var(--warning)" }}>
              <div style={{ fontWeight: 700, color: "var(--warning-text)", marginBottom: 6 }}>
                ID, která v ceníku nejsou ({plan.neznama.length})
              </div>
              <div style={{ fontSize: "var(--text-xs)", color: "var(--text)", wordBreak: "break-all", maxHeight: 100, overflowY: "auto" }}>
                {plan.neznama.slice(0, 20).join(", ")}{plan.neznama.length > 20 ? ", …" : ""}
              </div>
              <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)", marginTop: 6 }}>
                Nejspíš smazané opravy nebo sešit z jiného servisu. Nové opravy se tudy nezakládají – na to je import TXT výš.
              </div>
            </div>
          )}

          <Button
            variant="primary"
            onClick={pouzit}
            disabled={plan.zmeny.length === 0}
            style={{ marginTop: 16, width: "100%" }}
          >
            {plan.zmeny.length === 0
              ? "Není co měnit"
              : `Použít změny (${plan.zmeny.length} ${plan.zmeny.length === 1 ? "oprava" : plan.zmeny.length < 5 ? "opravy" : "oprav"})`}
          </Button>
        </div>
      )}
    </div>
  );
}
