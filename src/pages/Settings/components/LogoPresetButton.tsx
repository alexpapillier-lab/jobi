import { AppLogo } from "../../../components/AppLogo";
import { type LogoColors } from "../../../lib/logoPresets";
import { useState } from "react";

export function LogoPresetButton({
  isActive,
  label,
  logoUrl,
  fallbackColors,
  onClick,
}: {
  isActive: boolean;
  label: string;
  logoUrl: string;
  fallbackColors: LogoColors;
  onClick: () => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: 0,
        border: isActive ? "3px solid var(--accent)" : "2px solid var(--border)",
        borderRadius: "var(--radius-md)",
        background: "var(--panel)",
        cursor: "pointer",
        overflow: "hidden",
        transition: "var(--transition-smooth)",
        transform: isActive ? "scale(1.02)" : "scale(1)",
        boxShadow: isActive ? "0 8px 24px var(--accent-glow)" : "var(--shadow-soft)",
      }}
    >
      <div style={{ height: 100, display: "flex", alignItems: "center", justifyContent: "center", background: fallbackColors.background }}>
        {imgFailed ? (
          <AppLogo size={56} colors={fallbackColors} modern />
        ) : (
          <img
            src={logoUrl}
            alt=""
            style={{ width: 56, height: 56, objectFit: "contain" }}
            onError={() => setImgFailed(true)}
          />
        )}
      </div>
      <div style={{ padding: "8px 10px", textAlign: "center", background: "var(--panel)", borderTop: "1px solid var(--border)" }}>
        <span style={{ fontWeight: 700, fontSize: 12, color: "var(--text)" }}>{label}</span>
      </div>
    </button>
  );
}
