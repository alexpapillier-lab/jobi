-- Stavebnice automatizací.
--
-- Pravidlo = spouštěč (trigger) + akce (action) + podmínky (conditions),
-- všechno jako jsonb, ať se dá přidat nový typ bez další migrace. Tvary
-- jsou popsané v src/lib/automations.ts (Trigger / Action / Conditions) –
-- databáze hlídá jen typ spouštěče a akce, zbytek si sedí s aplikací.
--
-- Kdo pravidla vykonává:
--   * změna stavu / založení zakázky – Jobi zavolá edge funkci
--     automations-run s JWT uživatele hned po uložení,
--   * „ve stavu déle než“ a události portálu – pg_cron každých 15 minut
--     zavolá tutéž edge funkci přes pg_net s tajemstvím z Vaultu.
--
-- Každé spuštění se zapíše do automation_runs (ok / skipped / error) –
-- slouží jako log pro uživatele i jako zámek „už jednou proběhlo“.
--
-- Původní sms_automations zůstávají (Zakázky je ještě čtou), řádky se
-- jen zkopírují do nové tabulky pod deterministickým id, aby opakované
-- spuštění migrace nezaložilo duplicity.

-- 1) automation_rules ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.automation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  trigger jsonb NOT NULL,
  action jsonb NOT NULL,
  conditions jsonb NOT NULL DEFAULT '{"skip_final": true, "once_per_ticket": true}'::jsonb,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'automation_rules_trigger_type_check') THEN
    ALTER TABLE public.automation_rules
      ADD CONSTRAINT automation_rules_trigger_type_check
      CHECK (trigger->>'type' IN ('status_change', 'status_age', 'event', 'ticket_created'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'automation_rules_action_type_check') THEN
    ALTER TABLE public.automation_rules
      ADD CONSTRAINT automation_rules_action_type_check
      CHECK (action->>'type' IN ('sms', 'email', 'set_status', 'add_fee', 'notify'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_automation_rules_service_sort
  ON public.automation_rules(service_id, sort_order);

-- Edge funkce hledá aktivní pravidla podle typu spouštěče.
CREATE INDEX IF NOT EXISTS idx_automation_rules_service_trigger_type
  ON public.automation_rules(service_id, (trigger->>'type'))
  WHERE active;

COMMENT ON TABLE public.automation_rules IS
  'Pravidla „když X → udělej Y“ na servis. trigger/action/conditions viz src/lib/automations.ts. Vykonává edge funkce automations-run.';
COMMENT ON COLUMN public.automation_rules.trigger IS
  '{type: status_change, status_key} | {type: status_age, status_key, after_hours, repeat_hours?} | {type: event, event} | {type: ticket_created}';
COMMENT ON COLUMN public.automation_rules.action IS
  '{type: sms, template} | {type: email, subject, body} | {type: set_status, status_key} | {type: add_fee, name, amount, per_day?} | {type: notify, message}';
COMMENT ON COLUMN public.automation_rules.conditions IS
  '{skip_final?, once_per_ticket?, require_phone?, require_email?}';

-- updated_at – generický set_updated_at() z baseline
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_automation_rules_set_updated_at') THEN
    CREATE TRIGGER trg_automation_rules_set_updated_at
      BEFORE UPDATE ON public.automation_rules
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

ALTER TABLE public.automation_rules ENABLE ROW LEVEL SECURITY;

-- Členové čtou; zakládat, měnit a mazat smí jen owner/admin
-- (is_owner_or_admin(_service_id uuid) z baseline pracuje s auth.uid()).
DROP POLICY IF EXISTS "automation_rules_select_service_members" ON public.automation_rules;
CREATE POLICY "automation_rules_select_service_members"
  ON public.automation_rules
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = automation_rules.service_id AND m.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "automation_rules_insert_owner_admin" ON public.automation_rules;
CREATE POLICY "automation_rules_insert_owner_admin"
  ON public.automation_rules
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_owner_or_admin(service_id));

DROP POLICY IF EXISTS "automation_rules_update_owner_admin" ON public.automation_rules;
CREATE POLICY "automation_rules_update_owner_admin"
  ON public.automation_rules
  FOR UPDATE
  TO authenticated
  USING (public.is_owner_or_admin(service_id))
  WITH CHECK (public.is_owner_or_admin(service_id));

DROP POLICY IF EXISTS "automation_rules_delete_owner_admin" ON public.automation_rules;
CREATE POLICY "automation_rules_delete_owner_admin"
  ON public.automation_rules
  FOR DELETE
  TO authenticated
  USING (public.is_owner_or_admin(service_id));

-- Realtime: editor v Nastavení a nabídka akcí v Zakázkách se přepíšou hned.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.automation_rules;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE '%already member%' THEN RAISE; END IF;
END $$;

-- 2) automation_runs ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid REFERENCES public.automation_rules(id) ON DELETE CASCADE,
  ticket_id uuid REFERENCES public.tickets(id) ON DELETE SET NULL,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  ran_at timestamptz NOT NULL DEFAULT now(),
  result text NOT NULL CHECK (result IN ('ok', 'skipped', 'error')),
  detail text
);

CREATE INDEX IF NOT EXISTS idx_automation_runs_service_ran_at
  ON public.automation_runs(service_id, ran_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_runs_rule_ticket_ran_at
  ON public.automation_runs(rule_id, ticket_id, ran_at DESC);

COMMENT ON TABLE public.automation_runs IS
  'Log spuštění automatizací. Zapisuje výhradně edge funkce automations-run (service_role); slouží i jako zámek „jednou na zakázku“ a pro odstup opakování.';
COMMENT ON COLUMN public.automation_runs.detail IS
  'Proč se přeskočilo / chyba z Twilia či Resendu / u událostí portálu id události (dedupe).';

ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;

-- Jen čtení pro členy. Zápis nemá žádnou policy – klient se do logu nedostane.
DROP POLICY IF EXISTS "automation_runs_select_service_members" ON public.automation_runs;
CREATE POLICY "automation_runs_select_service_members"
  ON public.automation_runs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = automation_runs.service_id AND m.user_id = auth.uid()
    )
  );

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.automation_runs;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE '%already member%' THEN RAISE; END IF;
END $$;

-- 3) Převod sms_automations -----------------------------------------------------------
-- Deterministické id z původního řádku: při opakovaném spuštění se nic
-- nezdvojí. Původní tabulka zůstává, dokud ji Zakázky ještě čtou.
INSERT INTO public.automation_rules (id, service_id, name, active, trigger, action, conditions, sort_order, created_at)
SELECT
  md5('sms_automations:' || s.id::text)::uuid,
  s.service_id,
  'SMS při stavu ' || s.trigger_status_key,
  s.active,
  jsonb_build_object('type', 'status_change', 'status_key', s.trigger_status_key),
  jsonb_build_object('type', 'sms', 'template', COALESCE(s.message_template, '')),
  -- Stará SMS automatizace šla při každém přepnutí znovu; require_phone
  -- odpovídá tomu, že bez telefonu se dřív nic neposlalo.
  '{"skip_final": false, "once_per_ticket": false, "require_phone": true}'::jsonb,
  s.sort_order,
  COALESCE(s.created_at, now())
FROM public.sms_automations s
WHERE NOT EXISTS (
  SELECT 1 FROM public.automation_rules r
  WHERE r.id = md5('sms_automations:' || s.id::text)::uuid
);

-- 4) Tajemství pro plánovač -----------------------------------------------------------
-- Edge funkce automations-run běží bez JWT; plánovaný běh se ověřuje
-- sdíleným tajemstvím. To žije ve Vaultu (ne v kódu ani v migraci) a
-- funkce si ho přečte přes RPC pod service_role. Vault na Supabase je
-- schéma vault s vault.create_secret / vault.decrypted_secrets.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'vault') THEN
    RAISE NOTICE 'Vault není k dispozici – tajemství automations_cron_secret se nezaložilo. Zapni supabase_vault a spusť migraci znovu.';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'automations_cron_secret') THEN
    -- gen_random_bytes je z pgcrypto (schéma extensions) a v DO bloku
    -- nemusí být v search_path; dvě vestavěná gen_random_uuid() dají
    -- 64 hex znaků / ~244 bitů náhody bez závislosti na rozšíření.
    PERFORM vault.create_secret(
      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      'automations_cron_secret',
      'Sdílené tajemství pro plánované volání edge funkce automations-run (pg_cron → pg_net).'
    );
    RAISE NOTICE 'Založeno tajemství automations_cron_secret.';
  END IF;
EXCEPTION
  WHEN insufficient_privilege OR undefined_table OR undefined_function OR undefined_object THEN
    RAISE NOTICE 'Vault se nepodařilo použít (%). Tajemství automations_cron_secret založ ručně.', SQLERRM;
END $$;

CREATE OR REPLACE FUNCTION public.automations_cron_secret()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, vault, extensions
AS $$
DECLARE
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'automations_cron_secret'
  ORDER BY created_at DESC
  LIMIT 1;
  RETURN v_secret;
END;
$$;

REVOKE ALL ON FUNCTION public.automations_cron_secret() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.automations_cron_secret() FROM anon;
REVOKE ALL ON FUNCTION public.automations_cron_secret() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.automations_cron_secret() TO service_role;

COMMENT ON FUNCTION public.automations_cron_secret() IS
  'Vrátí tajemství automations_cron_secret z Vaultu. Jen service_role – edge funkce jím ověří plánované volání.';

-- 5) Tik plánovače ----------------------------------------------------------------------
-- Zavolá edge funkci přes pg_net. Funkce se založí vždy (plpgsql řeší
-- net.http_post až za běhu), chybějící rozšíření jen ohlásí.
CREATE OR REPLACE FUNCTION public.automations_tick()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_secret text;
  v_request_id bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'pg_net není zapnutý – automations_tick nemá jak zavolat edge funkci.';
    RETURN;
  END IF;

  v_secret := public.automations_cron_secret();
  IF v_secret IS NULL OR v_secret = '' THEN
    RAISE NOTICE 'Chybí tajemství automations_cron_secret ve Vaultu – tik se přeskočil.';
    RETURN;
  END IF;

  SELECT net.http_post(
    url := 'https://ijtvcgolsdsrquqbvjrz.supabase.co/functions/v1/automations-run',
    body := jsonb_build_object('mode', 'scheduled', 'secret', v_secret),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 60000
  ) INTO v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.automations_tick() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.automations_tick() FROM anon;
REVOKE ALL ON FUNCTION public.automations_tick() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.automations_tick() TO service_role;

COMMENT ON FUNCTION public.automations_tick() IS
  'Plánovaný tik: přes pg_net zavolá edge funkci automations-run v režimu scheduled. Spouští pg_cron (jobi-automations).';

-- pg_net: když je na projektu k dispozici, zapneme ho (remote_schema ho
-- kdysi shodila). Bez něj tik nic nepošle, ale nespadne.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net') THEN
    RAISE NOTICE 'pg_net není k dispozici – plánované automatizace nebudou volat edge funkci.';
    RETURN;
  END IF;
  CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_net se nepodařilo zapnout (%). Zapni ho v Supabase → Database → Extensions.', SQLERRM;
END $$;

-- 6) pg_cron každých 15 minut -------------------------------------------------------------
-- Stejný vzor jako úklid API (20260903180000): podmíněně, se stejným
-- názvem, ať opakovaná migrace nenadělá víc úloh.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron není k dispozici – automatizace „ve stavu déle než“ a události portálu se nenaplánovaly. Zapni ho v Supabase → Database → Extensions a spusť migraci znovu.';
    RETURN;
  END IF;

  CREATE EXTENSION IF NOT EXISTS pg_cron;

  PERFORM cron.unschedule('jobi-automations')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'jobi-automations');

  PERFORM cron.schedule(
    'jobi-automations',
    '*/15 * * * *',
    'SELECT public.automations_tick()'
  );

  RAISE NOTICE 'Automatizace naplánovány každých 15 minut (jobi-automations).';
EXCEPTION
  WHEN insufficient_privilege OR undefined_table OR undefined_function OR undefined_object THEN
    RAISE NOTICE 'pg_cron se nepodařilo nastavit (%). Tik automations_tick() je potřeba naplánovat ručně.', SQLERRM;
END $$;
