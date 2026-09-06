-- Čas na opravě: stopky technika na zakázce.
--
-- Volitelná funkce (Nastavení → Zakázky → Hodinová práce → „Stopky na
-- zakázce“, service_settings.config.cas_na_oprave). Technik na zakázce
-- spustí a zastaví práci; z úseků se počítá odpracovaný čas na zakázce
-- a v KPI techniků. Každý úsek patří jednomu člověku; běžící úsek má
-- ended_at prázdné a člověk může mít najednou jen jeden (start nového
-- ukončí předchozí – řeší aplikace).
create table if not exists public.ticket_work_sessions (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  constraint ticket_work_sessions_poradi check (ended_at is null or ended_at >= started_at)
);
comment on table public.ticket_work_sessions is 'Úseky práce technika na zakázce (stopky). ended_at null = běží.';
create index if not exists ticket_work_sessions_ticket_idx on public.ticket_work_sessions (ticket_id, started_at desc);
create index if not exists ticket_work_sessions_user_bezi_idx on public.ticket_work_sessions (user_id) where ended_at is null;

alter table public.ticket_work_sessions enable row level security;
revoke all on table public.ticket_work_sessions from anon;
revoke truncate, references, trigger on table public.ticket_work_sessions from authenticated;

create policy "work_sessions_select_members" on public.ticket_work_sessions
  for select to authenticated
  using (exists (select 1 from public.service_memberships m where m.service_id = ticket_work_sessions.service_id and m.user_id = auth.uid()));
-- Zapisovat smí každý jen své úseky, a jen na zakázku, kterou vidí (RLS zakázek včetně omezení na pobočku).
create policy "work_sessions_insert_own" on public.ticket_work_sessions
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.service_memberships m where m.service_id = ticket_work_sessions.service_id and m.user_id = auth.uid())
    and exists (select 1 from public.tickets t where t.id = ticket_work_sessions.ticket_id and t.service_id = ticket_work_sessions.service_id)
  );
create policy "work_sessions_update_own" on public.ticket_work_sessions
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy "work_sessions_delete_own" on public.ticket_work_sessions
  for delete to authenticated
  using (user_id = auth.uid());

alter publication supabase_realtime add table public.ticket_work_sessions;

-- KPI techniků: přibývá odpracovaný čas ze stopek.
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
