import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

export type ThemeMode = "light" | "dark" | "blue" | "green" | "orange" | "purple" | "pink" | "light-blue" | "light-green" | "light-orange" | "light-purple" | "light-pink" | "halloween" | "christmas";

type ThemeContextValue = {
  theme: ThemeMode;
  setTheme: (t: ThemeMode) => void;
  toggleTheme: () => void;
  availableThemes: ThemeMode[];
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = "jobsheet_theme";
const AVAILABLE_THEMES: ThemeMode[] = ["light", "light-blue", "light-green", "light-orange", "light-purple", "light-pink", "dark", "blue", "green", "orange", "purple", "pink", "halloween", "christmas"];

function applyThemeToDom(theme: ThemeMode) {
  document.documentElement.setAttribute("data-theme", theme);
  window.dispatchEvent(new CustomEvent("jobsheet:theme-changed", { detail: { theme } }));
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>("light");

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
    const initial: ThemeMode = AVAILABLE_THEMES.includes(saved as ThemeMode) ? (saved as ThemeMode) : "light";
    setThemeState(initial);
    applyThemeToDom(initial);
  }, []);

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
