/**
 * Osnova: hlavička (2 sloty) · obsah (bloky) · spodek stránky (3 sloty).
 * Jediné místo, kde se pořadí mění i klávesnicí / tlačítky; tažením
 * lze bloky řadit i tady.
 */
import { useState } from "react";
import { SLOT_LABELS, type Block, type SlotName, type Template } from "../../core/index";
import type { Selection } from "./Canvas";
import { blockLabel, slotItemLabel, BLOCK_TYPE_LABELS } from "./templateOps";

type Props = {
  template: Template;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onMoveBlock: (id: string, toIndex: number) => void;
  onAddBlock: () => void;
  onAddSlotItem: (slot: SlotName) => void;
};

const HEADER_SLOTS: SlotName[] = ["headerLeft", "headerRight"];
const BOTTOM_SLOTS: SlotName[] = ["bottomLeft", "bottomCenter", "bottomRight"];

export function Outline({ template, selection, onSelect, onMoveBlock, onAddBlock, onAddSlotItem }: Props) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; pos: "before" | "after" } | null>(null);

  const isSel = (kind: Selection["kind"], id: string) => selection.kind === kind && "id" in selection && selection.id === id;

  const renderSlotGroup = (slots: SlotName[]) =>
    slots.map((slot) => (
      <div key={slot}>
        <div className={`ol-slot ${isSel("slot", slot) ? "active" : ""}`} onClick={() => onSelect({ kind: "slot", id: slot })} role="button" tabIndex={0}>
          <span>{SLOT_LABELS[slot]}</span>
          <button type="button" className="icon-btn count" title="Přidat prvek" onClick={(e) => { e.stopPropagation(); onAddSlotItem(slot); }}>
            +
          </button>
        </div>
        {template.slots[slot].map((item) => (
          <div key={item.id} className={`ol-item nested ${isSel("slotItem", item.id) ? "active" : ""}`} onClick={() => onSelect({ kind: "slotItem", id: item.id })} role="button" tabIndex={0}>
            <span>{slotItemLabel(item)}</span>
          </div>
        ))}
      </div>
    ));

  const renderBlock = (b: Block, index: number, nested = false) => {
    const hiddenPrint = "when" in b && b.when === "notEmpty";
    return (
      <div key={b.id}>
        <div
          className={`ol-item ${nested ? "nested" : ""} ${isSel("block", b.id) ? "active" : ""} ${over?.id === b.id ? `drag-over-${over.pos}` : ""} ${hiddenPrint ? "hidden-print" : ""}`}
          onClick={() => onSelect({ kind: "block", id: b.id })}
          role="button"
          tabIndex={0}
          draggable={!nested}
          onDragStart={(e) => {
            if (nested) return;
            setDragId(b.id);
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={(e) => {
            if (!dragId || nested) return;
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            setOver({ id: b.id, pos: e.clientY < r.top + r.height / 2 ? "before" : "after" });
          }}
          onDrop={(e) => {
            if (!dragId || nested) return;
            e.preventDefault();
            const to = over?.pos === "after" ? index + 1 : index;
            onMoveBlock(dragId, to);
            setDragId(null);
            setOver(null);
          }}
          onDragEnd={() => {
            setDragId(null);
            setOver(null);
          }}
          title={hiddenPrint ? "Tiskne se jen když jsou data" : undefined}
        >
          {!nested && <span className="ol-grip">⋮⋮</span>}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{blockLabel(b)}</span>
          <span className="ol-type">{BLOCK_TYPE_LABELS[b.type]}</span>
        </div>
        {b.type === "columns" && (
          <>
            {b.left.map((c, i) => renderBlock(c, i, true))}
            {b.right.map((c, i) => renderBlock(c, i, true))}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="ed-pane">
      <div className="ed-pane-head">Osnova</div>
      <div className="ed-pane-body">
        <div className="ol-group">
          <div className="ol-group-title">Hlavička</div>
          {renderSlotGroup(HEADER_SLOTS)}
        </div>
        <div className="ol-group">
          <div className="ol-group-title">Obsah</div>
          {template.blocks.map((b, i) => renderBlock(b, i))}
          {template.blocks.length === 0 && <div className="ol-slot">Dokument nemá žádné bloky.</div>}
          <button type="button" className="ol-add" onClick={onAddBlock}>
            + Přidat blok
          </button>
        </div>
        <div className="ol-group">
          <div className="ol-group-title">Spodek stránky</div>
          {renderSlotGroup(BOTTOM_SLOTS)}
        </div>
      </div>
    </div>
  );
}
