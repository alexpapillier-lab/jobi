import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logosDir = path.join(__dirname, "logos");
const logosPngDir = path.join(logosDir, "logos png");

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: "logos-png",
      configureServer(server) {
        server.middlewares.use("/logos", (req, res, next) => {
          const url = req.url?.split("?")[0] ?? "";
          const name = url.replace(/^\//, "").replace(/[^a-z0-9.-]/gi, "");
          if (!name.endsWith(".png")) {
            next();
            return;
          }
          // Barvy loga: z logos png; jdlogo a tray-icon: přímo z logos/
          let file = path.join(logosPngDir, name);
          if (!fs.existsSync(file) && (name === "jdlogo.png" || name === "tray-icon.png"))
            file = path.join(logosDir, name);
          if (!file.startsWith(logosDir) || path.relative(logosDir, file).startsWith("..")) {
            next();
            return;
          }
          fs.readFile(file, (err, data) => {
            if (err) {
              next();
              return;
            }
            res.setHeader("Content-Type", "image/png");
            res.end(data);
          });
        });
      },
      writeBundle(_outputOptions, _bundle) {
        const outDir = path.join(__dirname, "dist");
        const destDir = path.join(outDir, "logos");
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
        if (fs.existsSync(logosPngDir)) {
          for (const f of fs.readdirSync(logosPngDir)) {
            if (f.endsWith(".png"))
              fs.copyFileSync(path.join(logosPngDir, f), path.join(destDir, f));
          }
        }
        for (const name of ["jdlogo.png", "tray-icon.png"]) {
          const src = path.join(logosDir, name);
          if (fs.existsSync(src)) fs.copyFileSync(src, path.join(destDir, name));
        }
      },
    },
  ],


  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
});
