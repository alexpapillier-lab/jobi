import { useState } from "react";
import type { BlockType, SlotItemType, SlotName } from "../../core/index";
import { SLOT_LABELS, variableGroups } from "../../core/index";
import { BLOCK_TYPE_DESCRIPTIONS, BLOCK_TYPE_LABELS, SLOT_ITEM_DESCRIPTIONS, SLOT_ITEM_LABELS } from "./templateOps";

const BLOCK_ORDER: BlockType[] = ["fields", "text", "heading", "items", "signature", "columns", "divider", "spacer", "photos", "warranty", "vatSummary", "payment"];
const SLOT_ORDER: SlotItemType[] = ["title", "brand", "logo", "stamp", "signature", "qr", "text", "contact", "pageNumber"];

export function AddBlockDialog({ onPick, onClose, title = "Přidat blok" }: { onPick: (t: BlockType) => void; onClose: () => void; title?: string }) {
  return (
    <div className="dlg-backdrop" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p>Blok se přidá do dokumentu. Přesunout ho můžete tažením v osnově nebo přímo v dokumentu.</p>
        <div className="ab-menu">
          {BLOCK_ORDER.map((t) => (
            <button key={t} type="button" className="ab-item" onClick={() => onPick(t)}>
              <b>{BLOCK_TYPE_LABELS[t]}</b>
              <span>{BLOCK_TYPE_DESCRIPTIONS[t]}</span>
            </button>
          ))}
        </div>
        <div className="actions">
          <button type="button" className="ui-btn" onClick={onClose}>
            Zrušit
          </button>
        </div>
      </div>
    </div>
  );
}

export function AddSlotItemDialog({ slot, onPick, onClose }: { slot: SlotName; onPick: (t: SlotItemType) => void; onClose: () => void }) {
  return (
    <div className="dlg-backdrop" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <h3>Přidat prvek: {SLOT_LABELS[slot].toLowerCase()}</h3>
        <p>Prvky v hlavičce se opakují na každé straně, prvky dole sedí u spodního okraje poslední strany. Mezi místy je lze přetahovat.</p>
        <div className="ab-menu">
          {SLOT_ORDER.map((t) => (
            <button key={t} type="button" className="ab-item" onClick={() => onPick(t)}>
              <b>{SLOT_ITEM_LABELS[t]}</b>
              <span>{SLOT_ITEM_DESCRIPTIONS[t]}</span>
            </button>
          ))}
        </div>
        <div className="actions">
          <button type="button" className="ui-btn" onClick={onClose}>
            Zrušit
          </button>
        </div>
      </div>
    </div>
  );
}

export function VariableDialog({ onPick, onClose }: { onPick: (key: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const groups = variableGroups()
    .map((g) => ({ ...g, items: g.items.filter((v) => !q || v.label.toLowerCase().includes(q.toLowerCase()) || v.key.includes(q.toLowerCase())) }))
    .filter((g) => g.items.length > 0);
  return (
    <div className="dlg-backdrop" onMouseDown={onClose}>
      <div className="dlg" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Vložit údaj</h3>
        <p>Na místo kurzoru se vloží údaj ze zakázky. Při tisku ho Jobi nahradí skutečnou hodnotou.</p>
        <input className="ui-input" placeholder="Hledat…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus style={{ marginBottom: 8 }} />
        <div style={{ maxHeight: "50vh", overflow: "auto" }}>
          {groups.map((g) => (
            <div key={g.group}>
              <div className="vp-group">{g.group}</div>
              {g.items.map((v) => (
                <button key={v.key} type="button" className="vp-item" onClick={() => onPick(v.key)}>
                  <span>{v.label}</span>
                  <code>{v.sample}</code>
                </button>
              ))}
            </div>
          ))}
          {groups.length === 0 && <div className="vp-group">Nic nenalezeno</div>}
        </div>
        <div className="actions">
          <button type="button" className="ui-btn" onClick={onClose}>
            Zrušit
          </button>
        </div>
      </div>
    </div>
  );
}
