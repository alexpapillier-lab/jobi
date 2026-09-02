-- Centrální sběr chyb ze všech servisů.
--
-- Účel: majitel aplikace (root owner) potřebuje vidět, komu co nefunguje,
-- aniž by musel obvolávat servisy. Zvlášť po zavedení Windows verze, kde
-- zatím není odzkoušené, co se v provozu rozbije.
--
-- POZOR NA OSOBNÍ ÚDAJE: chybové hlášky se v aplikaci před odesláním čistí
-- (src/lib/errorLog.ts). Do `message` a `context` NESMÍ jít jména zákazníků,
-- telefony, IMEI ani texty diagnostiky – servisy jsou správci těch dat.
-- Ukládá se kód chyby, technická hláška a identifikátory (ticket_id apod.).

CREATE TABLE IF NOT EXISTS public.error_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid REFERENCES public.services(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Krátký strojový kód, podle kterého se chyby seskupují (např. "supabase.insert_ticket").
  code text NOT NULL,
  -- Technická hláška, už očištěná od osobních údajů.
  message text NOT NULL,
  stack text,
  -- Kde v aplikaci k tomu došlo (např. "Orders.createTicket").
  source text,
  -- Doplňkové technické údaje: ticket_id, http status apod. Žádná osobní data.
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  app_version text,
  -- "macos" | "windows" | "web"
  platform text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_error_logs_created_at ON public.error_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_service_id ON public.error_logs(service_id);
CREATE INDEX IF NOT EXISTS idx_error_logs_code ON public.error_logs(code);
CREATE INDEX IF NOT EXISTS idx_error_logs_platform ON public.error_logs(platform);

ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;

-- Zapisovat smí přihlášený uživatel, ale jen za servis, ve kterém je členem.
-- (service_id smí být NULL – chyba při přihlašování, kdy servis ještě neznáme.)
CREATE POLICY "error_logs_insert_own_service"
  ON public.error_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (
      service_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.service_memberships m
        WHERE m.service_id = error_logs.service_id AND m.user_id = auth.uid()
      )
    )
  );

-- Číst NESMÍ nikdo přes RLS. Admin přehled jde přes Edge Function
-- error-logs-list, která si ověří root ownera a čte přes service_role.
-- Stejný vzor jako u delete_service_for_root / services-list.
CREATE POLICY "error_logs_no_select"
  ON public.error_logs
  FOR SELECT
  TO authenticated
  USING (false);

COMMENT ON TABLE public.error_logs IS
  'Chyby z klientských aplikací napříč servisy. Čte jen root owner přes Edge Function. Bez osobních údajů zákazníků.';

-- Úklid: starší než 30 dní se maže. Držet víc nemá smysl a zbytečně
-- by to hromadilo data.
CREATE OR REPLACE FUNCTION public.purge_old_error_logs()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.error_logs WHERE created_at < now() - interval '30 days';
$$;

COMMENT ON FUNCTION public.purge_old_error_logs() IS
  'Smaže chybové logy starší 30 dní. Volat z Edge Function nebo pg_cron.';
