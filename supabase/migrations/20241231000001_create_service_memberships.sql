-- Base table required by later migrations/RLS
CREATE TABLE IF NOT EXISTS public.service_memberships (
  service_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL,
  created_at timestamptz DEFAULT now(),
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb
);
