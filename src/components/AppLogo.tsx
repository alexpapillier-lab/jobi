import React, { useEffect, useMemo, useState } from "react";
import { useTheme } from "../theme/ThemeProvider";
import { getLogoColors } from "../lib/logoPresets";
import type { LogoPresetId } from "../lib/logoPresets";
import { STORAGE_KEYS } from "../constants/storageKeys";

const LOGO_SVG_URL = "/logos/logopic.svg";
/** JobiDocs logo – PNG ze složky logos (logos png/jdlogo.png), servírováno na /logos/jdlogo.png */
const LOGO_JOBIDOCS_PNG_URL = "/logos/jdlogo.png";

function applyLogoColors(svg: string, background: string, jInner: string, foreground: string): string {
  return svg
    .replace(/id="background"[^>]*fill="[^"]*"/, `id="background" width="260" height="260" x="0" y="0" fill="${background}"`)
    .replace(/id="j-inner" fill="#2ec8ff"/, `id="j-inner" fill="${jInner}"`)
    .replace(/fill="#ffffff"/g, `fill="${foreground}"`);
}

export type AppLogoProps = {
  size?: number;
  style?: React.CSSProperties;
  /** Předvyplněné barvy pro náhled (např. v mřížce výběru) – přepíše theme + preset */
  colors?: { background: string; jInner: string; foreground: string };
  /** Skrýt bílé prvky (dokument, obrys) – zůstane jen výplň J; efekt = foreground = background */
  minimal?: boolean;
  /** Zaoblené rohy a jemný stín kolem loga */
  modern?: boolean;
  /** Varianta loga: jobi (sidebar, O aplikaci) nebo jobidocs (náhled v Nastavení) */
  variant?: "jobi" | "jobidocs";
};

export function AppLogo({ size = 40, style, colors: colorsOverride, minimal: minimalOverride, modern = true, variant = "jobi" }: AppLogoProps) {
  const { theme } = useTheme();
  const [rawSvg, setRawSvg] = useState<string | null>(null);
  const [logoPresetVersion, setLogoPresetVersion] = useState(0);
  const logoUrl = variant === "jobidocs" ? null : LOGO_SVG_URL;

  useEffect(() => {
    if (variant === "jobidocs") return;
    let cancelled = false;
    fetch(logoUrl!)
      .then((r) => r.text())
      .then((text) => {
        if (!cancelled) setRawSvg(text);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [logoUrl, variant]);

  useEffect(() => {
    const handler = () => setLogoPresetVersion((v) => v + 1);
    window.addEventListener("jobsheet:logo-preset-changed", handler);
    return () => window.removeEventListener("jobsheet:logo-preset-changed", handler);
  }, []);

  const presetId = useMemo(() => {
    if (typeof localStorage === "undefined") return "auto" as LogoPresetId;
    return (localStorage.getItem(STORAGE_KEYS.LOGO_PRESET) as LogoPresetId | null) ?? "auto";
  }, [logoPresetVersion]);

  const minimal = useMemo(() => {
    if (minimalOverride !== undefined) return minimalOverride;
    try {
      return localStorage.getItem(STORAGE_KEYS.LOGO_MINIMAL) === "1";
    } catch {
      return false;
    }
  }, [minimalOverride, logoPresetVersion]);

  const colors = useMemo(() => {
    const base = colorsOverride ?? getLogoColors(theme, presetId);
    if (minimal) return { ...base, foreground: base.background };
    return base;
  }, [colorsOverride, theme, presetId, minimal]);
  const svgContent = useMemo(() => {
    if (variant === "jobidocs") return null;
    if (!rawSvg) return null;
    return applyLogoColors(rawSvg, colors.background, colors.jInner, colors.foreground);
  }, [rawSvg, variant, colors.background, colors.jInner, colors.foreground]);

  if (variant === "jobidocs") {
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
        <img src={LOGO_JOBIDOCS_PNG_URL} alt="" style={{ width: size, height: size, objectFit: "contain" }} />
      </div>
    );
  }

  if (!svgContent) {
    const placeholderBg = colors?.background ?? "var(--panel-2)";
    return (
      <div
        style={{
          width: size,
          height: size,
          background: placeholderBg,
          borderRadius: modern ? Math.max(4, size * 0.22) : 0,
          boxShadow: modern ? "0 2px 8px rgba(0,0,0,0.06)" : undefined,
          ...style,
        }}
        aria-hidden
      />
    );
  }

  const scaledSvg = svgContent.replace(
    /<svg([^>]*)width="260" height="260"/,
    "<svg$1width=\"100%\" height=\"100%\" style=\"display:block\""
  );

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
      dangerouslySetInnerHTML={{ __html: scaledSvg }}
    />
  );
}
