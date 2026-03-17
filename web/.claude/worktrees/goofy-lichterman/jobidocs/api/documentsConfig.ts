/**
 * Documents config storage – full DocumentsConfig per service.
 * Lokálně v .jobidocs-data/documents-config.json.
 */
import fs from "fs/promises";
import path from "path";

type DocumentsConfigEntry = { service_id: string; config: unknown };
type DocumentsConfigFile = { entries: DocumentsConfigEntry[] };

let configPath: string | null = null;

export function setDocumentsConfigPath(baseDir: string) {
  configPath = path.join(baseDir, "documents-config.json");
}

async function ensureDir(): Promise<string> {
  if (!configPath) throw new Error("Documents config path not set");
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  return configPath;
}

async function readConfig(): Promise<DocumentsConfigFile> {
  const p = await ensureDir();
  try {
    const data = await fs.readFile(p, "utf-8");
    const parsed = JSON.parse(data);
    return { entries: Array.isArray(parsed?.entries) ? parsed.entries : [] };
  } catch {
    return { entries: [] };
  }
}

async function writeConfig(file: DocumentsConfigFile): Promise<void> {
  const p = await ensureDir();
  await fs.writeFile(p, JSON.stringify(file, null, 2), "utf-8");
}

export async function getDocumentsConfig(
  serviceId: string
): Promise<{ config: unknown; version: number } | null> {
  const file = await readConfig();
  const entry = file.entries.find((e) => e.service_id === serviceId);
  return entry ? { config: entry.config, version: 1 } : null;
}

export async function putDocumentsConfig(
  serviceId: string,
  config: unknown
): Promise<{ config: unknown; version: number }> {
  const file = await readConfig();
  const idx = file.entries.findIndex((e) => e.service_id === serviceId);
  const entry: DocumentsConfigEntry = { service_id: serviceId, config: config ?? {} };
  if (idx >= 0) {
    file.entries[idx] = entry;
  } else {
    file.entries.push(entry);
  }
  await writeConfig(file);
  return { config: entry.config, version: 1 };
}
