-- Baseline for missing core tables so shadow DB can replay later migrations
-- Adds PK/FK/uniques/indexes + required extension(s).

-- Required extension for citext (used in service_invites.email)
CREATE EXTENSION IF NOT EXISTS citext;

-- 1) customer_history
CREATE TABLE IF NOT EXISTS public.customer_history (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL,
  service_id uuid NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid,
  change_type text NOT NULL,
  diff jsonb NOT NULL,
  CONSTRAINT customer_history_pkey PRIMARY KEY (id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_history_customer_id_fkey') THEN
    ALTER TABLE public.customer_history
      ADD CONSTRAINT customer_history_customer_id_fkey
      FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_history_service_id_fkey') THEN
    ALTER TABLE public.customer_history
      ADD CONSTRAINT customer_history_service_id_fkey
      FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_customer_history_customer_id ON public.customer_history(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_history_service_id ON public.customer_history(service_id);
CREATE INDEX IF NOT EXISTS idx_customer_history_changed_at ON public.customer_history(changed_at);

-- 2) service_document_templates
CREATE TABLE IF NOT EXISTS public.service_document_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL,
  doc_type text NOT NULL,
  template_html text NOT NULL,
  header_html text,
  footer_html text,
  logo_path text,
  template_version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT service_document_templates_pkey PRIMARY KEY (id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_document_templates_service_id_fkey') THEN
    ALTER TABLE public.service_document_templates
      ADD CONSTRAINT service_document_templates_service_id_fkey
      FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Typically one template per (service, doc_type, version)
CREATE UNIQUE INDEX IF NOT EXISTS ux_service_doc_templates_service_type_ver
  ON public.service_document_templates(service_id, doc_type, template_version);

CREATE INDEX IF NOT EXISTS idx_service_doc_templates_service_id
  ON public.service_document_templates(service_id);

-- 3) service_invites
CREATE TABLE IF NOT EXISTS public.service_invites (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL,
  email citext NOT NULL,
  role text NOT NULL,
  invited_by uuid NOT NULL,
  token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + '14 days'::interval),
  accepted_at timestamptz,
  accepted_by uuid,
  CONSTRAINT service_invites_pkey PRIMARY KEY (id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_invites_service_id_fkey') THEN
    ALTER TABLE public.service_invites
      ADD CONSTRAINT service_invites_service_id_fkey
      FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_service_invites_token
  ON public.service_invites(token);

CREATE INDEX IF NOT EXISTS idx_service_invites_service_id
  ON public.service_invites(service_id);

CREATE INDEX IF NOT EXISTS idx_service_invites_email
  ON public.service_invites(email);

-- 4) service_statuses
CREATE TABLE IF NOT EXISTS public.service_statuses (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL,
  key text NOT NULL,
  label text NOT NULL,
  bg text,
  fg text,
  is_final boolean NOT NULL DEFAULT false,
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT service_statuses_pkey PRIMARY KEY (id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_statuses_service_id_fkey') THEN
    ALTER TABLE public.service_statuses
      ADD CONSTRAINT service_statuses_service_id_fkey
      FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_service_statuses_service_key
  ON public.service_statuses(service_id, key);

CREATE INDEX IF NOT EXISTS idx_service_statuses_service_id
  ON public.service_statuses(service_id);

-- 5) ticket_documents
CREATE TABLE IF NOT EXISTS public.ticket_documents (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL,
  ticket_id uuid NOT NULL,
  doc_type text NOT NULL,
  storage_path text NOT NULL,
  content_hash text NOT NULL,
  file_size_bytes integer,
  page_count integer,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT ticket_documents_pkey PRIMARY KEY (id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_documents_service_id_fkey') THEN
    ALTER TABLE public.ticket_documents
      ADD CONSTRAINT ticket_documents_service_id_fkey
      FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_documents_ticket_id_fkey') THEN
    ALTER TABLE public.ticket_documents
      ADD CONSTRAINT ticket_documents_ticket_id_fkey
      FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ticket_documents_service_id ON public.ticket_documents(service_id);
CREATE INDEX IF NOT EXISTS idx_ticket_documents_ticket_id ON public.ticket_documents(ticket_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ticket_documents_storage_path ON public.ticket_documents(storage_path);
