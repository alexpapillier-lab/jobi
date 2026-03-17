-- Create service_document_settings table for per-service document configuration
CREATE TABLE IF NOT EXISTS public.service_document_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(service_id)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_service_document_settings_service_id 
  ON public.service_document_settings(service_id);

-- Enable RLS
ALTER TABLE public.service_document_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Members of a service can read/write document settings for that service
CREATE POLICY "Service members can read document settings"
  ON public.service_document_settings
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships
      WHERE service_memberships.service_id = service_document_settings.service_id
      AND service_memberships.user_id = auth.uid()
    )
  );

CREATE POLICY "Service members can insert document settings"
  ON public.service_document_settings
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.service_memberships
      WHERE service_memberships.service_id = service_document_settings.service_id
      AND service_memberships.user_id = auth.uid()
    )
  );

CREATE POLICY "Service members can update document settings"
  ON public.service_document_settings
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships
      WHERE service_memberships.service_id = service_document_settings.service_id
      AND service_memberships.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.service_memberships
      WHERE service_memberships.service_id = service_document_settings.service_id
      AND service_memberships.user_id = auth.uid()
    )
  );

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_service_document_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_service_document_settings_updated_at
  BEFORE UPDATE ON public.service_document_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_service_document_settings_updated_at();






