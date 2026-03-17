import fs from "fs/promises";
import path from "path";

type ServiceSettings = {
  preferred_printer_name?: string;
};

type SettingsFile = {
  services: Record<string, ServiceSettings>;
};

const DEFAULT_SETTINGS: SettingsFile = { services: {} };

let settingsPath: string | null = null;

export function setSettingsPath(baseDir: string) {
  settingsPath = path.join(baseDir, "settings.json");
}

async function ensureSettingsDir(): Promise<string> {
  if (!settingsPath) throw new Error("Settings path not set");
  const dir = path.dirname(settingsPath);
  await fs.mkdir(dir, { recursive: true });
  return settingsPath;
}

async function readSettings(): Promise<SettingsFile> {
  const p = await ensureSettingsDir();
  try {
    const data = await fs.readFile(p, "utf-8");
    return { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

async function writeSettings(settings: SettingsFile): Promise<void> {
  const p = await ensureSettingsDir();
  await fs.writeFile(p, JSON.stringify(settings, null, 2), "utf-8");
}

export async function getSettings(serviceId: string): Promise<ServiceSettings> {
  const s = await readSettings();
  return s.services[serviceId] || {};
}

export async function putSettings(
  serviceId: string,
  updates: Partial<ServiceSettings>
): Promise<ServiceSettings> {
  const s = await readSettings();
  const current = s.services[serviceId] || {};
  s.services[serviceId] = { ...current, ...updates };
  await writeSettings(s);
  return s.services[serviceId];
}
