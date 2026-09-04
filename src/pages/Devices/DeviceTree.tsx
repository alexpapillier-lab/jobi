import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button, Input, MenuItem } from "../../components/ui";
import {
  ChevronDownIcon,
  DragIcon,
  EditIcon,
  MoreIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
  XIcon,
} from "../../components/icons";
import { ApiPill, IconButton, plural } from "./shared";
import { KIND_LABEL, type DevicesData, type NodeKind, type Selection } from "./types";

/** Rozbalené uzly přežijí obnovení stránky. */
export const TREE_OPEN_KEY = "jobsheet_devices_tree_open";

export type DeviceTreeProps = {
  data: DevicesData;
  selection: Selection | null;
  onSelect: (sel: Selection | null) => void;
  /** Uzel, který se právě přejmenovává (řídí kontejner – spouští ho i hlavička vpravo a F2). */
  renaming: Selection | null;
  onStartRename: (sel: Selection) => void;
  onCommitRename: (sel: Selection, name: string) => void;
  onCancelRename: () => void;
  onDelete: (sel: Selection) => void;
  onAdd: (kind: NodeKind, parentId: string | null, name: string) => void;
  onMove: (sel: Selection, dir: -1 | 1) => void;
  onReorder: (kind: NodeKind, fromId: string, toId: string) => void;
  onTogglePublic: (sel: Selection) => void;
  /** Štítky „v API“ mají smysl, jen když servis ceník ven posílá. */
  showPublic: boolean;
};

type TreeNode = {
  kind: NodeKind;
  id: string;
  name: string;
  parentId: string | null;
  publicVisible?: boolean;
  children: TreeNode[];
  modelCount: number;
  repairCount: number;
};

type Row =
  | { type: "node"; node: TreeNode; depth: number; expanded: boolean; index: number; siblings: number }
  | { type: "add"; kind: NodeKind; parentId: string | null; depth: number };

const CHILD_KIND: Record<NodeKind, NodeKind | null> = { brand: "category", category: "model", model: null };

function normalize(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function loadOpen(): Set<string> {
  try {
    const raw = localStorage.getItem(TREE_OPEN_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

/** Postaví strom a spočítá modely / opravy pod každým uzlem. */
function buildTree(data: DevicesData): { roots: TreeNode[]; byId: Map<string, TreeNode> } {
  const byId = new Map<string, TreeNode>();
  const repairsByModel = new Map<string, Set<string>>();
  for (const r of data.repairs) {
    for (const mid of r.modelIds ?? []) {
      if (!repairsByModel.has(mid)) repairsByModel.set(mid, new Set());
      repairsByModel.get(mid)!.add(r.id);
    }
  }
  const modelsByCategory = new Map<string, TreeNode[]>();
  for (const m of data.models) {
    const node: TreeNode = {
      kind: "model",
      id: m.id,
      name: m.name,
      parentId: m.categoryId,
      publicVisible: m.publicVisible,
      children: [],
      modelCount: 0,
      repairCount: repairsByModel.get(m.id)?.size ?? 0,
    };
    byId.set(m.id, node);
    if (!modelsByCategory.has(m.categoryId)) modelsByCategory.set(m.categoryId, []);
    modelsByCategory.get(m.categoryId)!.push(node);
  }
  const categoriesByBrand = new Map<string, TreeNode[]>();
  const categoryRepairs = new Map<string, Set<string>>();
  for (const c of data.categories) {
    const children = modelsByCategory.get(c.id) ?? [];
    const set = new Set<string>();
    for (const ch of children) repairsByModel.get(ch.id)?.forEach((id) => set.add(id));
    categoryRepairs.set(c.id, set);
    const node: TreeNode = {
      kind: "category",
      id: c.id,
      name: c.name,
      parentId: c.brandId,
      publicVisible: c.publicVisible,
      children,
      modelCount: children.length,
      repairCount: set.size,
    };
    byId.set(c.id, node);
    if (!categoriesByBrand.has(c.brandId)) categoriesByBrand.set(c.brandId, []);
    categoriesByBrand.get(c.brandId)!.push(node);
  }
  const roots: TreeNode[] = data.brands.map((b) => {
    const children = categoriesByBrand.get(b.id) ?? [];
    const set = new Set<string>();
    let modelCount = 0;
    for (const ch of children) {
      modelCount += ch.modelCount;
      categoryRepairs.get(ch.id)?.forEach((id) => set.add(id));
    }
    const node: TreeNode = {
      kind: "brand",
      id: b.id,
      name: b.name,
      parentId: null,
      publicVisible: b.publicVisible,
      children,
      modelCount,
      repairCount: set.size,
    };
    byId.set(b.id, node);
    return node;
  });
  return { roots, byId };
}

function ancestorsOf(byId: Map<string, TreeNode>, id: string): string[] {
  const out: string[] = [];
  let cur = byId.get(id)?.parentId ?? null;
  while (cur) {
    out.push(cur);
    cur = byId.get(cur)?.parentId ?? null;
  }
  return out;
}

const STYLE = `
.devtree { outline: none; }
.devtree:focus-visible { box-shadow: inset 0 0 0 2px var(--accent); border-radius: var(--radius-sm); }
.devtree-row { position: relative; display: flex; align-items: center; gap: var(--space-1); min-height: 32px; padding-right: var(--space-2); border-radius: var(--radius-xs); cursor: pointer; color: var(--text); font-size: var(--text-base); user-select: none; }
.devtree-row:hover, .devtree-row:focus-within { background: var(--panel-2); }
.devtree-row[data-selected="true"] { background: var(--accent-soft); color: var(--accent); font-weight: 700; }
.devtree-row[data-dragover="true"] { box-shadow: inset 0 0 0 2px var(--accent); }
.devtree-row[data-dragging="true"] { opacity: 0.4; }
.devtree-actions { display: none; align-items: center; gap: 0; flex-shrink: 0; }
.devtree-meta { display: inline-flex; align-items: center; gap: var(--space-1); flex-shrink: 0; font-size: var(--text-xs); color: var(--muted); font-weight: 500; }
.devtree-row:hover .devtree-actions, .devtree-row:focus-within .devtree-actions, .devtree-row[data-menu="true"] .devtree-actions { display: inline-flex; }
.devtree-row:hover .devtree-meta, .devtree-row:focus-within .devtree-meta, .devtree-row[data-menu="true"] .devtree-meta { display: none; }
@media (hover: none) { .devtree-actions { display: inline-flex; } .devtree-meta { display: none; } }
.devtree-chevron { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; flex-shrink: 0; border: none; background: none; color: var(--muted); cursor: pointer; border-radius: var(--radius-2xs); padding: 0; transition: transform 0.15s ease; }
.devtree-chevron:hover { background: var(--panel); color: var(--text); }
.devtree-chevron[data-open="false"] { transform: rotate(-90deg); }
.devtree-drag { display: inline-flex; align-items: center; color: var(--muted); cursor: grab; padding: 0 2px; }
.devtree-add { display: flex; align-items: center; gap: var(--space-2); min-height: 30px; border: none; background: none; color: var(--muted); font-size: var(--text-sm); font-weight: 600; cursor: pointer; border-radius: var(--radius-xs); width: 100%; text-align: left; font-family: inherit; padding-right: var(--space-2); }
.devtree-add:hover, .devtree-add:focus-visible { color: var(--accent); background: var(--panel-2); outline: none; }
.devtree-menu { position: absolute; right: var(--space-2); top: calc(100% + 2px); z-index: 30; min-width: 180px; padding: var(--space-1); background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-sm); box-shadow: var(--shadow-soft); }
`;

export function DeviceTree({
  data,
  selection,
  onSelect,
  renaming,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onDelete,
  onAdd,
  onMove,
  onReorder,
  onTogglePublic,
  showPublic,
}: DeviceTreeProps) {
  const { roots, byId } = useMemo(() => buildTree(data), [data]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(loadOpen);
  const [adding, setAdding] = useState<{ kind: NodeKind; parentId: string | null } | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ kind: NodeKind; id: string; parentId: string | null } | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    try {
      localStorage.setItem(TREE_OPEN_KEY, JSON.stringify([...open]));
    } catch {
      /* soukromý režim – nevadí */
    }
  }, [open]);

  /* Výběr může přijít zvenčí (drobečky vpravo, klávesnice) – uzel musí být
     vidět, tak se rozbalí jeho předci. Úprava stavu při změně props, ne v efektu. */
  const [prevSelection, setPrevSelection] = useState(selection);
  if (selection !== prevSelection) {
    setPrevSelection(selection);
    if (selection) {
      const anc = ancestorsOf(byId, selection.id);
      if (anc.some((id) => !open.has(id))) {
        setOpen((prev) => {
          const next = new Set(prev);
          anc.forEach((id) => next.add(id));
          return next;
        });
      }
    }
  }

  useEffect(() => {
    if (!menuFor) return;
    const close = (e: MouseEvent) => {
      const el = containerRef.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) setMenuFor(null);
      else if (e.target instanceof Element && !e.target.closest(".devtree-menu, .devtree-actions")) setMenuFor(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuFor]);

  const toggleOpen = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const expand = (id: string) =>
    setOpen((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));

  /* Hledání: uzel je vidět, když sedí sám, něco pod ním, nebo něco nad ním.
     Předci shody se rozbalí bez ohledu na uložený stav. */
  const q = normalize(query.trim());
  const searching = q.length > 0;
  const { matches, hasMatchBelow } = useMemo(() => {
    const matches = new Set<string>();
    const hasMatchBelow = new Set<string>();
    if (!q) return { matches, hasMatchBelow };
    const walk = (n: TreeNode): boolean => {
      const self = normalize(n.name).includes(q);
      if (self) matches.add(n.id);
      let below = false;
      for (const ch of n.children) if (walk(ch)) below = true;
      if (below) hasMatchBelow.add(n.id);
      return self || below;
    };
    roots.forEach(walk);
    return { matches, hasMatchBelow };
  }, [roots, q]);

  const rows = useMemo(() => {
    const out: Row[] = [];
    const visit = (nodes: TreeNode[], depth: number, ancestorMatched: boolean, parentId: string | null, parentKind: NodeKind | null) => {
      const shown = searching
        ? nodes.filter((n) => matches.has(n.id) || hasMatchBelow.has(n.id) || ancestorMatched)
        : nodes;
      shown.forEach((n, index) => {
        const forced = searching && hasMatchBelow.has(n.id);
        const expanded = n.children.length > 0 && (forced || open.has(n.id));
        out.push({ type: "node", node: n, depth, expanded, index, siblings: shown.length });
        if (expanded || (!searching && open.has(n.id))) {
          visit(n.children, depth + 1, ancestorMatched || matches.has(n.id), n.id, n.kind);
        }
      });
      const childKind = parentKind ? CHILD_KIND[parentKind] : "brand";
      if (!searching && childKind) out.push({ type: "add", kind: childKind, parentId, depth });
    };
    visit(roots, 0, false, null, null);
    return out;
  }, [roots, open, searching, matches, hasMatchBelow]);

  const nodeRows = rows.filter((r): r is Extract<Row, { type: "node" }> => r.type === "node");

  useEffect(() => {
    if (!selection) return;
    rowRefs.current.get(selection.id)?.scrollIntoView({ block: "nearest" });
  }, [selection]);

  const select = (node: TreeNode) => {
    if (selection?.id === node.id) onSelect(null);
    else onSelect({ kind: node.kind, id: node.id });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
    if (menuFor) return;
    const idx = selection ? nodeRows.findIndex((r) => r.node.id === selection.id) : -1;
    const cur = idx >= 0 ? nodeRows[idx] : null;
    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        const next = nodeRows[Math.min(idx + 1, nodeRows.length - 1)];
        if (next) onSelect({ kind: next.node.kind, id: next.node.id });
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        const next = nodeRows[Math.max(idx - 1, 0)];
        if (next) onSelect({ kind: next.node.kind, id: next.node.id });
        break;
      }
      case "ArrowRight":
        if (cur && cur.node.children.length > 0) {
          e.preventDefault();
          expand(cur.node.id);
        }
        break;
      case "ArrowLeft":
        if (cur) {
          e.preventDefault();
          if (cur.expanded && !searching) toggleOpen(cur.node.id);
          else if (cur.node.parentId) {
            const p = byId.get(cur.node.parentId);
            if (p) onSelect({ kind: p.kind, id: p.id });
          }
        }
        break;
      case "Enter":
        if (cur && cur.node.children.length > 0) {
          e.preventDefault();
          toggleOpen(cur.node.id);
        }
        break;
      case "F2":
        if (cur) {
          e.preventDefault();
          onStartRename({ kind: cur.node.kind, id: cur.node.id });
        }
        break;
      case "Home":
        if (nodeRows[0]) {
          e.preventDefault();
          onSelect({ kind: nodeRows[0].node.kind, id: nodeRows[0].node.id });
        }
        break;
      case "End": {
        const last = nodeRows[nodeRows.length - 1];
        if (last) {
          e.preventDefault();
          onSelect({ kind: last.node.kind, id: last.node.id });
        }
        break;
      }
    }
  };

  const startAdd = (kind: NodeKind, parentId: string | null) => {
    if (parentId) expand(parentId);
    setAdding({ kind, parentId });
    setMenuFor(null);
  };

  const isEmpty = data.brands.length === 0;

  return (
    /* Roste do výšky rodiče (sloupec s max-height nebo panel s pevnou
       výškou) a seznam pod hledáním si posouvá sám. */
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", minHeight: 0, flex: 1 }}>
      <style>{STYLE}</style>
      <div style={{ position: "relative", flexShrink: 0 }}>
        <span
          aria-hidden="true"
          style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", display: "flex" }}
        >
          <SearchIcon size={14} />
        </span>
        <Input
          type="search"
          placeholder="Hledat značku, kategorii, model…"
          aria-label="Hledat ve stromu zařízení"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && query) {
              e.preventDefault();
              setQuery("");
            }
          }}
          style={{ paddingLeft: 30, padding: "8px 10px 8px 30px", boxShadow: "none" }}
        />
      </div>

      <div
        ref={containerRef}
        className="devtree"
        role="tree"
        aria-label="Značky, kategorie a modely"
        tabIndex={0}
        onKeyDown={onKeyDown}
        style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 1, paddingBottom: "var(--space-2)" }}
      >
        {isEmpty && (
          <div style={{ padding: "var(--space-4) var(--space-2)", color: "var(--muted)", fontSize: "var(--text-base)", textAlign: "center" }}>
            Zatím žádné značky. Přidejte první, nebo použijte Import.
          </div>
        )}
        {searching && nodeRows.length === 0 && !isEmpty && (
          <div style={{ padding: "var(--space-4) var(--space-2)", color: "var(--muted)", fontSize: "var(--text-base)", textAlign: "center" }}>
            Nic neodpovídá hledání.
          </div>
        )}
        {rows.map((row) => {
          if (row.type === "add") {
            const key = `add:${row.kind}:${row.parentId ?? "root"}`;
            const isOpen = adding?.kind === row.kind && adding.parentId === row.parentId;
            return (
              <AddRow
                key={key}
                kind={row.kind}
                depth={row.depth}
                open={isOpen}
                onOpen={() => startAdd(row.kind, row.parentId)}
                onClose={() => setAdding(null)}
                onAdd={(name) => {
                  onAdd(row.kind, row.parentId, name);
                  setAdding(null);
                }}
              />
            );
          }
          const { node, depth, expanded, index, siblings } = row;
          const sel: Selection = { kind: node.kind, id: node.id };
          const isSelected = selection?.id === node.id;
          const isRenaming = renaming?.id === node.id;
          const hasChildren = node.children.length > 0;
          const childKind = CHILD_KIND[node.kind];
          const canDrop = !!drag && drag.kind === node.kind && drag.parentId === node.parentId && drag.id !== node.id;
          return (
            <div
              key={node.id}
              ref={(el) => {
                if (el) rowRefs.current.set(node.id, el);
                else rowRefs.current.delete(node.id);
              }}
              className="devtree-row"
              role="treeitem"
              aria-level={depth + 1}
              aria-selected={isSelected}
              aria-expanded={hasChildren ? expanded : undefined}
              data-selected={isSelected || undefined}
              data-menu={menuFor === node.id || undefined}
              data-dragging={drag?.id === node.id || undefined}
              data-dragover={dragOver === node.id && canDrop ? true : undefined}
              draggable={!isRenaming && !searching}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                setDrag({ kind: node.kind, id: node.id, parentId: node.parentId });
              }}
              onDragEnd={() => {
                setDrag(null);
                setDragOver(null);
              }}
              onDragEnter={(e) => {
                e.preventDefault();
                if (canDrop) setDragOver(node.id);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = canDrop ? "move" : "none";
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (drag && canDrop) onReorder(node.kind, drag.id, node.id);
                setDrag(null);
                setDragOver(null);
              }}
              onClick={() => {
                if (isRenaming) return;
                select(node);
                containerRef.current?.focus({ preventScroll: true });
              }}
              onDoubleClick={() => {
                if (!isRenaming) onStartRename(sel);
              }}
              style={{ paddingLeft: 4 + depth * 16 }}
            >
              {hasChildren ? (
                <button
                  type="button"
                  className="devtree-chevron"
                  data-open={expanded}
                  aria-label={expanded ? "Sbalit" : "Rozbalit"}
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!(searching && hasMatchBelow.has(node.id))) toggleOpen(node.id);
                  }}
                >
                  <ChevronDownIcon size={14} />
                </button>
              ) : (
                <span style={{ width: 22, flexShrink: 0 }} />
              )}

              {isRenaming ? (
                <RenameInput
                  initial={node.name}
                  onCommit={(name) => onCommitRename(sel, name)}
                  onCancel={onCancelRename}
                />
              ) : (
                <span
                  style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  title={node.name}
                >
                  {node.name}
                </span>
              )}

              {showPublic && !isRenaming && (
                <ApiPill
                  hidden={node.publicVisible === false}
                  cascade={node.kind !== "model"}
                  onToggle={() => onTogglePublic(sel)}
                />
              )}

              {!isRenaming && (
                <>
                  <span
                    className="devtree-meta"
                    title={
                      node.kind === "model"
                        ? `${node.repairCount} ${plural(node.repairCount, ["oprava", "opravy", "oprav"])}`
                        : `${node.modelCount} ${plural(node.modelCount, ["model", "modely", "modelů"])} · ${node.repairCount} ${plural(node.repairCount, ["oprava", "opravy", "oprav"])}`
                    }
                  >
                    {node.kind === "model" ? node.repairCount : `${node.modelCount} / ${node.repairCount}`}
                  </span>
                  <span className="devtree-actions">
                    {!searching && (
                      <span className="devtree-drag" title="Přetažením změníte pořadí" aria-hidden="true">
                        <DragIcon size={14} />
                      </span>
                    )}
                    <IconButton label="Přejmenovat" icon={<EditIcon size={14} />} onClick={() => onStartRename(sel)} />
                    <IconButton label="Smazat" icon={<TrashIcon size={14} />} danger onClick={() => onDelete(sel)} />
                    <IconButton
                      label="Další akce"
                      icon={<MoreIcon size={14} />}
                      onClick={() => setMenuFor((cur) => (cur === node.id ? null : node.id))}
                    />
                  </span>
                  {menuFor === node.id && (
                    <div className="devtree-menu" role="menu" onClick={(e) => e.stopPropagation()}>
                      <MenuItem
                        disabled={index === 0 || searching}
                        onClick={() => {
                          onMove(sel, -1);
                          setMenuFor(null);
                        }}
                      >
                        Posunout nahoru
                      </MenuItem>
                      <MenuItem
                        disabled={index === siblings - 1 || searching}
                        divider={!!childKind}
                        onClick={() => {
                          onMove(sel, 1);
                          setMenuFor(null);
                        }}
                      >
                        Posunout dolů
                      </MenuItem>
                      {childKind && (
                        <MenuItem onClick={() => startAdd(childKind, node.id)}>
                          Přidat {childKind === "category" ? "kategorii" : "model"}
                        </MenuItem>
                      )}
                      <MenuItem
                        onClick={() => {
                          setMenuFor(null);
                          onStartRename(sel);
                        }}
                      >
                        Přejmenovat
                      </MenuItem>
                      <MenuItem
                        variant="danger"
                        onClick={() => {
                          setMenuFor(null);
                          onDelete(sel);
                        }}
                      >
                        Smazat {KIND_LABEL[node.kind].toLowerCase()}
                      </MenuItem>
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Řádek „+ Přidat …“, po kliknutí se změní v pole. Enter potvrdí, Escape zruší. */
function AddRow({
  kind,
  depth,
  open,
  onOpen,
  onClose,
  onAdd,
}: {
  kind: NodeKind;
  depth: number;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onAdd: (name: string) => void;
}) {
  const [value, setValue] = useState("");
  const label = kind === "brand" ? "Přidat značku" : kind === "category" ? "Přidat kategorii" : "Přidat model";
  const placeholder = kind === "brand" ? "Název značky…" : kind === "category" ? "Název kategorie…" : "Název modelu…";
  const indent = 4 + depth * 16 + 22;

  const commit = () => {
    const name = value.trim();
    if (name) onAdd(name);
    else onClose();
    setValue("");
  };

  if (!open) {
    return (
      <button type="button" className="devtree-add" style={{ paddingLeft: indent }} onClick={onOpen}>
        <PlusIcon size={14} />
        <span>{label}</span>
      </button>
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", paddingLeft: indent, paddingRight: "var(--space-2)", minHeight: 32 }}>
      <Input
        autoFocus
        value={value}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setValue("");
            onClose();
          }
        }}
        onBlur={commit}
        style={{ padding: "5px 8px", boxShadow: "none", fontSize: "var(--text-base)" }}
      />
      <IconButton
        label="Zrušit"
        icon={<XIcon size={14} />}
        onClick={() => {
          setValue("");
          onClose();
        }}
      />
    </div>
  );
}

/** Přejmenování přímo v řádku. Enter uloží, Escape zruší, opuštění pole uloží změnu. */
function RenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const commit = () => {
    if (done.current) return;
    done.current = true;
    const name = value.trim();
    if (name && name !== initial) onCommit(name);
    else onCancel();
  };
  return (
    <Input
      autoFocus
      value={value}
      aria-label="Nový název"
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          done.current = true;
          onCancel();
        }
      }}
      onBlur={commit}
      style={{ flex: 1, minWidth: 0, padding: "4px 8px", boxShadow: "none", fontSize: "var(--text-base)" }}
    />
  );
}

/** Na úzké obrazovce nahrazuje strom tlačítko s drobečky; strom se otevře v panelu. */
export function TreeTriggerButton({ label, onClick }: { label: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="ui-input"
      aria-haspopup="dialog"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--space-2)",
        textAlign: "left",
        cursor: "pointer",
        fontWeight: 600,
        boxShadow: "none",
      }}
    >
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{label}</span>
      <span style={{ color: "var(--muted)", display: "flex", flexShrink: 0 }}>
        <ChevronDownIcon size={16} />
      </span>
    </button>
  );
}

/** Panel se stromem pro úzké obrazovky. */
export function DeviceTreeSheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1200, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Zařízení"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 560,
          height: "min(80dvh, 640px)",
          display: "flex",
          flexDirection: "column",
          background: "var(--panel)",
          backdropFilter: "var(--blur)",
          WebkitBackdropFilter: "var(--blur)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg) var(--radius-lg) 0 0",
          boxShadow: "var(--shadow)",
          padding: "var(--space-3) var(--space-3) var(--space-4)",
          gap: "var(--space-2)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-2)" }}>
          <div style={{ fontWeight: 800, fontSize: "var(--text-lg)", color: "var(--text)" }}>Zařízení</div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Hotovo
          </Button>
        </div>
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
