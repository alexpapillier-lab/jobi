/**
 * Konflikt při uložení: šablony mezitím uložil někdo jiný – ve webové verzi
 * Jobi nebo v JobiDocs na jiném počítači. Společné pro Dokumenty i Značku,
 * ukládá se totiž jeden objekt (značka + všechny šablony).
 */
type Props = {
  onReload: () => void | Promise<void>;
  onOverwrite: () => void | Promise<unknown>;
};

export function ConflictDialog({ onReload, onOverwrite }: Props) {
  return (
    <div className="dlg-backdrop">
      <div className="dlg" role="alertdialog" aria-labelledby="jd-konflikt-nadpis">
        <h3 id="jd-konflikt-nadpis">Šablonu mezitím změnil někdo jiný (web nebo JobiDocs)</h3>
        <p>Od chvíle, kdy jste šablony otevřeli, je někdo uložil znovu – ve webové verzi Jobi nebo v JobiDocs na jiném počítači. Můžete načíst jeho verzi (vaše neuložené změny se nabídnou jako rozpracovaná verze k obnovení), nebo ji přepsat svou.</p>
        <div className="actions">
          <button type="button" className="ui-btn" onClick={() => void onReload()}>
            Načíst jeho verzi
          </button>
          <button type="button" className="ui-btn ui-btn-danger" onClick={() => void onOverwrite()}>
            Přepsat
          </button>
        </div>
      </div>
    </div>
  );
}
