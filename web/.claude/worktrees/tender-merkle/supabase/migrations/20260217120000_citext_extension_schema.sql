-- Fix Supabase linter: extension_in_public (WARN)
-- Move citext from public to extensions schema (only service_invites.email uses it).

CREATE SCHEMA IF NOT EXISTS extensions;

-- Temporarily use text so we can drop the extension from public
ALTER TABLE public.service_invites
  ALTER COLUMN email TYPE text USING email::text;

DROP EXTENSION IF EXISTS citext;

CREATE EXTENSION IF NOT EXISTS citext SCHEMA extensions;

ALTER TABLE public.service_invites
  ALTER COLUMN email TYPE extensions.citext USING email::extensions.citext;
