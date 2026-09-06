/** Stub @tauri-apps/plugin-opener pro web – odkazy se otevírají přes window.open. */
import type * as Skutecny from "@tauri-apps/plugin-opener";

export const openUrl: typeof Skutecny.openUrl = async (url) => {
  window.open(String(url), "_blank", "noopener,noreferrer");
};
export const revealItemInDir: typeof Skutecny.revealItemInDir = async () => {
  throw new Error("Zobrazení ve složce není ve webové verzi dostupné.");
};
