import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logosDir = path.join(__dirname, "logos");
const logosPngDir = path.join(logosDir, "logos png");

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
  base: "./",
  resolve: {
    alias: {
      // Stuby – iOS app nepoužívá Tauri
      "@tauri-apps/api/app": path.resolve(__dirname, "tauri-stub.js"),
      "@tauri-apps/api/window": path.resolve(__dirname, "tauri-window-stub.js"),
    },
  },
  server: {
    port: 1421,
  },
  envDir: "..",
});
