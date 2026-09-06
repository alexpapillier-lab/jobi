/** Stub @tauri-apps/plugin-process pro web – restart aplikace nahrazuje reload stránky. */
import type * as Skutecny from "@tauri-apps/plugin-process";

export const relaunch: typeof Skutecny.relaunch = async () => {
  window.location.reload();
};
