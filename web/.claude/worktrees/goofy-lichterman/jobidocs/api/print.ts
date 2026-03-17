import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import os from "os";

const LP_BIN = process.platform === "darwin" ? "/usr/bin/lp" : "lp";
const LP_TIMEOUT_MS = 20000;

/**
 * Print PDF to printer via lp (macOS CUPS).
 * Uses spawn (no shell) so args are passed safely; inherits process.env so CUPS sees the same user.
 * @returns Job ID line from lp stdout (e.g. "request id is DOLNI-42 (1 file(s))") or empty string.
 */
export async function printPdf(
  pdfBuffer: Buffer,
  printerName?: string
): Promise<string> {
  if (pdfBuffer.length === 0) {
    throw new Error("PDF je prázdný");
  }
  const tmpDir = os.tmpdir();
  const tmpPath = path.join(tmpDir, `jobidocs-print-${Date.now()}.pdf`);

  await fs.writeFile(tmpPath, pdfBuffer);

  const args = printerName ? ["-d", printerName, tmpPath] : [tmpPath];

  const jobId = await new Promise<string>((resolve, reject) => {
    const child = spawn(LP_BIN, args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => { stdout += d.toString(); });
    child.stderr?.on("data", (d) => { stderr += d.toString(); });
    const t = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`lp timeout (${LP_TIMEOUT_MS / 1000}s). ${stderr || stdout || ""}`.trim()));
    }, LP_TIMEOUT_MS);
    child.on("error", (err) => {
      clearTimeout(t);
      reject(new Error(err.message || "lp nelze spustit"));
    });
    child.on("close", (code) => {
      clearTimeout(t);
      if (code !== 0) {
        reject(new Error([stderr, stdout].filter(Boolean).join(" ").trim() || `lp skončil s kódem ${code}`));
      } else {
        resolve(stdout.trim());
      }
    });
  });

  // Odložené smazání, aby CUPS stihl soubor načíst
  setTimeout(() => fs.unlink(tmpPath).catch(() => {}), 5000);
  return jobId;
}