-- Migration: Create service_settings table
-- This table stores service-specific settings like abbreviation for ticket code generation

-- Create service_settings table
CREATE TABLE IF NOT EXISTS public.service_settings (
  service_id UUID NOT NULL PRIMARY KEY,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT service_settings_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE CASCADE
);

-- Create index on service_id for faster lookups (already indexed as primary key, but explicit for clarity)
-- Primary key already creates an index, so this is just for documentation

-- Enable RLS
ALTER TABLE public.service_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- Policy: Users can SELECT service_settings for services they are members of
CREATE POLICY "Users can view service_settings for their services"
  ON public.service_settings
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.service_memberships
      WHERE service_memberships.service_id = service_settings.service_id
        AND service_memberships.user_id = auth.uid()
    )
  );

-- Policy: Only owners/admins can INSERT service_settings (or via RPC)
-- Note: Direct INSERT is allowed, but update_service_settings RPC should be used for updates
CREATE POLICY "Owners and admins can insert service_settings"
  ON public.service_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.service_memberships
      WHERE service_memberships.service_id = service_settings.service_id
        AND service_memberships.user_id = auth.uid()
        AND service_memberships.role IN ('owner', 'admin')
    )
  );

-- Note: UPDATE is handled by the update_service_settings RPC function
-- We don't create a direct UPDATE policy here to enforce using the RPC

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_service_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER service_settings_updated_at
  BEFORE UPDATE ON public.service_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_service_settings_updated_at();

-- Add comment explaining the table
COMMENT ON TABLE public.service_settings IS 
  'Service-specific settings stored as JSONB. Contains configuration like abbreviation for ticket code generation.';
COMMENT ON COLUMN public.service_settings.config IS 
  'JSONB configuration object. Expected fields: abbreviation (string, optional) - prefix for ticket codes.';


