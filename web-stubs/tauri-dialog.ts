/** Stub @tauri-apps/plugin-dialog pro web – nativní dialog nahrazuje stažení souboru. */
import type * as Skutecny from "@tauri-apps/plugin-dialog";

export const save: typeof Skutecny.save = async () => {
  throw new Error("Nativní dialog pro uložení není ve webové verzi dostupný.");
};
export const open: typeof Skutecny.open = async () => {
  throw new Error("Nativní dialog pro otevření není ve webové verzi dostupný.");
};
