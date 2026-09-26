-- Provize: sdílení s vybraným účtem jen pro čtení
-- ============================================================================
--
-- PROČ: Majitel aplikace chce, aby jeho provize viděl konkrétní kolega –
-- částku a zakázky, ze kterých je. Sdílí se jménem účtu, ne rolí: vlastník
-- ani správce servisu nic nevidí, dokud ho sem majitel nepřidá.
--
-- Kolega dostane jen výstup RPC provize_moje (položky a vyúčtování), ne
-- nastavení, sazbu ani možnost cokoli měnit. Tabulky provize_* mu RLS
-- dál nepustí; RPC je SECURITY DEFINER a sám ověří, že je v provize_sdileni.

create table if not exists public.provize_sdileni (
  service_id uuid not null references public.services(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (service_id, user_id)
);

alter table public.provize_sdileni enable row level security;
drop policy if exists provize_sdileni_root on public.provize_sdileni;
create policy provize_sdileni_root on public.provize_sdileni
  for all to authenticated using (public.je_root_owner()) with check (public.je_root_owner());
revoke all on table public.provize_sdileni from anon;
grant select, insert, update, delete on table public.provize_sdileni to authenticated;

comment on table public.provize_sdileni is
  'Účty, kterým majitel aplikace zpřístupnil své provize ze servisu jen pro čtení (stránka Provize).';

-- Členové servisu k výběru (jen pro majitele aplikace): účet, přezdívka, e-mail.
create or replace function public.provize_clenove(p_service_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.je_root_owner() then
    raise exception 'Jen majitel aplikace.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', m.user_id,
      'nickname', p.nickname,
      'email', u.email,
      'role', m.role,
      'sdileno', exists (select 1 from public.provize_sdileni s where s.service_id = m.service_id and s.user_id = m.user_id)
    ) order by coalesce(p.nickname, u.email))
    from public.service_memberships m
    left join public.profiles p on p.id = m.user_id
    left join auth.users u on u.id = m.user_id
    where m.service_id = p_service_id
      and m.user_id <> public.root_owner_id()
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.provize_clenove(uuid) from public, anon;
grant execute on function public.provize_clenove(uuid) to authenticated;

-- Servisy, ve kterých přihlášený účet vidí sdílené provize (pro záložku v navigaci).
create or replace function public.provize_sdilene_servisy()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(service_id), '{}'::uuid[])
  from public.provize_sdileni
  where user_id = auth.uid();
$$;

revoke all on function public.provize_sdilene_servisy() from public, anon;
grant execute on function public.provize_sdilene_servisy() to authenticated;

-- Co kolega vidí: řádky spočítané v Jobi (nevyúčtované i vyúčtované) a
-- vyúčtování, která z nich vznikla. Bez nastavení, bez vyřazených řádků
-- a bez historie naimportované z Google tabulky – ta zůstává jen majiteli.
create or replace function public.provize_moje(p_service_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.provize_sdileni where service_id = p_service_id and user_id = auth.uid()
  ) then
    raise exception 'Provize tohoto servisu s vámi nejsou sdílené.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'vyuctovani', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'oznaceni', v.oznaceni, 'pocet', v.pocet, 'soucet_zaklad', v.soucet_zaklad,
        'soucet_provize', v.soucet_provize, 'created_at', v.created_at, 'vyplaceno_at', v.vyplaceno_at
      ) order by v.created_at desc, v.id desc)
      from public.provize_vyuctovani v
      where v.service_id = p_service_id and not v.importovano
        and exists (select 1 from public.provize_polozky p where p.vyuctovani_id = v.id and not p.importovano)
    ), '[]'::jsonb),
    'polozky', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'kod', p.zakazka_kod, 'poradi', p.poradi, 'zaklad', p.zaklad, 'provize', p.provize,
        'zapsano_at', p.zapsano_at, 'vyuctovani_id', p.vyuctovani_id, 'ticket_id', p.ticket_id,
        'zarizeni', (select coalesce(nullif(btrim(t.title), ''), t.device_label) from public.tickets t where t.id = p.ticket_id),
        'zakaznik', (select t.customer_name from public.tickets t where t.id = p.ticket_id),
        'stav', (select s.label from public.tickets t join public.service_statuses s on s.service_id = t.service_id and s.key = t.status where t.id = p.ticket_id)
      ) order by p.zapsano_at desc, p.id desc)
      from public.provize_polozky p
      where p.service_id = p_service_id and not p.vyrazeno and not p.importovano
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.provize_moje(uuid) from public, anon;
grant execute on function public.provize_moje(uuid) to authenticated;
