
interface PresetCardProps {
  name: string;
  description: string;
  colors: {
    accent: string;
    primary: string;
    secondary: string;
    headerBg: string;
    border: string;
  };
  active?: boolean;
  onClick: () => void;
}

export function PresetCard({ name, description, colors, active, onClick }: PresetCardProps) {
  return (
    <button type="button" className={`prc-root ${active ? "prc-active" : ""}`} onClick={onClick}>
      <div className="prc-preview">
        <div className="prc-header" style={{ background: colors.headerBg, borderBottom: `2px solid ${colors.accent}` }}>
          <div className="prc-dot" style={{ background: colors.accent }} />
          <div className="prc-line" style={{ background: colors.primary, width: "60%" }} />
          <div className="prc-line prc-line-sm" style={{ background: colors.secondary, width: "40%" }} />
        </div>
        <div className="prc-body-preview">
          <div className="prc-line" style={{ background: colors.border, width: "100%" }} />
          <div className="prc-line" style={{ background: colors.border, width: "75%" }} />
          <div className="prc-line" style={{ background: colors.border, width: "50%" }} />
        </div>
      </div>
      <div className="prc-info">
        <span className="prc-name">{name}</span>
        <span className="prc-desc">{description}</span>
      </div>
    </button>
  );
}
