/**
 * Profiles API – per-service per-doc-type document profiles.
 * Lokálně v .jobidocs-data/profiles.json. Při Supabase integraci nahradit voláním Supabase.
 */
import fs from "fs/promises";
import path from "path";

type ProfileEntry = { service_id: string; doc_type: string; profile_json: unknown };
type ProfilesFile = { profiles: ProfileEntry[] };

let profilesPath: string | null = null;

export function setProfilesPath(baseDir: string) {
  profilesPath = path.join(baseDir, "profiles.json");
}

async function ensureDir(): Promise<string> {
  if (!profilesPath) throw new Error("Profiles path not set");
  await fs.mkdir(path.dirname(profilesPath), { recursive: true });
  return profilesPath;
}

async function readProfiles(): Promise<ProfilesFile> {
  const p = await ensureDir();
  try {
    const data = await fs.readFile(p, "utf-8");
    return { profiles: JSON.parse(data).profiles || [] };
  } catch {
    return { profiles: [] };
  }
}

async function writeProfiles(file: ProfilesFile): Promise<void> {
  const p = await ensureDir();
  await fs.writeFile(p, JSON.stringify(file, null, 2), "utf-8");
}

export async function getProfile(
  serviceId: string,
  docType: string
): Promise<{ profile_json: unknown; version: number } | null> {
  const file = await readProfiles();
  const entry = file.profiles.find(
    (p) => p.service_id === serviceId && p.doc_type === docType
  );
  return entry ? { profile_json: entry.profile_json, version: 1 } : null;
}

export async function putProfile(
  serviceId: string,
  docType: string,
  profileJson: unknown
): Promise<{ profile_json: unknown; version: number }> {
  const file = await readProfiles();
  const idx = file.profiles.findIndex(
    (p) => p.service_id === serviceId && p.doc_type === docType
  );
  const entry: ProfileEntry = { service_id: serviceId, doc_type: docType, profile_json: profileJson ?? {} };
  if (idx >= 0) {
    file.profiles[idx] = entry;
  } else {
    file.profiles.push(entry);
  }
  await writeProfiles(file);
  return { profile_json: entry.profile_json, version: 1 };
}
