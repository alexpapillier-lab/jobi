#!/usr/bin/env node
/**
 * Converts PNG icons to RGBA (Tauri requires RGBA).
 * Run from repo root: node scripts/fix-icons-rgba.mjs
 */
import sharp from "sharp";
import path from "path";
import { fileURLToPath } from "url";
import { existsSync, renameSync } from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iconsDir = path.join(__dirname, "..", "src-tauri", "icons");
const pngNames = ["32x32.png", "128x128.png", "128x128@2x.png"];

async function main() {
  for (const name of pngNames) {
    const p = path.join(iconsDir, name);
    try {
      if (!existsSync(p)) {
        console.warn("Skip (not found):", name);
        continue;
      }
      const tmp = p + ".tmp.png";
      await sharp(p).ensureAlpha().toFile(tmp);
      renameSync(tmp, p);
      console.log("OK:", name);
    } catch (e) {
      console.error(name, e.message);
    }
  }
}

main();
