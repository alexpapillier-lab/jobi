/**
 * Čisté operace nad šablonou (bez Reactu): najít / upravit / přesunout blok
 * nebo prvek slotu. Všechny vrací novou šablonu, původní nemění.
 */
import { newId, VARIABLES, type Block, type BlockType, type FieldRow, type SlotItem, type SlotItemType, type SlotName, type Template } from "../../core/index";

export const BLOCK_TYPE_LABELS: Record<BlockType, string> = {
  fields: "Tabulka údajů",
  items: "Položky / opravy",
  text: "Text",
  heading: "Nadpis",
  divider: "Oddělovací čára",
  spacer: "Mezera",
  columns: "Dva sloupce",
  signature: "Řádek na podpis",
  photos: "Fotodokumentace",
  warranty: "Záruka",
  vatSummary: "Rekapitulace DPH",
  payment: "Platební údaje",
};

export const BLOCK_TYPE_DESCRIPTIONS: Record<BlockType, string> = {
  fields: "Štítek a hodnota v řádcích – číslo zakázky, zařízení, data…",
  items: "Tabulka provedených oprav nebo fakturačních položek s celkem.",
  text: "Libovolný text, může obsahovat proměnné {{…}} a tučné písmo.",
  heading: "Velký nadpis oddílu.",
  divider: "Tenká vodorovná linka.",
  spacer: "Prázdné místo dané výšky.",
  columns: "Dva bloky vedle sebe (např. dodavatel a odběratel).",
  signature: "Čára s popiskem pro podpis, v toku dokumentu.",
  photos: "Fotky ze zakázky, každá na vlastní straně nebo v mřížce.",
  warranty: "Délka záruky a datum, do kdy platí.",
  vatSummary: "Základ daně, DPH a celkem k úhradě.",
  payment: "Číslo účtu, IBAN, VS a QR platba.",
};

export const SLOT_ITEM_LABELS: Record<SlotItemType, string> = {
  title: "Název dokumentu",
  brand: "Název servisu a kontakty",
  logo: "Logo",
  stamp: "Razítko / podpis",
  qr: "QR kód na hodnocení",
  signature: "Řádek na podpis",
  text: "Text",
  contact: "Kontakt servisu (řádek)",
  pageNumber: "Číslo strany",
};

export const SLOT_ITEM_DESCRIPTIONS: Record<SlotItemType, string> = {
  title: "„Zakázkový list“ apod., v rámečku nebo bez.",
  brand: "Velký název servisu a kontakty ve dvou sloupcích.",
  logo: "Logo ze Značky.",
  stamp: "Obrázek razítka ze Značky s čárou a popiskem.",
  qr: "Odkaz na hodnocení ze Značky jako QR kód.",
  signature: "Čára s popiskem pro podpis.",
  text: "Krátký text, může obsahovat proměnné.",
  contact: "Název, telefon, e-mail a web servisu v jednom řádku.",
  pageNumber: "„Strana 1 / 2“.",
};

export function blockLabel(b: Block): string {
  switch (b.type) {
    case "fields":
      return b.title?.trim() || `Tabulka údajů (${b.rows.length})`;
    case "items":
      return b.title?.trim() || "Položky";
    case "text":
      return b.title?.trim() || (b.content.trim() ? b.content.replace(/\s+/g, " ").slice(0, 32) + (b.content.length > 32 ? "…" : "") : "Text");
    case "heading":
      return b.text.trim() || "Nadpis";
    case "signature":
      return `Podpis: ${b.label}`;
    case "spacer":
      return `Mezera ${b.height} mm`;
    default:
      return BLOCK_TYPE_LABELS[b.type];
  }
}

export function slotItemLabel(i: SlotItem): string {
  switch (i.type) {
    case "title":
      return i.text?.trim() ? `Název: ${i.text}` : "Název dokumentu";
    case "signature":
      return `Podpis: ${i.label}`;
    case "stamp":
      return `Razítko: ${i.label ?? ""}`.trim();
    case "text":
      return i.content.trim() ? i.content.slice(0, 28) : "Text";
    default:
      return SLOT_ITEM_LABELS[i.type];
  }
}

// ---------------------------------------------------------------------------
// Bloky
// ---------------------------------------------------------------------------

export type BlockLocation = { block: Block; index: number; parentId?: string; side?: "left" | "right" };

export function findBlock(t: Template, id: string): BlockLocation | null {
  for (let i = 0; i < t.blocks.length; i++) {
    const b = t.blocks[i];
    if (b.id === id) return { block: b, index: i };
    if (b.type === "columns") {
      for (const side of ["left", "right"] as const) {
        const idx = b[side].findIndex((c) => c.id === id);
        if (idx >= 0) return { block: b[side][idx], index: idx, parentId: b.id, side };
      }
    }
  }
  return null;
}

function mapBlocks(blocks: Block[], fn: (b: Block) => Block | null): Block[] {
  const out: Block[] = [];
  for (const b of blocks) {
    const r = fn(b);
    if (r == null) continue;
    if (r.type === "columns") out.push({ ...r, left: mapBlocks(r.left, fn), right: mapBlocks(r.right, fn) });
    else out.push(r);
  }
  return out;
}

export function updateBlock(t: Template, id: string, updater: (b: Block) => Block): Template {
  return { ...t, blocks: mapBlocks(t.blocks, (b) => (b.id === id ? updater(b) : b)) };
}

export function removeBlock(t: Template, id: string): Template {
  return { ...t, blocks: mapBlocks(t.blocks, (b) => (b.id === id ? null : b)) };
}

export function insertBlock(t: Template, block: Block, index?: number): Template {
  const blocks = [...t.blocks];
  const i = index == null || index < 0 || index > blocks.length ? blocks.length : index;
  blocks.splice(i, 0, block);
  return { ...t, blocks };
}

/** Přesun bloku na pozici v hlavním toku (vnořený blok se nejdřív vyjme ze sloupce). */
export function moveBlock(t: Template, id: string, toIndex: number): Template {
  const loc = findBlock(t, id);
  if (!loc) return t;
  const without = removeBlock(t, id);
  let idx = toIndex;
  if (!loc.parentId && loc.index < toIndex) idx -= 1;
  return insertBlock(without, loc.block, idx);
}

export function moveBlockBy(t: Template, id: string, delta: number): Template {
  const loc = findBlock(t, id);
  if (!loc) return t;
  if (loc.parentId && loc.side) {
    return updateBlock(t, loc.parentId, (p) => {
      if (p.type !== "columns") return p;
      const arr = [...p[loc.side!]];
      const j = loc.index + delta;
      if (j < 0 || j >= arr.length) return p;
      [arr[loc.index], arr[j]] = [arr[j], arr[loc.index]];
      return { ...p, [loc.side!]: arr };
    });
  }
  const j = loc.index + delta;
  if (j < 0 || j >= t.blocks.length) return t;
  const blocks = [...t.blocks];
  [blocks[loc.index], blocks[j]] = [blocks[j], blocks[loc.index]];
  return { ...t, blocks };
}

function reId(b: Block): Block {
  const base = { ...b, id: newId() } as Block;
  if (base.type === "fields") return { ...base, rows: base.rows.map((r) => ({ ...r, id: newId("r") })) };
  if (base.type === "columns") return { ...base, left: base.left.map(reId), right: base.right.map(reId) };
  return base;
}

export function duplicateBlock(t: Template, id: string): { template: Template; newId: string | null } {
  const loc = findBlock(t, id);
  if (!loc) return { template: t, newId: null };
  const copy = reId(loc.block);
  if (loc.parentId && loc.side) {
    const template = updateBlock(t, loc.parentId, (p) => {
      if (p.type !== "columns") return p;
      const arr = [...p[loc.side!]];
      arr.splice(loc.index + 1, 0, copy);
      return { ...p, [loc.side!]: arr };
    });
    return { template, newId: copy.id };
  }
  return { template: insertBlock(t, copy, loc.index + 1), newId: copy.id };
}

export function addToColumn(t: Template, columnsId: string, side: "left" | "right", block: Block): Template {
  return updateBlock(t, columnsId, (p) => (p.type === "columns" ? { ...p, [side]: [...p[side], block] } : p));
}

export function createBlock(type: BlockType): Block {
  const id = newId();
  switch (type) {
    case "fields":
      return { id, type, rows: [fieldRowFromVariable("number"), fieldRowFromVariable("device.name")] };
    case "items":
      return { id, type, title: "Provedené opravy", columns: ["name", "total"], showTotal: true, when: "notEmpty" };
    case "text":
      return { id, type, content: "", size: "normal", align: "left" };
    case "heading":
      return { id, type, text: "Nadpis", level: 2 };
    case "divider":
      return { id, type };
    case "spacer":
      return { id, type, height: 6 };
    case "columns":
      return { id, type, left: [], right: [] };
    case "signature":
      return { id, type, label: "Podpis zákazníka", align: "left", width: 50 };
    case "photos":
      return { id, type, mode: "pages", when: "notEmpty" };
    case "warranty":
      return { id, type, when: "notEmpty" };
    case "vatSummary":
      return { id, type, when: "notEmpty" };
    case "payment":
      return { id, type, title: "Platební údaje", showQr: true, when: "notEmpty" };
  }
}

export function fieldRowFromVariable(key: string): FieldRow {
  const def = VARIABLES.find((v) => v.key === key);
  return { id: newId("r"), label: def?.label ?? key, value: `{{${key}}}` };
}

// ---------------------------------------------------------------------------
// Sloty
// ---------------------------------------------------------------------------

export function findSlotItem(t: Template, id: string): { item: SlotItem; slot: SlotName; index: number } | null {
  for (const slot of Object.keys(t.slots) as SlotName[]) {
    const idx = t.slots[slot].findIndex((i) => i.id === id);
    if (idx >= 0) return { item: t.slots[slot][idx], slot, index: idx };
  }
  return null;
}

export function updateSlotItem(t: Template, id: string, updater: (i: SlotItem) => SlotItem): Template {
  const slots = { ...t.slots };
  for (const slot of Object.keys(slots) as SlotName[]) {
    slots[slot] = slots[slot].map((i) => (i.id === id ? updater(i) : i));
  }
  return { ...t, slots };
}

export function removeSlotItem(t: Template, id: string): Template {
  const slots = { ...t.slots };
  for (const slot of Object.keys(slots) as SlotName[]) slots[slot] = slots[slot].filter((i) => i.id !== id);
  return { ...t, slots };
}

export function moveSlotItem(t: Template, id: string, toSlot: SlotName, index: number): Template {
  const loc = findSlotItem(t, id);
  if (!loc) return t;
  const without = removeSlotItem(t, id);
  const arr = [...without.slots[toSlot]];
  let idx = index;
  if (loc.slot === toSlot && loc.index < index) idx -= 1;
  idx = Math.max(0, Math.min(arr.length, idx));
  arr.splice(idx, 0, loc.item);
  return { ...without, slots: { ...without.slots, [toSlot]: arr } };
}

export function addSlotItem(t: Template, slot: SlotName, item: SlotItem): Template {
  return { ...t, slots: { ...t.slots, [slot]: [...t.slots[slot], item] } };
}

export function createSlotItem(type: SlotItemType): SlotItem {
  const id = newId("s");
  switch (type) {
    case "title":
      return { id, type, style: "box" };
    case "brand":
      return { id, type, showContact: true };
    case "logo":
      return { id, type, height: 16 };
    case "stamp":
      return { id, type, label: "Razítko a podpis technika", height: 22 };
    case "qr":
      return { id, type, size: 22 };
    case "signature":
      return { id, type, label: "Podpis zákazníka", width: 50 };
    case "text":
      return { id, type, content: "", size: "small" };
    case "contact":
      return { id, type };
    case "pageNumber":
      return { id, type };
  }
}

// ---------------------------------------------------------------------------
// Úpravy přímo v dokumentu
// ---------------------------------------------------------------------------

/** Cíl úpravy z atributu data-edit: "block:ID:field" | "row:ID:field" | "item:ID:field". */
export function applyEdit(t: Template, target: string, value: string): Template {
  const [kind, id, field] = target.split(":");
  if (!kind || !id || !field) return t;
  if (kind === "block") {
    return updateBlock(t, id, (b) => {
      const patch: Record<string, string | undefined> = {};
      if (field === "title") patch.title = value.trim() ? value : undefined;
      else if (field === "content" || field === "text" || field === "label") patch[field] = value;
      else return b;
      return { ...b, ...patch } as Block;
    });
  }
  if (kind === "row") {
    return updateRow(t, id, (r) => (field === "label" ? { ...r, label: value } : field === "value" ? { ...r, value } : r));
  }
  if (kind === "item") {
    return updateSlotItem(t, id, (i) => {
      if (field === "text" && (i.type === "title" || i.type === "qr")) return { ...i, text: value.trim() ? value : undefined };
      if (field === "label" && (i.type === "signature" || i.type === "stamp")) return { ...i, label: value };
      if (field === "content" && i.type === "text") return { ...i, content: value };
      return i;
    });
  }
  return t;
}

export function findRow(t: Template, rowId: string): { blockId: string; index: number; row: FieldRow } | null {
  let found: { blockId: string; index: number; row: FieldRow } | null = null;
  mapBlocks(t.blocks, (b) => {
    if (!found && b.type === "fields") {
      const idx = b.rows.findIndex((r) => r.id === rowId);
      if (idx >= 0) found = { blockId: b.id, index: idx, row: b.rows[idx] };
    }
    return b;
  });
  return found;
}

export function updateRow(t: Template, rowId: string, updater: (r: FieldRow) => FieldRow): Template {
  const loc = findRow(t, rowId);
  if (!loc) return t;
  return updateBlock(t, loc.blockId, (b) => (b.type === "fields" ? { ...b, rows: b.rows.map((r) => (r.id === rowId ? updater(r) : r)) } : b));
}

export function moveRow(t: Template, rowId: string, delta: number): Template {
  const loc = findRow(t, rowId);
  if (!loc) return t;
  return updateBlock(t, loc.blockId, (b) => {
    if (b.type !== "fields") return b;
    const j = loc.index + delta;
    if (j < 0 || j >= b.rows.length) return b;
    const rows = [...b.rows];
    [rows[loc.index], rows[j]] = [rows[j], rows[loc.index]];
    return { ...b, rows };
  });
}

export function addRowAfter(t: Template, rowId: string, row?: FieldRow): { template: Template; rowId: string } {
  const loc = findRow(t, rowId);
  const created = row ?? { id: newId("r"), label: "Štítek", value: "" };
  if (!loc) return { template: t, rowId: created.id };
  const template = updateBlock(t, loc.blockId, (b) => {
    if (b.type !== "fields") return b;
    const rows = [...b.rows];
    rows.splice(loc.index + 1, 0, created);
    return { ...b, rows };
  });
  return { template, rowId: created.id };
}

export function deleteRow(t: Template, rowId: string): Template {
  const loc = findRow(t, rowId);
  if (!loc) return t;
  return updateBlock(t, loc.blockId, (b) => (b.type === "fields" ? { ...b, rows: b.rows.filter((r) => r.id !== rowId) } : b));
}
