-- Add version column for optimistic locking
ALTER TABLE public.service_document_settings
ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- Backfill version for existing rows (safety)
UPDATE public.service_document_settings
SET version = 1
WHERE version IS NULL;

-- Function to bump version on update
CREATE OR REPLACE FUNCTION public.bump_service_document_settings_version()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$$;

-- Drop trigger if exists (idempotent)
DROP TRIGGER IF EXISTS trg_bump_service_document_settings_version ON public.service_document_settings;

-- Create trigger to bump version on update
CREATE TRIGGER trg_bump_service_document_settings_version
BEFORE UPDATE ON public.service_document_settings
FOR EACH ROW
EXECUTE FUNCTION public.bump_service_document_settings_version();

