-- ============================================================================
-- Odměny týmu: prémie za nabídnuté opravy (servisní čištění, sklo, těsnění…)
-- ============================================================================
--
-- PROČ: Servis motivuje lidi na příjmu, aby zákazníkovi nabídli něco navíc –
-- kdo prodá servisní čištění, dostane 100 Kč, za aplikaci skla 50 Kč, za
-- těsnění 30 Kč. Dosud se to počítalo ručně ze zakázek. Tady je to
-- automaticky: pravidla si majitel nastaví (Nastavení → Tým → Odměny za
-- opravy), Jobi je přiloží na provedené opravy vydaných zakázek a stránka
-- Odměny ukáže, kdo má za měsíc kolik, kdo je zaměstnanec měsíce a co už
-- je vyplacené.
--
-- Pravidla žijí v service_settings.config.odmeny (jako slevy, rezervace…):
--   { pravidla: [{ id, nazev, hledat, typ: 'castka'|'procento', hodnota,
--                  komu: 'pridal'|'technik', aktivni }],
--     verejny_zebricek: true }
--   hledat  – text v názvu opravy (bez ohledu na velikost písmen), např.
--             „servisní čištění“ – jedno pravidlo tak platí pro všechny
--             modely v ceníku, kde se oprava jmenuje stejně.
--   komu    – 'pridal' = kdo opravu na zakázku přidal (nabídl ji);
--             'technik' = přidělený technik zakázky.
--
-- Komu se odměna připíše, když ji přidal „pridal“:
--   1) performed_repairs[].pridalUserId – aplikace ho od teď zapisuje,
--   2) jinak historie zakázky: první změna, ve které se položka objevila
--      (details.changes.performed_repairs.new obsahuje id, old ne),
--   3) jinak kdo zakázku založil (položka byla na zakázce od příjmu).
--   Majitel to může u řádku přepsat (odmeny_upravy.user_id) nebo řádek
--   vyřadit (vyrazeno).
--
-- Období = datum VYDÁNÍ zakázky (koncový stav, completed_at), stejně jako
-- peníze ve Statistikách: odměna vzniká, až když zákazník zaplatil, a
-- storno odměnu nedostane. Číslo za uzavřený měsíc se pak už nemění.
--
-- Vyplacení: odmeny_vyplaty – jeden řádek na člověka a měsíc (YYYY-MM),
-- zapisuje majitel/správce zaškrtnutím na stránce.
--
-- Kdo co vidí: majitel a správce všechno; člen svoje řádky vždy a cizí jen
-- když je zapnutý veřejný žebříček (výchozí ano – zaměstnanec měsíce má
-- být vidět).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Kdo je správce servisu (owner/admin) – pomocná funkce pro RLS a RPC
-- ---------------------------------------------------------------------------
create or replace function public.odmeny_je_spravce(p_service_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.service_memberships m
    where m.service_id = p_service_id and m.user_id = auth.uid() and m.role in ('owner', 'admin')
  );
$$;
revoke all on function public.odmeny_je_spravce(uuid) from public, anon;
grant execute on function public.odmeny_je_spravce(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Ruční úpravy: komu jinému, nebo vyřadit
-- ---------------------------------------------------------------------------
create table if not exists public.odmeny_upravy (
  service_id uuid not null references public.services(id) on delete cascade,
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  -- id položky v tickets.performed_repairs
  polozka_id text not null,
  -- komu se odměna připíše místo automatiky; null = automaticky
  user_id uuid references auth.users(id) on delete set null,
  vyrazeno boolean not null default false,
  poznamka text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (ticket_id, polozka_id)
);
create index if not exists odmeny_upravy_service_idx on public.odmeny_upravy (service_id);

alter table public.odmeny_upravy enable row level security;
drop policy if exists odmeny_upravy_cteni on public.odmeny_upravy;
create policy odmeny_upravy_cteni on public.odmeny_upravy
  for select to authenticated
  using (exists (select 1 from public.service_memberships m where m.service_id = odmeny_upravy.service_id and m.user_id = auth.uid()));
drop policy if exists odmeny_upravy_zapis on public.odmeny_upravy;
create policy odmeny_upravy_zapis on public.odmeny_upravy
  for all to authenticated
  using (public.odmeny_je_spravce(service_id))
  with check (public.odmeny_je_spravce(service_id));
revoke all on table public.odmeny_upravy from anon;
grant select, insert, update, delete on table public.odmeny_upravy to authenticated;
comment on table public.odmeny_upravy is
  'Odměny týmu: ruční přepsání příjemce nebo vyřazení jedné položky (zakázka + id opravy). Zapisuje majitel/správce.';

-- ---------------------------------------------------------------------------
-- 3) Vyplaceno: člověk × měsíc
-- ---------------------------------------------------------------------------
create table if not exists public.odmeny_vyplaty (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- „2026-09“
  obdobi text not null check (obdobi ~ '^[0-9]{4}-[0-9]{2}$'),
  castka numeric not null default 0,
  vyplaceno_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique (service_id, user_id, obdobi)
);

alter table public.odmeny_vyplaty enable row level security;
drop policy if exists odmeny_vyplaty_cteni on public.odmeny_vyplaty;
create policy odmeny_vyplaty_cteni on public.odmeny_vyplaty
  for select to authenticated
  using (user_id = auth.uid() or public.odmeny_je_spravce(service_id));
drop policy if exists odmeny_vyplaty_zapis on public.odmeny_vyplaty;
create policy odmeny_vyplaty_zapis on public.odmeny_vyplaty
  for all to authenticated
  using (public.odmeny_je_spravce(service_id))
  with check (public.odmeny_je_spravce(service_id));
revoke all on table public.odmeny_vyplaty from anon;
grant select, insert, update, delete on table public.odmeny_vyplaty to authenticated;
comment on table public.odmeny_vyplaty is
  'Odměny týmu: vyplaceno za člověka a měsíc (YYYY-MM). Zapisuje majitel/správce zaškrtnutím na stránce Odměny.';

-- ---------------------------------------------------------------------------
-- 4) Přehled: řádky za období, součty na člověka, měsíce zpět, vyplaceno
-- ---------------------------------------------------------------------------
create or replace function public.odmeny_prehled(
  p_service_id uuid,
  p_od timestamptz default null,
  p_do timestamptz default null,
  p_tz text default 'Europe/Prague'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_admin boolean;
  v_cfg jsonb;
  v_pravidla jsonb;
  v_verejny boolean;
  v_tz text;
  v_od timestamptz;
  v_do timestamptz;
  v_od12 timestamptz;
  v_vysledek jsonb;
  c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if v_uid is null or not exists (
    select 1 from public.service_memberships m where m.service_id = p_service_id and m.user_id = v_uid
  ) then
    raise exception 'Nemáte přístup k tomuto servisu.' using errcode = '42501';
  end if;
  v_admin := public.odmeny_je_spravce(p_service_id);

  select coalesce(s.config -> 'odmeny', '{}'::jsonb) into v_cfg
  from public.service_settings s where s.service_id = p_service_id;
  v_cfg := coalesce(v_cfg, '{}'::jsonb);
  v_pravidla := case when jsonb_typeof(v_cfg -> 'pravidla') = 'array' then v_cfg -> 'pravidla' else '[]'::jsonb end;
  v_verejny := coalesce((v_cfg ->> 'verejny_zebricek')::boolean, true);

  v_tz := case
    when p_tz is not null and exists (select 1 from pg_timezone_names n where n.name = p_tz) then p_tz
    else 'Europe/Prague'
  end;
  -- Bez období = tento měsíc.
  v_od := coalesce(p_od, date_trunc('month', now() at time zone v_tz) at time zone v_tz);
  v_do := coalesce(p_do, now());
  -- Měsíční řada: posledních 12 měsíců do konce vybraného období (nebo do teď).
  v_od12 := date_trunc('month', (greatest(v_do, now()) at time zone v_tz) - interval '11 months') at time zone v_tz;

  with pravidla as (
    select
      coalesce(nullif(r ->> 'id', ''), ord::text) as id,
      coalesce(nullif(btrim(r ->> 'nazev'), ''), r ->> 'hledat') as nazev,
      lower(btrim(r ->> 'hledat')) as hledat,
      case when r ->> 'typ' = 'procento' then 'procento' else 'castka' end as typ,
      coalesce(replace(r ->> 'hodnota', ',', '.')::numeric, 0) as hodnota,
      case when r ->> 'komu' = 'technik' then 'technik' else 'pridal' end as komu,
      ord
    from jsonb_array_elements(v_pravidla) with ordinality x(r, ord)
    where coalesce((r ->> 'aktivni')::boolean, true)
      and nullif(btrim(r ->> 'hledat'), '') is not null
      and (r ->> 'hodnota') ~ '^-?[0-9]+([.,][0-9]+)?$'
  ),
  -- Vydané zakázky (koncový stav, ne storno) – datum vydání jako ve Statistikách.
  zakazky as (
    select
      t.id,
      t.code,
      t.customer_name,
      coalesce(nullif(btrim(t.title), ''), t.device_label) as zarizeni,
      t.assigned_to,
      coalesce(t.completed_at, t.updated_at) as vydano_at,
      case when jsonb_typeof(t.performed_repairs) = 'array' then t.performed_repairs else '[]'::jsonb end as opravy
    from public.tickets t
    join public.service_statuses st
      on st.service_id = t.service_id and st.key = coalesce(nullif(t.status, ''), 'received')
    where t.service_id = p_service_id
      and t.deleted_at is null
      and st.is_final
      and not public.stav_je_storno(coalesce(nullif(t.status, ''), 'received'), st.label)
      and coalesce(t.completed_at, t.updated_at) >= least(v_od, v_od12)
      and coalesce(t.completed_at, t.updated_at) <= greatest(v_do, now())
  ),
  polozky as (
    select
      z.id as ticket_id,
      z.code,
      z.customer_name,
      z.zarizeni,
      z.assigned_to,
      z.vydano_at,
      coalesce(e.polozka ->> 'id', e.ord::text) as polozka_id,
      coalesce(e.polozka ->> 'name', '') as oprava,
      case when jsonb_typeof(e.polozka -> 'price') = 'number' then (e.polozka ->> 'price')::numeric else 0 end as cena,
      case when (e.polozka ->> 'pridalUserId') ~* c_uuid then (e.polozka ->> 'pridalUserId')::uuid end as pridal_uid
    from zakazky z
    cross join lateral jsonb_array_elements(z.opravy) with ordinality e(polozka, ord)
  ),
  -- Na položku nejvýš jedno pravidlo: první v pořadí, které sedí.
  shody as (
    select distinct on (p.ticket_id, p.polozka_id)
      p.*,
      r.id as pravidlo_id,
      r.nazev as pravidlo,
      r.komu,
      case when r.typ = 'procento' then round(p.cena * r.hodnota / 100, 2) else round(r.hodnota, 2) end as castka
    from polozky p
    join pravidla r on lower(p.oprava) like '%' || r.hledat || '%'
    order by p.ticket_id, p.polozka_id, r.ord
  ),
  prirazene as (
    select
      s.*,
      coalesce(u.vyrazeno, false) as vyrazeno,
      u.user_id is not null as prepsano,
      u.poznamka,
      case
        when u.user_id is not null then u.user_id
        when s.komu = 'technik' then s.assigned_to
        else coalesce(
          s.pridal_uid,
          -- Historie: první změna, kde se položka objevila (v „new“ je, v „old“ není).
          (select h.changed_by from public.ticket_history h
            where h.ticket_id = s.ticket_id and h.action = 'updated'
              and (h.details #> '{changes,performed_repairs,new}') @> jsonb_build_array(jsonb_build_object('id', s.polozka_id))
              and not coalesce((h.details #> '{changes,performed_repairs,old}') @> jsonb_build_array(jsonb_build_object('id', s.polozka_id)), false)
            order by h.created_at
            limit 1),
          -- Položka je na zakázce od příjmu: kdo zakázku založil.
          (select h.changed_by from public.ticket_history h
            where h.ticket_id = s.ticket_id and h.action = 'created'
            order by h.created_at
            limit 1)
        )
      end as komu_uid
    from shody s
    left join public.odmeny_upravy u on u.ticket_id = s.ticket_id and u.polozka_id = s.polozka_id
  ),
  -- Co smí volající vidět: správce vše, člen svoje, cizí jen s veřejným žebříčkem.
  viditelne as (
    select * from prirazene p
    where v_admin or p.komu_uid = v_uid or v_verejny
  ),
  v_obdobi as (
    select * from viditelne where vydano_at >= v_od and vydano_at <= v_do
  ),
  jmena as (
    select m.user_id, coalesce(nullif(btrim(pr.nickname), ''), 'Kolega') as jmeno, pr.avatar_url
    from public.service_memberships m
    left join public.profiles pr on pr.id = m.user_id
    where m.service_id = p_service_id
  )
  select jsonb_build_object(
    'zapnuto', exists (select 1 from pravidla),
    'verejny', v_verejny,
    'admin', v_admin,
    'ja', v_uid,
    'od', v_od,
    'do', v_do,
    'radky', coalesce((
      select jsonb_agg(jsonb_build_object(
        'ticketId', o.ticket_id, 'kod', o.code, 'zakaznik', o.customer_name, 'zarizeni', o.zarizeni,
        'polozkaId', o.polozka_id, 'oprava', o.oprava, 'cena', o.cena,
        'pravidloId', o.pravidlo_id, 'pravidlo', o.pravidlo, 'komu', o.komu,
        'userId', o.komu_uid, 'jmeno', j.jmeno,
        'castka', o.castka, 'vydanoAt', o.vydano_at,
        'vyrazeno', o.vyrazeno, 'prepsano', o.prepsano, 'poznamka', o.poznamka
      ) order by o.vydano_at desc, o.code desc, o.polozka_id)
      from v_obdobi o
      left join jmena j on j.user_id = o.komu_uid
      -- Vyřazené řádky vidí jen správce (aby je mohl vrátit).
      where v_admin or not o.vyrazeno
    ), '[]'::jsonb),
    'lide', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', x.komu_uid, 'jmeno', coalesce(j.jmeno, 'Nepřiřazeno'), 'avatarUrl', j.avatar_url,
        'pocet', x.pocet, 'castka', x.castka
      ) order by x.castka desc, x.pocet desc, j.jmeno)
      from (
        select komu_uid, count(*) as pocet, sum(castka) as castka
        from v_obdobi where not vyrazeno
        group by komu_uid
      ) x
      left join jmena j on j.user_id = x.komu_uid
    ), '[]'::jsonb),
    'mesice', coalesce((
      select jsonb_agg(jsonb_build_object(
        'mesic', x.mesic, 'userId', x.komu_uid, 'jmeno', coalesce(j.jmeno, 'Nepřiřazeno'), 'pocet', x.pocet, 'castka', x.castka
      ) order by x.mesic, x.castka desc)
      from (
        select to_char(vydano_at at time zone v_tz, 'YYYY-MM') as mesic, komu_uid, count(*) as pocet, sum(castka) as castka
        from viditelne
        where not vyrazeno and vydano_at >= v_od12
        group by 1, 2
      ) x
      left join jmena j on j.user_id = x.komu_uid
    ), '[]'::jsonb),
    'vyplaty', coalesce((
      select jsonb_agg(jsonb_build_object('userId', v.user_id, 'obdobi', v.obdobi, 'castka', v.castka, 'vyplacenoAt', v.vyplaceno_at))
      from public.odmeny_vyplaty v
      where v.service_id = p_service_id
        and (v_admin or v.user_id = v_uid)
        and v.obdobi >= to_char(v_od12 at time zone v_tz, 'YYYY-MM')
    ), '[]'::jsonb)
  )
  into v_vysledek;

  return v_vysledek;
end;
$$;

comment on function public.odmeny_prehled(uuid, timestamptz, timestamptz, text) is
  'Odměny týmu: řádky za období (podle data vydání zakázky), součty na člověka, měsíční řada 12 měsíců zpět a vyplaceno. Pravidla ze service_settings.config.odmeny.';
revoke all on function public.odmeny_prehled(uuid, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.odmeny_prehled(uuid, timestamptz, timestamptz, text) to authenticated;
