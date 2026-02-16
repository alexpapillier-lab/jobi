-- document_profiles: per-service per-doc-type configuration
-- doc_type: zakazkovy_list | zarucni_list | diagnosticky_protokol
CREATE TABLE IF NOT EXISTS public.document_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('zakazkovy_list', 'zarucni_list', 'diagnosticky_protokol')),
  profile_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id),
  UNIQUE(service_id, doc_type)
);

CREATE INDEX IF NOT EXISTS idx_document_profiles_service_id ON public.document_profiles(service_id);
CREATE INDEX IF NOT EXISTS idx_document_profiles_service_doc_type ON public.document_profiles(service_id, doc_type);

ALTER TABLE public.document_profiles ENABLE ROW LEVEL SECURITY;

-- RLS: select/update jen členové service s rolí owner/admin
CREATE POLICY "Service members can read document profiles"
  ON public.document_profiles
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships
      WHERE service_memberships.service_id = document_profiles.service_id
        AND service_memberships.user_id = auth.uid()
    )
  );

CREATE POLICY "Owner/admin can insert document profiles"
  ON public.document_profiles
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.service_memberships
      WHERE service_memberships.service_id = document_profiles.service_id
        AND service_memberships.user_id = auth.uid()
        AND service_memberships.role IN ('owner', 'admin')
    )
  );

CREATE POLICY "Owner/admin can update document profiles"
  ON public.document_profiles
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships
      WHERE service_memberships.service_id = document_profiles.service_id
        AND service_memberships.user_id = auth.uid()
        AND service_memberships.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.service_memberships
      WHERE service_memberships.service_id = document_profiles.service_id
        AND service_memberships.user_id = auth.uid()
        AND service_memberships.role IN ('owner', 'admin')
    )
  );

CREATE POLICY "Owner/admin can delete document profiles"
  ON public.document_profiles
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships
      WHERE service_memberships.service_id = document_profiles.service_id
        AND service_memberships.user_id = auth.uid()
        AND service_memberships.role IN ('owner', 'admin')
    )
  );

CREATE OR REPLACE FUNCTION update_document_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  NEW.updated_by = auth.uid();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER update_document_profiles_updated_at
  BEFORE INSERT OR UPDATE ON public.document_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_document_profiles_updated_at();
