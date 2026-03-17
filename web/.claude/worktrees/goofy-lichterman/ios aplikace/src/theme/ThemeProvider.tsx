import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

export type ThemeMode = "light" | "dark" | "blue" | "green" | "orange" | "purple" | "pink" | "light-blue" | "light-green" | "light-orange" | "light-purple" | "light-pink" | "halloween" | "christmas" | "tron-red" | "tron-cyan" | "synthwave" | "paper-mint" | "sand-ink" | "sky-blueprint" | "lilac-frost";

type ThemeContextValue = {
  theme: ThemeMode;
  setTheme: (t: ThemeMode) => void;
  toggleTheme: () => void;
  availableThemes: ThemeMode[];
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = "jobsheet_theme";
const AVAILABLE_THEMES: ThemeMode[] = ["light", "light-blue", "light-green", "light-orange", "light-purple", "light-pink", "paper-mint", "sand-ink", "sky-blueprint", "lilac-frost", "dark", "blue", "green", "orange", "purple", "pink", "halloween", "christmas", "tron-red", "tron-cyan", "synthwave"];

function applyThemeToDom(theme: ThemeMode) {
  document.documentElement.setAttribute("data-theme", theme);
  window.dispatchEvent(new CustomEvent("jobsheet:theme-changed", { detail: { theme } }));
}

function getInitialTheme(): ThemeMode {
  if (typeof window === "undefined") return "light";
  const saved = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
  return AVAILABLE_THEMES.includes(saved as ThemeMode) ? (saved as ThemeMode) : "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(getInitialTheme);

  useEffect(() => {
    applyThemeToDom(theme);
  }, [theme]);

  const setTheme = (t: ThemeMode) => {
    setThemeState(t);
    localStorage.setItem(STORAGE_KEY, t);
    applyThemeToDom(t);
  };

  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");

  const value = useMemo(() => ({ theme, setTheme, toggleTheme, availableThemes: AVAILABLE_THEMES }), [theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
