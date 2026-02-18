import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// Na macOS používáme absolutní cestu (jako u /usr/bin/lp), aby to fungovalo i při minimálním PATH (Electron z Finderu).
// CUPS (lpstat, lp) je součást macOS a chová se stejně na Intel i Apple Silicon.
const LPSTAT_BIN = process.platform === "darwin" ? "/usr/bin/lpstat" : "lpstat";

export type PrinterInfo = {
  name: string;
  status: string;
  available: boolean;
};

/**
 * List printers via lpstat -p (macOS CUPS).
 * Returns array of printer names and their status.
 */
export async function listPrinters(): Promise<PrinterInfo[]> {
  try {
    const { stdout } = await execAsync(`"${LPSTAT_BIN}" -p 2>/dev/null || true`, {
      maxBuffer: 64 * 1024,
    });
    const lines = stdout.trim().split("\n").filter(Boolean);
    const printers: PrinterInfo[] = [];
    for (const line of lines) {
      // Format: "printer NAME is idle. enabled since ..."
      const match = line.match(/^printer\s+(\S+)\s+is\s+(\S+)/);
      if (match) {
        const [, name, status] = match;
        const statusLower = (status || "").toLowerCase();
        printers.push({
          name: name || "",
          status: status || "unknown",
          available: statusLower === "idle" || statusLower === "printing" || statusLower === "ready",
        });
      }
    }
    return printers;
  } catch (err) {
    return [];
  }
}
