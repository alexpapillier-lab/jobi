function getErrorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error && typeof (error as { code: unknown }).code === "string") {
    return (error as { code: string }).code;
  }
  return undefined;
}

export function normalizeError(error: unknown): string {
  if (!error) return "Neznámá chyba";

  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorCode = getErrorCode(error);
  
  // Permission errors
  if (errorMessage.includes("Not authorized") || errorMessage.includes("permission") || errorCode === "PGRST301") {
    return "Nemáte oprávnění k této akci";
  }
  
  // Supabase project restoring / maintenance (503, 502)
  if (
    /503|502|unavailable|maintenance|restoring/i.test(errorMessage)
  ) {
    return "Cloud je dočasně nedostupný (pravděpodobně probíhá obnova projektu). Zkuste to za několik minut.";
  }
  
  // Edge Function unreachable (Tauri desktop / network / functions not deployed)
  if (/failed to send a request to the edge function|edge function/i.test(errorMessage)) {
    return "Nelze volat cloudovou funkci (tým). Zkontrolujte připojení k internetu a že je projekt Supabase dostupný. V desktopové aplikaci zkuste restartovat.";
  }

  // Network / connection errors
  if (
    /fetch|network|failed to fetch|load failed|timeout|connection|err_connection/i.test(errorMessage)
  ) {
    return "Nelze se připojit k cloudu. Zkontrolujte připojení k internetu a zkuste to znovu.";
  }
  
  // Supabase specific
  if (errorCode === "PGRST116") {
    return "Položka nebyla nalezena";
  }
  
  return errorMessage || "Došlo k neočekávané chybě.";
}

/** Pro hlášku „e-mail nebyl odeslán“ u pozvánky: při Resend 403 (jen na svůj e-mail) vrátí srozumitelný návod. */
export function formatInviteEmailReason(reason: string): string {
  if (!reason) return "E-mail se nepodařilo odeslat.";
  const r = reason.toLowerCase();
  if (
    (r.includes("403") || r.includes("validation_error")) &&
    (r.includes("your own email") || r.includes("verify a domain") || r.includes("only send"))
  ) {
    return "S adresou onboarding@resend.dev můžeš posílat jen na svůj e-mail. Aby šly pozvánky i ostatním: v Resend ověř doménu a v Supabase (Edge Functions → Secrets) nastav RESEND_FROM_EMAIL, např. Jobi <noreply@tvoje-domena.cz>.";
  }
  return reason;
}

