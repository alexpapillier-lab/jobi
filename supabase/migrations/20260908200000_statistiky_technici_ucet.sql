-- KPI techniků: hodinová práce podle účtu technika, řádek „Bez technika“.
--
-- Revize 6. 9.: hodinová práce se párovala s člověkem jen podle přezdívky
-- (dvě stejné přezdívky = hodiny oběma), a zakázky založené portálem nebo
-- automatem (bez changed_by) chyběly úplně, takže součet „Přijal“ neseděl
-- s počtem zakázek. Položka hodinové práce teď nese technikUserId (aplikace
-- ho uloží, když technik zůstal přihlášený člověk), jméno je záloha.
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
           h.ticket_id,
           h.details -> 'changes' -> 'status' ->> 'new' as novy_stav,
           t.service_id
    from public.ticket_history h
    join public.tickets t on t.id = h.ticket_id
    where t.service_id = any(p_service_ids)
      and t.deleted_at is null
      and (p_branch_id is null or t.branch_id = p_branch_id)
      and (p_od is null or h.created_at >= p_od)
      and (p_do is null or h.created_at <= p_do)
  ),
  podle_uzivatele as (
    select
      h.user_id,
      count(distinct h.ticket_id) filter (where h.action = 'created') as prijato,
      count(distinct h.ticket_id) filter (
        where h.action = 'updated' and h.novy_stav is not null
          and exists (
            select 1 from public.service_statuses s
            where s.service_id = h.service_id and s.key = h.novy_stav and s.is_final
              and s.key !~* '(cancel|storno)'
              and coalesce(s.label, '') !~* '(storn|zruš|nerealiz|neopraven|odmítn)'
          )
      ) as dokonceno
    from historie h
    group by h.user_id
  ),
  odpracovano as (
    select w.user_id,
           sum(extract(epoch from (least(coalesce(w.ended_at, now()), coalesce(p_do, now())) - w.started_at))) / 3600.0 as hodiny
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
           greatest(coalesce(o.hodiny, 0), 0) as odpracovano
    from podle_uzivatele u
    full outer join odpracovano o on o.user_id = u.user_id
  ),
  hodinova as (
    select
      -- Účet technika má přednost před jménem: dva lidé se stejnou přezdívkou se nesmí slít.
      coalesce(nullif(r ->> 'technikUserId', ''), 'jmeno:' || lower(trim(r ->> 'technik'))) as klic,
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
      and (coalesce(trim(r ->> 'technik'), '') <> '' or coalesce(r ->> 'technikUserId', '') <> '')
    group by coalesce(nullif(r ->> 'technikUserId', ''), 'jmeno:' || lower(trim(r ->> 'technik')))
  ),
  lide as (
    select u.user_id,
           case
             when u.user_id is null then 'Bez technika (portál, automat)'
             else coalesce(nullif(trim(p.nickname), ''), 'Bez přezdívky (' || left(u.user_id::text, 8) || ')')
           end as jmeno,
           -- Párování s hodinovou prací: podle účtu, záložně podle přezdívky.
           u.user_id::text as klic_ucet,
           'jmeno:' || lower(coalesce(nullif(trim(p.nickname), ''), '')) as klic_jmeno,
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
    full outer join hodinova h on h.klic = l.klic_ucet or (h.klic <> 'jmeno:' and h.klic = l.klic_jmeno)
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
