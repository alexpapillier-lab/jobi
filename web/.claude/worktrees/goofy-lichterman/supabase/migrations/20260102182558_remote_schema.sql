drop extension if exists "pg_net";

drop trigger if exists "trg_customers_set_updated_at" on "public"."customers";

drop trigger if exists "service_settings_updated_at" on "public"."service_settings";

drop trigger if exists "trg_tickets_set_updated_at" on "public"."tickets";

drop trigger if exists "trg_prevent_root_owner_change" on "public"."service_memberships";

drop policy "Users can insert customer_history for their services" on "public"."customer_history";

drop policy "Users can view customer_history for their services" on "public"."customer_history";

drop policy "Only owner/admin can delete document settings" on "public"."service_document_settings";

drop policy "Owners and admins can insert service_settings" on "public"."service_settings";

drop policy "Service members can update service settings" on "public"."service_settings";

drop policy "Users can view service_settings for their services" on "public"."service_settings";

drop policy "Only owner/admin can insert document settings" on "public"."service_document_settings";

drop policy "Only owner/admin can update document settings" on "public"."service_document_settings";

drop policy "Service members can read document settings" on "public"."service_document_settings";

alter table "public"."customer_history" drop constraint "customer_history_service_id_fkey";

alter table "public"."service_settings" drop constraint "service_settings_service_id_key";

alter table "public"."service_settings" drop constraint "service_settings_pkey";

drop index if exists "public"."idx_customer_history_changed_at";

drop index if exists "public"."idx_customer_history_customer_id";

drop index if exists "public"."idx_customer_history_service_id";

drop index if exists "public"."idx_customers_phone";

drop index if exists "public"."idx_customers_phone_norm";

drop index if exists "public"."idx_customers_service_id";

drop index if exists "public"."idx_customers_service_phone_norm_unique";

drop index if exists "public"."idx_service_doc_templates_service_id";

drop index if exists "public"."idx_service_invites_email";

drop index if exists "public"."idx_service_invites_service_id";

drop index if exists "public"."idx_service_statuses_service_id";

drop index if exists "public"."idx_ticket_documents_service_id";

drop index if exists "public"."idx_ticket_documents_ticket_id";

drop index if exists "public"."idx_tickets_code";

drop index if exists "public"."idx_tickets_created_at";

drop index if exists "public"."idx_tickets_customer_id";

drop index if exists "public"."idx_tickets_service_id";

drop index if exists "public"."idx_tickets_updated_at";

drop index if exists "public"."service_settings_service_id_key";

drop index if exists "public"."ux_service_doc_templates_service_type_ver";

drop index if exists "public"."ux_service_invites_token";

drop index if exists "public"."ux_service_statuses_service_key";

drop index if exists "public"."ux_ticket_documents_storage_path";

drop index if exists "public"."service_settings_pkey";

alter table "public"."customer_history" disable row level security;

alter table "public"."customers" add column "address_city" text;

alter table "public"."customers" add column "address_country" text;

alter table "public"."customers" add column "address_street" text;

alter table "public"."customers" add column "address_zip" text;

alter table "public"."customers" add column "company" text;

alter table "public"."customers" add column "dic" text;

alter table "public"."customers" add column "ico" text;

alter table "public"."customers" add column "info" text;

alter table "public"."customers" add column "note" text;

alter table "public"."customers" alter column "name" set not null;

alter table "public"."customers" alter column "updated_at" set not null;

alter table "public"."customers" enable row level security;

alter table "public"."service_document_templates" enable row level security;

alter table "public"."service_invites" enable row level security;

alter table "public"."service_memberships" enable row level security;

alter table "public"."service_settings" drop column "id";

alter table "public"."service_statuses" enable row level security;

alter table "public"."services" enable row level security;

alter table "public"."ticket_documents" enable row level security;

alter table "public"."tickets" enable row level security;

CREATE INDEX customers_name_idx ON public.customers USING gin (to_tsvector('simple'::regconfig, COALESCE(name, ''::text)));

CREATE INDEX customers_phone_idx ON public.customers USING btree (phone);

CREATE INDEX customers_service_id_idx ON public.customers USING btree (service_id);

CREATE UNIQUE INDEX customers_service_phone_norm_uniq ON public.customers USING btree (service_id, phone_norm) WHERE (phone_norm IS NOT NULL);

CREATE UNIQUE INDEX customers_service_phone_norm_uq ON public.customers USING btree (service_id, phone_norm) WHERE (phone_norm IS NOT NULL);

CREATE INDEX idx_service_document_templates_service ON public.service_document_templates USING btree (service_id);

CREATE INDEX idx_ticket_documents_ticket ON public.ticket_documents USING btree (service_id, ticket_id);

CREATE INDEX idx_tickets_service_deleted_at ON public.tickets USING btree (service_id, deleted_at, created_at DESC);

CREATE UNIQUE INDEX service_document_templates_service_id_doc_type_key ON public.service_document_templates USING btree (service_id, doc_type);

CREATE UNIQUE INDEX service_invites_pending_unique ON public.service_invites USING btree (service_id, email) WHERE (accepted_at IS NULL);

CREATE UNIQUE INDEX service_invites_service_id_email_key ON public.service_invites USING btree (service_id, email);

CREATE INDEX service_invites_token_idx ON public.service_invites USING btree (token);

CREATE UNIQUE INDEX service_memberships_pkey ON public.service_memberships USING btree (service_id, user_id);

CREATE UNIQUE INDEX service_memberships_service_id_user_id_key ON public.service_memberships USING btree (service_id, user_id);

CREATE UNIQUE INDEX service_memberships_service_user_uniq ON public.service_memberships USING btree (service_id, user_id);

CREATE UNIQUE INDEX service_statuses_service_id_key_key ON public.service_statuses USING btree (service_id, key);

CREATE UNIQUE INDEX ticket_documents_service_id_ticket_id_doc_type_key ON public.ticket_documents USING btree (service_id, ticket_id, doc_type);

CREATE INDEX tickets_customer_id_idx ON public.tickets USING btree (customer_id);

CREATE UNIQUE INDEX service_settings_pkey ON public.service_settings USING btree (service_id);

alter table "public"."service_memberships" add constraint "service_memberships_pkey" PRIMARY KEY using index "service_memberships_pkey";

alter table "public"."service_settings" add constraint "service_settings_pkey" PRIMARY KEY using index "service_settings_pkey";

alter table "public"."customers" add constraint "customers_phone_norm_e164_check" CHECK (((phone_norm IS NULL) OR (phone_norm ~ '^\+[1-9][0-9]{6,14}$'::text))) not valid;

alter table "public"."customers" validate constraint "customers_phone_norm_e164_check";

alter table "public"."service_document_templates" add constraint "service_document_templates_doc_type_check" CHECK ((doc_type = ANY (ARRAY['ticket_list'::text, 'diagnostic_protocol'::text, 'warranty_certificate'::text]))) not valid;

alter table "public"."service_document_templates" validate constraint "service_document_templates_doc_type_check";

alter table "public"."service_document_templates" add constraint "service_document_templates_service_id_doc_type_key" UNIQUE using index "service_document_templates_service_id_doc_type_key";

alter table "public"."service_document_templates" add constraint "service_document_templates_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id) not valid;

alter table "public"."service_document_templates" validate constraint "service_document_templates_updated_by_fkey";

alter table "public"."service_invites" add constraint "service_invites_role_check" CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text]))) not valid;

alter table "public"."service_invites" validate constraint "service_invites_role_check";

alter table "public"."service_invites" add constraint "service_invites_service_id_email_key" UNIQUE using index "service_invites_service_id_email_key";

alter table "public"."service_invites" add constraint "service_invites_token_nonempty" CHECK ((length(token) >= 20)) not valid;

alter table "public"."service_invites" validate constraint "service_invites_token_nonempty";

alter table "public"."service_memberships" add constraint "service_memberships_role_check" CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text]))) not valid;

alter table "public"."service_memberships" validate constraint "service_memberships_role_check";

alter table "public"."service_memberships" add constraint "service_memberships_service_id_fkey" FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE CASCADE not valid;

alter table "public"."service_memberships" validate constraint "service_memberships_service_id_fkey";

alter table "public"."service_memberships" add constraint "service_memberships_service_id_user_id_key" UNIQUE using index "service_memberships_service_id_user_id_key";

alter table "public"."service_memberships" add constraint "service_memberships_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."service_memberships" validate constraint "service_memberships_user_id_fkey";

alter table "public"."service_statuses" add constraint "service_statuses_service_id_key_key" UNIQUE using index "service_statuses_service_id_key_key";

alter table "public"."ticket_documents" add constraint "ticket_documents_doc_type_check" CHECK ((doc_type = ANY (ARRAY['ticket_list'::text, 'diagnostic_protocol'::text, 'warranty_certificate'::text]))) not valid;

alter table "public"."ticket_documents" validate constraint "ticket_documents_doc_type_check";

alter table "public"."ticket_documents" add constraint "ticket_documents_service_id_ticket_id_doc_type_key" UNIQUE using index "ticket_documents_service_id_ticket_id_doc_type_key";

alter table "public"."ticket_documents" add constraint "ticket_documents_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id) not valid;

alter table "public"."ticket_documents" validate constraint "ticket_documents_updated_by_fkey";

alter table "public"."tickets" add constraint "tickets_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL not valid;

alter table "public"."tickets" validate constraint "tickets_customer_id_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.enforce_ticket_status_exists()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if not exists (
    select 1
    from service_statuses s
    where s.service_id = new.service_id
      and s.key = new.status
  ) then
    raise exception 'Invalid status key % for service %', new.status, new.service_id;
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.is_owner_or_admin(_service_id uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO 'off'
AS $function$
  select exists (
    select 1
    from public.service_memberships sm
    where sm.service_id = _service_id
      and sm.user_id = auth.uid()
      and sm.role in ('owner', 'admin')
  );
$function$
;

CREATE OR REPLACE FUNCTION public.bump_service_document_settings_version()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.version := old.version + 1;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_ticket_status_change_permissions()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
BEGIN
  -- Only enforce when status is changing
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    SELECT sm.role INTO v_role
    FROM public.service_memberships sm
    WHERE sm.service_id = NEW.service_id
      AND sm.user_id = auth.uid()
    LIMIT 1;

    IF v_role IS NULL THEN
      RAISE EXCEPTION 'Not authorized: not a service member';
    END IF;

    IF v_role IN ('owner', 'admin')
       OR public.has_capability(NEW.service_id, auth.uid(), 'can_change_ticket_status')
    THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Not authorized: missing can_change_ticket_status';
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.has_any_capability(p_service_id uuid, p_user_id uuid, p_capabilities text[])
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
DECLARE
  v_role TEXT;
  v_capabilities_jsonb JSONB;
  v_capability TEXT;
  v_has_any BOOLEAN := FALSE;
BEGIN
  -- Get user's role and capabilities for the service
  SELECT role, capabilities INTO v_role, v_capabilities_jsonb
  FROM public.service_memberships
  WHERE service_id = p_service_id
    AND user_id = p_user_id;
  
  -- If user is not a member, return false
  IF v_role IS NULL THEN
    RETURN FALSE;
  END IF;
  
  -- Owner and admin have all capabilities implicitly
  IF v_role IN ('owner', 'admin') THEN
    RETURN TRUE;
  END IF;
  
  -- For members, check if at least one capability in the array is true
  FOREACH v_capability IN ARRAY p_capabilities
  LOOP
    IF COALESCE(
      (v_capabilities_jsonb->>v_capability)::boolean,
      FALSE
    ) = TRUE THEN
      v_has_any := TRUE;
      EXIT; -- Early exit if any capability is true
    END IF;
  END LOOP;
  
  RETURN v_has_any;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.has_capability(p_service_id uuid, p_user_id uuid, p_capability text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
DECLARE
  v_role TEXT;
  v_capabilities_jsonb JSONB;
  v_capability_value BOOLEAN;
BEGIN
  -- Get user's role and capabilities for the service
  SELECT role, capabilities INTO v_role, v_capabilities_jsonb
  FROM public.service_memberships
  WHERE service_id = p_service_id
    AND user_id = p_user_id;
  
  -- If user is not a member, return false
  IF v_role IS NULL THEN
    RETURN FALSE;
  END IF;
  
  -- Owner and admin have all capabilities implicitly
  IF v_role IN ('owner', 'admin') THEN
    RETURN TRUE;
  END IF;
  
  -- For members, check capabilities JSONB
  -- Missing key or null value => false
  -- Explicit true => true
  -- Explicit false => false
  v_capability_value := COALESCE(
    (v_capabilities_jsonb->>p_capability)::boolean,
    FALSE
  );
  
  RETURN v_capability_value;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.prevent_last_owner_removal()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  owners_count int;
begin
  -- počítáme ownery v daném servisu (kromě aktuálního řádku)
  select count(*) into owners_count
  from public.service_memberships
  where service_id = old.service_id
    and role = 'owner'
    and user_id <> old.user_id;

  -- pokud je to poslední owner
  if old.role = 'owner' and owners_count = 0 then
    if tg_op = 'DELETE' then
      raise exception 'Cannot remove the last owner of a service';
    end if;

    if tg_op = 'UPDATE' and new.role <> 'owner' then
      raise exception 'Cannot downgrade the last owner of a service';
    end if;
  end if;

  -- DŮLEŽITÉ: správný návrat podle operace
  if tg_op = 'DELETE' then
    return old;
  else
    return new;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.prevent_root_owner_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  -- Root owner (nezměnitelný)
  if old.user_id = 'f3b27eb3-7059-48e0-839f-de1eb988fe70' then
    if tg_op = 'DELETE' then
      raise exception 'Root owner cannot be removed';
    end if;

    if tg_op = 'UPDATE' and new.role <> 'owner' then
      raise exception 'Root owner role cannot be changed';
    end if;
  end if;

  -- DŮLEŽITÉ: správný návrat podle operace
  if tg_op = 'DELETE' then
    return old;
  else
    return new;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.restore_ticket(p_ticket_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_service_id UUID;
  v_user_role TEXT;
BEGIN
  -- Get ticket's service_id
  SELECT service_id INTO v_service_id
  FROM public.tickets
  WHERE id = p_ticket_id;
  
  IF v_service_id IS NULL THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;
  
  -- Check user is a member of the service
  SELECT role INTO v_user_role
  FROM public.service_memberships
  WHERE service_id = v_service_id
    AND user_id = auth.uid();
  
  IF v_user_role IS NULL THEN
    RAISE EXCEPTION 'Not authorized: user is not a member of this service';
  END IF;
  
  -- Check user is owner or admin
  IF v_user_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Not authorized: only owner or admin can restore tickets';
  END IF;
  
  -- Perform restore
  UPDATE public.tickets
  SET deleted_at = NULL
  WHERE id = p_ticket_id
    AND service_id = v_service_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found or update failed';
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_member_capabilities(p_service_id uuid, p_user_id uuid, p_capabilities jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_role TEXT;
  v_target_role TEXT;
  v_allowed_keys TEXT[] := ARRAY[
    'can_manage_tickets_basic',
    'can_change_ticket_status',
    'can_manage_ticket_archive',
    'can_manage_customers',
    'can_manage_statuses',
    'can_manage_documents',
    'can_edit_devices',
    'can_edit_inventory',
    'can_edit_service_settings'
  ];
  v_key TEXT;
BEGIN
  -- Get current user ID
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Get caller's role
  SELECT role INTO v_caller_role
  FROM public.service_memberships
  WHERE service_id = p_service_id
    AND user_id = auth.uid();

  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'Not authorized: User is not a member of this service';
  END IF;

  -- Only owner and admin can change capabilities
  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Not authorized: Only owner or admin can change member capabilities';
  END IF;

  -- Get target user's role
  SELECT role INTO v_target_role
  FROM public.service_memberships
  WHERE service_id = p_service_id
    AND user_id = p_user_id;

  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'Target user is not a member of this service';
  END IF;

  -- Prevent changing capabilities for owner
  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Cannot change capabilities of owner';
  END IF;

  -- Admin can only change capabilities for members (not for other admins)
  IF v_caller_role = 'admin' AND v_target_role != 'member' THEN
    RAISE EXCEPTION 'Not authorized: Admin can only change capabilities for members';
  END IF;

  -- Whitelist: Only allow known capability keys
  -- Remove any keys that are not in the whitelist
  -- Convert all values to boolean
  FOR v_key IN SELECT jsonb_object_keys(p_capabilities)
  LOOP
    IF NOT (v_key = ANY(v_allowed_keys)) THEN
      RAISE EXCEPTION 'Invalid capability key: %. Allowed keys: %', v_key, array_to_string(v_allowed_keys, ', ');
    END IF;
  END LOOP;

  -- Build sanitized capabilities object (only whitelisted keys, all as booleans)
  -- Replace entire capabilities object (not merge)
  UPDATE public.service_memberships
  SET capabilities = COALESCE(
    (
      SELECT jsonb_object_agg(key, COALESCE((value::text)::boolean, false))
      FROM jsonb_each(p_capabilities)
      WHERE key = ANY(v_allowed_keys)
    ),
    '{}'::jsonb
  )
  WHERE service_id = p_service_id
    AND user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Failed to update member capabilities';
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.soft_delete_ticket(p_ticket_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_service_id UUID;
  v_user_role TEXT;
BEGIN
  -- Get ticket's service_id
  SELECT service_id INTO v_service_id
  FROM public.tickets
  WHERE id = p_ticket_id;
  
  IF v_service_id IS NULL THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;
  
  -- Check user is a member of the service
  SELECT role INTO v_user_role
  FROM public.service_memberships
  WHERE service_id = v_service_id
    AND user_id = auth.uid();
  
  IF v_user_role IS NULL THEN
    RAISE EXCEPTION 'Not authorized: user is not a member of this service';
  END IF;
  
  -- Check user is owner or admin
  IF v_user_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Not authorized: only owner or admin can delete tickets';
  END IF;
  
  -- Perform soft delete
  UPDATE public.tickets
  SET deleted_at = now()
  WHERE id = p_ticket_id
    AND service_id = v_service_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found or update failed';
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_service_settings(p_service_id uuid, p_patch jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_user_role TEXT;
  v_user_id UUID;
BEGIN
  -- Get current user ID
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  
  -- Verify user is a member of the service
  SELECT role INTO v_user_role
  FROM public.service_memberships
  WHERE service_id = p_service_id
    AND user_id = v_user_id;
  
  IF v_user_role IS NULL THEN
    RAISE EXCEPTION 'Not authorized: User is not a member of this service';
  END IF;
  
  -- Owner and admin can always update
  IF v_user_role IN ('owner', 'admin') THEN
    -- Proceed with update
  ELSIF v_user_role = 'member' THEN
    -- Member needs can_edit_service_settings capability
    IF NOT public.has_capability(p_service_id, v_user_id, 'can_edit_service_settings') THEN
      RAISE EXCEPTION 'Not authorized: Member does not have can_edit_service_settings capability';
    END IF;
  ELSE
    RAISE EXCEPTION 'Not authorized: Invalid role';
  END IF;
  
  -- Whitelist allowed fields in p_patch
  -- Only allow updating the 'config' JSONB field
  -- Reject any attempt to change service_id or other system fields
  IF p_patch ? 'service_id' OR p_patch ? 'id' OR p_patch ? 'created_at' OR p_patch ? 'updated_at' THEN
    RAISE EXCEPTION 'Not allowed: Cannot update system fields (service_id, id, created_at, updated_at)';
  END IF;
  
  -- Perform update
  -- Only allow updating 'config' field
  -- Note: updated_at is automatically updated by trigger
  UPDATE public.service_settings
  SET config = COALESCE(p_patch->'config', config)
  WHERE service_id = p_service_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Service settings not found for service_id: %', p_service_id;
  END IF;
END;
$function$
;


  create policy "customers_delete"
  on "public"."customers"
  as permissive
  for delete
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.service_memberships sm
  WHERE ((sm.service_id = customers.service_id) AND (sm.user_id = auth.uid())))));



  create policy "customers_insert"
  on "public"."customers"
  as permissive
  for insert
  to authenticated
with check ((EXISTS ( SELECT 1
   FROM public.service_memberships sm
  WHERE ((sm.service_id = customers.service_id) AND (sm.user_id = auth.uid())))));



  create policy "customers_select"
  on "public"."customers"
  as permissive
  for select
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.service_memberships sm
  WHERE ((sm.service_id = customers.service_id) AND (sm.user_id = auth.uid())))));



  create policy "customers_update"
  on "public"."customers"
  as permissive
  for update
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.service_memberships sm
  WHERE ((sm.service_id = customers.service_id) AND (sm.user_id = auth.uid())))))
with check ((EXISTS ( SELECT 1
   FROM public.service_memberships sm
  WHERE ((sm.service_id = customers.service_id) AND (sm.user_id = auth.uid())))));



  create policy "service_document_templates_insert_own_service"
  on "public"."service_document_templates"
  as permissive
  for insert
  to authenticated
with check ((EXISTS ( SELECT 1
   FROM public.service_memberships sm
  WHERE ((sm.service_id = service_document_templates.service_id) AND (sm.user_id = auth.uid())))));



  create policy "service_document_templates_select_own_service"
  on "public"."service_document_templates"
  as permissive
  for select
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.service_memberships sm
  WHERE ((sm.service_id = service_document_templates.service_id) AND (sm.user_id = auth.uid())))));



  create policy "service_document_templates_update_own_service"
  on "public"."service_document_templates"
  as permissive
  for update
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.service_memberships sm
  WHERE ((sm.service_id = service_document_templates.service_id) AND (sm.user_id = auth.uid())))))
with check ((EXISTS ( SELECT 1
   FROM public.service_memberships sm
  WHERE ((sm.service_id = service_document_templates.service_id) AND (sm.user_id = auth.uid())))));



  create policy "invites_delete_admin"
  on "public"."service_invites"
  as permissive
  for delete
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.service_memberships sm
  WHERE ((sm.service_id = service_invites.service_id) AND (sm.user_id = auth.uid()) AND (sm.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));



  create policy "invites_insert_admin"
  on "public"."service_invites"
  as permissive
  for insert
  to authenticated
with check (((invited_by = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.service_memberships sm
  WHERE ((sm.service_id = service_invites.service_id) AND (sm.user_id = auth.uid()) AND (sm.role = ANY (ARRAY['owner'::text, 'admin'::text])))))));



  create policy "invites_select_admin"
  on "public"."service_invites"
  as permissive
  for select
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.service_memberships sm
  WHERE ((sm.service_id = service_invites.service_id) AND (sm.user_id = auth.uid()) AND (sm.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));



  create policy "invites_update_admin"
  on "public"."service_invites"
  as permissive
  for update
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.service_memberships sm
  WHERE ((sm.service_id = service_invites.service_id) AND (sm.user_id = auth.uid()) AND (sm.role = ANY (ARRAY['owner'::text, 'admin'::text]))))))
with check ((EXISTS ( SELECT 1
   FROM public.service_memberships sm
  WHERE ((sm.service_id = service_invites.service_id) AND (sm.user_id = auth.uid()) AND (sm.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));



  create policy "service role can delete memberships"
  on "public"."service_memberships"
  as permissive
  for delete
  to service_role
using (true);



  create policy "service_memberships_select"
  on "public"."service_memberships"
  as permissive
  for select
  to authenticated
using ((public.is_owner_or_admin(service_id) OR (user_id = auth.uid())));



  create policy "Service settings can only be updated via RPC"
  on "public"."service_settings"
  as permissive
  for update
  to public
using (false)
with check (false);



  create policy "service_statuses_delete_by_owner_admin"
  on "public"."service_statuses"
  as permissive
  for delete
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.service_memberships m
  WHERE ((m.service_id = service_statuses.service_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));



  create policy "service_statuses_insert_by_owner_admin"
  on "public"."service_statuses"
  as permissive
  for insert
  to authenticated
with check ((EXISTS ( SELECT 1
   FROM public.service_memberships m
  WHERE ((m.service_id = service_statuses.service_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));



  create policy "service_statuses_select_by_membership"
  on "public"."service_statuses"
  as permissive
  for select
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.service_memberships m
  WHERE ((m.service_id = service_statuses.service_id) AND (m.user_id = auth.uid())))));



  create policy "service_statuses_update_by_owner_admin"
  on "public"."service_statuses"
  as permissive
  for update
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.service_memberships m
  WHERE ((m.service_id = service_statuses.service_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))))
with check ((EXISTS ( SELECT 1
   FROM public.service_memberships m
  WHERE ((m.service_id = service_statuses.service_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));



  create policy "services_insert_any_authenticated"
  on "public"."services"
  as permissive
  for insert
  to authenticated
with check (true);



  create policy "services_select_by_membership"
  on "public"."services"
  as permissive
  for select
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.service_memberships m
  WHERE ((m.service_id = services.id) AND (m.user_id = auth.uid())))));



  create policy "services_update_by_admin"
  on "public"."services"
  as permissive
  for update
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.service_memberships m
  WHERE ((m.service_id = services.id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))))
with check ((EXISTS ( SELECT 1
   FROM public.service_memberships m
  WHERE ((m.service_id = services.id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));



  create policy "ticket_documents_insert_own_service"
  on "public"."ticket_documents"
  as permissive
  for insert
  to authenticated
with check ((EXISTS ( SELECT 1
   FROM public.service_memberships sm
  WHERE ((sm.service_id = ticket_documents.service_id) AND (sm.user_id = auth.uid())))));



  create policy "ticket_documents_select_own_service"
  on "public"."ticket_documents"
  as permissive
  for select
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.service_memberships sm
  WHERE ((sm.service_id = ticket_documents.service_id) AND (sm.user_id = auth.uid())))));



  create policy "ticket_documents_update_own_service"
  on "public"."ticket_documents"
  as permissive
  for update
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.service_memberships sm
  WHERE ((sm.service_id = ticket_documents.service_id) AND (sm.user_id = auth.uid())))))
with check ((EXISTS ( SELECT 1
   FROM public.service_memberships sm
  WHERE ((sm.service_id = ticket_documents.service_id) AND (sm.user_id = auth.uid())))));



  create policy "tickets_insert_by_membership"
  on "public"."tickets"
  as permissive
  for insert
  to authenticated
with check ((EXISTS ( SELECT 1
   FROM public.service_memberships m
  WHERE ((m.service_id = tickets.service_id) AND (m.user_id = auth.uid())))));



  create policy "tickets_select_by_membership"
  on "public"."tickets"
  as permissive
  for select
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.service_memberships m
  WHERE ((m.service_id = tickets.service_id) AND (m.user_id = auth.uid())))));



  create policy "tickets_update_by_membership"
  on "public"."tickets"
  as permissive
  for update
  to authenticated
using (((EXISTS ( SELECT 1
   FROM public.service_memberships m
  WHERE ((m.service_id = tickets.service_id) AND (m.user_id = auth.uid())))) AND (deleted_at IS NULL)))
with check (((EXISTS ( SELECT 1
   FROM public.service_memberships m
  WHERE ((m.service_id = tickets.service_id) AND (m.user_id = auth.uid())))) AND (deleted_at IS NULL)));



  create policy "Only owner/admin can insert document settings"
  on "public"."service_document_settings"
  as permissive
  for insert
  to authenticated
with check ((EXISTS ( SELECT 1
   FROM public.service_memberships sm
  WHERE ((sm.service_id = service_document_settings.service_id) AND (sm.user_id = auth.uid()) AND (sm.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));



  create policy "Only owner/admin can update document settings"
  on "public"."service_document_settings"
  as permissive
  for update
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.service_memberships sm
  WHERE ((sm.service_id = service_document_settings.service_id) AND (sm.user_id = auth.uid()) AND (sm.role = ANY (ARRAY['owner'::text, 'admin'::text]))))))
with check ((EXISTS ( SELECT 1
   FROM public.service_memberships sm
  WHERE ((sm.service_id = service_document_settings.service_id) AND (sm.user_id = auth.uid()) AND (sm.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));



  create policy "Service members can read document settings"
  on "public"."service_document_settings"
  as permissive
  for select
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.service_memberships sm
  WHERE ((sm.service_id = service_document_settings.service_id) AND (sm.user_id = auth.uid())))));


CREATE TRIGGER trg_customers_updated_at BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_service_settings_updated_at BEFORE UPDATE ON public.service_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER tickets_enforce_status_exists BEFORE INSERT OR UPDATE OF status ON public.tickets FOR EACH ROW EXECUTE FUNCTION public.enforce_ticket_status_exists();

CREATE TRIGGER tickets_set_updated_at BEFORE UPDATE ON public.tickets FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_prevent_root_owner_change BEFORE DELETE OR UPDATE ON public.service_memberships FOR EACH ROW EXECUTE FUNCTION public.prevent_root_owner_change();


