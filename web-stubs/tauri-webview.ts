/**
 * Stub `@tauri-apps/api/webview` pro web.
 *
 * Webová verze zvětšuje rozhraní CSS zoomem (viz `src/lib/velikostRozhrani.ts`),
 * takže `setZoom` tu nemá co dělat – a stránka si zoom prohlížeče stejně
 * nastavit nesmí. Stub existuje jen proto, aby se do webového balíčku nedostal
 * Tauri kód; kdyby se náhodou zavolal, tiše nic neudělá.
 */
import type * as Skutecny from "@tauri-apps/api/webview";

type Webview = { setZoom: (meritko: number) => Promise<void> };

export const getCurrentWebview: () => Webview = () => ({
  setZoom: async () => {},
});

/** Ať typová kontrola pozná, že stub odpovídá skutečnému modulu. */
export type _Kontrola = typeof Skutecny.getCurrentWebview extends () => unknown ? true : never;
