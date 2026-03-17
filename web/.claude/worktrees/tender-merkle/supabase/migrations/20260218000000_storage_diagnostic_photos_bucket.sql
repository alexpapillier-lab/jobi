-- Bucket pro diagnostické fotky zakázek. Veřejný read (img src), upload/delete jen přihlášení.
-- Path: {service_id}/{ticket_id}/{uuid}.{ext}

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'diagnostic-photos',
  'diagnostic-photos',
  true,
  52428800,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Čtení: kdokoli (veřejný bucket – náhledy v dokumentech / jiná zařízení)
CREATE POLICY "diagnostic_photos_select"
ON storage.objects FOR SELECT
USING (bucket_id = 'diagnostic-photos');

-- Nahrání: jen přihlášení (aplikace používá auth)
CREATE POLICY "diagnostic_photos_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'diagnostic-photos');

-- Smazání: jen přihlášení
CREATE POLICY "diagnostic_photos_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'diagnostic-photos');
