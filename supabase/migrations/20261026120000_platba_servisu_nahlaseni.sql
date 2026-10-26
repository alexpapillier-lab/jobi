-- Platby servisů: servis sám nahlásí „Zaplaceno“.
--
-- Okno s QR platbou se servisu ukazovalo každý den, dokud majitel aplikace
-- platbu nezapsal – i když servis už zaplatil a majitel ji jen ještě
-- neověřil v bance. Teď ji vlastník/admin servisu může nahlásit tlačítkem;
-- okno zmizí a majitel v Owner → Platby servisů uvidí „hlásí zaplaceno“.
-- Nahlášení není zaplacení: zápis platby dělá dál jen majitel.

create table if not exists public.platby_nahlaseni (
  service_id uuid not null references public.services(id) on delete cascade,
  obdobi text not null check (obdobi ~ '^[0-9]{4}-[0-9]{2}$'),
  nahlaseno_at timestamptz not null default now(),
  nahlasil uuid references auth.users(id) on delete set null,
  primary key (service_id, obdobi)
);
comment on table public.platby_nahlaseni is
  'Servis nahlásil, že měsíční platbu poslal (tlačítko Zaplaceno v okně s QR). Zapisuje jen platba_nahlasit_zaplaceno; čte root owner.';
alter table public.platby_nahlaseni enable row level security;
revoke all on public.platby_nahlaseni from anon;
revoke insert, update, delete on public.platby_nahlaseni from authenticated;
drop policy if exists "platby_nahlaseni_root" on public.platby_nahlaseni;
create policy "platby_nahlaseni_root" on public.platby_nahlaseni
  for select to authenticated using (public.je_root_owner());

create or replace function public.platba_nahlasit_zaplaceno(p_service_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_obdobi text := to_char(now() at time zone 'Europe/Prague', 'YYYY-MM');
begin
  if auth.uid() is null or not exists (
    select 1 from public.service_memberships m
     where m.service_id = p_service_id and m.user_id = auth.uid() and m.role in ('owner', 'admin')
  ) then
    raise exception 'Platbu nahlašuje vlastník nebo admin servisu.' using errcode = '42501';
  end if;
  insert into public.platby_nahlaseni (service_id, obdobi, nahlasil)
  values (p_service_id, v_obdobi, auth.uid())
  on conflict (service_id, obdobi) do nothing;
end;
$$;
revoke all on function public.platba_nahlasit_zaplaceno(uuid) from public, anon;
grant execute on function public.platba_nahlasit_zaplaceno(uuid) to authenticated;

-- Okno: po nahlášení za měsíc už nic.
create or replace function public.platba_meho_servisu(p_service_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_dnes date := (now() at time zone 'Europe/Prague')::date;
  v_obdobi text := to_char(v_dnes, 'YYYY-MM');
  n public.platby_nastaveni%rowtype;
  v_splatnost date;
  v_ucet text;
  v_nazev text;
begin
  if auth.uid() is null or not exists (
    select 1 from public.service_memberships m
     where m.service_id = p_service_id and m.user_id = auth.uid() and m.role in ('owner', 'admin')
  ) then
    return null;
  end if;
  select * into n from public.platby_nastaveni where service_id = p_service_id;
  if n.service_id is null or not n.aktivni or n.cena_mesicne <= 0 then
    return null;
  end if;
  select name into v_nazev from public.services where id = p_service_id and coalesce(active, true);
  if v_nazev is null then
    return null;
  end if;
  if exists (select 1 from public.platby p where p.service_id = p_service_id and p.obdobi = v_obdobi)
     or exists (select 1 from public.platby_nahlaseni x where x.service_id = p_service_id and x.obdobi = v_obdobi) then
    return null;
  end if;
  v_splatnost := make_date(extract(year from v_dnes)::int, extract(month from v_dnes)::int, least(greatest(n.den_platby, 1), 28));
  if v_dnes < v_splatnost then
    return null;
  end if;
  select ucet into v_ucet from public.platby_prijem where id;
  return jsonb_build_object(
    'nazev', v_nazev,
    'castka', n.cena_mesicne,
    'obdobi', v_obdobi,
    'splatnost', v_splatnost,
    'dniPoSplatnosti', v_dnes - v_splatnost,
    'ucet', v_ucet,
    'vs', public.platby_vs(v_obdobi, n.poradi)
  );
end;
$$;
revoke all on function public.platba_meho_servisu(uuid) from public, anon;
grant execute on function public.platba_meho_servisu(uuid) to authenticated;

-- Přehled pro Owner: navíc kdy servis nahlásil zaplaceno.
create or replace function public.platby_prehled(p_obdobi text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_obdobi text := coalesce(p_obdobi, to_char(now() at time zone 'Europe/Prague', 'YYYY-MM'));
begin
  if auth.role() is distinct from 'service_role' and not public.je_root_owner() then
    raise exception 'Jen majitel aplikace.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'serviceId', s.id,
      'nazev', s.name,
      'aktivniServis', coalesce(s.active, true),
      'cenaMesicne', coalesce(n.cena_mesicne, 0),
      'denPlatby', coalesce(n.den_platby, 1),
      'aktivni', coalesce(n.aktivni, false),
      'poznamka', n.poznamka,
      'maNastaveni', n.service_id is not null,
      'obdobi', v_obdobi,
      'zaplacenoAt', p.zaplaceno_at,
      'zaplacenoCastka', p.castka,
      'posledniObdobi', (select max(x.obdobi) from public.platby x where x.service_id = s.id),
      'poradi', n.poradi,
      'vs', public.platby_vs(v_obdobi, n.poradi),
      'nahlasenoAt', h.nahlaseno_at
    ) order by coalesce(n.aktivni, false) desc, s.name)
    from public.services s
    left join public.platby_nastaveni n on n.service_id = s.id
    left join public.platby p on p.service_id = s.id and p.obdobi = v_obdobi
    left join public.platby_nahlaseni h on h.service_id = s.id and h.obdobi = v_obdobi
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.platby_prehled(text) from public, anon;
grant execute on function public.platby_prehled(text) to authenticated, service_role;
