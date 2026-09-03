-- Bucket pro obrázky produktů ve skladu.
--
-- Do teď se obrázky ukládaly jako base64 přímo do sloupce
-- inventory_products.image_url. To znamenalo, že každé uložení skladu
-- posílalo všechny obrázky všech produktů znovu – u dvou fotek půl mega
-- při každé změně jednoho čísla.
--
-- Path: {service_id}/{product_id}/{uuid}.{ext}
--
-- Čtení je veřejné, protože adresa se posílá i do veřejného API (sklad)
-- a vykresluje se přes <img src>. Zápis smí jen člen toho servisu, jehož
-- id je v první části cesty – na rozdíl od staršího bucketu
-- diagnostic-photos, kam smí zapsat kterýkoli přihlášený uživatel.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-images',
  'product-images',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "product_images_select" ON storage.objects;
CREATE POLICY "product_images_select"
ON storage.objects FOR SELECT
USING (bucket_id = 'product-images');

DROP POLICY IF EXISTS "product_images_insert" ON storage.objects;
CREATE POLICY "product_images_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'product-images'
  AND (storage.foldername(name))[1] IN (
    SELECT m.service_id::text FROM public.service_memberships m WHERE m.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "product_images_update" ON storage.objects;
CREATE POLICY "product_images_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'product-images'
  AND (storage.foldername(name))[1] IN (
    SELECT m.service_id::text FROM public.service_memberships m WHERE m.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "product_images_delete" ON storage.objects;
CREATE POLICY "product_images_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'product-images'
  AND (storage.foldername(name))[1] IN (
    SELECT m.service_id::text FROM public.service_memberships m WHERE m.user_id = auth.uid()
  )
);
