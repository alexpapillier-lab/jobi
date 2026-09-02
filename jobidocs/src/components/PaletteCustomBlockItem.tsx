import { useDraggable } from "@dnd-kit/core";

export function PaletteCustomBlockItem({ id, label, hasAny, onAdd }: { id: string; label: string; hasAny: boolean; onAdd?: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, data: { type: id } });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onAdd}
      title={onAdd ? "Kliknutím přidat na konec, tažením na konkrétní místo" : undefined}
      style={{
        padding: "8px 12px",
        borderRadius: 10,
        border: "1px solid var(--border)",
        background: hasAny ? "var(--accent-soft)" : "var(--panel)",
        color: "var(--text)",
        fontSize: 12,
        fontWeight: 500,
        cursor: "grab",
        display: "flex",
        alignItems: "center",
        gap: 6,
        opacity: isDragging ? 0.6 : 1,
      }}
    >
      <span style={{ opacity: 0.6 }}>⋮⋮</span>
      {label}
      {hasAny && <span style={{ fontSize: 10, color: "var(--accent)", fontWeight: 600 }}>✓</span>}
    </div>
  );
}
