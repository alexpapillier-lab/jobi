-- Fix Supabase linter: function_search_path_mutable (WARN)
-- Set search_path on all reported functions so behaviour is not role-dependent.

-- Trigger functions (no arguments)
ALTER FUNCTION public.update_document_profiles_updated_at() SET search_path = public;
ALTER FUNCTION public.bump_service_document_settings_version() SET search_path = public;
ALTER FUNCTION public.set_updated_at() SET search_path = public;
ALTER FUNCTION public.enforce_ticket_status_exists() SET search_path = public;
ALTER FUNCTION public.set_profiles_updated_at() SET search_path = public;
ALTER FUNCTION public.update_service_settings_updated_at() SET search_path = public;
ALTER FUNCTION public.update_service_document_settings_updated_at() SET search_path = public;
ALTER FUNCTION public.prevent_last_owner_removal() SET search_path = public;
ALTER FUNCTION public.prevent_root_owner_change() SET search_path = public;

-- Functions with arguments
ALTER FUNCTION public.has_any_capability(uuid, uuid, text[]) SET search_path = public;
ALTER FUNCTION public.has_capability(uuid, uuid, text) SET search_path = public;
ALTER FUNCTION public.set_member_role(uuid, uuid, text) SET search_path = public;

-- bump_version may exist only in some environments (e.g. from dashboard)
DO $$
BEGIN
  ALTER FUNCTION public.bump_version() SET search_path = public;
EXCEPTION WHEN undefined_function THEN
  NULL;
END $$;
