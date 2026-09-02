import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export function SortableSignaturePlaceholder({ id, styles, docConfig, onEditClick, selectedSectionId }: { id: string; styles: Record<string, unknown>; docConfig: Record<string, unknown>; onEditClick?: (id: string) => void; selectedSectionId?: string | null }) {
  const { setNodeRef, attributes, listeners, transform, isDragging } = useSortable({ id });
  const blockId = id.slice(7);
  const blocks = (docConfig?.customBlocks as Record<string, { type?: string; content?: string }>) || {};
  const label = blocks[blockId]?.content || "Podpis";
  const isSelected = selectedSectionId === id;
  const style: React.CSSProperties = {
    width: "100%",
    flexShrink: 0,
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? "none" : "transform 0.2s ease",
    opacity: isDragging ? 0.4 : 1,
    cursor: "grab",
    touchAction: "none",
  };
  const cardStyle: React.CSSProperties = {
    padding: "8px 12px",
    background: (styles.sectionBg as string) ?? "#fff",
    borderRadius: 6,
    border: isSelected ? "2px solid var(--accent)" : `1px solid ${(styles.borderColor as string) ?? "#e5e7eb"}`,
    display: "flex",
    alignItems: "center",
    gap: 8,
    flex: "1 1 680px",
    width: 680,
    minWidth: 680,
    maxWidth: 680,
    boxSizing: "border-box",
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} onClick={() => onEditClick?.(id)} role="button" tabIndex={0} aria-label={`Podpis: ${label}`}>
      <div style={cardStyle}>
        <span style={{ fontSize: 10, opacity: 0.5, userSelect: "none" }}>⋮⋮</span>
        <div style={{ flex: 1 }}>
          <div style={{ width: "100%", maxWidth: 120, borderBottom: `1px solid ${(styles.contentColor as string) ?? "#171717"}`, marginBottom: 2 }} />
          <div style={{ fontSize: 9, color: (styles.contentColor as string) ?? "#171717" }}>{label}</div>
        </div>
      </div>
    </div>
  );
}
