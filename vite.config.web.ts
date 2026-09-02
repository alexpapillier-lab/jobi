import { defineConfig, mergeConfig } from "vite";
import fs from "node:fs";
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
/**
 * Zapíše do výstupu hlavičky pro Cloudflare Pages.
 *
 * Assety mají v názvu hash, takže se dají kešovat natrvalo. index.html se
 * musí revalidovat vždy, jinak by prohlížeč kombinoval nové HTML se starými
 * assety – přesně to se stalo na marketingovém webu (viz web/_headers).
 */
const cloudflareHeaders = () => ({
  name: "cloudflare-headers",
  writeBundle() {
    const outDir = path.resolve(__dirname, "dist-web");
    const content = [
      "# Cloudflare Pages – webová verze Jobi",
      "",
      "/assets/*",
      "  Cache-Control: public, max-age=31536000, immutable",
      "",
      "/index.html",
      "  Cache-Control: public, max-age=0, must-revalidate",
      "",
      "/*",
      "  X-Frame-Options: SAMEORIGIN",
      "  X-Content-Type-Options: nosniff",
      "  Referrer-Policy: strict-origin-when-cross-origin",
      // Webová verze je záložní nástroj pro servisy, ne veřejný produkt.
      // Vyhledávače ji nemají indexovat ani chodit po odkazech z ní.
      "  X-Robots-Tag: noindex, nofollow, noarchive",
      "",
    ].join("\n");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "_headers"), content, "utf-8");

    // robots.txt jako druhá vrstva – hlavičku některé roboty ignorují,
    // ale tohle je standard, na který se dívají všichni.
    fs.writeFileSync(
      path.join(outDir, "robots.txt"),
      ["# Webová verze Jobi – neveřejná, jen pro servisy.", "User-agent: *", "Disallow: /", ""].join("\n"),
      "utf-8"
    );
  },
});

export default mergeConfig(
  baseConfig,
  defineConfig({
    plugins: [cloudflareHeaders()],
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
