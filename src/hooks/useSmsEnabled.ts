import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

/**
 * Returns whether SMS is enabled for the given service (has an active phone number).
 */
export function useSmsEnabled(activeServiceId: string | null): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (!activeServiceId || !supabase) {
      setEnabled(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("service_phone_numbers")
        .select("id")
        .eq("service_id", activeServiceId)
        .eq("active", true)
        .maybeSingle();
      if (!cancelled) setEnabled(!error && !!data);
    })();
    return () => { cancelled = true; };
  }, [activeServiceId]);

  return enabled;
}
