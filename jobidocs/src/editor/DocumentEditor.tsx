/**
 * Editor dokumentu. Hlavní způsob úprav je přímo v dokumentu (klik = výběr,
 * další klik nebo dvojklik = psaní, plus mezi bloky, lišta u vybraného
 * prvku, tažení). Osnova vlevo a panel vlastností vpravo jsou doplněk.
 * Náhled se renderuje přímo z jádra – tou samou funkcí, kterou API dělá PDF.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DOC_TYPES, DOC_TYPE_LABELS, renderDocument, sampleData, serviceFromCompanyData, templateFor, VARIABLES, type Block, type DocType, type DocumentData, type DocumentsV2, type SampleKind, type SlotItem, type SlotName, type Template } from "../../core/index";
import { api, electron } from "../api";
import type { Draft, SaveState } from "../state/useDocuments";
import { AddBlockDialog, AddSlotItemDialog, VariableDialog } from "./AddMenu";
import { Canvas, type CanvasEvent, type CanvasHandle, type FitInfo, type Selection, type Zoom } from "./Canvas";
import { Inspector } from "./Inspector";
import { Outline } from "./Outline";
import { addRowAfter, addSlotItem, addToColumn, applyEdit, createBlock, createSlotItem, deleteRow, duplicateBlock, findBlock, insertBlock, moveBlock, moveBlockBy, moveRow, moveSlotItem, removeBlock, removeSlotItem, updateBlock, updateSlotItem } from "./templateOps";

type Props = {
  serviceId: string;
  companyData: Record<string, unknown> | null;
  docs: DocumentsV2;
  setDocs: (updater: (d: DocumentsV2) => DocumentsV2) => void;
  dirty: boolean;
  save: SaveState;
  onSave: (opts?: { force?: boolean }) => Promise<boolean>;
  onReload: () => Promise<void>;
  canManage: boolean;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onToast: (msg: string, kind?: "ok" | "error") => void;
  lastSaved: { version: number; updated_at: string | null; source: string } | null;
  draft: Draft | null;
  onRestoreDraft: () => void;
  onDiscardDraft: () => void;
};

type RecentItem = { id: string; label: string; data: DocumentData };

export function DocumentEditor(p: Props) {
  const { docs, setDocs, serviceId, companyData } = p;
  const [docType, setDocType] = useState<DocType>("zakazkovy_list");
  const [sample, setSample] = useState<string>("short");
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [selection, setSelection] = useState<Selection>({ kind: "none" });
  const [addBlock, setAddBlock] = useState<null | { index?: number; column?: { id: string; side: "left" | "right" } }>(null);
  const [addSlotFor, setAddSlotFor] = useState<SlotName | null>(null);
  const [varDialog, setVarDialog] = useState(false);
  const [fit, setFit] = useState<FitInfo | null>(null);
  const [busy, setBusy] = useState<null | "print" | "pdf">(null);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [outlineOpen, setOutlineOpen] = useState(() => (typeof window !== "undefined" ? window.innerWidth > 1180 : true));
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const canvasRef = useRef<CanvasHandle>(null);

  const template = useMemo(() => templateFor(docs, docType), [docs, docType]);

  const setTemplate = useCallback(
    (updater: (t: Template) => Template) => {
      setDocs((d) => {
        const cur = templateFor(d, docType);
        const next = updater(cur);
        if (next === cur) return d;
        return { ...d, templates: { ...d.templates, [docType]: next } };
      });
    },
    [setDocs, docType]
  );

  useEffect(() => {
    setSelection({ kind: "none" });
    setFit(null);
    setSample((s) => (s.startsWith("recent:") ? "short" : s));
    let alive = true;
    api
      .recent(serviceId, docType)
      .then((r) => alive && setRecent(r.items))
      .catch(() => alive && setRecent([]));
    return () => {
      alive = false;
    };
  }, [docType, serviceId]);

  const previewData = useMemo<{ data: DocumentData; placeholders: boolean; sampleKind: SampleKind }>(() => {
    const service = serviceFromCompanyData(companyData);
    if (sample.startsWith("recent:")) {
      const item = recent.find((r) => `recent:${r.id}` === sample);
      if (item) return { data: { ...item.data, service: { ...service, ...item.data.service } }, placeholders: false, sampleKind: "short" };
    }
    if (sample === "placeholders") return { data: sampleData(docType, "empty", service), placeholders: true, sampleKind: "short" };
    const kind: SampleKind = sample === "long" ? "long" : "short";
    return { data: sampleData(docType, kind, service), placeholders: false, sampleKind: kind };
  }, [sample, recent, docType, companyData]);

  const html = useMemo(
    () => renderDocument({ template, data: previewData.data, brand: docs.brand, theme: docs.theme, options: { mode: "editor", showPlaceholders: previewData.placeholders } }),
    [template, docs.brand, docs.theme, previewData]
  );

  const selectedBlockId = selection.kind === "block" ? selection.id : null;

  const onCanvasEvent = useCallback(
    (ev: CanvasEvent) => {
      switch (ev.type) {
        case "select":
          setSelection(ev.selection);
          if (ev.selection.kind !== "none") setInspectorOpen(true);
          break;
        case "fit":
          setFit(ev.info);
          break;
        case "moveBlock":
          setTemplate((t) => moveBlock(t, ev.id, ev.toIndex));
          break;
        case "moveSlotItem":
          setTemplate((t) => moveSlotItem(t, ev.id, ev.toSlot, ev.index));
          break;
        case "edit":
          setTemplate((t) => applyEdit(t, ev.target, ev.value));
          break;
        case "insertBlock":
          setAddBlock({ index: ev.index });
          break;
        case "addSlotItem":
          setAddSlotFor(ev.slot);
          break;
        case "delete":
          setSelection((sel) => {
            if (sel.kind === "block") setTemplate((t) => removeBlock(t, sel.id));
            else if (sel.kind === "slotItem") setTemplate((t) => removeSlotItem(t, sel.id));
            return { kind: "none" };
          });
          break;
        case "duplicate": {
          let created: string | null = null;
          setTemplate((t) => {
            const r = duplicateBlock(t, ev.id);
            created = r.newId;
            return r.template;
          });
          if (created) setSelection({ kind: "block", id: created });
          break;
        }
        case "moveBy":
          setTemplate((t) => moveBlockBy(t, ev.id, ev.delta));
          break;
        case "properties":
          setInspectorOpen(true);
          break;
        case "pickVariable":
          setVarDialog(true);
          break;
        case "undo":
          p.undo();
          break;
        case "redo":
          p.redo();
          break;
        case "rowMove":
          setTemplate((t) => moveRow(t, ev.id, ev.delta));
          break;
        case "rowAdd":
          setTemplate((t) => addRowAfter(t, ev.afterId).template);
          break;
        case "rowDelete":
          setTemplate((t) => deleteRow(t, ev.id));
          break;
      }
    },
    [setTemplate, p]
  );

  const onUpdateBlock = useCallback((id: string, u: (b: Block) => Block) => setTemplate((t) => updateBlock(t, id, u)), [setTemplate]);
  const onUpdateSlotItem = useCallback((id: string, u: (i: SlotItem) => SlotItem) => setTemplate((t) => updateSlotItem(t, id, u)), [setTemplate]);

  const pickBlockType = (type: Parameters<typeof createBlock>[0]) => {
    const block = createBlock(type);
    if (addBlock?.column) {
      const c = addBlock.column;
      setTemplate((t) => addToColumn(t, c.id, c.side, block));
    } else {
      let index = addBlock?.index;
      if (index == null && selectedBlockId) {
        const loc = findBlock(template, selectedBlockId);
        if (loc && !loc.parentId) index = loc.index + 1;
      }
      setTemplate((t) => insertBlock(t, block, index));
    }
    setAddBlock(null);
    setSelection({ kind: "block", id: block.id });
  };

  const pickSlotItemType = (type: Parameters<typeof createSlotItem>[0]) => {
    if (!addSlotFor) return;
    const item = createSlotItem(type);
    setTemplate((t) => addSlotItem(t, addSlotFor, item));
    setAddSlotFor(null);
    setSelection({ kind: "slotItem", id: item.id });
  };

  const renderBody = () => ({ service_id: serviceId, doc_type: docType, documents: docs, ...(sample.startsWith("recent:") ? { data: previewData.data } : { sample: previewData.sampleKind }) });

  const testPrint = async () => {
    setBusy("print");
    try {
      const r = await api.print(renderBody());
      p.onToast(`Zkušební tisk odeslán na tiskárnu ${r.printer ?? ""}`.trim());
    } catch (e) {
      p.onToast(`Tisk se nezdařil: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setBusy(null);
    }
  };

  const savePdf = async () => {
    const bridge = electron();
    setBusy("pdf");
    try {
      if (bridge) {
        const path = await bridge.showSaveDialog(`${docType}-ukazka.pdf`);
        if (!path) return;
        await api.exportPdf({ ...renderBody(), target_path: path });
        p.onToast(`PDF uloženo: ${path}`);
      } else {
        const blob = await api.pdf(renderBody());
        window.open(URL.createObjectURL(blob), "_blank");
      }
    } catch (e) {
      p.onToast(`PDF se nezdařilo: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setBusy(null);
    }
  };

  const resetTemplate = () => {
    setDocs((d) => {
      const templates = { ...d.templates };
      delete templates[docType];
      return { ...d, templates };
    });
    setSelection({ kind: "none" });
    setResetConfirm(false);
  };

  // Klávesy mimo iframe (fokus v editoru, ne v textovém poli).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) p.redo();
        else p.undo();
      } else if (meta && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (p.dirty && p.canManage) void p.onSave();
      } else if (e.key === "Escape") {
        setSelection({ kind: "none" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [p]);

  const isCustomized = !!docs.templates[docType];

  return (
    <div className="ed-root">
      <div className="doc-type-tabs" style={{ marginBottom: 0 }}>
        {DOC_TYPES.map((dt) => (
          <button key={dt} type="button" className={dt === docType ? "active" : ""} onClick={() => setDocType(dt)}>
            {DOC_TYPE_LABELS[dt]}
            {docs.templates[dt] ? <span className="tab-dot" title="Upravená šablona" /> : null}
          </button>
        ))}
      </div>

      {p.draft && (
        <div className="draft-banner">
          <span>
            Máte neuloženou rozpracovanou verzi z {new Date(p.draft.at).toLocaleString("cs-CZ", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}.
          </span>
          <button type="button" className="ui-btn ui-btn-sm ui-btn-primary" onClick={p.onRestoreDraft}>
            Obnovit
          </button>
          <button type="button" className="ui-btn ui-btn-sm ui-btn-ghost" onClick={p.onDiscardDraft}>
            Zahodit
          </button>
        </div>
      )}

      <div className="ed-toolbar">
        <button type="button" className={`ui-btn ui-btn-sm ${outlineOpen ? "" : "ui-btn-ghost"}`} onClick={() => setOutlineOpen((o) => !o)} title="Osnova dokumentu">
          ☰ Osnova
        </button>
        <select className="ui-select" style={{ width: "auto" }} value={sample} onChange={(e) => setSample(e.target.value)} title="Jaká data se ukážou v náhledu">
          <option value="short">Ukázková zakázka</option>
          <option value="long">Dlouhá zakázka (test rozsahu)</option>
          <option value="placeholders">Názvy polí místo dat</option>
          {recent.length > 0 && (
            <optgroup label="Skutečné z Jobi">
              {recent.map((r) => (
                <option key={r.id} value={`recent:${r.id}`}>
                  {r.label}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <select className="ui-select" style={{ width: "auto" }} value={String(zoom)} onChange={(e) => setZoom(e.target.value === "fit" ? "fit" : (Number(e.target.value) as Zoom))} title="Zvětšení">
          <option value="fit">Přizpůsobit šířce</option>
          <option value="50">50 %</option>
          <option value="75">75 %</option>
          <option value="100">100 %</option>
          <option value="125">125 %</option>
        </select>
        {fit && (
          <span className={`ed-status ${fit.overflow ? "err" : ""}`} title="Kolik stran dokument s těmito daty zabere">
            {fit.pages === 1 ? "1 strana" : fit.pages < 5 ? `${fit.pages} strany` : `${fit.pages} stran`}
            {fit.fontSize !== template.page.fontSize ? ` · písmo zmenšeno na ${fit.fontSize} pt` : ""}
            {fit.overflow ? " · přetéká na další stranu" : ""}
          </span>
        )}
        <span className="spacer" />
        <button type="button" className="ui-btn ui-btn-sm" onClick={p.undo} disabled={!p.canUndo} title="Zpět (⌘Z)">
          ↩
        </button>
        <button type="button" className="ui-btn ui-btn-sm" onClick={p.redo} disabled={!p.canRedo} title="Znovu (⇧⌘Z)">
          ↪
        </button>
        {isCustomized && (
          <button type="button" className="ui-btn ui-btn-sm ui-btn-ghost" onClick={() => setResetConfirm(true)} title="Vrátit výchozí šablonu tohoto dokumentu">
            Výchozí šablona
          </button>
        )}
        <button type="button" className="ui-btn ui-btn-sm" onClick={savePdf} disabled={busy != null}>
          {busy === "pdf" ? "Ukládám…" : "Uložit PDF"}
        </button>
        <button type="button" className="ui-btn ui-btn-sm" onClick={testPrint} disabled={busy != null}>
          {busy === "print" ? "Tisknu…" : "Zkušební tisk"}
        </button>
        <button type="button" className={`ui-btn ${p.dirty ? "ui-btn-primary" : ""}`} onClick={() => void p.onSave()} disabled={!p.dirty || p.save.status === "saving" || !p.canManage} title={!p.canManage ? "Nemáte oprávnění měnit dokumenty" : "Uložit (⌘S)"}>
          {p.save.status === "saving" ? "Ukládám…" : "Uložit"}
        </button>
        {renderSaveStatus(p.save, p.dirty, p.lastSaved)}
      </div>

      {!p.canManage && <div className="ed-status err">Nemáte oprávnění měnit nastavení dokumentů. Změny si můžete prohlédnout, ale neuloží se.</div>}

      <div className={`ed-panes ${outlineOpen ? "" : "no-outline"} ${inspectorOpen ? "" : "no-inspector"}`}>
        {outlineOpen && (
          <Outline
            template={template}
            selection={selection}
            onSelect={setSelection}
            onMoveBlock={(id, to) => setTemplate((t) => moveBlock(t, id, to))}
            onAddBlock={() => setAddBlock({})}
            onAddSlotItem={(s) => setAddSlotFor(s)}
          />
        )}
        <div className="ed-pane" style={{ position: "relative" }}>
          <Canvas ref={canvasRef} html={html} selection={selection} zoom={zoom} onEvent={onCanvasEvent} />
          <div className="cv-hint">Klik = vybrat · další klik = psát · ⋮⋮ = táhnout · „+“ mezi bloky = vložit</div>
        </div>
        {inspectorOpen && (
          <Inspector
            template={template}
            selection={selection}
            onTemplate={setTemplate}
            onUpdateBlock={onUpdateBlock}
            onRemoveBlock={(id) => {
              setTemplate((t) => removeBlock(t, id));
              setSelection({ kind: "none" });
            }}
            onDuplicateBlock={(id) => onCanvasEvent({ type: "duplicate", id })}
            onMoveBlockBy={(id, d) => setTemplate((t) => moveBlockBy(t, id, d))}
            onUpdateSlotItem={onUpdateSlotItem}
            onRemoveSlotItem={(id) => {
              setTemplate((t) => removeSlotItem(t, id));
              setSelection({ kind: "none" });
            }}
            onMoveSlotItem={(id, slot, index) => setTemplate((t) => moveSlotItem(t, id, slot, index))}
            onAddBlock={() => setAddBlock({})}
            onAddToColumn={(id, side) => setAddBlock({ column: { id, side } })}
            onAddSlotItem={(s) => setAddSlotFor(s)}
            onSelect={setSelection}
            onClose={() => setInspectorOpen(false)}
          />
        )}
        {!inspectorOpen && (
          <button type="button" className="ed-open-inspector" onClick={() => setInspectorOpen(true)} title="Zobrazit vlastnosti">
            ⚙
          </button>
        )}
      </div>

      {addBlock && (
        <AddBlockDialog
          title={addBlock.column ? `Přidat blok do ${addBlock.column.side === "left" ? "levého" : "pravého"} sloupce` : addBlock.index != null ? "Vložit blok sem" : "Přidat blok"}
          onPick={pickBlockType}
          onClose={() => setAddBlock(null)}
        />
      )}
      {addSlotFor && <AddSlotItemDialog slot={addSlotFor} onPick={pickSlotItemType} onClose={() => setAddSlotFor(null)} />}
      {varDialog && (
        <VariableDialog
          onPick={(key) => {
            const label = VARIABLES.find((v) => v.key === key)?.label ?? key;
            canvasRef.current?.insertVariable(key, label);
            setVarDialog(false);
          }}
          onClose={() => setVarDialog(false)}
        />
      )}
      {resetConfirm && (
        <div className="dlg-backdrop" onClick={() => setResetConfirm(false)}>
          <div className="dlg" onClick={(e) => e.stopPropagation()}>
            <h3>Vrátit výchozí šablonu?</h3>
            <p>Vaše úpravy dokumentu „{DOC_TYPE_LABELS[docType]}“ se nahradí výchozí šablonou JobiDocs. Ostatní dokumenty ani Značka se nezmění. Změnu lze vzít zpět tlačítkem Zpět, dokud neuložíte.</p>
            <div className="actions">
              <button type="button" className="ui-btn" onClick={() => setResetConfirm(false)}>
                Zrušit
              </button>
              <button type="button" className="ui-btn ui-btn-danger" onClick={resetTemplate}>
                Vrátit výchozí
              </button>
            </div>
          </div>
        </div>
      )}
      {p.save.status === "conflict" && (
        <div className="dlg-backdrop">
          <div className="dlg">
            <h3>Šablonu mezitím změnil někdo jiný</h3>
            <p>Na jiném počítači byla uložena novější verze. Můžete načíst tu novější (vaše neuložené změny se zahodí), nebo ji přepsat svou verzí.</p>
            <div className="actions">
              <button type="button" className="ui-btn" onClick={() => void p.onReload()}>
                Načíst novější verzi
              </button>
              <button type="button" className="ui-btn ui-btn-danger" onClick={() => void p.onSave({ force: true })}>
                Přepsat mou verzí
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function renderSaveStatus(save: SaveState, dirty: boolean, last: Props["lastSaved"]) {
  if (save.status === "saving") return <span className="ed-status">Ukládám…</span>;
  if (save.status === "error") return <span className="ed-status err">Uložení selhalo: {save.message}</span>;
  if (dirty) return <span className="ed-status dirty">● Neuložené změny</span>;
  if (save.status === "saved") return <span className="ed-status ok">Uloženo {save.to === "supabase" ? "pro celý servis" : "jen v tomto počítači"} · {new Date(save.at).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}</span>;
  if (last?.updated_at) return <span className="ed-status">Naposledy uloženo {new Date(last.updated_at).toLocaleString("cs-CZ", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}</span>;
  if (last?.source === "default") return <span className="ed-status">Výchozí šablony</span>;
  return null;
}
