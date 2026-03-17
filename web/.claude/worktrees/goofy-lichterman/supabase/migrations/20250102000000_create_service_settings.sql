-- Create service_settings table for per-service configuration
CREATE TABLE IF NOT EXISTS public.service_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(service_id)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_service_settings_service_id 
  ON public.service_settings(service_id);

-- Enable RLS
ALTER TABLE public.service_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Members of a service can read/write settings for that service
CREATE POLICY "Service members can read service settings"
  ON public.service_settings
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships
      WHERE service_memberships.service_id = service_settings.service_id
      AND service_memberships.user_id = auth.uid()
    )
  );

CREATE POLICY "Service members can insert service settings"
  ON public.service_settings
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.service_memberships
      WHERE service_memberships.service_id = service_settings.service_id
      AND service_memberships.user_id = auth.uid()
    )
  );

CREATE POLICY "Service members can update service settings"
  ON public.service_settings
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships
      WHERE service_memberships.service_id = service_settings.service_id
      AND service_memberships.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.service_memberships
      WHERE service_memberships.service_id = service_settings.service_id
      AND service_memberships.user_id = auth.uid()
    )
  );

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_service_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_service_settings_updated_at
  BEFORE UPDATE ON public.service_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_service_settings_updated_at();

