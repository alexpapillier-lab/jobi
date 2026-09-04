import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { STORAGE_KEYS } from "../constants/storageKeys";

export type ThemeMode = "light" | "dark" | "blue" | "green" | "orange" | "purple" | "pink" | "light-blue" | "light-green" | "light-orange" | "light-purple" | "light-pink" | "paper-mint" | "sand-ink" | "sky-blueprint" | "lilac-frost";

/** Barevný akcent – společný pro světlou i tmavou variantu. */
export type ThemeAccent = "default" | "blue" | "green" | "orange" | "purple" | "pink";

/**
 * Co si uživatel zvolil: buď konkrétní motiv (jako dosud), nebo „podle
 * systému“ s akcentem – ten se za běhu přeloží na světlý/tmavý motiv podle
 * prefers-color-scheme.
 *
 * Ukládá se do DVOU klíčů: STORAGE_KEYS.THEME drží vždy konkrétní
 * (přeložené) ID, protože ho čtou i místa mimo React (ikona v Docku,
 * barvy loga pro JobiDocs v App.tsx) a ta s „system:…“ počítat neumí.
 * Volba „podle systému“ je zvlášť v THEME_PREFERENCE_STORAGE_KEY. Oba
 * klíče se sdílí mezi zařízeními (personalPreferencesSync).
 */
export type ThemePreference = ThemeMode | `system:${ThemeAccent}`;

/** Klíč volby „podle systému“. Vedle STORAGE_KEYS.THEME, viz výše. */
export const THEME_PREFERENCE_STORAGE_KEY = "jobsheet_theme_pref";

type ThemeContextValue = {
  /** Motiv, který je právě na <html data-theme>. Vždy konkrétní ID. */
  theme: ThemeMode;
  /** Co si uživatel zvolil – včetně „podle systému“. */
  preference: ThemePreference;
  setTheme: (t: ThemeMode) => void;
  setPreference: (p: ThemePreference) => void;
  toggleTheme: () => void;
  availableThemes: ThemeMode[];
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = STORAGE_KEYS.THEME;
const AVAILABLE_THEMES: ThemeMode[] = ["light", "light-blue", "light-green", "light-orange", "light-purple", "light-pink", "paper-mint", "sand-ink", "sky-blueprint", "lilac-frost", "dark", "blue", "green", "orange", "purple", "pink"];
const ACCENTS: ThemeAccent[] = ["default", "blue", "green", "orange", "purple", "pink"];

const LIGHT_BY_ACCENT: Record<ThemeAccent, ThemeMode> = {
  default: "light", blue: "light-blue", green: "light-green", orange: "light-orange", purple: "light-purple", pink: "light-pink",
};
const DARK_BY_ACCENT: Record<ThemeAccent, ThemeMode> = {
  default: "dark", blue: "blue", green: "green", orange: "orange", purple: "purple", pink: "pink",
};

/** ID motivu pro daný režim a akcent. */
export function themeFor(mode: "light" | "dark", accent: ThemeAccent): ThemeMode {
  return mode === "dark" ? DARK_BY_ACCENT[accent] : LIGHT_BY_ACCENT[accent];
}

/** Rozklad ID motivu na režim a akcent; pojmenované předvolby vrací accent null. */
export function splitTheme(t: ThemeMode): { mode: "light" | "dark"; accent: ThemeAccent | null } {
  for (const a of ACCENTS) {
    if (DARK_BY_ACCENT[a] === t) return { mode: "dark", accent: a };
    if (LIGHT_BY_ACCENT[a] === t) return { mode: "light", accent: a };
  }
  return { mode: "light", accent: null };
}

export function isThemeMode(v: unknown): v is ThemeMode {
  return typeof v === "string" && AVAILABLE_THEMES.includes(v as ThemeMode);
}

function isSystemPreference(v: unknown): v is `system:${ThemeAccent}` {
  return typeof v === "string" && v.startsWith("system:")
    && ACCENTS.includes(v.slice("system:".length) as ThemeAccent);
}

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolvePreference(p: ThemePreference, dark: boolean = systemPrefersDark()): ThemeMode {
  if (isThemeMode(p)) return p;
  const accent = p.slice("system:".length) as ThemeAccent;
  return themeFor(dark ? "dark" : "light", accent);
}

function applyThemeToDom(theme: ThemeMode) {
  document.documentElement.setAttribute("data-theme", theme);
  window.dispatchEvent(new CustomEvent("jobsheet:theme-changed", { detail: { theme } }));
}

/** Volba z localStorage: „podle systému“ má přednost, jinak uložené ID motivu. */
function readStoredPreference(): ThemePreference {
  if (typeof window === "undefined") return "light";
  const pref = localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY);
  if (isSystemPreference(pref)) return pref;
  const saved = localStorage.getItem(STORAGE_KEY);
  return isThemeMode(saved) ? saved : "light";
}

function writeStoredPreference(p: ThemePreference, resolved: ThemeMode) {
  localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, p);
  localStorage.setItem(STORAGE_KEY, resolved);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredPreference);
  const [systemDark, setSystemDark] = useState<boolean>(systemPrefersDark);
  const theme = useMemo(() => resolvePreference(preference, systemDark), [preference, systemDark]);

  useEffect(() => {
    // Přeložené ID musí být v localStorage i při změně v OS – čtou ho
    // místa mimo React (ikona v Docku, barvy loga pro JobiDocs).
    if (localStorage.getItem(STORAGE_KEY) !== theme) localStorage.setItem(STORAGE_KEY, theme);
    applyThemeToDom(theme);
  }, [theme]);

  // „Podle systému“: sledovat přepnutí světlý/tmavý v OS.
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Motiv nastavený na jiném zařízení dorazí přes personalPreferencesSync
  // rovnou do localStorage, ne přes setTheme() – tenhle posluchač je jediné
  // místo, kde se to promítne i do stavu právě otevřené appky.
  useEffect(() => {
    const onExternalChange = () => {
      const saved = readStoredPreference();
      setPreferenceState((prev) => (prev === saved ? prev : saved));
    };
    window.addEventListener("jobsheet:theme-changed", onExternalChange);
    return () => window.removeEventListener("jobsheet:theme-changed", onExternalChange);
  }, []);

  // useCallback, ne obyčejné funkce: useMemo níž je uvádí v hodnotě kontextu,
  // ale bez toho by je v závislostech neměl. Taková memoizace lže a React
  // Compiler kvůli ní přeskočil optimalizaci celé komponenty.
  const setPreference = useCallback((p: ThemePreference) => {
    const resolved = resolvePreference(p);
    setPreferenceState(p);
    writeStoredPreference(p, resolved);
    applyThemeToDom(resolved);
  }, []);

  const setTheme = useCallback((t: ThemeMode) => setPreference(t), [setPreference]);

  const toggleTheme = useCallback(
    () => setPreference(theme === "dark" ? "light" : "dark"),
    [setPreference, theme]
  );

  const value = useMemo(
    () => ({ theme, preference, setTheme, setPreference, toggleTheme, availableThemes: AVAILABLE_THEMES }),
    [theme, preference, setTheme, setPreference, toggleTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
