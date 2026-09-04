import { useMemo, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { Button, Card, Input, Label } from "../../components/ui";
import { ChevronDownIcon, EditIcon, PlusIcon, SearchIcon, TrashIcon, WrenchIcon, XIcon } from "../../components/icons";
import { ApiPill, IconButton, formatKc, formatMinutes, plural } from "./shared";
import { KIND_LABEL, type DevicesData, type InventoryProduct, type Repair, type RepairDraft, type Selection } from "./types";

/**
 * Pravý panel: hlavička vybraného uzlu (drobečky, akce) a opravy pod ním.
 *
 * Stav drží kontejner (Devices.tsx) – panel jen kreslí a volá zpět.
 */
export type RepairsPaneProps = {
  data: DevicesData;
  products: InventoryProduct[];
  selection: Selection | null;
  onSelect: (sel: Selection | null) => void;
  onStartRename: (sel: Selection) => void;
  onToggleNodePublic: (sel: Selection) => void;
  showPublic: boolean;

  /** Opravy už zúžené podle výběru a hledání. */
  repairs: Repair[];
  search: string;
  onSearch: (q: string) => void;
  onToggleRepairPublic: (id: string) => void;
  onBulkPublic: (visible: boolean) => void;

  /** Přidat opravu jde jen s vybraným modelem nebo kategorií. */
  canAdd: boolean;
  adding: boolean;
  onOpenAdd: () => void;
  onCancelAdd: () => void;
  newRepair: RepairDraft;
  setNewRepair: Dispatch<SetStateAction<RepairDraft>>;
  onSubmitAdd: () => void;

  editingId: string | null;
  editDraft: RepairDraft;
  setEditDraft: Dispatch<SetStateAction<RepairDraft>>;
  onStartEdit: (r: Repair) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDeleteRepair: (r: Repair) => void;
};

function ChevronRight({ size = 12 }: { size?: number }) {
  return (
    <span aria-hidden="true" style={{ display: "inline-flex", transform: "rotate(-90deg)", color: "var(--muted)" }}>
      <ChevronDownIcon size={size} />
    </span>
  );
}

export function RepairsPane(p: RepairsPaneProps) {
  const { data, selection } = p;

  /* Drobečky: značka › kategorie › model, poslední je vybraný uzel. */
  const crumbs = useMemo(() => {
    if (!selection) return [];
    const out: { sel: Selection; name: string; publicVisible?: boolean }[] = [];
    let model: DevicesData["models"][number] | undefined;
    let category: DevicesData["categories"][number] | undefined;
    let brand: DevicesData["brands"][number] | undefined;
    if (selection.kind === "model") {
      model = data.models.find((m) => m.id === selection.id);
      category = model && data.categories.find((c) => c.id === model!.categoryId);
    } else if (selection.kind === "category") {
      category = data.categories.find((c) => c.id === selection.id);
    }
    if (selection.kind === "brand") brand = data.brands.find((b) => b.id === selection.id);
    else if (category) brand = data.brands.find((b) => b.id === category!.brandId);
    if (brand) out.push({ sel: { kind: "brand", id: brand.id }, name: brand.name, publicVisible: brand.publicVisible });
    if (category) out.push({ sel: { kind: "category", id: category.id }, name: category.name, publicVisible: category.publicVisible });
    if (model) out.push({ sel: { kind: "model", id: model.id }, name: model.name, publicVisible: model.publicVisible });
    return out;
  }, [data, selection]);

  const current = crumbs[crumbs.length - 1];
  const parents = crumbs.slice(0, -1);
  const productsById = useMemo(() => new Map(p.products.map((x) => [x.id, x])), [p.products]);
  const modelsById = useMemo(() => new Map(data.models.map((m) => [m.id, m])), [data.models]);

  const emptyText = (() => {
    if (p.search.trim()) return "Žádné opravy neodpovídají hledání.";
    if (!selection) return data.repairs.length === 0 ? "Vyberte značku nebo hledejte." : "Žádné opravy.";
    if (selection.kind === "model") return "Tento model zatím nemá opravy.";
    if (selection.kind === "category") return "Tato kategorie zatím nemá opravy.";
    return "Tato značka zatím nemá opravy.";
  })();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", minWidth: 0 }}>
      <Card style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        {/* Hlavička výběru */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-3)", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {parents.length > 0 && (
              <nav aria-label="Umístění" style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", flexWrap: "wrap", marginBottom: 2 }}>
                {parents.map((c, i) => (
                  <span key={c.sel.id} style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-1)" }}>
                    {i > 0 && <ChevronRight />}
                    <button
                      type="button"
                      onClick={() => p.onSelect(c.sel)}
                      style={{ border: "none", background: "none", padding: 0, cursor: "pointer", color: "var(--muted)", fontSize: "var(--text-sm)", fontWeight: 600, fontFamily: "inherit" }}
                    >
                      {c.name}
                    </button>
                  </span>
                ))}
                <ChevronRight />
              </nav>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", minWidth: 0 }}>
              <span style={{ display: "flex", color: "var(--accent)", flexShrink: 0 }}>
                <WrenchIcon size={16} />
              </span>
              <span style={{ fontSize: "var(--text-lg)", fontWeight: 800, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {current ? current.name : "Všechny opravy"}
              </span>
              {current && (
                <span style={{ fontSize: "var(--text-xs)", color: "var(--muted)", fontWeight: 600, flexShrink: 0 }}>
                  {KIND_LABEL[current.sel.kind].toLowerCase()}
                </span>
              )}
            </div>
          </div>
          {current && (
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", flexShrink: 0 }}>
              {p.showPublic && (
                <ApiPill
                  size="md"
                  hidden={current.publicVisible === false}
                  cascade={current.sel.kind !== "model"}
                  onToggle={() => p.onToggleNodePublic(current.sel)}
                />
              )}
              <IconButton label="Přejmenovat" icon={<EditIcon size={15} />} onClick={() => p.onStartRename(current.sel)} />
              <IconButton label="Zrušit výběr" icon={<XIcon size={15} />} onClick={() => p.onSelect(null)} />
            </div>
          )}
        </div>

        {/* Lišta nad seznamem */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
          <div style={{ position: "relative", flex: 1, minWidth: 180 }}>
            <span aria-hidden="true" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", display: "flex" }}>
              <SearchIcon size={14} />
            </span>
            <Input
              type="search"
              placeholder="Hledat opravu (název, podrobnosti)…"
              aria-label="Hledat opravu"
              value={p.search}
              onChange={(e) => p.onSearch(e.target.value)}
              style={{ padding: "8px 10px 8px 30px", boxShadow: "none" }}
            />
          </div>
          {p.showPublic && p.repairs.length > 0 && (
            <div style={{ display: "flex", gap: "var(--space-1)", alignItems: "center" }} title={`Působí na ${p.repairs.length} zobrazených oprav`}>
              <Button variant="ghost" size="sm" onClick={() => p.onBulkPublic(true)}>
                Zveřejnit vše
              </Button>
              <Button variant="ghost" size="sm" onClick={() => p.onBulkPublic(false)}>
                Skrýt vše
              </Button>
            </div>
          )}
          <span title={p.canAdd ? undefined : "Nejdřív vyberte model nebo kategorii ve stromu vlevo."} style={{ display: "inline-flex" }}>
            <Button
              variant="primary"
              size="sm"
              icon={<PlusIcon size={14} />}
              disabled={!p.canAdd || p.adding}
              onClick={p.onOpenAdd}
            >
              Přidat opravu
            </Button>
          </span>
        </div>

        {p.adding && (
          <div style={{ border: "1px solid var(--accent)", borderRadius: "var(--radius-sm)", padding: "var(--space-4)", background: "var(--panel-2)" }}>
            <div style={{ fontWeight: 800, fontSize: "var(--text-base)", color: "var(--text)", marginBottom: "var(--space-3)" }}>Nová oprava</div>
            <RepairForm
              draft={p.newRepair}
              onChange={p.setNewRepair}
              models={data.models}
              products={p.products}
              showPublic={false}
              submitLabel="Přidat opravu"
              onSubmit={p.onSubmitAdd}
              onCancel={p.onCancelAdd}
            />
          </div>
        )}
      </Card>

      {/* Seznam oprav – řádky. */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        {p.repairs.map((r) => {
          const isEditing = p.editingId === r.id;
          const repairModels = (r.modelIds ?? []).map((id) => modelsById.get(id)).filter((m): m is NonNullable<typeof m> => !!m);
          const showModels = selection?.kind !== "model" || repairModels.length > 1;
          const productNames = (r.productIds ?? []).map((id) => productsById.get(id)?.name).filter(Boolean) as string[];
          return (
            <Card key={r.id} style={{ padding: isEditing ? "var(--space-4)" : "10px var(--space-4)" }}>
              {isEditing ? (
                <RepairForm
                  draft={p.editDraft}
                  onChange={p.setEditDraft}
                  models={data.models}
                  products={p.products}
                  showPublic={p.showPublic}
                  submitLabel="Uložit"
                  onSubmit={p.onSaveEdit}
                  onCancel={p.onCancelEdit}
                  compact
                />
              ) : (
                <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-4)" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", minWidth: 0 }}>
                      <span style={{ fontWeight: 800, fontSize: "var(--text-base)", color: "var(--text)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.name}
                      </span>
                      {p.showPublic && (
                        <ApiPill hidden={r.publicVisible === false} onToggle={() => p.onToggleRepairPublic(r.id)} />
                      )}
                    </div>
                    {showModels && repairModels.length > 0 && (
                      /* Výčet zkrácený – u opravy pro 40 modelů přebíjel všechno ostatní. Celý je v titulku. */
                      <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)", marginTop: 2 }} title={repairModels.map((m) => m.name).join(", ")}>
                        {repairModels.slice(0, 3).map((m) => m.name).join(", ")}
                        {repairModels.length > 3 && ` a ${repairModels.length - 3} ${plural(repairModels.length - 3, ["další", "další", "dalších"])}`}
                      </div>
                    )}
                    {productNames.length > 0 && (
                      <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)", marginTop: 2 }}>Produkty: {productNames.join(", ")}</div>
                    )}
                    {r.details && (
                      <div
                        style={{ fontSize: "var(--text-sm)", color: "var(--muted)", lineHeight: 1.4, marginTop: 4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
                      >
                        {r.details}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexShrink: 0 }}>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: "var(--text-base)", fontWeight: 800, color: "var(--text)", whiteSpace: "nowrap" }}>{formatKc(r.price)}</div>
                      <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)", whiteSpace: "nowrap" }}>
                        {formatMinutes(r.estimatedTime)}
                        {r.costs ? ` · náklady ${formatKc(r.costs)}` : ""}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 0 }}>
                      <IconButton label="Upravit" icon={<EditIcon size={15} />} onClick={() => p.onStartEdit(r)} />
                      <IconButton label="Smazat" icon={<TrashIcon size={15} />} danger onClick={() => p.onDeleteRepair(r)} />
                    </div>
                  </div>
                </div>
              )}
            </Card>
          );
        })}

        {p.repairs.length === 0 && (
          <Card style={{ padding: "var(--space-8) var(--space-4)", textAlign: "center", color: "var(--muted)", fontSize: "var(--text-base)", display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-3)" }}>
            <span>{emptyText}</span>
            {p.canAdd && !p.adding && !p.search.trim() && (
              <Button variant="soft" size="sm" icon={<PlusIcon size={14} />} onClick={p.onOpenAdd}>
                Přidat opravu
              </Button>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */

/** Odebratelný štítek (vybraný model / produkt). */
function Chip({ children, muted = false, onRemove, extra }: { children: ReactNode; muted?: boolean; onRemove: () => void; extra?: ReactNode }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-1)",
        padding: "3px 4px 3px 10px",
        background: muted ? "var(--panel)" : "var(--accent-soft)",
        border: muted ? "1px solid var(--warning)" : "1px solid transparent",
        borderRadius: "var(--radius-xs)",
        fontSize: "var(--text-sm)",
        color: muted ? "var(--muted)" : "var(--text)",
      }}
    >
      <span>{children}</span>
      {extra}
      <IconButton label="Odebrat" icon={<XIcon size={12} />} onClick={onRemove} />
    </span>
  );
}

const dropdown: React.CSSProperties = {
  position: "absolute",
  top: "100%",
  left: 0,
  right: 0,
  zIndex: 1000,
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-xs)",
  marginTop: 4,
  maxHeight: 200,
  overflowY: "auto",
  boxShadow: "var(--shadow-soft)",
};

const suggestion: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "8px 12px",
  cursor: "pointer",
  fontSize: "var(--text-base)",
  borderBottom: "1px solid var(--border)",
  background: "transparent",
  border: "none",
  color: "var(--text)",
  fontFamily: "inherit",
};

/**
 * Formulář opravy – společný pro přidání i úpravu.
 *
 * Modely a produkty se vybírají našeptávačem; našeptávač je position:absolute,
 * takže obal formuláře nesmí mít overflow: hidden.
 */
export function RepairForm({
  draft,
  onChange,
  models,
  products,
  showPublic,
  submitLabel,
  onSubmit,
  onCancel,
  compact = false,
}: {
  draft: RepairDraft;
  onChange: Dispatch<SetStateAction<RepairDraft>>;
  models: DevicesData["models"];
  products: InventoryProduct[];
  /** Ukázat u modelů štítek „v API / mimo API“ (jen při úpravě). */
  showPublic: boolean;
  submitLabel: string;
  onSubmit: () => void;
  onCancel: () => void;
  compact?: boolean;
}) {
  const inputStyle: React.CSSProperties = compact ? { padding: "8px 10px", boxShadow: "none" } : { boxShadow: "none" };
  const modelQ = draft.modelSearch.trim().toLowerCase();
  const productQ = draft.productSearch.trim().toLowerCase();
  const modelSuggestions = modelQ
    ? models.filter((m) => m.name.toLowerCase().includes(modelQ) && !draft.modelIds.includes(m.id)).slice(0, 10)
    : [];
  const productSuggestions = productQ
    ? products
        .filter((x) => x.name.toLowerCase().includes(productQ) && !draft.productIds.includes(x.id))
        /* Produkt bez vazby na vybraný model se dřív vůbec nenabídl, takže nově
           založený díl nešlo k opravě připojit. Nabízíme všechny; přiřazené první. */
        .sort(
          (a, b) =>
            Number(b.modelIds.some((m) => draft.modelIds.includes(m))) - Number(a.modelIds.some((m) => draft.modelIds.includes(m))),
        )
        .slice(0, 10)
    : [];
  const canSubmit = draft.name.trim().length > 0 && draft.modelIds.length > 0;

  return (
    <div
      style={{ display: "grid", gap: "var(--space-2)" }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
    >
      <div>
        <Label>Modely</Label>
        <div style={{ position: "relative" }}>
          <Input
            placeholder="Hledat model…"
            value={draft.modelSearch}
            onChange={(e) => onChange((d) => ({ ...d, modelSearch: e.target.value }))}
            style={inputStyle}
          />
          {modelSuggestions.length > 0 && (
            <div style={dropdown} role="listbox">
              {modelSuggestions.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  className="devrepair-suggestion"
                  style={suggestion}
                  onClick={() => onChange((d) => ({ ...d, modelIds: [...d.modelIds, m.id], modelSearch: "" }))}
                >
                  {m.name}
                </button>
              ))}
            </div>
          )}
        </div>
        {draft.modelIds.length > 0 && showPublic && (
          <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)", marginTop: "var(--space-2)" }}>
            Štítkem u modelu určíte, zda se tato oprava posílá do veřejného ceníku právě u něj. V aplikaci se nabízí u všech.
          </div>
        )}
        {draft.modelIds.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-1)", marginTop: "var(--space-2)" }}>
            {draft.modelIds.map((mid) => {
              const model = models.find((m) => m.id === mid);
              if (!model) return null;
              const hidden = draft.hiddenModelIds.includes(mid);
              return (
                <Chip
                  key={mid}
                  muted={showPublic && hidden}
                  onRemove={() => onChange((d) => ({ ...d, modelIds: d.modelIds.filter((id) => id !== mid) }))}
                  extra={
                    showPublic ? (
                      <ApiPill
                        hidden={hidden}
                        onToggle={() =>
                          onChange((d) => ({
                            ...d,
                            hiddenModelIds: d.hiddenModelIds.includes(mid)
                              ? d.hiddenModelIds.filter((id) => id !== mid)
                              : [...d.hiddenModelIds, mid],
                          }))
                        }
                      />
                    ) : undefined
                  }
                >
                  {model.name}
                </Chip>
              );
            })}
          </div>
        )}
        {draft.modelIds.length === 0 && (
          <div style={{ fontSize: "var(--text-xs)", color: "var(--warning-text)", marginTop: "var(--space-1)" }}>Oprava musí mít alespoň jeden model.</div>
        )}
      </div>

      <div>
        <Label>Název</Label>
        <Input
          autoFocus
          placeholder="Název opravy…"
          value={draft.name}
          onChange={(e) => onChange((d) => ({ ...d, name: e.target.value }))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSubmit) {
              e.preventDefault();
              onSubmit();
            }
          }}
          style={inputStyle}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 160px), 1fr))", gap: "var(--space-2)" }}>
        <div>
          <Label>Cena (Kč)</Label>
          <Input type="number" inputMode="decimal" placeholder="0" value={draft.price} onChange={(e) => onChange((d) => ({ ...d, price: e.target.value }))} style={inputStyle} />
        </div>
        <div>
          <Label>Čas (min)</Label>
          <Input type="number" inputMode="numeric" placeholder="0" value={draft.time} onChange={(e) => onChange((d) => ({ ...d, time: e.target.value }))} style={inputStyle} />
        </div>
        <div>
          <Label>Náklady (Kč, volitelné)</Label>
          <Input type="number" inputMode="decimal" placeholder="0" value={draft.costs} onChange={(e) => onChange((d) => ({ ...d, costs: e.target.value }))} style={inputStyle} />
        </div>
      </div>

      <div>
        <Label>Produkty</Label>
        <div style={{ position: "relative" }}>
          <Input
            placeholder="Hledat produkt…"
            value={draft.productSearch}
            onChange={(e) => onChange((d) => ({ ...d, productSearch: e.target.value }))}
            style={inputStyle}
          />
          {productSuggestions.length > 0 && (
            <div style={dropdown} role="listbox">
              {productSuggestions.map((x) => {
                const linked = draft.modelIds.length === 0 || x.modelIds.some((m) => draft.modelIds.includes(m));
                return (
                  <button
                    key={x.id}
                    type="button"
                    role="option"
                    aria-selected={false}
                    className="devrepair-suggestion"
                    style={suggestion}
                    onClick={() => onChange((d) => ({ ...d, productIds: [...d.productIds, x.id], productSearch: "" }))}
                  >
                    <div style={{ fontWeight: 600 }}>
                      {x.name}
                      {x.sku ? ` (${x.sku})` : ""}
                    </div>
                    {!linked && <div style={{ fontSize: "var(--text-xs)", color: "var(--warning-text)" }}>Není přiřazen k vybranému modelu</div>}
                    {x.modelIds.length > 0 && (
                      <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)" }}>
                        Modely: {x.modelIds.map((mid) => models.find((m) => m.id === mid)?.name).filter(Boolean).join(", ")}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {draft.productIds.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-1)", marginTop: "var(--space-2)" }}>
            {draft.productIds.map((pid) => {
              const product = products.find((x) => x.id === pid);
              if (!product) return null;
              return (
                <Chip key={pid} onRemove={() => onChange((d) => ({ ...d, productIds: d.productIds.filter((id) => id !== pid) }))}>
                  {product.name}
                </Chip>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <Label>Podrobnosti</Label>
        <textarea
          className="ui-input"
          placeholder="Podrobnosti…"
          value={draft.details}
          onChange={(e) => onChange((d) => ({ ...d, details: e.target.value }))}
          style={{ ...inputStyle, minHeight: compact ? 50 : 60, resize: "vertical" }}
        />
      </div>

      <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
        <Button variant="soft" onClick={onCancel}>
          Zrušit
        </Button>
        <Button variant="primary" onClick={onSubmit} disabled={!canSubmit}>
          {submitLabel}
        </Button>
      </div>
      <style>{`.devrepair-suggestion:hover, .devrepair-suggestion:focus-visible { background: var(--accent-soft); outline: none; }`}</style>
    </div>
  );
}
