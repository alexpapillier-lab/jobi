/**
 * Typed Supabase Client Wrapper
 * 
 * Tento soubor poskytuje typovaný wrapper pro Supabase client,
 * který umožňuje používat TypeScript typy z database schema.
 * 
 * Použití:
 *   import { typedSupabase } from './lib/typedSupabase';
 *   
 *   // Místo (supabase.from("customers") as any).select(...)
 *   // Použijte:
 *   const { data } = await typedSupabase.from("customers").select("...");
 *   // ✅ Plně typované!
 */

import { supabase } from "./supabaseClient";
import type { Database } from "../types/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Typovaný Supabase client
 * 
 * Tento client má plnou TypeScript typovou podporu pro všechny
 * databázové operace (select, insert, update, delete).
 * 
 * Typy jsou odvozeny z Database typu v src/types/supabase.ts.
 */
export const typedSupabase = supabase as unknown as SupabaseClient<Database>;

/**
 * Helper funkce pro získání typovaného clientu
 * (pokud by bylo potřeba pro podmíněné použití)
 */
export function getTypedSupabaseClient(): SupabaseClient<Database> | null {
  if (!supabase) return null;
  return supabase as unknown as SupabaseClient<Database>;
}

