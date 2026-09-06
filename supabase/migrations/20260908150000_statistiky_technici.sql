-- KPI techniků pro stránku Statistiky.
--
-- Kdo zakázky přijímá a kdo je dokončuje (z historie zakázky: záznam
-- 'created' a změna stavu do koncového stavu servisu) a kolik hodin
-- hodinové práce si kdo zapsal (položky provedených oprav typu 'hourly',
-- technik je tam jménem). Lidé se párují přes přezdívku v profilu; kdo
-- přezdívku nemá, je „Bez přezdívky“. Období se bere podle času záznamu
-- v historii, u hodin podle vzniku zakázky – stejně jako zbytek statistik.
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
           u.prijato, u.dokonceno
    from podle_uzivatele u
    left join public.profiles p on p.id = u.user_id
  ),
  spojeni as (
    select coalesce(l.jmeno, h.jmeno) as jmeno,
           l.user_id,
           coalesce(l.prijato, 0) as prijato,
           coalesce(l.dokonceno, 0) as dokonceno,
           coalesce(h.hodiny, 0) as hodiny,
           coalesce(h.trzba, 0) as trzba
    from lide l
    full outer join hodinova h on h.klic <> '' and h.klic = l.klic
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'userId', s.user_id, 'name', s.jmeno, 'prijato', s.prijato, 'dokonceno', s.dokonceno,
    'hodiny', round(s.hodiny, 2), 'trzbaHodin', round(s.trzba, 2)
  ) order by s.dokonceno desc, s.prijato desc, s.hodiny desc, s.jmeno), '[]'::jsonb)
  into v_vysledek
  from spojeni s
  where s.prijato > 0 or s.dokonceno > 0 or s.hodiny > 0;

  return v_vysledek;
end;
$$;

revoke all on function public.statistiky_technici(uuid[], timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.statistiky_technici(uuid[], timestamptz, timestamptz, uuid) to authenticated, service_role;
