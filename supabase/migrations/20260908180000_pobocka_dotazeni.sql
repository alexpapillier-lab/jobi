-- Omezení na pobočku – dotažení po bezpečnostní revizi 6. 9.
--
-- 1) Zápis (insert/update) do zakázek, reklamací a faktur vyžaduje u člena
--    s branch_only přímo jeho domovskou pobočku (dřív pustil i „bez pobočky“,
--    čímž šla zakázka zviditelnit všem). Reklamace a faktury mají i insert
--    a delete pod restrikcí.
-- 2) Historie zakázky, komentáře a úseky práce se čtou jen k zakázkám, které
--    člověk vidí – přes historii šel jinak přečíst obsah cizí pobočky.
-- 3) RPC change_ticket_status a ensure_portal_token kontrolují pobočku;
--    statistiky omezenému členovi vnutí jeho pobočku.
-- 4) Historie neukládá kód k odemknutí zařízení ani podpis.
-- 5) Úseky práce: update nesmí přesunout úsek na cizí zakázku; rezervace
--    mění a maže jen kdo smí upravovat zakázky.

create or replace function public.pobocka_povolena_zapis(p_service_id uuid, p_branch_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_role text;
  v_caps jsonb;
  v_home uuid;
begin
  if auth.uid() is null then
    return true;
  end if;
  select role, capabilities, home_branch_id into v_role, v_caps, v_home
    from public.service_memberships
   where service_id = p_service_id and user_id = auth.uid();
  if v_role is null then
    return false;
  end if;
  if v_role in ('owner', 'admin') then
    return true;
  end if;
  if coalesce(v_caps ->> 'branch_only', 'false') <> 'true' then
    return true;
  end if;
  -- Omezený člen zapisuje jen do své pobočky; bez domovské pobočky nezapisuje nikam.
  return v_home is not null and p_branch_id = v_home;
end;
$$;
revoke all on function public.pobocka_povolena_zapis(uuid, uuid) from public, anon;
grant execute on function public.pobocka_povolena_zapis(uuid, uuid) to authenticated, service_role;

-- Domovská pobočka, pokud je volající v některém ze servisů omezený; jinak null.
create or replace function public.vynucena_pobocka(p_service_ids uuid[])
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select m.home_branch_id
    from public.service_memberships m
   where m.user_id = auth.uid()
     and m.service_id = any(p_service_ids)
     and m.role not in ('owner', 'admin')
     and coalesce(m.capabilities ->> 'branch_only', 'false') = 'true'
     and m.home_branch_id is not null
   limit 1;
$$;
revoke all on function public.vynucena_pobocka(uuid[]) from public, anon;
grant execute on function public.vynucena_pobocka(uuid[]) to authenticated, service_role;

-- 1) zápis jen do vlastní pobočky
drop policy if exists "tickets_jen_vlastni_pobocka_zapis" on public.tickets;
create policy "tickets_jen_vlastni_pobocka_zapis" on public.tickets
  as restrictive for update to authenticated
  using (public.pobocka_povolena(service_id, branch_id))
  with check (public.pobocka_povolena_zapis(service_id, branch_id));
drop policy if exists "tickets_jen_vlastni_pobocka_vlozeni" on public.tickets;
create policy "tickets_jen_vlastni_pobocka_vlozeni" on public.tickets
  as restrictive for insert to authenticated
  with check (public.pobocka_povolena_zapis(service_id, branch_id));

drop policy if exists "warranty_claims_jen_vlastni_pobocka_zapis" on public.warranty_claims;
create policy "warranty_claims_jen_vlastni_pobocka_zapis" on public.warranty_claims
  as restrictive for update to authenticated
  using (public.pobocka_povolena(service_id, branch_id))
  with check (public.pobocka_povolena_zapis(service_id, branch_id));
create policy "warranty_claims_jen_vlastni_pobocka_vlozeni" on public.warranty_claims
  as restrictive for insert to authenticated
  with check (public.pobocka_povolena_zapis(service_id, branch_id));
create policy "warranty_claims_jen_vlastni_pobocka_mazani" on public.warranty_claims
  as restrictive for delete to authenticated
  using (public.pobocka_povolena(service_id, branch_id));

drop policy if exists "invoices_jen_vlastni_pobocka_zapis" on public.invoices;
create policy "invoices_jen_vlastni_pobocka_zapis" on public.invoices
  as restrictive for update to authenticated
  using (public.pobocka_povolena(service_id, branch_id))
  with check (public.pobocka_povolena_zapis(service_id, branch_id));
create policy "invoices_jen_vlastni_pobocka_vlozeni" on public.invoices
  as restrictive for insert to authenticated
  with check (public.pobocka_povolena_zapis(service_id, branch_id));
create policy "invoices_jen_vlastni_pobocka_mazani" on public.invoices
  as restrictive for delete to authenticated
  using (public.pobocka_povolena(service_id, branch_id));

-- 2) historie, komentáře a úseky jen k viditelným zakázkám (RLS zakázek se uplatní v poddotazu)
create policy "ticket_history_jen_viditelne_zakazky" on public.ticket_history
  as restrictive for select to authenticated
  using (exists (select 1 from public.tickets t where t.id = ticket_history.ticket_id));
create policy "ticket_comments_jen_viditelne_zakazky" on public.ticket_comments
  as restrictive for select to authenticated
  using (exists (select 1 from public.tickets t where t.id = ticket_comments.ticket_id));
create policy "work_sessions_jen_viditelne_zakazky" on public.ticket_work_sessions
  as restrictive for select to authenticated
  using (exists (select 1 from public.tickets t where t.id = ticket_work_sessions.ticket_id));

-- 5) úseky práce bez přesunu; rezervace jen s právem upravovat zakázky
drop policy if exists "work_sessions_update_own" on public.ticket_work_sessions;
create policy "work_sessions_update_own" on public.ticket_work_sessions
  for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.tickets t where t.id = ticket_work_sessions.ticket_id and t.service_id = ticket_work_sessions.service_id)
  );
create or replace function public.ticket_work_sessions_bez_presunu()
returns trigger language plpgsql as $$
begin
  if new.ticket_id <> old.ticket_id or new.service_id <> old.service_id or new.user_id <> old.user_id then
    raise exception 'Úsek práce nejde přesunout na jinou zakázku nebo člověka.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists ticket_work_sessions_bez_presunu on public.ticket_work_sessions;
create trigger ticket_work_sessions_bez_presunu before update on public.ticket_work_sessions
  for each row execute function public.ticket_work_sessions_bez_presunu();

drop policy if exists "bookings_update_members" on public.bookings;
create policy "bookings_update_members" on public.bookings
  for update to authenticated
  using (public.has_capability(service_id, auth.uid(), 'can_manage_tickets_basic'))
  with check (public.has_capability(service_id, auth.uid(), 'can_manage_tickets_basic'));
drop policy if exists "bookings_delete_members" on public.bookings;
create policy "bookings_delete_members" on public.bookings
  for delete to authenticated
  using (public.has_capability(service_id, auth.uid(), 'can_manage_tickets_basic'));

-- 3) RPC a statistiky
CREATE OR REPLACE FUNCTION public.change_ticket_status(
  p_ticket_id UUID,
  p_next TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket_service_id UUID;
  v_ticket_status TEXT;
  v_ticket_deleted_at TIMESTAMPTZ;
  v_user_role TEXT;
  v_user_id UUID;
  v_is_final BOOLEAN;
  v_branch_id UUID;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT service_id, status, deleted_at, branch_id
  INTO v_ticket_service_id, v_ticket_status, v_ticket_deleted_at, v_branch_id
  FROM public.tickets
  WHERE id = p_ticket_id;

  IF v_ticket_service_id IS NULL THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;

  IF v_ticket_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot change status of deleted ticket';
  END IF;

  SELECT role INTO v_user_role
  FROM public.service_memberships
  WHERE service_id = v_ticket_service_id
    AND user_id = v_user_id;

  IF v_user_role IS NULL THEN
    RAISE EXCEPTION 'Not authorized: User is not a member of this service';
  END IF;

  -- Člen omezený na pobočku nemění stav zakázek jiné pobočky (RLS by ho pustila jen přes id).
  IF NOT public.pobocka_povolena(v_ticket_service_id, v_branch_id) THEN
    RAISE EXCEPTION 'Not authorized: zakázka patří jiné pobočce' USING ERRCODE = '42501';
  END IF;

  IF v_user_role IN ('owner', 'admin') THEN
    NULL; -- proceed
  ELSIF v_user_role = 'member' THEN
    IF NOT public.has_capability(v_ticket_service_id, v_user_id, 'can_change_ticket_status') THEN
      RAISE EXCEPTION 'Not authorized: Member does not have can_change_ticket_status capability';
    END IF;
  ELSE
    RAISE EXCEPTION 'Not authorized: Invalid role';
  END IF;

  SELECT COALESCE(is_final, false) INTO v_is_final
  FROM public.service_statuses
  WHERE service_id = v_ticket_service_id AND key = p_next
  LIMIT 1;

  IF v_is_final THEN
    UPDATE public.tickets
    SET status = p_next, completed_at = now()
    WHERE id = p_ticket_id AND service_id = v_ticket_service_id;
  ELSE
    UPDATE public.tickets
    SET status = p_next
    WHERE id = p_ticket_id AND service_id = v_ticket_service_id;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found or update failed';
  END IF;
END;
$$;

create or replace function public.ensure_portal_token(p_ticket_id uuid)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_service_id uuid;
  v_token text;
  v_branch_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select service_id, portal_token, branch_id
    into v_service_id, v_token, v_branch_id
  from public.tickets
  where id = p_ticket_id
    and deleted_at is null;

  if v_service_id is null then
    raise exception 'Zakázka nenalezena' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.service_memberships m
    where m.service_id = v_service_id and m.user_id = v_uid
  ) then
    raise exception 'Nemáte oprávnění k této zakázce' using errcode = '42501';
  end if;
  if not public.pobocka_povolena(v_service_id, v_branch_id) then
    raise exception 'Zakázka patří jiné pobočce' using errcode = '42501';
  end if;

  if v_token is not null then
    return v_token;
  end if;

  perform set_config('app.portal_token_ticket', p_ticket_id::text, true);

  -- Kolize je při 192 bitech prakticky vyloučená, ale UNIQUE constraint
  -- ji stejně chytí – v tom případě zkusíme znovu.
  loop
    v_token := translate(
      rtrim(encode(gen_random_bytes(24), 'base64'), '='),
      '+/', '-_'
    );
    begin
      update public.tickets
         set portal_token = v_token
       where id = p_ticket_id
         and portal_token is null;
      exit;
    exception when unique_violation then
      null; -- zkusit jiný token
    end;
  end loop;

  -- Pokud mezitím token založil kolega (souběh), vrátíme ten jeho.
  select portal_token into v_token from public.tickets where id = p_ticket_id;
  return v_token;
end;
$$;

create or replace function public.statistiky_prehled(
  p_service_ids uuid[],
  p_od timestamptz default null,
  p_do timestamptz default null,
  p_branch_id uuid default null,
  p_drill_typ text default null,
  p_drill_hodnota text default null,
  p_drill_rok integer default null,
  p_drill_mesic integer default null,
  p_prev_od timestamptz default null,
  p_prev_do timestamptz default null,
  p_tz text default 'Europe/Prague'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_vysledek jsonb;
  v_tz text;
  v_drill text := coalesce(p_drill_typ, '');
  -- Tvar UUID; v JSONu položek jsou jen texty a špatný zápis by shodil přetypování.
  c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if p_service_ids is null or array_length(p_service_ids, 1) is null then
    raise exception 'Chybí servis.' using errcode = '22023';
  end if;

  -- Právo se kontroluje ručně: funkce je security definer, obchází RLS a
  -- nesmí prozradit čísla ze servisu, do kterého volající nepatří.
  if (
    select count(distinct s.id)
    from unnest(p_service_ids) s(id)
    where exists (
      select 1 from public.service_memberships m
      where m.service_id = s.id and m.user_id = auth.uid()
    )
  ) <> (select count(distinct x) from unnest(p_service_ids) x) then
    raise exception 'Nemáte přístup k některému z vybraných servisů.' using errcode = '42501';
  end if;

  -- Člen omezený na pobočku dostane vždy jen svou pobočku, ať si pošle cokoli.
  p_branch_id := coalesce(public.vynucena_pobocka(p_service_ids), p_branch_id);

  -- Neznámé pásmo by shodilo celý dotaz; radši spočítat měsíce v našem čase.
  v_tz := case
    when p_tz is not null and exists (select 1 from pg_timezone_names n where n.name = p_tz) then p_tz
    else 'Europe/Prague'
  end;

  with zakazky as (
    select
      t.id,
      t.service_id,
      t.branch_id,
      t.created_at,
      t.completed_at,
      -- Stejné náhrady jako mapování v Orders.tsx: prázdný stav je „received“,
      -- prázdný název zařízení „Nová zakázka“.
      coalesce(nullif(t.status, ''), 'received') as stav,
      coalesce(nullif(t.title, ''), 'Nová zakázka') as zarizeni,
      t.discount_type,
      coalesce(t.discount_value, 0) as sleva_hodnota,
      case when jsonb_typeof(t.performed_repairs) = 'array' then t.performed_repairs else '[]'::jsonb end as opravy,
      ((p_od is null or t.created_at >= p_od) and (p_do is null or t.created_at <= p_do)) as je_aktualni
    from public.tickets t
    where t.service_id = any(p_service_ids)
      and t.deleted_at is null
      -- Pobočka z lišty: zakázky bez pobočky vidí každá pobočka (shodně s filterByBranch).
      and (p_branch_id is null or t.branch_id is null or t.branch_id = p_branch_id)
      and (
        ((p_od is null or t.created_at >= p_od) and (p_do is null or t.created_at <= p_do))
        or (p_prev_od is not null and p_prev_do is not null and t.created_at >= p_prev_od and t.created_at <= p_prev_do)
      )
  ),
  polozky as (
    select
      z.id as zakazka_id,
      e.ord,
      coalesce(e.polozka ->> 'name', '') as nazev,
      case when jsonb_typeof(e.polozka -> 'price') = 'number' then (e.polozka ->> 'price')::numeric else 0 end as prijem,
      case when jsonb_typeof(e.polozka -> 'costs') = 'number' then (e.polozka ->> 'costs')::numeric end as vlastni_naklad,
      case when (e.polozka ->> 'repairId') ~* c_uuid then (e.polozka ->> 'repairId')::uuid end as repair_id,
      case when jsonb_typeof(e.polozka -> 'productIds') = 'array' then e.polozka -> 'productIds' end as vlastni_dily
    from zakazky z
    cross join lateral jsonb_array_elements(z.opravy) with ordinality e(polozka, ord)
  ),
  polozky_cenik as (
    select
      p.zakazka_id,
      p.ord,
      p.nazev,
      p.prijem,
      p.repair_id,
      -- Vlastní náklad má přednost před ceníkem; teprve když není ani jeden,
      -- zůstane null a položka se počítá jako „bez nákladů“.
      coalesce(p.vlastni_naklad, r.costs) as naklad_prace,
      coalesce(
        p.vlastni_dily,
        case when jsonb_typeof(r.product_ids) = 'array' and jsonb_array_length(r.product_ids) > 0 then r.product_ids end,
        '[]'::jsonb
      ) as dily
    from polozky p
    left join public.repairs r on r.id = p.repair_id and r.service_id = any(p_service_ids)
  ),
  dily as (
    select
      pc.zakazka_id,
      pc.ord,
      coalesce(sum(ip.purchase_price), 0) as cena_dilu,
      count(ip.id) as dilu_s_cenou,
      count(*) - count(ip.id) as dilu_bez_ceny
    from polozky_cenik pc
    cross join lateral jsonb_array_elements_text(pc.dily) d(pid)
    left join public.inventory_products ip
      on ip.id = (case when d.pid ~* c_uuid then d.pid::uuid end)
     and ip.service_id = any(p_service_ids)
     and ip.purchase_price is not null
    group by pc.zakazka_id, pc.ord
  ),
  polozky_vysledek as (
    select
      pc.zakazka_id,
      pc.ord,
      pc.nazev,
      pc.repair_id,
      pc.prijem,
      coalesce(pc.naklad_prace, 0) + coalesce(d.cena_dilu, 0) as naklad,
      (pc.naklad_prace is not null or coalesce(d.dilu_s_cenou, 0) > 0) as ma_zdroj_nakladu,
      coalesce(d.dilu_bez_ceny, 0) > 0 as chybi_nakupni_cena
    from polozky_cenik pc
    left join dily d on d.zakazka_id = pc.zakazka_id and d.ord = pc.ord
  ),
  zakazky_soucty as (
    select
      z.id,
      z.service_id,
      z.branch_id,
      z.created_at,
      z.completed_at,
      z.stav,
      z.zarizeni,
      z.je_aktualni,
      z.discount_type,
      z.sleva_hodnota,
      coalesce(sum(pv.prijem), 0) as hruby,
      coalesce(sum(pv.naklad), 0) as naklad,
      count(pv.ord) as polozek,
      count(*) filter (where pv.ord is not null and not pv.ma_zdroj_nakladu) as bez_nakladu,
      count(*) filter (where pv.chybi_nakupni_cena) as bez_ceny_dilu
    from zakazky z
    left join polozky_vysledek pv on pv.zakazka_id = z.id
    group by z.id, z.service_id, z.branch_id, z.created_at, z.completed_at,
             z.stav, z.zarizeni, z.je_aktualni, z.discount_type, z.sleva_hodnota
  ),
  zakazky_drill as (
    select
      zs.id,
      zs.service_id,
      zs.branch_id,
      zs.created_at,
      zs.completed_at,
      zs.stav,
      zs.zarizeni,
      zs.je_aktualni,
      zs.hruby,
      zs.naklad,
      zs.polozek,
      zs.bez_nakladu,
      zs.bez_ceny_dilu,
      s.sleva,
      greatest(0, zs.hruby - s.sleva) as prijem,
      zs.hruby - zs.naklad - s.sleva as marze,
      extract(year from zs.created_at at time zone v_tz)::int as rok,
      extract(month from zs.created_at at time zone v_tz)::int - 1 as mesic,
      case
        when v_drill = '' then true
        when v_drill = 'status' then zs.stav = p_drill_hodnota
        when v_drill = 'device' then zs.zarizeni = p_drill_hodnota
        when v_drill = 'month' then extract(year from zs.created_at at time zone v_tz)::int = p_drill_rok
                                and extract(month from zs.created_at at time zone v_tz)::int - 1 = p_drill_mesic
        when v_drill = 'repair' then exists (
          select 1 from polozky_vysledek pv where pv.zakazka_id = zs.id and pv.nazev = p_drill_hodnota
        )
        else true
      end as ve_vyberu
    from zakazky_soucty zs
    cross join lateral (
      select case
        when zs.discount_type = 'percentage' then zs.hruby * zs.sleva_hodnota / 100
        when zs.discount_type = 'amount' then zs.sleva_hodnota
        else 0
      end as sleva
    ) s
  ),
  -- Klíčová čísla za aktuální výběr (akt = true) a za předchozí období
  -- (akt = false; to se drill-downem nezužuje, porovnává se celé období).
  kpi_skupiny as (
    select
      (je_aktualni and ve_vyberu) as akt,
      count(*) as pocet,
      sum(prijem) as prijem,
      sum(naklad) as naklad,
      sum(sleva) as sleva,
      sum(marze) as marze,
      sum(bez_nakladu) as bez_nakladu,
      sum(bez_ceny_dilu) as bez_ceny_dilu,
      count(*) filter (where prijem > 0) as placenych,
      avg(extract(epoch from (completed_at - created_at)) / 86400.0)
        filter (where completed_at is not null and completed_at > created_at) as doba
    from zakazky_drill
    where (je_aktualni and ve_vyberu) or not je_aktualni
    group by 1
  ),
  -- Zaokrouhlení není kosmetika: podíl dvou numericů má v Postgresu i dvacet
  -- desetinných míst a odpověď by kvůli nim byla o desítky kilobajtů delší.
  kpi as (
    select
      akt,
      jsonb_build_object(
        'totalTickets', pocet,
        'totalRevenue', round(coalesce(prijem, 0), 2),
        'totalCosts', round(coalesce(naklad, 0), 2),
        'totalDiscounts', round(coalesce(sleva, 0), 2),
        'profit', round(coalesce(marze, 0), 2),
        'marginPct', round((case when coalesce(prijem, 0) > 0 then coalesce(marze, 0) / prijem * 100 else 0 end)::numeric, 4),
        'entriesWithoutCost', coalesce(bez_nakladu, 0),
        'entriesMissingPurchasePrice', coalesce(bez_ceny_dilu, 0),
        'averageTicketPrice', round((case when placenych > 0 then coalesce(prijem, 0) / placenych else 0 end)::numeric, 2),
        'averageTicketDurationDays', round(coalesce(doba, 0)::numeric, 4)
      ) as data
    from kpi_skupiny
  ),
  prazdne_kpi as (
    select jsonb_build_object(
      'totalTickets', 0, 'totalRevenue', 0, 'totalCosts', 0, 'totalDiscounts', 0,
      'profit', 0, 'marginPct', 0, 'entriesWithoutCost', 0, 'entriesMissingPurchasePrice', 0,
      'averageTicketPrice', 0, 'averageTicketDurationDays', 0
    ) as data
  )
  select jsonb_build_object(
    'kpi', coalesce((select data from kpi where akt), (select data from prazdne_kpi)),
    'kpiPredchozi', coalesce((select data from kpi where not akt), (select data from prazdne_kpi)),
    'pocetVObdobi', (select count(*) from zakazky_drill where je_aktualni),
    'pocetVeVyberu', (select count(*) from zakazky_drill where je_aktualni and ve_vyberu),
    'pocetPredchozi', (select count(*) from zakazky_drill where not je_aktualni),

    'stavy', (
      select coalesce(jsonb_agg(jsonb_build_object('key', x.stav, 'count', x.pocet) order by x.pocet desc, x.stav), '[]'::jsonb)
      from (
        select stav, count(*) as pocet
        from zakazky_drill
        where je_aktualni and (v_drill = 'status' or ve_vyberu)
        group by stav
      ) x
    ),

    'topOpravy', (
      select coalesce(jsonb_agg(jsonb_build_object('name', x.nazev, 'count', x.pocet) order by x.pocet desc, x.nazev), '[]'::jsonb)
      from (
        select pv.nazev, count(*) as pocet
        from polozky_vysledek pv
        join zakazky_drill zd on zd.id = pv.zakazka_id
        where zd.je_aktualni and (v_drill = 'repair' or zd.ve_vyberu)
        group by pv.nazev
        order by count(*) desc, pv.nazev
        limit 5
      ) x
    ),

    'topZarizeni', (
      select coalesce(jsonb_agg(jsonb_build_object('name', x.zarizeni, 'count', x.pocet) order by x.pocet desc, x.zarizeni), '[]'::jsonb)
      from (
        select zarizeni, count(*) as pocet
        from zakazky_drill
        where je_aktualni and (v_drill = 'device' or ve_vyberu)
        group by zarizeni
        order by count(*) desc, zarizeni
        limit 5
      ) x
    ),

    -- Marže podle oprav se počítá z položek, ne ze zakázek: sleva zakázky se
    -- mezi opravy rozdělit nedá, proto v ní není (stejně jako v prohlížeči).
    'marzeOpravy', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'key', x.klic, 'name', x.nazev, 'count', x.pocet,
        'revenue', round(x.prijem, 2), 'cost', round(x.naklad, 2), 'margin', round(x.prijem - x.naklad, 2),
        'marginPct', round((case when x.prijem > 0 then (x.prijem - x.naklad) / x.prijem * 100 else 0 end)::numeric, 4),
        'noCostData', x.se_zdrojem = 0
      ) order by x.prijem - x.naklad desc, x.pocet desc), '[]'::jsonb)
      from (
        select
          case when pv.repair_id is not null then 'id:' || pv.repair_id::text else 'name:' || pv.nazev end as klic,
          -- Ceníková oprava se mohla přejmenovat: platí název z nejnovější zakázky.
          (array_agg(pv.nazev order by zd.created_at desc, zd.id))[1] as nazev,
          count(*) as pocet,
          sum(pv.prijem) as prijem,
          sum(pv.naklad) as naklad,
          count(*) filter (where pv.ma_zdroj_nakladu) as se_zdrojem
        from polozky_vysledek pv
        join zakazky_drill zd on zd.id = pv.zakazka_id
        where zd.je_aktualni and (v_drill = 'repair' or zd.ve_vyberu)
        group by 1
      ) x
    ),

    'marzeZarizeni', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'key', x.zarizeni, 'name', x.zarizeni, 'count', x.pocet,
        'revenue', round(x.prijem, 2), 'cost', round(x.naklad, 2), 'margin', round(x.marze, 2),
        'marginPct', round((case when x.prijem > 0 then x.marze / x.prijem * 100 else 0 end)::numeric, 4),
        'noCostData', x.se_zdrojem = 0
      ) order by x.marze desc, x.pocet desc), '[]'::jsonb)
      from (
        select
          zarizeni,
          count(*) as pocet,
          sum(prijem) as prijem,
          sum(naklad) as naklad,
          sum(marze) as marze,
          count(*) filter (where polozek - bez_nakladu > 0) as se_zdrojem
        from zakazky_drill
        where je_aktualni and (v_drill = 'device' or ve_vyberu)
        group by zarizeni
      ) x
    ),

    -- Pobočky a servisy vedle sebe: název doplní stránka, tady jde jen o čísla.
    'marzePobocky', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'key', x.klic, 'count', x.pocet,
        'revenue', round(x.prijem, 2), 'cost', round(x.naklad, 2), 'margin', round(x.marze, 2),
        'marginPct', round((case when x.prijem > 0 then x.marze / x.prijem * 100 else 0 end)::numeric, 4),
        'noCostData', x.se_zdrojem = 0
      ) order by x.prijem desc), '[]'::jsonb)
      from (
        select
          coalesce(branch_id::text, '') as klic,
          count(*) as pocet,
          sum(prijem) as prijem,
          sum(naklad) as naklad,
          sum(marze) as marze,
          count(*) filter (where polozek - bez_nakladu > 0) as se_zdrojem
        from zakazky_drill
        where je_aktualni and ve_vyberu
        group by 1
      ) x
    ),

    'marzeServisy', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'key', x.klic, 'count', x.pocet,
        'revenue', round(x.prijem, 2), 'cost', round(x.naklad, 2), 'margin', round(x.marze, 2),
        'marginPct', round((case when x.prijem > 0 then x.marze / x.prijem * 100 else 0 end)::numeric, 4),
        'noCostData', x.se_zdrojem = 0
      ) order by x.prijem desc), '[]'::jsonb)
      from (
        select
          coalesce(service_id::text, '') as klic,
          count(*) as pocet,
          sum(prijem) as prijem,
          sum(naklad) as naklad,
          sum(marze) as marze,
          count(*) filter (where polozek - bez_nakladu > 0) as se_zdrojem
        from zakazky_drill
        where je_aktualni and ve_vyberu
        group by 1
      ) x
    ),

    -- Měsíce jen s daty; prázdné měsíce mezi nimi dokreslí stránka podle
    -- `mesicOd` / `mesicDo` a vybraného období.
    'mesice', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'year', x.rok, 'monthIndex', x.mesic, 'count', x.pocet, 'revenue', round(x.prijem, 2), 'margin', round(x.marze, 2)
      ) order by x.rok, x.mesic), '[]'::jsonb)
      from (
        select rok, mesic, count(*) as pocet, sum(prijem) as prijem, sum(marze) as marze
        from zakazky_drill
        where je_aktualni and (v_drill = 'month' or ve_vyberu)
        group by rok, mesic
      ) x
    ),
    'mesicOd', (select min(created_at) from zakazky_drill where je_aktualni and (v_drill = 'month' or ve_vyberu)),
    'mesicDo', (select max(created_at) from zakazky_drill where je_aktualni and (v_drill = 'month' or ve_vyberu))
  )
  into v_vysledek;

  return v_vysledek;
end;
$$;

create or replace function public.statistiky_technici(
  p_service_ids uuid[],
  p_od timestamptz default null,
  p_do timestamptz default null,
  p_branch_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_vysledek jsonb;
begin
  if p_service_ids is null or array_length(p_service_ids, 1) is null then
    raise exception 'Chybí servis.' using errcode = '22023';
  end if;
  if (
    select count(distinct s.id)
    from unnest(p_service_ids) s(id)
    where exists (select 1 from public.service_memberships m where m.service_id = s.id and m.user_id = auth.uid())
  ) <> (select count(distinct x) from unnest(p_service_ids) x) then
    raise exception 'Nemáte přístup k některému z vybraných servisů.' using errcode = '42501';
  end if;
  p_branch_id := coalesce(public.vynucena_pobocka(p_service_ids), p_branch_id);

  with historie as (
    select h.changed_by as user_id,
           h.action,
           h.details -> 'changes' -> 'status' ->> 'new' as novy_stav,
           t.service_id
    from public.ticket_history h
    join public.tickets t on t.id = h.ticket_id
    where t.service_id = any(p_service_ids)
      and t.deleted_at is null
      and h.changed_by is not null
      and (p_branch_id is null or t.branch_id = p_branch_id)
      and (p_od is null or h.created_at >= p_od)
      and (p_do is null or h.created_at <= p_do)
  ),
  podle_uzivatele as (
    select
      h.user_id,
      count(*) filter (where h.action = 'created') as prijato,
      count(*) filter (
        where h.action = 'updated' and h.novy_stav is not null
          and exists (select 1 from public.service_statuses s where s.service_id = h.service_id and s.key = h.novy_stav and s.is_final)
      ) as dokonceno
    from historie h
    group by h.user_id
  ),
  odpracovano as (
    select w.user_id,
           sum(extract(epoch from (coalesce(w.ended_at, now()) - w.started_at))) / 3600.0 as hodiny
    from public.ticket_work_sessions w
    join public.tickets t on t.id = w.ticket_id
    where w.service_id = any(p_service_ids)
      and t.deleted_at is null
      and (p_branch_id is null or t.branch_id = p_branch_id)
      and (p_od is null or w.started_at >= p_od)
      and (p_do is null or w.started_at <= p_do)
    group by w.user_id
  ),
  uzivatele as (
    select coalesce(u.user_id, o.user_id) as user_id,
           coalesce(u.prijato, 0) as prijato,
           coalesce(u.dokonceno, 0) as dokonceno,
           coalesce(o.hodiny, 0) as odpracovano
    from podle_uzivatele u
    full outer join odpracovano o on o.user_id = u.user_id
  ),
  hodinova as (
    select
      lower(trim(r ->> 'technik')) as klic,
      max(trim(r ->> 'technik')) as jmeno,
      sum(coalesce((r ->> 'hodiny')::numeric, 0)) as hodiny,
      sum(coalesce((r ->> 'price')::numeric, 0)) as trzba
    from public.tickets t,
         jsonb_array_elements(case when jsonb_typeof(t.performed_repairs) = 'array' then t.performed_repairs else '[]'::jsonb end) r
    where t.service_id = any(p_service_ids)
      and t.deleted_at is null
      and (p_branch_id is null or t.branch_id = p_branch_id)
      and (p_od is null or t.created_at >= p_od)
      and (p_do is null or t.created_at <= p_do)
      and r ->> 'type' = 'hourly'
      and coalesce(trim(r ->> 'technik'), '') <> ''
    group by lower(trim(r ->> 'technik'))
  ),
  lide as (
    select u.user_id,
           coalesce(nullif(trim(p.nickname), ''), 'Bez přezdívky (' || left(u.user_id::text, 8) || ')') as jmeno,
           lower(coalesce(nullif(trim(p.nickname), ''), '')) as klic,
           u.prijato, u.dokonceno, u.odpracovano
    from uzivatele u
    left join public.profiles p on p.id = u.user_id
  ),
  spojeni as (
    select coalesce(l.jmeno, h.jmeno) as jmeno,
           l.user_id,
           coalesce(l.prijato, 0) as prijato,
           coalesce(l.dokonceno, 0) as dokonceno,
           coalesce(l.odpracovano, 0) as odpracovano,
           coalesce(h.hodiny, 0) as hodiny,
           coalesce(h.trzba, 0) as trzba
    from lide l
    full outer join hodinova h on h.klic <> '' and h.klic = l.klic
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'userId', s.user_id, 'name', s.jmeno, 'prijato', s.prijato, 'dokonceno', s.dokonceno,
    'odpracovanoHodin', round(s.odpracovano::numeric, 2),
    'hodiny', round(s.hodiny, 2), 'trzbaHodin', round(s.trzba, 2)
  ) order by s.dokonceno desc, s.prijato desc, s.odpracovano desc, s.hodiny desc, s.jmeno), '[]'::jsonb)
  into v_vysledek
  from spojeni s
  where s.prijato > 0 or s.dokonceno > 0 or s.hodiny > 0 or s.odpracovano > 0;

  return v_vysledek;
end;
$$;

-- 4) historie bez kódu zařízení a podpisu
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
  v_old jsonb;
  v_new jsonb;
  v_key text;
  c_skip constant text[] := array[
    'id', 'service_id', 'code', 'created_at', 'updated_at', 'version', 'deleted_at',
    'portal_token', 'portal_last_opened_at', 'discount_type', 'discount_value',
    -- Kód k odemknutí zařízení a podpis do historie nepatří: zůstaly by tam i po smazání ze zakázky.
    'device_passcode', 'intake_signature_url'
  ];
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'created';
    v_details := jsonb_build_object('title', COALESCE(NEW.title, ''), 'changes', '{}'::jsonb);
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      v_action := 'deleted';
    ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
      v_action := 'restored';
    ELSE
      v_action := 'updated';
      v_old := to_jsonb(OLD);
      v_new := to_jsonb(NEW);
      FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
        IF v_key = ANY (c_skip) THEN
          CONTINUE;
        END IF;
        IF v_old -> v_key IS DISTINCT FROM v_new -> v_key THEN
          IF v_key = 'performed_repairs' THEN
            v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_object(
              'old', COALESCE(v_old -> v_key, '[]'::jsonb), 'new', COALESCE(v_new -> v_key, '[]'::jsonb)));
          ELSE
            v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_object('old', v_old -> v_key, 'new', v_new -> v_key));
          END IF;
        END IF;
      END LOOP;
      IF OLD.discount_type IS DISTINCT FROM NEW.discount_type OR OLD.discount_value IS DISTINCT FROM NEW.discount_value THEN
        v_changes := v_changes || jsonb_build_object('discount', jsonb_build_object(
          'old', jsonb_build_object('type', to_jsonb(OLD.discount_type), 'value', to_jsonb(OLD.discount_value)),
          'new', jsonb_build_object('type', to_jsonb(NEW.discount_type), 'value', to_jsonb(NEW.discount_value))));
      END IF;
      -- Nic, co by člověka zajímalo (jen updated_at, version, portál) – bez záznamu.
      IF v_changes = '{}'::jsonb THEN
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
