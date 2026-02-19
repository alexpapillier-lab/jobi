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

function parseLpstatP(stdout: string): PrinterInfo[] {
  const lines = stdout.trim().split("\n").filter(Boolean);
  const printers: PrinterInfo[] = [];
  for (const line of lines) {
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
}

/**
 * On macOS, lpstat -a lists destinations (queues) including some AirPrint printers
 * that may not appear in lpstat -p. Format: "NAME accepting requests since ..."
 */
async function listPrintersLpstatA(): Promise<PrinterInfo[]> {
  if (process.platform !== "darwin") return [];
  try {
    const { stdout } = await execAsync(`"${LPSTAT_BIN}" -a 2>/dev/null || true`, {
      maxBuffer: 64 * 1024,
    });
    const lines = stdout.trim().split("\n").filter(Boolean);
    const printers: PrinterInfo[] = [];
    for (const line of lines) {
      const match = line.match(/^(\S+)\s+accepting/);
      if (match) {
        const name = match[1];
        if (name) {
          printers.push({ name, status: "unknown", available: true });
        }
      }
    }
    return printers;
  } catch {
    return [];
  }
}

/**
 * List printers via lpstat -p (macOS CUPS). On macOS, also merge in lpstat -a
 * so AirPrint and other destinations not in -p appear in the list.
 */
export async function listPrinters(): Promise<PrinterInfo[]> {
  try {
    const { stdout } = await execAsync(`"${LPSTAT_BIN}" -p 2>/dev/null || true`, {
      maxBuffer: 64 * 1024,
    });
    const byP = parseLpstatP(stdout);
    const namesFromP = new Set(byP.map((p) => p.name));

    if (process.platform === "darwin") {
      const fromA = await listPrintersLpstatA();
      for (const p of fromA) {
        if (p.name && !namesFromP.has(p.name)) {
          byP.push(p);
          namesFromP.add(p.name);
        }
      }
    }

    return byP;
  } catch {
    return [];
  }
}
