import React from "react";

/** JobiDocs logo – aktuální jdlogo.png z logos/ (ikona aplikace, tray i uvnitř aplikace). */
const LOGO_PNG_URL = "/logos/jdlogo.png";

export type AppLogoProps = {
  size?: number;
  style?: React.CSSProperties;
  /** Barvy z kontextu (Jobi) – u PNG se nepoužívají, ponecháno pro kompatibilitu API */
  colors?: { background: string; jInner: string; foreground: string };
  modern?: boolean;
};

export function AppLogo({ size = 40, style, modern = true }: AppLogoProps) {
  return (
    <div
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        borderRadius: modern ? Math.max(4, size * 0.22) : 0,
        boxShadow: modern ? "0 2px 12px rgba(0,0,0,0.08)" : undefined,
        ...style,
      }}
      aria-hidden
    >
      <img
        src={LOGO_PNG_URL}
        alt=""
        width={size}
        height={size}
        style={{ display: "block", width: size, height: size, objectFit: "contain" }}
      />
    </div>
  );
}
