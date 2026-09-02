/** Stub @tauri-apps/plugin-opener pro web – odkazy se otevírají přes window.open. */
export async function openUrl(url: string): Promise<void> {
  window.open(url, "_blank", "noopener,noreferrer");
}
export async function revealItemInDir(): Promise<void> {
  throw new Error("Zobrazení ve složce není ve webové verzi dostupné.");
}
