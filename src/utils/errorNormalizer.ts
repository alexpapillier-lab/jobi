export function normalizeError(error: any): string {
  if (!error) return "Neznámá chyba";
  
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorCode = (error as any)?.code;
  
  // Permission errors
  if (errorMessage.includes("Not authorized") || errorMessage.includes("permission") || errorCode === "PGRST301") {
    return "Nemáte oprávnění k této akci";
  }
  
  // Network errors
  if (errorMessage.includes("network") || errorMessage.includes("fetch") || errorMessage.includes("Failed to fetch")) {
    return "Chyba připojení. Zkuste to znovu.";
  }
  
  // Supabase specific
  if (errorCode === "PGRST116") {
    return "Položka nebyla nalezena";
  }
  
  return errorMessage || "Došlo k neočekávané chybě.";
}

