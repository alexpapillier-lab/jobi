-- Add active flag for service deactivation (root owner can deactivate, app can hide inactive)
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.services.active IS 'When false, service is deactivated (root owner). Inactive services can be hidden from lists.';
