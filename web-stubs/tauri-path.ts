/** Stub @tauri-apps/api/path pro web. */
import type * as Skutecny from "@tauri-apps/api/path";

const NENI = "Cesty k systémovým složkám nejsou ve webové verzi dostupné.";

export const desktopDir: typeof Skutecny.desktopDir = async () => {
  throw new Error(NENI);
};
export const downloadDir: typeof Skutecny.downloadDir = async () => {
  throw new Error(NENI);
};
