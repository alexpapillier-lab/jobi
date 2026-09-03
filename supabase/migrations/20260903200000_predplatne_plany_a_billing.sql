-- Základ předplatného: plány, doplňky, stav placení a log webhooků.
--
-- Do teď se platilo mimo aplikaci a nároky na moduly se udělovaly ručně
-- přes edge funkci entitlements-manage. Tahle migrace přidává vrstvu nad
-- tím: katalog toho, co se prodává, a evidenci toho, kdo co má zaplacené.
--
-- Zásadní je, že se NEMĚNÍ způsob, jak se moduly vyhodnocují. Jediné
-- místo pravdy o zaplacených modulech zůstává service_entitlements
-- a has_entitlement(). Předplatné do té tabulky jen automaticky zapisuje
-- místo majitele – stejná data, jiný pisatel. Díky tomu se nemusí sahat
-- na serverové kontroly v sms-send, sms-provision ani invoice-send-email.
--
-- Ceny jsou podle ceníku na webu (web/index.html):
--   Starter 590 / Business 1190 / Enterprise 2490 Kč, ročně −15 %.
--
-- Plán zavedení a rozhodnutí, ze kterých to vychází: docs/PREDPLATNE_PLAN.md

-- ---------------------------------------------------------------------
-- Obor servisu
--
-- Zatím má každý servis obor 'repair' (opravy elektroniky). Sloupec
-- vzniká takhle brzy schválně: doplnit ho později znamená migrovat
-- všechny existující servisy i plány, teď je zadarmo.
-- ---------------------------------------------------------------------

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS vertical text NOT NULL DEFAULT 'repair';

COMMENT ON COLUMN public.services.vertical IS
  'Obor servisu: repair (elektronika), bike, auto… Určuje názvosloví, výchozí statusy a sadu dokumentů.';

-- ---------------------------------------------------------------------
-- Katalog plánů
--
-- Ceny jsou v haléřích jako integer, ne v korunách jako numeric. Důvod:
-- Stripe pracuje se základní jednotkou měny a jakýkoli float u peněz je
-- zdroj zaokrouhlovacích chyb.
--
-- Plány jsou vedené zvlášť pro každý obor (UNIQUE na vertical + key).
-- Znamená to, že s každým novým oborem se sada plánů duplikuje – u dvou
-- tří oborů je to v pořádku a je to levnější než dodatečné dělení.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vertical text NOT NULL DEFAULT 'repair',
  -- Strojový klíč plánu: 'starter', 'business', 'enterprise', 'legacy'.
  key text NOT NULL,
  name text NOT NULL,
  -- V haléřích: 59000 = 590 Kč.
  price_monthly integer NOT NULL,
  price_yearly integer NOT NULL,
  -- NULL = bez omezení (stejná úmluva jako u valid_until v nárocích).
  max_members integer,
  -- Kolik míst navíc si smí plán dokoupit. NULL = bez omezení.
  max_extra_seats integer,
  trial_days integer NOT NULL DEFAULT 7,
  -- Nároky, které plán uděluje: ["invoices", "sms", …]. Musí sedět
  -- s ModuleName v src/hooks/useEntitlements.ts a s KNOWN_MODULES
  -- v entitlements-manage.
  modules jsonb NOT NULL DEFAULT '[]'::jsonb,
  stripe_price_id_monthly text,
  stripe_price_id_yearly text,
  -- false = plán se už nenabízí, ale stávající zákazníci na něm zůstávají.
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vertical, key)
);

COMMENT ON TABLE public.plans IS
  'Katalog prodávaných plánů. Ceny v haléřích. Zapisuje jen majitel aplikace přes edge funkci.';
COMMENT ON COLUMN public.plans.max_members IS
  'Kolik členů smí servis mít včetně ownera. NULL = bez omezení.';
COMMENT ON COLUMN public.plans.max_extra_seats IS
  'Kolik míst nad max_members si lze dokoupit. NULL = bez omezení. Na Starteru 2, aby dokupování míst nepodlezlo Business.';
COMMENT ON COLUMN public.plans.trial_days IS
  'Délka zkušební doby ve dnech. Sloupec (ne konstanta v kódu), aby šla změnit bez releasu.';

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

-- Ceník musí přečíst každý přihlášený – vybírá si z něj při registraci.
DROP POLICY IF EXISTS "plans_select_authenticated" ON public.plans;
CREATE POLICY "plans_select_authenticated"
  ON public.plans
  FOR SELECT
  TO authenticated
  USING (true);

-- Zapisovat nesmí přes RLS nikdo. Stejný vzor jako service_entitlements.
DROP POLICY IF EXISTS "plans_no_write" ON public.plans;
CREATE POLICY "plans_no_write"
  ON public.plans
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

-- ---------------------------------------------------------------------
-- Doplňky nad rámec plánu
--
-- Záměrně jen dva. Každý další doplněk násobí kombinace, které je potřeba
-- otestovat (plán × doplněk × obor), takže sem nepatří nic, co se dá dát
-- do plánu. SMS je výjimka oprávněná tím, že má skutečné variabilní
-- náklady (Twilio); místo navíc tím, že je to měkčí alternativa k upgradu.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.plan_addons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'sms' | 'seat'
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  price_monthly integer NOT NULL,
  price_yearly integer NOT NULL,
  -- Nárok, který doplněk uděluje. NULL u 'seat' – ten nezvyšuje moduly,
  -- ale limit členů.
  module text,
  stripe_price_id_monthly text,
  stripe_price_id_yearly text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.plan_addons IS
  'Placené doplňky k plánu. Ve Stripu jde o další položky téhož předplatného, ne o druhé předplatné.';

ALTER TABLE public.plan_addons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plan_addons_select_authenticated" ON public.plan_addons;
CREATE POLICY "plan_addons_select_authenticated"
  ON public.plan_addons
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "plan_addons_no_write" ON public.plan_addons;
CREATE POLICY "plan_addons_no_write"
  ON public.plan_addons
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

-- ---------------------------------------------------------------------
-- Stav placení servisu
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.service_billing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL UNIQUE REFERENCES public.services(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.plans(id),
  billing_period text NOT NULL DEFAULT 'monthly',
  status text NOT NULL DEFAULT 'trialing',
  stripe_customer_id text,
  stripe_subscription_id text UNIQUE,
  -- Konec zaplaceného období. Nárok v service_entitlements má valid_until
  -- o pár dní dál – viz odklad v stripe-webhook.
  current_period_end timestamptz,
  -- Zákazník vypověděl, ale období ještě běží.
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  -- Kolik míst navíc má servis zaplacených (doplněk 'seat').
  extra_seats integer NOT NULL DEFAULT 0,
  -- Individuální domluva mimo ceník. NULL = platí limit z plánu.
  max_members_override integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_billing_period_check
    CHECK (billing_period IN ('monthly', 'yearly')),
  CONSTRAINT service_billing_status_check
    CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'legacy')),
  CONSTRAINT service_billing_extra_seats_check
    CHECK (extra_seats >= 0)
);

CREATE INDEX IF NOT EXISTS idx_service_billing_service
  ON public.service_billing (service_id);
CREATE INDEX IF NOT EXISTS idx_service_billing_status
  ON public.service_billing (status);

COMMENT ON TABLE public.service_billing IS
  'Co má který servis předplacené. Zapisuje jen stripe-webhook přes service_role.';
COMMENT ON COLUMN public.service_billing.status IS
  'trialing | active | past_due | canceled | legacy. legacy = servis z doby před předplatným, mimo Stripe.';
COMMENT ON COLUMN public.service_billing.stripe_subscription_id IS
  'UNIQUE schválně: brání tomu, aby dvakrát doručený webhook založil dva servisy na jedno předplatné.';

ALTER TABLE public.service_billing ENABLE ROW LEVEL SECURITY;

-- Členové servisu vidí svůj stav (obrazovka Předplatné v Nastavení).
DROP POLICY IF EXISTS "service_billing_select_members" ON public.service_billing;
CREATE POLICY "service_billing_select_members"
  ON public.service_billing
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = service_billing.service_id
        AND m.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "service_billing_no_write" ON public.service_billing;
CREATE POLICY "service_billing_no_write"
  ON public.service_billing
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

-- ---------------------------------------------------------------------
-- Log webhooků
--
-- stripe_event_id UNIQUE je celá idempotence: webhook nejdřív zkusí
-- vložit řádek, a když nic nevloží, událost už proběhla a zpracování se
-- přeskočí. Bez toho vzniknou při opakovaném doručení dva servisy na
-- jednu platbu. Stripe opakované doručení nezaručeně vylučuje.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.billing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id text NOT NULL UNIQUE,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error text
);

CREATE INDEX IF NOT EXISTS idx_billing_events_type
  ON public.billing_events (type);
-- Nezpracované události – tady se hledá, když platba dorazila a nic se nestalo.
CREATE INDEX IF NOT EXISTS idx_billing_events_unprocessed
  ON public.billing_events (received_at)
  WHERE processed_at IS NULL;

COMMENT ON TABLE public.billing_events IS
  'Log webhooků od Stripe. stripe_event_id UNIQUE zajišťuje, že se událost zpracuje právě jednou.';

ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;

-- Payload obsahuje údaje o platbách. Klient sem nesmí vůbec, ani na čtení.
DROP POLICY IF EXISTS "billing_events_no_access" ON public.billing_events;
CREATE POLICY "billing_events_no_access"
  ON public.billing_events
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

-- ---------------------------------------------------------------------
-- Odlišení placených nároků od darovaných
--
-- Bez tohohle by webhook při změně plánu zrušil i nároky, které majitel
-- udělil ručně (kamarádský servis, kompenzace za výpadek). Webhook smí
-- sahat jen na řádky se source = 'subscription'.
--
-- Výchozí 'manual' je správně i pro existující řádky: všechny dosavadní
-- nároky opravdu udělil majitel ručně.
-- ---------------------------------------------------------------------

ALTER TABLE public.service_entitlements
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';

ALTER TABLE public.service_entitlements
  DROP CONSTRAINT IF EXISTS service_entitlements_source_check;
ALTER TABLE public.service_entitlements
  ADD CONSTRAINT service_entitlements_source_check
  CHECK (source IN ('manual', 'subscription', 'addon'));

COMMENT ON COLUMN public.service_entitlements.source IS
  'Odkud nárok pochází. subscription/addon spravuje stripe-webhook, manual uděluje majitel a webhook na něj nesahá.';

-- ---------------------------------------------------------------------
-- Obsazená místa
--
-- Počítají se členové I nepřijaté pozvánky. Kdyby se pozvánky
-- nepočítaly, dá se limit obejít tím, že se nechají viset – servis
-- pozve deset lidí a limit se projeví až při přijetí, kdy už je pozdě.
--
-- p_exclude_user je kvůli root ownerovi: ten je členem servisů, které
-- založil, ale místo zabírat nemá. Jeho UUID zná jen edge funkce
-- (proměnná ROOT_OWNER_ID), takže ho musí předat.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.service_seat_count(
  p_service_id uuid,
  p_exclude_user uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    (
      SELECT count(*)
      FROM public.service_memberships m
      WHERE m.service_id = p_service_id
        AND (p_exclude_user IS NULL OR m.user_id <> p_exclude_user)
    )
    +
    (
      SELECT count(*)
      FROM public.service_invites i
      WHERE i.service_id = p_service_id
        AND i.accepted_at IS NULL
        AND i.expires_at > now()
    );
$$;

COMMENT ON FUNCTION public.service_seat_count(uuid, uuid) IS
  'Kolik míst servis zabírá: členové + platné nepřijaté pozvánky. p_exclude_user vynechá root ownera.';

-- ---------------------------------------------------------------------
-- Kolik míst má servis k dispozici
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.service_seat_limit(p_service_id uuid)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT CASE
    -- Individuální domluva má přednost před ceníkem.
    WHEN b.max_members_override IS NOT NULL THEN b.max_members_override
    -- NULL v plánu = bez omezení; NULL se vrací dál a volající to musí umět.
    WHEN p.max_members IS NULL THEN NULL
    ELSE p.max_members + b.extra_seats
  END
  FROM public.service_billing b
  JOIN public.plans p ON p.id = b.plan_id
  WHERE b.service_id = p_service_id;
$$;

COMMENT ON FUNCTION public.service_seat_limit(uuid) IS
  'Kolik členů smí servis mít. NULL = bez omezení. POZOR: NULL vrací i servis bez řádku v service_billing – volající musí existenci předplatného ověřit zvlášť.';

-- ---------------------------------------------------------------------
-- Platí předplatné?
--
-- Vedle has_entitlement(), která odpovídá na "má servis tenhle modul".
-- Tahle odpovídá na "smí servis aplikaci vůbec používat" – podle toho se
-- zapíná read-only režim po vypršení.
--
-- past_due je schválně platný stav: karta selhala, Stripe to ještě
-- několik dní zkouší a zákazníka mezitím vypnout nechceme.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.has_active_subscription(p_service_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.service_billing b
    WHERE b.service_id = p_service_id
      AND b.status IN ('trialing', 'active', 'past_due', 'legacy')
  );
$$;

COMMENT ON FUNCTION public.has_active_subscription(uuid) IS
  'Smí servis aplikaci používat? past_due je záměrně platný – běží odklad. Volat jen ze serveru.';

-- Stejný důvod jako u has_entitlement_lockdown: anon klíč je vestavěný
-- v každé instalaci, takže bez tohohle by šlo zvenčí zjišťovat, který
-- servis platí a který ne. Klient čte stav ze service_billing přes RLS.
REVOKE ALL ON FUNCTION public.has_active_subscription(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_active_subscription(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.has_active_subscription(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.has_active_subscription(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.service_seat_count(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.service_seat_count(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.service_seat_count(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.service_seat_count(uuid, uuid) TO service_role;

-- service_seat_limit smí číst i klient – Tým a přístupy podle něj ukazuje
-- obsazenost. Neprozrazuje nic, co člen servisu nevidí ve svém předplatném.
REVOKE ALL ON FUNCTION public.service_seat_limit(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.service_seat_limit(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.service_seat_limit(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.service_seat_limit(uuid) TO service_role;

-- ---------------------------------------------------------------------
-- Naplnění ceníku
--
-- Ceny odpovídají web/index.html. Roční je −15 % (12 × měsíční × 0,85),
-- zaokrouhlené na celé koruny stejně jako na webu.
--
-- POZOR: modules u Enterprise zatím neobsahuje api_catalog ani
-- api_inventory. Veřejné API se na webu v ceníku vůbec neuvádí, takže
-- není rozhodnuté, do kterého plánu patří – doplnit, až padne.
-- ---------------------------------------------------------------------

INSERT INTO public.plans
  (vertical, key, name, price_monthly, price_yearly, max_members, max_extra_seats, trial_days, modules, sort_order)
VALUES
  ('repair', 'starter', 'Starter', 59000, 601200, 1, 2, 7,
   '["invoices"]'::jsonb, 1),
  ('repair', 'business', 'Business', 119000, 1213800, 6, NULL, 7,
   '["invoices", "sms"]'::jsonb, 2),
  ('repair', 'enterprise', 'Enterprise', 249000, 2539800, NULL, NULL, 7,
   '["invoices", "sms"]'::jsonb, 3)
ON CONFLICT (vertical, key) DO NOTHING;

-- Plán pro servisy z doby před předplatným. active = false, takže se
-- nikde nenabízí – slouží jen k tomu, aby i legacy servis měl řádek
-- v service_billing a nemusela se pro něj psát výjimka.
INSERT INTO public.plans
  (vertical, key, name, price_monthly, price_yearly, max_members, max_extra_seats, trial_days, modules, active, sort_order)
VALUES
  ('repair', 'legacy', 'Legacy (zdarma)', 0, 0, NULL, NULL, 0,
   '["invoices"]'::jsonb, false, 99)
ON CONFLICT (vertical, key) DO NOTHING;

INSERT INTO public.plan_addons (key, name, price_monthly, price_yearly, module)
VALUES
  ('sms', 'SMS modul', 19900, 202980, 'sms'),
  ('seat', 'Místo navíc', 9900, 100980, NULL)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------
-- Existující servisy
--
-- Všechny dosavadní servisy dostanou legacy plán bez limitů. Bez tohohle
-- kroku by se jim po nasazení kontrol začaly hlásit vyčerpaná místa,
-- přestože nikdy nic neporušily.
--
-- Nároky, které dnes mají (viz migrace 20260902200000), zůstávají beze
-- změny se source = 'manual' – webhook na ně nesahá.
-- ---------------------------------------------------------------------

INSERT INTO public.service_billing (service_id, plan_id, status, billing_period)
SELECT
  s.id,
  (SELECT p.id FROM public.plans p WHERE p.vertical = 'repair' AND p.key = 'legacy'),
  'legacy',
  'monthly'
FROM public.services s
ON CONFLICT (service_id) DO NOTHING;
