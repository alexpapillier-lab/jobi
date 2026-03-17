/**
 * Diagnostické fotky v Supabase Storage (bucket diagnostic-photos).
 * Path: {serviceId}/{ticketId}/{uuid}.{ext}
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { addWatermarkToImageBlob } from "./diagnosticPhotoWatermark";

const BUCKET = "diagnostic-photos";

function getExt(file: File): string {
  const name = file.name?.trim() || "";
  const last = name.split(".").pop()?.toLowerCase();
  if (last && /^[a-z0-9]+$/.test(last)) return last;
  const mime = file.type?.toLowerCase() || "";
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "jpg";
}

/**
 * Nahraje soubor do Storage a vrátí veřejnou URL.
 * Volat jen když má zakázka už id (po uložení).
 */
export async function uploadDiagnosticPhoto(
  supabase: SupabaseClient | null,
  serviceId: string,
  ticketId: string,
  file: File
): Promise<string> {
  if (!supabase) throw new Error("Supabase není k dispozici");
  const ext = getExt(file);
  const path = `${serviceId}/${ticketId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || `image/${ext}`,
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Nahraje soubor do Storage s watermarkem (datum, čas, jobi) a vrátí veřejnou URL.
 */
export async function uploadDiagnosticPhotoWithWatermark(
  supabase: SupabaseClient | null,
  serviceId: string,
  ticketId: string,
  file: File
): Promise<string> {
  if (!supabase) throw new Error("Supabase není k dispozici");
  const watermarked = await addWatermarkToImageBlob(file);
  const f = new File(
    [watermarked],
    (file.name || "photo.jpg").replace(/\.[^.]+$/i, ".jpg") || "photo.jpg",
    { type: "image/jpeg" }
  );
  return uploadDiagnosticPhoto(supabase, serviceId, ticketId, f);
}

/**
 * Smaže soubor ze Storage podle veřejné URL (pokud jde o náš bucket).
 * Pokud URL není z našeho Storage, nic nedělá (např. staré base64).
 */
export async function deleteDiagnosticPhotoFromStorage(
  supabase: SupabaseClient | null,
  photoUrl: string
): Promise<void> {
  if (!supabase) return;
  const path = getStoragePathFromPublicUrl(photoUrl);
  if (!path) return;
  await supabase.storage.from(BUCKET).remove([path]);
}

/**
 * Vrátí true, pokud je URL z našeho bucketu (Storage). Jinak jde o data URL (base64) nebo cizí odkaz.
 */
export function isDiagnosticPhotoStorageUrl(photoUrl: string): boolean {
  return getStoragePathFromPublicUrl(photoUrl) != null;
}

function getStoragePathFromPublicUrl(publicUrl: string): string | null {
  try {
    const u = new URL(publicUrl);
    const pathMatch = u.pathname.match(/\/storage\/v1\/object\/public\/diagnostic-photos\/(.+)/);
    return pathMatch ? decodeURIComponent(pathMatch[1]) : null;
  } catch {
    return null;
  }
}
