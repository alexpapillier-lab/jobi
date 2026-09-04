-- Zákaznický portál.
--
-- Zákazník dostane odkaz s tokenem (web/z/?t=...), na kterém vidí stav své
-- zakázky, fotky, provedené opravy a cenu, může schválit/zamítnout cenovou
-- nabídku, podepsat převzetí a potvrdit vyzvednutí. Portál čte i zapisuje
-- VÝHRADNĚ edge funkce portal-ticket pod service_role – token je jediné
-- „heslo“, proto je dlouhý, náhodný a unikátní.
--
-- Z Jobi (přihlášený člen servisu) se token zakládá přes RPC
-- ensure_portal_token; UI ho zobrazí / pošle SMS. Nic z portálu nevyžaduje
-- has_entitlement – portál je základní funkce, ne placený modul.

-- 1) Nové sloupce na tickets ---------------------------------------------------
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS portal_token text,
  ADD COLUMN IF NOT EXISTS quote_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS quote_note text,
  ADD COLUMN IF NOT EXISTS quote_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS quote_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS quote_decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS quote_decision_meta jsonb,
  ADD COLUMN IF NOT EXISTS intake_signature_url text,
  ADD COLUMN IF NOT EXISTS intake_signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS portal_last_opened_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tickets_portal_token_key') THEN
    ALTER TABLE public.tickets
      ADD CONSTRAINT tickets_portal_token_key UNIQUE (portal_token);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tickets_quote_status_check') THEN
    ALTER TABLE public.tickets
      ADD CONSTRAINT tickets_quote_status_check
      CHECK (quote_status IN ('none', 'sent', 'approved', 'rejected'));
  END IF;
END $$;

-- UNIQUE constraint index už existuje; tenhle partial index je pro lookup
-- z edge funkce (drtivá většina zakázek token nemá → menší index).
CREATE INDEX IF NOT EXISTS idx_tickets_portal_token
  ON public.tickets(portal_token)
  WHERE portal_token IS NOT NULL;

COMMENT ON COLUMN public.tickets.portal_token IS 'Token odkazu pro zákaznický portál (web/z/?t=...). NULL = odkaz zatím nevygenerován.';
COMMENT ON COLUMN public.tickets.quote_amount IS 'Cenová nabídka poslaná zákazníkovi ke schválení (Kč).';
COMMENT ON COLUMN public.tickets.quote_note IS 'Poznámka k cenové nabídce (co se bude dělat, proč ta cena).';
COMMENT ON COLUMN public.tickets.quote_status IS 'none | sent | approved | rejected';
COMMENT ON COLUMN public.tickets.quote_sent_at IS 'Kdy servis nabídku odeslal.';
COMMENT ON COLUMN public.tickets.quote_decided_at IS 'Kdy zákazník na portálu rozhodl.';
COMMENT ON COLUMN public.tickets.quote_decision_meta IS 'Otisk rozhodnutí: { ip, userAgent, note } – pro případ sporu.';
COMMENT ON COLUMN public.tickets.intake_signature_url IS 'Veřejná URL PNG podpisu převzetí (bucket diagnostic-photos, složka signatures/).';
COMMENT ON COLUMN public.tickets.intake_signed_at IS 'Kdy zákazník podepsal převzetí na portálu.';
COMMENT ON COLUMN public.tickets.portal_last_opened_at IS 'Poslední otevření portálu zákazníkem.';

-- 2) Události portálu ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ticket_portal_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN (
    'opened', 'quote_approved', 'quote_rejected', 'signed', 'pickup_confirmed', 'link_sent', 'quote_sent'
  )),
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_portal_events_ticket_created
  ON public.ticket_portal_events(ticket_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ticket_portal_events_service_id
  ON public.ticket_portal_events(service_id);

COMMENT ON TABLE public.ticket_portal_events IS
  'Co se dělo na zákaznickém portálu (otevření, schválení nabídky, podpis, vyzvednutí) + co servis poslal (link_sent, quote_sent). Zapisuje edge funkce portal-ticket (service_role) a Jobi (link_sent, quote_sent).';

ALTER TABLE public.ticket_portal_events ENABLE ROW LEVEL SECURITY;

-- Členové servisu čtou a zapisují (link_sent / quote_sent z Jobi); mazat ani
-- upravovat záznamy nejde – je to audit. Zápisy z portálu obstará service_role.
DROP POLICY IF EXISTS "ticket_portal_events_select_service_members" ON public.ticket_portal_events;
CREATE POLICY "ticket_portal_events_select_service_members"
  ON public.ticket_portal_events
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = ticket_portal_events.service_id AND m.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "ticket_portal_events_insert_service_members" ON public.ticket_portal_events;
CREATE POLICY "ticket_portal_events_insert_service_members"
  ON public.ticket_portal_events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = ticket_portal_events.service_id AND m.user_id = auth.uid()
    )
  );

-- Realtime: Jobi si událost (schválení nabídky, podpis) zobrazí hned.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.ticket_portal_events;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE '%already member%' THEN RAISE; END IF;
END $$;

-- 3) RPC: založení / vrácení tokenu ------------------------------------------------
-- Volá Jobi při zobrazení tlačítka „Odkaz pro zákazníka“. Token se generuje jen
-- jednou (na zakázku), takže odkaz, který zákazník už dostal, zůstává platný.
-- 24 náhodných bajtů → base64 = 32 znaků, převedeno na URL-safe abecedu.
-- gen_random_bytes je z pgcrypto, na Supabase ve schématu extensions.
CREATE OR REPLACE FUNCTION public.ensure_portal_token(p_ticket_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_service_id uuid;
  v_token text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT service_id, portal_token
    INTO v_service_id, v_token
  FROM public.tickets
  WHERE id = p_ticket_id
    AND deleted_at IS NULL;

  IF v_service_id IS NULL THEN
    RAISE EXCEPTION 'Zakázka nenalezena' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.service_memberships m
    WHERE m.service_id = v_service_id AND m.user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Nemáte oprávnění k této zakázce' USING ERRCODE = '42501';
  END IF;

  IF v_token IS NOT NULL THEN
    RETURN v_token;
  END IF;

  -- Kolize je při 192 bitech prakticky vyloučená, ale UNIQUE constraint
  -- ji stejně chytí – v tom případě zkusíme znovu.
  LOOP
    v_token := translate(
      rtrim(encode(gen_random_bytes(24), 'base64'), '='),
      '+/', '-_'
    );
    BEGIN
      UPDATE public.tickets
         SET portal_token = v_token
       WHERE id = p_ticket_id
         AND portal_token IS NULL;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      NULL; -- zkusit jiný token
    END;
  END LOOP;

  -- Pokud mezitím token založil kolega (souběh), vrátíme ten jeho.
  SELECT portal_token INTO v_token FROM public.tickets WHERE id = p_ticket_id;
  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_portal_token(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_portal_token(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.ensure_portal_token(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_portal_token(uuid) TO service_role;

COMMENT ON FUNCTION public.ensure_portal_token(uuid) IS
  'Vrátí token zákaznického portálu pro zakázku; když ještě není, vygeneruje ho. Jen členové servisu.';

-- 4) Historie zakázky: portál nesmí dělat šum ------------------------------------
-- Každé otevření portálu aktualizuje portal_last_opened_at, a trigger
-- ticket_history_log (20260220000000) by na to zapsal řádek „updated“
-- s prázdným diffem. Přidáváme jedinou podmínku: když se nezměnilo nic
-- sledovaného a hnul se jen portal_last_opened_at, nic nelogovat.
-- Zbytek funkce je beze změny.
CREATE OR REPLACE FUNCTION public.ticket_history_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_action text;
  v_details jsonb := '{}'::jsonb;
  v_changes jsonb := '{}'::jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'created';
    v_details := jsonb_build_object(
      'title', COALESCE(NEW.title, ''),
      'changes', '{}'::jsonb
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      v_action := 'deleted';
      v_details := '{}'::jsonb;
    ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
      v_action := 'restored';
      v_details := '{}'::jsonb;
    ELSE
      v_action := 'updated';
      -- Build diff: only include columns that actually changed
      IF OLD.title IS DISTINCT FROM NEW.title THEN
        v_changes := v_changes || jsonb_build_object('title', jsonb_build_object('old', to_jsonb(OLD.title), 'new', to_jsonb(NEW.title)));
      END IF;
      IF OLD.status IS DISTINCT FROM NEW.status THEN
        v_changes := v_changes || jsonb_build_object('status', jsonb_build_object('old', to_jsonb(OLD.status), 'new', to_jsonb(NEW.status)));
      END IF;
      IF OLD.notes IS DISTINCT FROM NEW.notes THEN
        v_changes := v_changes || jsonb_build_object('notes', jsonb_build_object('old', to_jsonb(OLD.notes), 'new', to_jsonb(NEW.notes)));
      END IF;
      IF OLD.estimated_price IS DISTINCT FROM NEW.estimated_price THEN
        v_changes := v_changes || jsonb_build_object('estimated_price', jsonb_build_object('old', to_jsonb(OLD.estimated_price), 'new', to_jsonb(NEW.estimated_price)));
      END IF;
      IF OLD.performed_repairs IS DISTINCT FROM NEW.performed_repairs THEN
        v_changes := v_changes || jsonb_build_object('performed_repairs', jsonb_build_object('old', COALESCE(OLD.performed_repairs, '[]'::jsonb), 'new', COALESCE(NEW.performed_repairs, '[]'::jsonb)));
      END IF;
      IF OLD.diagnostic_text IS DISTINCT FROM NEW.diagnostic_text THEN
        v_changes := v_changes || jsonb_build_object('diagnostic_text', jsonb_build_object('old', to_jsonb(OLD.diagnostic_text), 'new', to_jsonb(NEW.diagnostic_text)));
      END IF;
      IF OLD.customer_name IS DISTINCT FROM NEW.customer_name THEN
        v_changes := v_changes || jsonb_build_object('customer_name', jsonb_build_object('old', to_jsonb(OLD.customer_name), 'new', to_jsonb(NEW.customer_name)));
      END IF;
      IF OLD.customer_phone IS DISTINCT FROM NEW.customer_phone THEN
        v_changes := v_changes || jsonb_build_object('customer_phone', jsonb_build_object('old', to_jsonb(OLD.customer_phone), 'new', to_jsonb(NEW.customer_phone)));
      END IF;
      IF OLD.customer_email IS DISTINCT FROM NEW.customer_email THEN
        v_changes := v_changes || jsonb_build_object('customer_email', jsonb_build_object('old', to_jsonb(OLD.customer_email), 'new', to_jsonb(NEW.customer_email)));
      END IF;
      IF OLD.device_label IS DISTINCT FROM NEW.device_label THEN
        v_changes := v_changes || jsonb_build_object('device_label', jsonb_build_object('old', to_jsonb(OLD.device_label), 'new', to_jsonb(NEW.device_label)));
      END IF;
      IF OLD.discount_type IS DISTINCT FROM NEW.discount_type OR OLD.discount_value IS DISTINCT FROM NEW.discount_value THEN
        v_changes := v_changes || jsonb_build_object(
          'discount',
          jsonb_build_object(
            'old', jsonb_build_object('type', to_jsonb(OLD.discount_type), 'value', to_jsonb(OLD.discount_value)),
            'new', jsonb_build_object('type', to_jsonb(NEW.discount_type), 'value', to_jsonb(NEW.discount_value))
          )
        );
      END IF;
      IF OLD.device_condition IS DISTINCT FROM NEW.device_condition THEN
        v_changes := v_changes || jsonb_build_object('device_condition', jsonb_build_object('old', to_jsonb(OLD.device_condition), 'new', to_jsonb(NEW.device_condition)));
      END IF;
      IF OLD.device_note IS DISTINCT FROM NEW.device_note THEN
        v_changes := v_changes || jsonb_build_object('device_note', jsonb_build_object('old', to_jsonb(OLD.device_note), 'new', to_jsonb(NEW.device_note)));
      END IF;

      -- Zákaznický portál: samotné otevření stránky ani založení tokenu
      -- do historie nepatří (odeslání odkazu loguje ticket_portal_events).
      IF v_changes = '{}'::jsonb
         AND (OLD.portal_last_opened_at IS DISTINCT FROM NEW.portal_last_opened_at
              OR OLD.portal_token IS DISTINCT FROM NEW.portal_token) THEN
        RETURN NEW;
      END IF;

      v_details := jsonb_build_object('changes', v_changes);
    END IF;
  ELSE
    RETURN NULL;
  END IF;

  INSERT INTO public.ticket_history (ticket_id, service_id, action, changed_by, details)
  VALUES (NEW.id, NEW.service_id, v_action, auth.uid(), v_details);
  RETURN COALESCE(NEW, OLD);
END;
$$;
