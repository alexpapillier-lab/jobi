-- Přehled obsazenosti pro Owner – Správa servisů.
--
-- Owner obrazovka dosud ukazovala počet členů, který si services-list
-- počítal sám: prosté sečtení řádků v service_memberships. To se
-- s limity předplatného rozchází ve dvou věcech naráz – nepočítá
-- nepřijaté pozvánky a naopak započítává root ownera, kdežto
-- service_seat_count() to má obráceně.
--
-- Owner by tedy viděl „3 členové" a servisu by se při zvaní čtvrtého
-- člověka hlásil vyčerpaný limit, protože někde visí pozvánka. Tahle
-- funkce ten rozpor odstraňuje tím, že seznam počítá týmiž funkcemi
-- jako kontrola při zvaní – ne vlastním dotazem.
--
-- Vrací všechny servisy včetně těch bez řádku v service_billing (LEFT
-- JOIN), aby se v Owner obrazovce neztratil servis, kterému by billing
-- z jakéhokoli důvodu chyběl. Takový případ je vidět jako plan_key NULL.

CREATE OR REPLACE FUNCTION public.service_seat_overview(p_exclude_user uuid DEFAULT NULL)
RETURNS TABLE (
  service_id uuid,
  seats integer,
  seat_limit integer,
  plan_key text,
  plan_name text,
  status text,
  current_period_end timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    s.id,
    public.service_seat_count(s.id, p_exclude_user),
    public.service_seat_limit(s.id),
    p.key,
    p.name,
    b.status,
    b.current_period_end
  FROM public.services s
  LEFT JOIN public.service_billing b ON b.service_id = s.id
  LEFT JOIN public.plans p ON p.id = b.plan_id;
$$;

COMMENT ON FUNCTION public.service_seat_overview(uuid) IS
  'Obsazenost a předplatné všech servisů pro Owner obrazovku. Počítá stejnými funkcemi jako kontrola při zvaní, aby čísla neseděla jinak. seat_limit NULL = bez omezení.';

-- Vrací data o VŠECH servisech, tedy jen pro root ownera přes edge
-- funkci pod service_role. Klient se k ní nesmí dostat ani na čtení –
-- stejný důvod jako u has_entitlement_lockdown.
REVOKE ALL ON FUNCTION public.service_seat_overview(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.service_seat_overview(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.service_seat_overview(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.service_seat_overview(uuid) TO service_role;
