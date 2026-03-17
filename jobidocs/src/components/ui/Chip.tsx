import React from "react";

interface ChipProps {
  label: string;
  active?: boolean;
  onRemove?: () => void;
  onClick?: () => void;
  icon?: React.ReactNode;
  draggable?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function Chip({ label, active, onRemove, onClick, icon, className, style }: ChipProps) {
  return (
    <div
      className={`chip-root ${active ? "chip-active" : ""} ${onClick ? "chip-clickable" : ""} ${className ?? ""}`}
      onClick={onClick}
      style={style}
    >
      {icon && <span className="chip-icon">{icon}</span>}
      <span className="chip-text">{label}</span>
      {onRemove && (
        <button type="button" className="chip-remove" onClick={(e) => { e.stopPropagation(); onRemove(); }} aria-label="Odebrat">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );
}
