import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "../lib/supabaseClient";
import type { Session } from "@supabase/supabase-js";

type AuthContextType = {
  session: Session | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  configError: string | null;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setConfigError("Supabase není nakonfigurován. Zkontrolujte VITE_SUPABASE_URL a VITE_SUPABASE_ANON_KEY v .env souboru.");
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (import.meta.env.DEV) {
        console.log("[Auth] onAuthStateChange", { event, hasSession: !!session });
      }
      if (session) {
        setSession(session);
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
    if (!supabase) throw new Error("Supabase client není dostupný");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signUp = async (email: string, password: string) => {
    if (!supabase) throw new Error("Supabase client není dostupný");
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
  };

  return (
    <AuthContext.Provider value={{ session, signIn, signUp, configError }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
