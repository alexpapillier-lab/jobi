#!/usr/bin/env node
/**
 * Generates purple DMG background (540x380) with gradient, text and arrow.
 * Usage: node scripts/gen-dmg-background.js
 * Output: scripts/dmg-assets/dmg-background.png (Jobi), jobidocs/build/background.png (JobiDocs)
 */

import sharp from "sharp";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const W = 540;
const H = 380;

function buildSvg(text) {
  // Šipka vpravo: čára + trojúhelník (od cca 130 do 410, mezi ikonami)
  const arrowY = 200;
  const arrowLeft = 140;
  const arrowRight = 400;
  const arrowHeadSize = 14;
  const arrowPath = `M ${arrowLeft} ${arrowY} L ${arrowRight - arrowHeadSize} ${arrowY} L ${arrowRight - arrowHeadSize} ${arrowY - arrowHeadSize} L ${arrowRight + 4} ${arrowY} L ${arrowRight - arrowHeadSize} ${arrowY + arrowHeadSize} Z`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="${W}" y2="${H}" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#1e1b4b"/>
      <stop offset="100%" stop-color="#8b5cf6"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <path d="${arrowPath}" fill="rgba(255,255,255,0.9)" stroke="rgba(255,255,255,0.5)" stroke-width="1.5"/>
  <text x="${W / 2}" y="280" text-anchor="middle" fill="rgba(255,255,255,0.95)" font-family="system-ui, -apple-system, sans-serif" font-size="20" font-weight="500">${escapeXml(text)}</text>
</svg>`;
}

function escapeXml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function writePng(svg, outPath) {
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, png);
  console.log("Written:", outPath);
}

const svgJobi = buildSvg("Přetáhni Jobi do Aplikace");
const svgJobiDocs = buildSvg("Přetáhni JobiDocs do Aplikace");

const assetsDir = path.join(__dirname, "dmg-assets");
const outJobi = path.join(assetsDir, "dmg-background.png");
const outJobiDocs = path.join(__dirname, "..", "jobidocs", "build", "background.png");

fs.mkdirSync(assetsDir, { recursive: true });
await writePng(svgJobi, outJobi);
await writePng(svgJobiDocs, outJobiDocs);
