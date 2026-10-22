/**
 * Nastavení → Dokumenty a tisk → Šablony dokumentů (jen webová verze).
 *
 * Karta s tlačítkem, které otevře editor šablon JobiDocs přes celé okno
 * (EditorSablonWeb). Desktop má na úpravy šablon aplikaci JobiDocs
 * s tiskem rovnou na tiskárnu, proto tam podsekce není.
 */
import { lazy, Suspense, useState } from "react";
import { Button } from "../../components/ui";
import { Card } from "../../lib/settingsUi";
import { useIsNarrow } from "../../hooks/useIsNarrow";

const EditorSablonWeb = lazy(() => import("./EditorSablonWeb"));

type Props = {
  serviceId: string | null;
  serviceName: string;
  canManage: boolean;
};

export function SablonyDokumentuSection({ serviceId, serviceName, canManage }: Props) {
  const [otevreno, setOtevreno] = useState(false);
  const uzky = useIsNarrow();

  return (
    <>
      <Card data-tour="settings-sablony-karta">
        <div style={{ marginBottom: "var(--space-3)" }}>
          <div style={{ fontWeight: 900, fontSize: "var(--text-base)", color: "var(--text)" }}>Šablony dokumentů</div>
          <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)", marginTop: 2, lineHeight: 1.5 }}>
            Rozvržení zakázkového a záručního listu, protokolů, faktury a smlouvy o zápůjčce, vlastní texty, logo, razítko a barvy. Je to tentýž editor jako v JobiDocs
            na počítači a ukládá do stejného místa – co upravíte tady, platí i pro tisk z JobiDocs a naopak.
          </div>
        </div>
        {uzky ? (
          <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)", padding: "var(--space-3)", border: "1px dashed var(--border)", borderRadius: "var(--radius-sm)" }}>
            Šablony upravujte na počítači nebo tabletu.
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
            <Button variant="primary" onClick={() => setOtevreno(true)} disabled={!serviceId} data-tour="settings-sablony-otevrit">
              Otevřít editor šablon
            </Button>
            {!canManage && <span style={{ fontSize: "var(--text-sm)", color: "var(--muted)" }}>Jen pro čtení – šablony smí měnit majitel, správce nebo člen s oprávněním Dokumenty.</span>}
          </div>
        )}
      </Card>

      <Card>
        <div style={{ fontWeight: 900, fontSize: "var(--text-base)", color: "var(--text)", marginBottom: 4 }}>Co ve webové verzi není</div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: "var(--text-sm)", color: "var(--muted)", lineHeight: 1.6 }}>
          <li>Tisk bez dialogu na vybranou tiskárnu – prohlížeč vždy ukáže tiskový dialog. To umí jen JobiDocs na počítači.</li>
          <li>Výběr tiskárny a profily tiskáren; automatický tisk se nastavuje v části JobiDocs a automatický tisk.</li>
          <li>Hlavičkový papír (PDF) se uloží, ale přes dialog prohlížeče se pod dokument nepřidá – sloučí ho jen JobiDocs.</li>
        </ul>
      </Card>

      {otevreno && serviceId && (
        <Suspense fallback={null}>
          <EditorSablonWeb serviceId={serviceId} serviceName={serviceName} canManage={canManage} onClose={() => setOtevreno(false)} />
        </Suspense>
      )}
    </>
  );
}
