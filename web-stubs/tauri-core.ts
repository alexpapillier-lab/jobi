/** Stub @tauri-apps/api/core pro web. */
export async function invoke<T = unknown>(cmd: string): Promise<T> {
  throw new Error(`Tauri příkaz "${cmd}" není ve webové verzi dostupný.`);
}
