/**
 * Inspektor: vlastnosti vybraného bloku / prvku slotu; bez výběru
 * nastavení stránky. Každá změna jde rovnou do šablony a hned se
 * vykreslí na ploše.
 */
import { useRef, type ReactNode } from "react";
import { DOC_TYPE_LABELS, SLOT_LABELS, SLOT_NAMES, type Block, type BlockWhen, type FieldRow, type ItemsColumn, type SlotItem, type SlotName, type Template } from "../../core/index";
import { newId } from "../../core/index";
import type { Selection } from "./Canvas";
import { BLOCK_TYPE_LABELS, SLOT_ITEM_LABELS, fieldRowFromVariable, findBlock, findSlotItem } from "./templateOps";
import { VariablePicker, insertAtCursor } from "./VariablePicker";

type Props = {
  template: Template;
  selection: Selection;
  onTemplate: (updater: (t: Template) => Template) => void;
  onUpdateBlock: (id: string, updater: (b: Block) => Block) => void;
  onRemoveBlock: (id: string) => void;
  onDuplicateBlock: (id: string) => void;
  onMoveBlockBy: (id: string, delta: number) => void;
  onUpdateSlotItem: (id: string, updater: (i: SlotItem) => SlotItem) => void;
  onRemoveSlotItem: (id: string) => void;
  onMoveSlotItem: (id: string, toSlot: SlotName, index: number) => void;
  onAddBlock: () => void;
  onAddToColumn: (columnsId: string, side: "left" | "right") => void;
  onAddSlotItem: (slot: SlotName) => void;
  onSelect: (s: Selection) => void;
  onClose?: () => void;
};

function CloseBtn({ onClose }: { onClose?: () => void }) {
  if (!onClose) return null;
  return (
    <button type="button" className="icon-btn" title="Skrýt panel" onClick={onClose} style={{ marginLeft: "auto" }}>
      ✕
    </button>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="in-row">
      <label>{label}</label>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

function TextWithVars({ value, onChange, multiline, placeholder }: { value: string; onChange: (v: string) => void; multiline?: boolean; placeholder?: string }) {
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  return (
    <div>
      {multiline ? (
        <textarea ref={ref as React.RefObject<HTMLTextAreaElement>} className="ui-textarea" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input ref={ref as React.RefObject<HTMLInputElement>} className="ui-input" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
      <div style={{ marginTop: 4 }}>
        <VariablePicker onPick={(k) => onChange(insertAtCursor(ref.current, value, `{{${k}}}`))} />
      </div>
    </div>
  );
}

function WhenSelect({ value, onChange }: { value: BlockWhen | undefined; onChange: (v: BlockWhen) => void }) {
  return (
    <Row label="Zobrazit" hint="„Jen když jsou data“: blok se při tisku vynechá, když k němu Jobi nepošle žádné hodnoty.">
      <select className="ui-select" value={value ?? "always"} onChange={(e) => onChange(e.target.value as BlockWhen)}>
        <option value="always">Vždy</option>
        <option value="notEmpty">Jen když jsou data</option>
      </select>
    </Row>
  );
}

const ITEM_COLUMNS: { key: ItemsColumn; label: string }[] = [
  { key: "name", label: "Název" },
  { key: "qty", label: "Množství" },
  { key: "unit", label: "Jednotka" },
  { key: "unitPrice", label: "Cena za jednotku" },
  { key: "vatRate", label: "Sazba DPH" },
  { key: "total", label: "Celkem" },
];

export function Inspector(p: Props) {
  const { template, selection } = p;

  if (selection.kind === "block") {
    const loc = findBlock(template, selection.id);
    if (loc) return <BlockPanel {...p} block={loc.block} nested={!!loc.parentId} />;
  }
  if (selection.kind === "slotItem") {
    const loc = findSlotItem(template, selection.id);
    if (loc) return <SlotItemPanel {...p} item={loc.item} slot={loc.slot} />;
  }
  if (selection.kind === "slot") return <SlotPanel {...p} slot={selection.id} />;
  return <DocumentPanel {...p} />;
}

function DocumentPanel({ template, onTemplate, onAddBlock, onAddSlotItem, onClose }: Props) {
  const m = template.page.margins;
  const setMargin = (k: keyof typeof m, v: number) => onTemplate((t) => ({ ...t, page: { ...t.page, margins: { ...t.page.margins, [k]: Math.max(5, Math.min(30, v || 0)) } } }));
  return (
    <div className="ed-pane">
      <div className="ed-pane-head">Dokument<CloseBtn onClose={onClose} /></div>
      <div className="ed-pane-body">
        <h3 className="in-title">{DOC_TYPE_LABELS[template.docType]}</h3>
        <p className="in-sub">Klikněte na cokoli v dokumentu: dalším klikem text upravíte přímo, lišta u prvku ho přesune nebo odebere, plus mezi bloky vloží nový. Prvky hlavičky a spodku stránky lze tažením přesouvat mezi místy.</p>
        <Row label="Rozsah" hint="Na jednu stranu: písmo a mezery se zmenší, dokud se dokument nevejde. Když ani to nestačí, pokračuje na další straně.">
          <select className="ui-select" value={template.page.fit} onChange={(e) => onTemplate((t) => ({ ...t, page: { ...t.page, fit: e.target.value as "onePage" | "auto" } }))}>
            <option value="onePage">Vejít se na jednu stranu</option>
            <option value="auto">Podle obsahu (více stran)</option>
          </select>
        </Row>
        <Row label="Velikost písma (pt)">
          <input type="number" className="ui-input" min={7} max={14} step={0.5} value={template.page.fontSize} onChange={(e) => onTemplate((t) => ({ ...t, page: { ...t.page, fontSize: Math.max(7, Math.min(14, Number(e.target.value) || 10)) } }))} />
        </Row>
        <Row label="Okraje stránky (mm)">
          <div className="in-inline">
            {(["top", "right", "bottom", "left"] as const).map((k) => (
              <label key={k} style={{ fontSize: 11, color: "var(--muted)", fontWeight: 500 }}>
                {{ top: "Nahoře", right: "Vpravo", bottom: "Dole", left: "Vlevo" }[k]}
                <input type="number" className="ui-input" min={5} max={30} value={m[k]} onChange={(e) => setMargin(k, Number(e.target.value))} />
              </label>
            ))}
          </div>
        </Row>
        <div className="in-section">
          <div className="in-section-title">Přidat</div>
          <div className="in-actions">
            <button type="button" className="ui-btn ui-btn-primary" onClick={onAddBlock}>
              + Blok do obsahu
            </button>
            <button type="button" className="ui-btn" onClick={() => onAddSlotItem("headerRight")}>
              + Prvek do hlavičky
            </button>
            <button type="button" className="ui-btn" onClick={() => onAddSlotItem("bottomRight")}>
              + Prvek dolů
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SlotPanel({ template, slot, onAddSlotItem, onSelect, onClose }: Props & { slot: SlotName }) {
  const items = template.slots[slot];
  return (
    <div className="ed-pane">
      <div className="ed-pane-head">Místo<CloseBtn onClose={onClose} /></div>
      <div className="ed-pane-body">
        <h3 className="in-title">{SLOT_LABELS[slot]}</h3>
        <p className="in-sub">{slot.startsWith("header") ? "Opakuje se na každé straně dokumentu." : "Sedí u spodního okraje poslední strany."}</p>
        {items.length === 0 && <p className="in-sub">Zatím prázdné.</p>}
        {items.map((i) => (
          <div key={i.id} className="ol-item" onClick={() => onSelect({ kind: "slotItem", id: i.id })} role="button" tabIndex={0}>
            {SLOT_ITEM_LABELS[i.type]}
          </div>
        ))}
        <div className="in-actions">
          <button type="button" className="ui-btn ui-btn-primary" onClick={() => onAddSlotItem(slot)}>
            + Přidat prvek sem
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Blok
// ---------------------------------------------------------------------------

function BlockPanel(p: Props & { block: Block; nested: boolean }) {
  const { block, onUpdateBlock, onRemoveBlock, onDuplicateBlock, onMoveBlockBy, nested } = p;
  const upd = <T extends Block>(patch: Partial<T>) => onUpdateBlock(block.id, (b) => ({ ...b, ...patch }) as Block);

  return (
    <div className="ed-pane">
      <div className="ed-pane-head">
        Blok
        <span className="spacer" />
        <button type="button" className="icon-btn" title="Posunout výš" onClick={() => onMoveBlockBy(block.id, -1)}>
          ↑
        </button>
        <button type="button" className="icon-btn" title="Posunout níž" onClick={() => onMoveBlockBy(block.id, 1)}>
          ↓
        </button>
        <button type="button" className="icon-btn" title="Duplikovat" onClick={() => onDuplicateBlock(block.id)}>
          ⧉
        </button>
        <button type="button" className="icon-btn danger" title="Odebrat blok" onClick={() => onRemoveBlock(block.id)}>
          ✕
        </button>
        <CloseBtn onClose={p.onClose} />
      </div>
      <div className="ed-pane-body">
        <h3 className="in-title">{BLOCK_TYPE_LABELS[block.type]}</h3>
        <p className="in-sub">{nested ? "Blok ve sloupci." : "Blok v hlavním toku dokumentu."}</p>
        {block.type === "fields" && <FieldsEditor block={block} onChange={(b) => onUpdateBlock(block.id, () => b)} />}
        {block.type === "items" && (
          <>
            <Row label="Nadpis">
              <input className="ui-input" value={block.title ?? ""} onChange={(e) => upd({ title: e.target.value })} />
            </Row>
            <Row label="Sloupce">
              {ITEM_COLUMNS.map((c) => (
                <label key={c.key} style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 500, fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={block.columns.includes(c.key)}
                    onChange={(e) => {
                      const cols = e.target.checked ? [...block.columns, c.key] : block.columns.filter((x) => x !== c.key);
                      upd({ columns: ITEM_COLUMNS.map((x) => x.key).filter((k) => cols.includes(k)) });
                    }}
                  />
                  {c.label}
                </label>
              ))}
            </Row>
            <Row label="Řádek Celkem">
              <select className="ui-select" value={block.showTotal === false ? "no" : "yes"} onChange={(e) => upd({ showTotal: e.target.value === "yes" })}>
                <option value="yes">Zobrazit</option>
                <option value="no">Skrýt</option>
              </select>
            </Row>
            <WhenSelect value={block.when} onChange={(w) => upd({ when: w })} />
          </>
        )}
        {block.type === "text" && (
          <>
            <Row label="Nadpis bloku" hint="Nepovinný.">
              <input className="ui-input" value={block.title ?? ""} onChange={(e) => upd({ title: e.target.value })} />
            </Row>
            <Row label="Text" hint="Prázdný řádek odděluje odstavce. Tučně: <b>text</b>.">
              <TextWithVars multiline value={block.content} onChange={(v) => upd({ content: v })} />
            </Row>
            <div className="in-inline">
              <Row label="Velikost">
                <select className="ui-select" value={block.size ?? "normal"} onChange={(e) => upd({ size: e.target.value as "normal" | "small" })}>
                  <option value="normal">Běžná</option>
                  <option value="small">Malá (právní text)</option>
                </select>
              </Row>
              <Row label="Zarovnání">
                <select className="ui-select" value={block.align ?? "left"} onChange={(e) => upd({ align: e.target.value as "left" | "justify" | "center" })}>
                  <option value="left">Vlevo</option>
                  <option value="justify">Do bloku</option>
                  <option value="center">Na střed</option>
                </select>
              </Row>
              <Row label="Sloupce">
                <select className="ui-select" value={String(block.columns ?? 1)} onChange={(e) => upd({ columns: Number(e.target.value) as 1 | 2 })}>
                  <option value="1">Jeden</option>
                  <option value="2">Dva (šetří místo)</option>
                </select>
              </Row>
            </div>
            <WhenSelect value={block.when} onChange={(w) => upd({ when: w })} />
          </>
        )}
        {block.type === "heading" && (
          <>
            <Row label="Text nadpisu">
              <TextWithVars value={block.text} onChange={(v) => upd({ text: v })} />
            </Row>
            <Row label="Velikost">
              <select className="ui-select" value={String(block.level ?? 2)} onChange={(e) => upd({ level: Number(e.target.value) as 1 | 2 })}>
                <option value="2">Nadpis oddílu</option>
                <option value="1">Velký nadpis</option>
              </select>
            </Row>
          </>
        )}
        {block.type === "spacer" && (
          <Row label="Výška (mm)">
            <input type="number" className="ui-input" min={1} max={80} value={block.height} onChange={(e) => upd({ height: Math.max(1, Math.min(80, Number(e.target.value) || 1)) })} />
          </Row>
        )}
        {block.type === "divider" && <p className="in-sub">Tenká linka přes celou šířku. Nemá žádné nastavení.</p>}
        {block.type === "columns" && (
          <>
            <p className="in-sub">Bloky ve sloupcích upravíte kliknutím na ně v dokumentu nebo v osnově.</p>
            <div className="in-actions">
              <button type="button" className="ui-btn" onClick={() => p.onAddToColumn(block.id, "left")}>
                + Blok vlevo
              </button>
              <button type="button" className="ui-btn" onClick={() => p.onAddToColumn(block.id, "right")}>
                + Blok vpravo
              </button>
            </div>
          </>
        )}
        {block.type === "signature" && (
          <>
            <Row label="Popisek pod čárou">
              <TextWithVars value={block.label} onChange={(v) => upd({ label: v })} />
            </Row>
            <div className="in-inline">
              <Row label="Zarovnání">
                <select className="ui-select" value={block.align ?? "left"} onChange={(e) => upd({ align: e.target.value as "left" | "center" | "right" })}>
                  <option value="left">Vlevo</option>
                  <option value="center">Na střed</option>
                  <option value="right">Vpravo</option>
                </select>
              </Row>
              <Row label="Šířka čáry (mm)">
                <input type="number" className="ui-input" min={20} max={120} value={block.width ?? 50} onChange={(e) => upd({ width: Math.max(20, Math.min(120, Number(e.target.value) || 50)) })} />
              </Row>
            </div>
          </>
        )}
        {block.type === "photos" && (
          <>
            <Row label="Nadpis" hint="Výchozí „Fotodokumentace“.">
              <input className="ui-input" value={block.title ?? ""} onChange={(e) => upd({ title: e.target.value })} />
            </Row>
            <Row label="Rozložení">
              <select className="ui-select" value={block.mode} onChange={(e) => upd({ mode: e.target.value as "pages" | "grid" })}>
                <option value="pages">Každá fotka na vlastní straně</option>
                <option value="grid">Mřížka v dokumentu</option>
              </select>
            </Row>
            <WhenSelect value={block.when} onChange={(w) => upd({ when: w })} />
          </>
        )}
        {block.type === "warranty" && (
          <>
            <Row label="Nadpis">
              <input className="ui-input" value={block.title ?? ""} placeholder="Záruka" onChange={(e) => upd({ title: e.target.value })} />
            </Row>
            <p className="in-sub">Délku záruky a datum posílá Jobi ze zakázky.</p>
            <WhenSelect value={block.when} onChange={(w) => upd({ when: w })} />
          </>
        )}
        {block.type === "vatSummary" && <WhenSelect value={block.when} onChange={(w) => upd({ when: w })} />}
        {block.type === "payment" && (
          <>
            <Row label="Nadpis">
              <input className="ui-input" value={block.title ?? ""} onChange={(e) => upd({ title: e.target.value })} />
            </Row>
            <Row label="QR platba">
              <select className="ui-select" value={block.showQr === false ? "no" : "yes"} onChange={(e) => upd({ showQr: e.target.value === "yes" })}>
                <option value="yes">Zobrazit</option>
                <option value="no">Skrýt</option>
              </select>
            </Row>
            <WhenSelect value={block.when} onChange={(w) => upd({ when: w })} />
          </>
        )}
      </div>
    </div>
  );
}

function FieldsEditor({ block, onChange }: { block: Extract<Block, { type: "fields" }>; onChange: (b: Block) => void }) {
  const setRows = (rows: FieldRow[]) => onChange({ ...block, rows });
  const setRow = (id: string, patch: Partial<FieldRow>) => setRows(block.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= block.rows.length) return;
    const rows = [...block.rows];
    [rows[i], rows[j]] = [rows[j], rows[i]];
    setRows(rows);
  };
  return (
    <>
      <Row label="Nadpis tabulky" hint="Nepovinný.">
        <input className="ui-input" value={block.title ?? ""} onChange={(e) => onChange({ ...block, title: e.target.value })} />
      </Row>
      <Row label="Řádky" hint="Řádek bez hodnoty se při tisku vynechá.">
        <div>
          {block.rows.map((r, i) => (
            <div key={r.id} className="fr-row">
              <div className="fr-fields">
                <input className="ui-input" value={r.label} placeholder="Štítek (např. Číslo zakázky)" onChange={(e) => setRow(r.id, { label: e.target.value })} />
                <RowValueInput value={r.value} onChange={(v) => setRow(r.id, { value: v })} />
              </div>
              <div className="btns">
                <button type="button" className="icon-btn" title="Výš" onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button type="button" className="icon-btn" title="Níž" onClick={() => move(i, 1)}>
                  ↓
                </button>
                <button type="button" className="icon-btn danger" title="Odebrat řádek" onClick={() => setRows(block.rows.filter((x) => x.id !== r.id))}>
                  ✕
                </button>
              </div>
            </div>
          ))}
          <div className="in-actions">
            <VariablePicker label="Přidat řádek z údaje" onPick={(k) => setRows([...block.rows, fieldRowFromVariable(k)])} />
            <button type="button" className="ui-btn ui-btn-sm" onClick={() => setRows([...block.rows, { id: newId("r"), label: "Štítek", value: "" }])}>
              + Vlastní řádek
            </button>
          </div>
        </div>
      </Row>
      <Row label="Rozložení">
        <select className="ui-select" value={block.layout ?? "grid"} onChange={(e) => onChange({ ...block, layout: e.target.value as "grid" | "table" })}>
          <option value="grid">Mřížka (dva sloupce, štítek nad hodnotou)</option>
          <option value="table">Tabulka (štítek vlevo, hodnota vpravo)</option>
        </select>
      </Row>
      <WhenSelect value={block.when} onChange={(w) => onChange({ ...block, when: w })} />
    </>
  );
}

function RowValueInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="fr-value">
      <input ref={ref} className="ui-input" value={value} placeholder="Hodnota nebo {{…}}" onChange={(e) => onChange(e.target.value)} />
      <VariablePicker label="" align="right" onPick={(k) => onChange(insertAtCursor(ref.current, value, `{{${k}}}`))} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Prvek slotu
// ---------------------------------------------------------------------------

function SlotItemPanel(p: Props & { item: SlotItem; slot: SlotName }) {
  const { item, slot, onUpdateSlotItem, onRemoveSlotItem, onMoveSlotItem } = p;
  const upd = <T extends SlotItem>(patch: Partial<T>) => onUpdateSlotItem(item.id, (i) => ({ ...i, ...patch }) as SlotItem);
  return (
    <div className="ed-pane">
      <div className="ed-pane-head">
        Prvek
        <span className="spacer" />
        <button type="button" className="icon-btn danger" title="Odebrat" onClick={() => onRemoveSlotItem(item.id)}>
          ✕
        </button>
        <CloseBtn onClose={p.onClose} />
      </div>
      <div className="ed-pane-body">
        <h3 className="in-title">{SLOT_ITEM_LABELS[item.type]}</h3>
        <Row label="Umístění" hint="Nebo prvek přetáhněte přímo v dokumentu.">
          <select className="ui-select" value={slot} onChange={(e) => onMoveSlotItem(item.id, e.target.value as SlotName, 999)}>
            {SLOT_NAMES.map((s) => (
              <option key={s} value={s}>
                {SLOT_LABELS[s]}
              </option>
            ))}
          </select>
        </Row>
        {item.type === "title" && (
          <>
            <Row label="Text" hint="Prázdné = název typu dokumentu.">
              <TextWithVars value={item.text ?? ""} onChange={(v) => upd({ text: v })} />
            </Row>
            <Row label="Styl">
              <select className="ui-select" value={item.style ?? "plain"} onChange={(e) => upd({ style: e.target.value as "box" | "plain" })}>
                <option value="plain">Bez rámečku</option>
                <option value="box">V rámečku</option>
              </select>
            </Row>
            <Row label="Číslo dokumentu" hint="Číslo zakázky, reklamace nebo faktury z Jobi, velkým písmem.">
              <select className="ui-select" value={item.showNumber === false ? "no" : "yes"} onChange={(e) => upd({ showNumber: e.target.value === "yes" })}>
                <option value="yes">Zobrazit</option>
                <option value="no">Skrýt</option>
              </select>
            </Row>
            <Row label="Datum pod číslem">
              <select className="ui-select" value={item.showDate ? "yes" : "no"} onChange={(e) => upd({ showDate: e.target.value === "yes" })}>
                <option value="yes">Zobrazit</option>
                <option value="no">Skrýt</option>
              </select>
            </Row>
          </>
        )}
        {item.type === "brand" && (
          <Row label="Kontakty pod názvem">
            <select className="ui-select" value={item.showContact === false ? "no" : "yes"} onChange={(e) => upd({ showContact: e.target.value === "yes" })}>
              <option value="yes">Zobrazit</option>
              <option value="no">Jen název</option>
            </select>
          </Row>
        )}
        {item.type === "logo" && (
          <Row label="Výška (mm)" hint="Obrázek loga nastavíte ve Značce.">
            <input type="number" className="ui-input" min={6} max={40} value={item.height ?? 16} onChange={(e) => upd({ height: Math.max(6, Math.min(40, Number(e.target.value) || 16)) })} />
          </Row>
        )}
        {item.type === "stamp" && (
          <>
            <Row label="Popisek pod čárou">
              <TextWithVars value={item.label ?? ""} onChange={(v) => upd({ label: v })} />
            </Row>
            <Row label="Výška razítka (mm)" hint="Obrázek razítka nastavíte ve Značce.">
              <input type="number" className="ui-input" min={8} max={50} value={item.height ?? 22} onChange={(e) => upd({ height: Math.max(8, Math.min(50, Number(e.target.value) || 22)) })} />
            </Row>
          </>
        )}
        {item.type === "qr" && (
          <>
            <Row label="Text vedle QR" hint="Prázdné = text ze Značky.">
              <TextWithVars value={item.text ?? ""} onChange={(v) => upd({ text: v })} />
            </Row>
            <Row label="Velikost (mm)">
              <input type="number" className="ui-input" min={12} max={40} value={item.size ?? 22} onChange={(e) => upd({ size: Math.max(12, Math.min(40, Number(e.target.value) || 22)) })} />
            </Row>
          </>
        )}
        {item.type === "signature" && (
          <>
            <Row label="Popisek pod čárou">
              <TextWithVars value={item.label} onChange={(v) => upd({ label: v })} />
            </Row>
            <Row label="Šířka čáry (mm)">
              <input type="number" className="ui-input" min={20} max={120} value={item.width ?? 50} onChange={(e) => upd({ width: Math.max(20, Math.min(120, Number(e.target.value) || 50)) })} />
            </Row>
          </>
        )}
        {item.type === "text" && (
          <>
            <Row label="Text">
              <TextWithVars multiline value={item.content} onChange={(v) => upd({ content: v })} />
            </Row>
            <Row label="Velikost">
              <select className="ui-select" value={item.size ?? "small"} onChange={(e) => upd({ size: e.target.value as "normal" | "small" })}>
                <option value="normal">Běžná</option>
                <option value="small">Malá</option>
              </select>
            </Row>
          </>
        )}
        {item.type === "contact" && <p className="in-sub">Název, telefon, e-mail a web servisu z Jobi v jednom řádku.</p>}
        {item.type === "pageNumber" && <p className="in-sub">Číslo strany a celkový počet stran.</p>}
      </div>
    </div>
  );
}
