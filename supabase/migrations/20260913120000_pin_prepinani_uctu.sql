-- PIN pro přepínání účtů na sdíleném počítači
-- ============================================================================
--
-- PROČ: Servis má na pobočce jeden počítač a víc lidí. Dnes se musí každý
-- odhlásit a přihlásit heslem. Nově aplikace drží přihlášení víc lidí najednou
-- a přepíná mezi nimi – ale bez ověření by kdokoli u pultu byl „kdokoli“ a
-- rozpadla by se historie zakázek, čas na opravě, KPI techniků i oprávnění.
-- Přepnutí proto chrání čtyřmístný PIN (rozhodnutí majitele 8. 9. 2026).
--
-- PROČ vlastní tabulka a ne sloupec v profiles: `profiles` smí číst každý
-- přihlášený (kvůli jménům u komentářů). Hash PINu tam nesmí ležet – 4 číslice
-- jsou 10 000 možností a offline by se uhodly za chvíli. `user_pin` nemá
-- žádnou politiku ani grant; jde k ní jen přes funkce níž, které počítají
-- pokusy a po pěti chybných zamknou účet na pět minut.
--
-- PROČ ověřuje PIN i cizí člen servisu: při přepnutí je přihlášený ještě ten
-- předchozí (odcházející) člověk a ptá se na PIN toho, na koho se přepíná.
-- Bez společného servisu se ptát nesmí – jinak by šlo přes veřejný klíč
-- hádat PINy libovolného účtu.

create table if not exists public.user_pin (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pin_hash text not null,
  pokusy integer not null default 0,
  zamek_do timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.user_pin enable row level security;
alter table public.user_pin force row level security;
revoke all on table public.user_pin from public, anon, authenticated;

comment on table public.user_pin is 'Hash čtyřmístného PINu pro přepínání účtů na sdíleném počítači; čte se jen přes over_pin/ma_pin.';

-- Sdílí volající s p_user aspoň jeden servis? (nebo je to on sám)
create or replace function public.stejny_servis_jako(p_user uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select auth.uid() is not null and (
    p_user = auth.uid()
    or exists (
      select 1
        from public.service_memberships a
        join public.service_memberships b on b.service_id = a.service_id
       where a.user_id = auth.uid() and b.user_id = p_user
    )
  );
$$;
revoke all on function public.stejny_servis_jako(uuid) from public, anon;
grant execute on function public.stejny_servis_jako(uuid) to authenticated;

-- Nastaví (nebo NULL = zruší) PIN přihlášeného. Ukládá se jen bcrypt hash.
create or replace function public.nastav_pin(p_pin text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if p_pin is null then
    delete from public.user_pin where user_id = auth.uid();
    return;
  end if;
  if p_pin !~ '^[0-9]{4}$' then
    raise exception 'pin_musi_mit_4_cislice';
  end if;
  insert into public.user_pin (user_id, pin_hash, pokusy, zamek_do, updated_at)
  values (auth.uid(), extensions.crypt(p_pin, extensions.gen_salt('bf')), 0, null, now())
  on conflict (user_id) do update
    set pin_hash = excluded.pin_hash, pokusy = 0, zamek_do = null, updated_at = now();
end;
$$;
revoke all on function public.nastav_pin(text) from public, anon;
grant execute on function public.nastav_pin(text) to authenticated;

-- Má člověk PIN? Jen pro sebe nebo kolegu ze stejného servisu.
create or replace function public.ma_pin(p_user uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.stejny_servis_jako(p_user)
     and exists (select 1 from public.user_pin where user_id = p_user);
$$;
revoke all on function public.ma_pin(uuid) from public, anon;
grant execute on function public.ma_pin(uuid) to authenticated;

-- Ověří PIN. Vrací {ok} nebo {ok:false, duvod: bez_pinu | zamceno | spatny,
-- zbyva, zamceno_do}. Po pěti chybných pokusech zamkne na pět minut – hádat
-- 10 000 kombinací tak trvá dny a přitom se u pultu nikdo nezablokuje
-- kvůli jednomu překlepu.
create or replace function public.over_pin(p_user uuid, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.user_pin%rowtype;
  v_max constant integer := 5;
  v_zamek constant interval := interval '5 minutes';
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.stejny_servis_jako(p_user) then
    raise exception 'cizi_ucet';
  end if;
  select * into r from public.user_pin where user_id = p_user for update;
  if not found then
    return jsonb_build_object('ok', false, 'duvod', 'bez_pinu');
  end if;
  if r.zamek_do is not null and r.zamek_do > now() then
    return jsonb_build_object('ok', false, 'duvod', 'zamceno', 'zamceno_do', r.zamek_do);
  end if;
  if p_pin is not null and r.pin_hash = extensions.crypt(p_pin, r.pin_hash) then
    update public.user_pin set pokusy = 0, zamek_do = null where user_id = p_user;
    return jsonb_build_object('ok', true);
  end if;
  if r.pokusy + 1 >= v_max then
    update public.user_pin set pokusy = 0, zamek_do = now() + v_zamek where user_id = p_user;
    return jsonb_build_object('ok', false, 'duvod', 'zamceno', 'zamceno_do', now() + v_zamek);
  end if;
  update public.user_pin set pokusy = r.pokusy + 1 where user_id = p_user;
  return jsonb_build_object('ok', false, 'duvod', 'spatny', 'zbyva', v_max - r.pokusy - 1);
end;
$$;
revoke all on function public.over_pin(uuid, text) from public, anon;
grant execute on function public.over_pin(uuid, text) to authenticated;
