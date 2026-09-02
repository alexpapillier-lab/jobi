import React from "react";
import { useDroppable } from "@dnd-kit/core";

export function SectionDropZone({ index }: { index: number }) {
  const left = useDroppable({ id: `drop-${index}-left` });
  const right = useDroppable({ id: `drop-${index}-right` });
  const baseStyle: React.CSSProperties = {
    minHeight: 28,
    flexShrink: 0,
    borderRadius: 6,
    transition: "background 0.2s ease, border 0.2s ease, min-height 0.2s ease",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
  };
  return (
    <div style={{ width: "100%", display: "flex", gap: 4 }}>
      <div
        ref={left.setNodeRef}
        style={{
          ...baseStyle,
          flex: 1,
          minHeight: left.isOver ? 48 : 28,
          background: left.isOver ? "var(--accent-soft)" : "rgba(0,0,0,0.03)",
          border: left.isOver ? "2px dashed var(--accent)" : "1px dashed var(--border)",
        }}
      >
        {left.isOver && <span style={{ fontSize: 12, fontWeight: 700, color: "var(--accent)", display: "flex", alignItems: "center", gap: 4 }}>↓ Pustit vlevo</span>}
      </div>
      <div
        ref={right.setNodeRef}
        style={{
          ...baseStyle,
          flex: 1,
          minHeight: right.isOver ? 48 : 28,
          background: right.isOver ? "var(--accent-soft)" : "rgba(0,0,0,0.03)",
          border: right.isOver ? "2px dashed var(--accent)" : "1px dashed var(--border)",
        }}
      >
        {right.isOver && <span style={{ fontSize: 12, fontWeight: 700, color: "var(--accent)", display: "flex", alignItems: "center", gap: 4 }}>↓ Pustit vpravo</span>}
      </div>
    </div>
  );
}
