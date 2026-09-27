/**
 * Má servis aktivní SMS číslo (service_phone_numbers)? Vyneseno z Orders.tsx.
 */
import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";

export function useSmsDostupnost(activeServiceId: string | null): boolean {
  const [smsActivatedForService, setSmsActivatedForService] = useState(false);
  useEffect(() => {
    if (!activeServiceId || !supabase) {
      setSmsActivatedForService(false);
      return;
    }
    supabase
      .from("service_phone_numbers")
      .select("id")
      .eq("service_id", activeServiceId)
      .eq("active", true)
      .maybeSingle()
      .then(({ data }) => setSmsActivatedForService(!!data));
  }, [activeServiceId]);

  return smsActivatedForService;
}
