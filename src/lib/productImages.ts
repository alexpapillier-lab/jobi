/**
 * Obrázky produktů ve skladu (bucket product-images).
 *
 * Path: {serviceId}/{productId}/{uuid}.{ext}
 *
 * Do teď se obrázek ukládal jako base64 přímo do sloupce image_url. Kromě
 * toho, že to nafouklo každé uložení skladu o všechny fotky, to znamenalo,
 * že fotka z telefonu (3–5 MB) prošla v base64 ještě o třetinu větší.
 * Proto se před nahráním zmenšuje.
 *
 * Staré base64 hodnoty zůstávají funkční – `<img src>` i veřejné API berou
 * obojí, takže se nic migrovat nemusí.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "product-images";

/** Delší strana výsledku. Na náhled i detail produktu bohatě stačí. */
const MAX_HRANA = 1600;
const KVALITA = 0.85;

export function jeUlozenaAdresa(url: string | undefined): boolean {
  return !!url && !url.startsWith("data:");
}

/**
 * Zmenší obrázek na rozumnou velikost a převede na JPEG.
 *
 * Když se to nepovede (podivný formát, prohlížeč bez podpory), vrátí
 * původní soubor – radši větší obrázek než žádný.
 */
export async function zmensiObrazek(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const delsi = Math.max(bitmap.width, bitmap.height);
    const pomer = delsi > MAX_HRANA ? MAX_HRANA / delsi : 1;
    const w = Math.round(bitmap.width * pomer);
    const h = Math.round(bitmap.height * pomer);

    const platno = document.createElement("canvas");
    platno.width = w;
    platno.height = h;
    const ctx = platno.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((hotovo) =>
      platno.toBlob(hotovo, "image/jpeg", KVALITA),
    );
    // Průhledné PNG po převodu na JPEG zčerná, ale u fotek produktů je
    // menší soubor důležitější. Když by výsledek byl větší, necháme originál.
    if (!blob || blob.size >= file.size) return file;
    return blob;
  } catch {
    return file;
  }
}

/** Nahraje obrázek produktu a vrátí veřejnou adresu. */
export async function nahrajObrazekProduktu(
  supabase: SupabaseClient | null,
  serviceId: string,
  productId: string,
  file: File,
): Promise<string> {
  if (!supabase) throw new Error("Supabase není k dispozici");
  const blob = await zmensiObrazek(file);
  const pripona = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
  const cesta = `${serviceId}/${productId}/${crypto.randomUUID()}.${pripona}`;

  const { error } = await supabase.storage.from(BUCKET).upload(cesta, blob, {
    contentType: blob.type || "image/jpeg",
    upsert: false,
  });
  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(cesta);
  return data.publicUrl;
}

/**
 * Smaže obrázek produktu. Chyba se schválně polyká – osiřelý soubor
 * v úložišti je menší problém než rozbité mazání produktu.
 */
export async function smazObrazekProduktu(
  supabase: SupabaseClient | null,
  url: string | undefined,
): Promise<void> {
  if (!supabase || !jeUlozenaAdresa(url)) return;
  const kus = url!.split(`/${BUCKET}/`)[1];
  if (!kus) return;
  try {
    await supabase.storage.from(BUCKET).remove([decodeURIComponent(kus.split("?")[0])]);
  } catch {
    /* osiřelý soubor nevadí */
  }
}
