/** Stub @tauri-apps/plugin-dialog pro web – nativní dialog nahrazuje stažení souboru. */
export async function save(): Promise<string | null> {
  throw new Error("Nativní dialog pro uložení není ve webové verzi dostupný.");
}
export async function open(): Promise<string | null> {
  throw new Error("Nativní dialog pro otevření není ve webové verzi dostupný.");
}
