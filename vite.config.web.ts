import { defineConfig, mergeConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import baseConfig from "./vite.config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const stub = (name: string) => path.resolve(__dirname, "web-stubs", name);

/**
 * Build webové verze Jobi.
 *
 * Dědí ze základního vite.config.ts (kvůli pluginu na loga a nastavení Reactu)
 * a jen podstrčí stuby místo @tauri-apps/* balíčků, aby se Tauri kód do web
 * buildu vůbec nedostal. Desktopový build se tím nemění – ten dál používá
 * vite.config.ts beze změny.
 *
 * Spuštění:
 *   npm run dev:web     – vývojový server na portu 1430
 *   npm run build:web   – produkční build do dist-web/
 */
export default mergeConfig(
  baseConfig,
  defineConfig({
    resolve: {
      alias: {
        "@tauri-apps/api/core": stub("tauri-core.ts"),
        "@tauri-apps/api/app": stub("tauri-app.ts"),
        "@tauri-apps/api/path": stub("tauri-path.ts"),
        "@tauri-apps/plugin-dialog": stub("tauri-dialog.ts"),
        "@tauri-apps/plugin-opener": stub("tauri-opener.ts"),
        "@tauri-apps/plugin-http": stub("tauri-http.ts"),
        "@tauri-apps/plugin-updater": stub("tauri-updater.ts"),
        "@tauri-apps/plugin-process": stub("tauri-process.ts"),
      },
    },
    build: {
      outDir: "dist-web",
      emptyOutDir: true,
    },
    // Jiný port než desktop (1420), ať se dají spustit vedle sebe.
    server: {
      port: 1430,
      strictPort: false,
      // Desktopový config tu má host z TAURI_DEV_HOST a pevný port – pro web nechceme.
      hmr: undefined,
    },
    clearScreen: true,
  })
);
