/**
 * Set the app (Dock) icon from the given logo preset. Only runs in Tauri.
 * Fetches the PNG from /logos/{id}.png and invokes the Rust command.
 */
import type { LogoPresetId } from "./logoPresets";
import type { ThemeMode } from "../theme/ThemeProvider";

export async function setAppIconFromPreset(
  presetId: LogoPresetId,
  theme: ThemeMode
): Promise<void> {
  const isTauri =
    typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
  if (!isTauri) return;
  const effectiveId = presetId === "auto" ? theme : presetId;
  try {
    const r = await fetch(`/logos/${effectiveId}.png`);
    if (!r.ok) return;
    const blob = await r.blob();
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        resolve(dataUrl?.split(",")[1] ?? "");
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    if (!base64) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_app_icon", { data: base64 });
  } catch (e) {
    console.warn("[setAppIcon] failed:", e);
  }
}
