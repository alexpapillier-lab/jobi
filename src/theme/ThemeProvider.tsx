import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type ThemeMode = "light" | "dark" | "blue" | "green" | "orange" | "purple" | "pink" | "light-blue" | "light-green" | "light-orange" | "light-purple" | "light-pink" | "paper-mint" | "sand-ink" | "sky-blueprint" | "lilac-frost";

type ThemeContextValue = {
  theme: ThemeMode;
  setTheme: (t: ThemeMode) => void;
  toggleTheme: () => void;
  availableThemes: ThemeMode[];
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = "jobsheet_theme";
const AVAILABLE_THEMES: ThemeMode[] = ["light", "light-blue", "light-green", "light-orange", "light-purple", "light-pink", "paper-mint", "sand-ink", "sky-blueprint", "lilac-frost", "dark", "blue", "green", "orange", "purple", "pink"];

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

  // useCallback, ne obyčejné funkce: useMemo níž je uvádí v hodnotě kontextu,
  // ale bez toho by je v závislostech neměl. Taková memoizace lže a React
  // Compiler kvůli ní přeskočil optimalizaci celé komponenty.
  const setTheme = useCallback((t: ThemeMode) => {
    setThemeState(t);
    localStorage.setItem(STORAGE_KEY, t);
    applyThemeToDom(t);
  }, []);

  const toggleTheme = useCallback(
    () => setTheme(theme === "dark" ? "light" : "dark"),
    [setTheme, theme]
  );

  const value = useMemo(
    () => ({ theme, setTheme, toggleTheme, availableThemes: AVAILABLE_THEMES }),
    [theme, setTheme, toggleTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
