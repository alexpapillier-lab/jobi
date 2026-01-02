import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

let supabase: ReturnType<typeof createClient> | null = null;

if (supabaseUrl && supabaseAnonKey) {
  supabase = createClient(supabaseUrl, supabaseAnonKey);
} else {
  console.error(
    "[supabaseClient] Missing environment variables: VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY"
  );
}

export { supabase };
export function getSupabaseClient() {
  return supabase;
}
