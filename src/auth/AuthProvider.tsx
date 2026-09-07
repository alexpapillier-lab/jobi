import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "../lib/supabaseClient";
import type { Session } from "@supabase/supabase-js";

type AuthContextType = {
  session: Session | null;
  /** Než se z úložiště obnoví relace. Bez tohohle problikne přihlašovací obrazovka. */
  initializing: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  /**
   * Registrace. Vrací `potrebujePotvrzeni: true`, když Supabase relaci
   * nevrátil – tedy když je v projektu zapnuté potvrzování e-mailu a člověk
   * musí nejdřív kliknout na odkaz v poště. Bez téhle informace se
   * přihlašovací obrazovka nemá jak rozhodnout, jestli má něco říct, nebo
   * mlčky pustit dál – a vypisovala „zkontrolujte e-mail“ i tomu, kdo už byl
   * přihlášený.
   */
  signUp: (email: string, password: string) => Promise<{ potrebujePotvrzeni: boolean }>;
  configError: string | null;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setConfigError("Supabase není nakonfigurován. Zkontrolujte VITE_SUPABASE_URL a VITE_SUPABASE_ANON_KEY v .env souboru.");
      setInitializing(false);
      return;
    }

    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        setSession(session);
      })
      .finally(() => setInitializing(false));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (import.meta.env.DEV) {
        console.log("[Auth] onAuthStateChange", { event, hasSession: !!session });
      }
      if (session) {
        setSession(session);
        setInitializing(false);
        return;
      }
      if (event === "SIGNED_OUT") {
        setSession(null);
        return;
      }
      // Při null bez explicitního odhlášení zkusit refresh
      if (!supabase) return;
      const { data, error } = await supabase.auth.refreshSession();
      if (import.meta.env.DEV) {
        console.log("[Auth] refreshSession po event=" + event, { ok: !!data?.session, error: error?.message });
      }
      if (data?.session) {
        setSession(data.session);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    setInitializing(false);
    if (!supabase) throw new Error("Supabase client není dostupný");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signUp = async (email: string, password: string) => {
    if (!supabase) throw new Error("Supabase client není dostupný");
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    return { potrebujePotvrzeni: !data?.session };
  };

  return (
    <AuthContext.Provider value={{ session, initializing, signIn, signUp, configError }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
