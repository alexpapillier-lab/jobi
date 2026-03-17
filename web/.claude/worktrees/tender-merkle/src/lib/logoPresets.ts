import type { ThemeMode } from "../theme/ThemeProvider";

export type LogoPresetId = "auto" | ThemeMode;

export type LogoColors = { background: string; jInner: string; foreground: string };

export type LogoPreset = {
  id: LogoPresetId;
  label: string;
  background: string;
  jInner: string;
  /** Barva dokumentu a obrysu J – na světlém pozadí tmavá, na tmavém bílá */
  foreground: string;
};

/** Barvy loga podle témat (pro předvolbu "Podle barevného tématu") */
const THEME_LOGO_COLORS: Record<ThemeMode, LogoColors> = {
  light: { background: "#ffffff", jInner: "#2563eb", foreground: "#111827" },
  dark: { background: "#141720", jInner: "#60a5fa", foreground: "#ffffff" },
  blue: { background: "#0f1e3a", jInner: "#0ea5e9", foreground: "#ffffff" },
  green: { background: "#0f2a14", jInner: "#22c55e", foreground: "#ffffff" },
  orange: { background: "#3a2410", jInner: "#f97316", foreground: "#ffffff" },
  purple: { background: "#251438", jInner: "#8b5cf6", foreground: "#ffffff" },
  pink: { background: "#381420", jInner: "#ec4899", foreground: "#ffffff" },
  "light-blue": { background: "#e0f2fe", jInner: "#0ea5e9", foreground: "#0c4a6e" },
  "light-green": { background: "#dcfce7", jInner: "#22c55e", foreground: "#14532d" },
  "light-orange": { background: "#fff7ed", jInner: "#f97316", foreground: "#7c2d12" },
  "light-purple": { background: "#faf5ff", jInner: "#8b5cf6", foreground: "#4c1d95" },
  "light-pink": { background: "#fdf2f8", jInner: "#ec4899", foreground: "#831843" },
  "paper-mint": { background: "#F7FBFA", jInner: "#14B8A6", foreground: "#0F172A" },
  "sand-ink": { background: "#FBF7F1", jInner: "#F59E0B", foreground: "#111827" },
  "sky-blueprint": { background: "#F5FAFF", jInner: "#2563EB", foreground: "#0B1220" },
  "lilac-frost": { background: "#FAF8FF", jInner: "#7C3AED", foreground: "#111827" },
  halloween: { background: "#1a0f0f", jInner: "#f97316", foreground: "#fef3c7" },
  christmas: { background: "#1a2e35", jInner: "#22c55e", foreground: "#f0fdf4" },
  "tron-red": { background: "#0a0809", jInner: "#DD2200", foreground: "#e5e5e5" },
  "tron-cyan": { background: "#070b0e", jInner: "#04BFBF", foreground: "#e5e7eb" },
  synthwave: { background: "#0d0e1e", jInner: "#FF2BD6", foreground: "#EDEBFF" },
};

/** Předvolby barev loga – výběr v Nastavení → Barevné téma → Logo */
export const LOGO_PRESETS: LogoPreset[] = [
  { id: "light", label: "Světlé", background: "#ffffff", jInner: "#2563eb", foreground: "#111827" },
  { id: "dark", label: "Tmavé", background: "#141720", jInner: "#60a5fa", foreground: "#ffffff" },
  { id: "blue", label: "Modré", background: "#0f1e3a", jInner: "#0ea5e9", foreground: "#ffffff" },
  { id: "green", label: "Zelené", background: "#0f2a14", jInner: "#22c55e", foreground: "#ffffff" },
  { id: "orange", label: "Oranžové", background: "#3a2410", jInner: "#f97316", foreground: "#ffffff" },
  { id: "purple", label: "Fialové", background: "#251438", jInner: "#8b5cf6", foreground: "#ffffff" },
  { id: "pink", label: "Růžové", background: "#381420", jInner: "#ec4899", foreground: "#ffffff" },
  { id: "light-blue", label: "Světle modré", background: "#e0f2fe", jInner: "#0ea5e9", foreground: "#0c4a6e" },
  { id: "light-green", label: "Světle zelené", background: "#dcfce7", jInner: "#22c55e", foreground: "#14532d" },
  { id: "light-orange", label: "Světle oranžové", background: "#fff7ed", jInner: "#f97316", foreground: "#7c2d12" },
  { id: "light-purple", label: "Světle fialové", background: "#faf5ff", jInner: "#8b5cf6", foreground: "#4c1d95" },
  { id: "light-pink", label: "Světle růžové", background: "#fdf2f8", jInner: "#ec4899", foreground: "#831843" },
  { id: "paper-mint", label: "Paper Mint", background: "#F7FBFA", jInner: "#14B8A6", foreground: "#0F172A" },
  { id: "sand-ink", label: "Sand & Ink", background: "#FBF7F1", jInner: "#F59E0B", foreground: "#111827" },
  { id: "sky-blueprint", label: "Sky Blueprint", background: "#F5FAFF", jInner: "#2563EB", foreground: "#0B1220" },
  { id: "lilac-frost", label: "Lilac Frost", background: "#FAF8FF", jInner: "#7C3AED", foreground: "#111827" },
  { id: "halloween", label: "Halloween", background: "#1a0f0f", jInner: "#f97316", foreground: "#fef3c7" },
  { id: "christmas", label: "Vánoce", background: "#1a2e35", jInner: "#22c55e", foreground: "#f0fdf4" },
  { id: "tron-red", label: "Tron Red", background: "#0a0809", jInner: "#DD2200", foreground: "#e5e5e5" },
  { id: "tron-cyan", label: "Tron Cyan", background: "#070b0e", jInner: "#04BFBF", foreground: "#e5e7eb" },
  { id: "synthwave", label: "Synthwave", background: "#0d0e1e", jInner: "#FF2BD6", foreground: "#EDEBFF" },
];

export function getLogoColors(theme: ThemeMode, presetId: LogoPresetId | null): LogoColors {
  if (presetId === "auto" || !presetId) {
    return THEME_LOGO_COLORS[theme];
  }
  const preset = LOGO_PRESETS.find((p) => p.id === presetId);
  return preset ? { background: preset.background, jInner: preset.jInner, foreground: preset.foreground } : THEME_LOGO_COLORS[theme];
}
