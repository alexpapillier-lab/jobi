-- Provize majitele aplikace přímo v Jobi (místo Google Sheets)
-- ============================================================================
--
-- PROČ: Provize ze zakázek servisu se dosud vedly v Google tabulce: zapisoval
-- je bot nad Zakázkovým listem, pak edge funkce provize-sheets. Tabulka byla
-- kopie dat s vlastním Apps Scriptem, pomalým a křehkým (plánovaný běh dva dny
-- tiše neběžel), a adresa skriptu ležela v service_settings.config, který čtou
-- všichni členové servisu – kdo ji našel, viděl celé provize.
--
-- Provize se teď počítají ze zakázek tady a vidí je JEN majitel aplikace
-- (root owner): tabulky mají RLS na je_root_owner(), funkce totéž ověřují
-- uvnitř. Vlastník ani správci servisu k nim nemají přístup.
--
-- Pravidla navazují na tabulku, ať se dá pokračovat tam, kde skončila:
--   * zakázka se zapíše, jakmile je poprvé ve sledovaném stavu (Připraveno
--     k převzetí / Vydáno) s cenou, jakou v tu chvíli má;
--   * dokud řádek není vyúčtovaný, drží se aktuální ceny zakázky (importovaný
--     řádek jen směrem nahoru – tabulka cenu nikdy nesnižovala);
--   * po vyúčtování se řádek nemění; zdražení jde do nového řádku (doplatek);
--   * vyřazený řádek (dřív „a“ ve sloupci F) se do vyúčtování nebere.

-- ── 1. Kdo je majitel aplikace (pro RLS) ────────────────────────────────────
create or replace function public.je_root_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and auth.uid() = public.root_owner_id();
$$;

revoke all on function public.je_root_owner() from public, anon;
grant execute on function public.je_root_owner() to authenticated, service_role;

comment on function public.je_root_owner() is
  'True, když je přihlášený účet majitel aplikace (app_nastaveni.root_owner_id). Pro RLS tabulek, které nemá vidět ani vlastník servisu.';

-- ── 2. Tabulky ──────────────────────────────────────────────────────────────
create table if not exists public.provize_nastaveni (
  service_id uuid primary key references public.services(id) on delete cascade,
  zapnuto boolean not null default true,
  sazba numeric(6,4) not null default 0.075,
  statusy text[] not null default array['Připraveno k převzetí', 'Vydáno'],
  -- Zakázky, které v provizích ještě nejsou, se přidají jen tehdy, když se do
  -- sledovaného stavu dostaly od tohoto data (historie zakázky) nebo byly od
  -- té doby založené. Importovaná historie ze ZL se tak sama nezačne účtovat.
  od date,
  posledni_sync_at timestamptz,
  posledni_sync jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.provize_vyuctovani (
  id bigint generated always as identity primary key,
  service_id uuid not null references public.services(id) on delete cascade,
  oznaceni text not null,
  pocet integer not null default 0,
  soucet_zaklad numeric(12,2) not null default 0,
  soucet_provize numeric(12,2) not null default 0,
  importovano boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists provize_vyuctovani_service_idx
  on public.provize_vyuctovani (service_id, created_at desc);

create table if not exists public.provize_polozky (
  id bigint generated always as identity primary key,
  service_id uuid not null references public.services(id) on delete cascade,
  ticket_id uuid references public.tickets(id) on delete set null,
  zakazka_kod text not null,
  -- 0 = zakázka, 1+ = doplatky po vyúčtování
  poradi integer not null default 0,
  zaklad numeric(12,2) not null,
  sazba numeric(6,4),
  provize numeric(12,2) not null,
  status text,
  zapsano_at timestamptz not null default now(),
  vyuctovani_id bigint references public.provize_vyuctovani(id) on delete set null,
  vyrazeno boolean not null default false,
  poznamka text,
  importovano boolean not null default false,
  unique (service_id, zakazka_kod, poradi)
);

create index if not exists provize_polozky_service_idx
  on public.provize_polozky (service_id, vyuctovani_id);
create index if not exists provize_polozky_ticket_idx
  on public.provize_polozky (ticket_id);

do $$
declare
  t text;
begin
  foreach t in array array['provize_nastaveni', 'provize_vyuctovani', 'provize_polozky'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_root', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.je_root_owner()) with check (public.je_root_owner())',
      t || '_root', t
    );
    execute format('revoke all on table public.%I from anon', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
  end loop;
end $$;

comment on table public.provize_polozky is
  'Provize majitele aplikace ze zakázek servisu. Vidí jen root owner (RLS je_root_owner).';

-- Záznam běhů odesílání do Sheets viděl vlastník a správci servisu – taky jen root owner.
drop policy if exists provize_sheets_behy_select on public.provize_sheets_behy;
create policy provize_sheets_behy_select on public.provize_sheets_behy
  for select to authenticated
  using (public.je_root_owner());

-- ── 3. Konečná cena zakázky v SQL ───────────────────────────────────────────
-- Stejný vzorec jako src/lib/slevaZakazky.ts a supabase/functions/_shared/penize.ts:
-- součet cen oprav na haléře, sleva nejvýš do výše ceny, výsledek nezáporný.
-- round() nad numeric zaokrouhluje půlku od nuly, stejně jako naHalere().
create or replace function public.provize_cena(p_opravy jsonb, p_typ text, p_hodnota numeric)
returns numeric
language sql
immutable
set search_path = public
as $$
  with h as (
    select round(coalesce((
      select sum(case when jsonb_typeof(r -> 'price') = 'number' then (r ->> 'price')::numeric
                      when (r ->> 'price') ~ '^-?[0-9]+(\.[0-9]+)?$' then (r ->> 'price')::numeric
                      else 0 end)
      from jsonb_array_elements(case when jsonb_typeof(p_opravy) = 'array' then p_opravy else '[]'::jsonb end) r
    ), 0), 2) as hruba
  ), s as (
    select hruba,
      case
        when p_typ is null or coalesce(p_hodnota, 0) <= 0 or hruba <= 0 then 0
        when p_typ = 'percentage' then least(hruba, round(hruba * p_hodnota / 100, 2))
        when p_typ = 'amount' then least(hruba, round(p_hodnota, 2))
        else 0
      end as sleva
    from h
  )
  select greatest(0, round(hruba - sleva, 2)) from s;
$$;

-- ── 4. Synchronizace ze zakázek ─────────────────────────────────────────────
create or replace function public.provize_synchronizuj_interni(p_service_id uuid, p_nanecisto boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n public.provize_nastaveni;
  r record;
  v_total numeric;
  v_pocet integer;
  v_posl public.provize_polozky;
  v_rozdil numeric;
  v_nove integer := 0;
  v_doplatky integer := 0;
  v_upraveno integer := 0;
  v_zmeny jsonb := '[]'::jsonb;
  v_vysledek jsonb;
begin
  select * into n from public.provize_nastaveni where service_id = p_service_id;
  if not found or not n.zapnuto then
    return jsonb_build_object('ok', false, 'duvod', 'provize nejsou pro servis zapnuté');
  end if;

  for r in
    select t.id, t.code, s.label,
           public.provize_cena(t.performed_repairs, t.discount_type, t.discount_value) as cena
    from public.tickets t
    join public.service_statuses s on s.service_id = t.service_id and s.key = t.status
    where t.service_id = p_service_id
      and t.deleted_at is null
      and t.code is not null and btrim(t.code) <> ''
      and s.label = any (n.statusy)
      and (
        n.od is null
        or t.created_at >= n.od
        or exists (select 1 from public.provize_polozky p where p.service_id = t.service_id and p.zakazka_kod = t.code)
        or exists (
          select 1 from public.ticket_history h
          where h.ticket_id = t.id
            and h.created_at >= n.od
            and h.details -> 'changes' -> 'status' ->> 'new' in (
              select ss.key from public.service_statuses ss
              where ss.service_id = p_service_id and ss.label = any (n.statusy)
            )
        )
      )
    order by t.created_at
  loop
    select coalesce(sum(zaklad), 0), count(*) into v_total, v_pocet
    from public.provize_polozky
    where service_id = p_service_id and zakazka_kod = r.code;

    if v_pocet = 0 then
      v_nove := v_nove + 1;
      v_zmeny := v_zmeny || jsonb_build_object('kod', r.code, 'akce', 'nova', 'zaklad', r.cena, 'status', r.label);
      if not p_nanecisto then
        insert into public.provize_polozky (service_id, ticket_id, zakazka_kod, poradi, zaklad, sazba, provize, status)
        values (p_service_id, r.id, r.code, 0, r.cena, n.sazba, round(r.cena * n.sazba, 2), r.label);
      end if;
      continue;
    end if;

    v_rozdil := r.cena - v_total;
    if v_rozdil = 0 then
      continue;
    end if;

    select * into v_posl from public.provize_polozky
    where service_id = p_service_id and zakazka_kod = r.code
    order by poradi desc limit 1;

    if v_posl.vyuctovani_id is null then
      -- Nevyúčtovaný řádek drží aktuální cenu. Importovaný jen nahoru: tabulka
      -- cenu nikdy nesnižovala a rozdíl může být jen jiným zaokrouhlením importu.
      if v_rozdil > 0 or not v_posl.importovano then
        v_upraveno := v_upraveno + 1;
        v_zmeny := v_zmeny || jsonb_build_object('kod', r.code, 'akce', 'uprava', 'z', v_posl.zaklad, 'na', greatest(0, v_posl.zaklad + v_rozdil));
        if not p_nanecisto then
          update public.provize_polozky
          set zaklad = greatest(0, zaklad + v_rozdil),
              provize = round(greatest(0, zaklad + v_rozdil) * coalesce(sazba, n.sazba), 2),
              sazba = coalesce(sazba, n.sazba),
              status = r.label,
              ticket_id = coalesce(ticket_id, r.id)
          where id = v_posl.id;
        end if;
      end if;
    elsif v_rozdil > 0 then
      v_doplatky := v_doplatky + 1;
      v_zmeny := v_zmeny || jsonb_build_object('kod', r.code, 'akce', 'doplatek', 'zaklad', v_rozdil);
      if not p_nanecisto then
        insert into public.provize_polozky (service_id, ticket_id, zakazka_kod, poradi, zaklad, sazba, provize, status)
        values (p_service_id, r.id, r.code, v_posl.poradi + 1, v_rozdil, n.sazba, round(v_rozdil * n.sazba, 2), r.label);
      end if;
    end if;
  end loop;

  v_vysledek := jsonb_build_object('ok', true, 'nanecisto', p_nanecisto, 'nove', v_nove, 'doplatky', v_doplatky, 'upraveno', v_upraveno);
  if not p_nanecisto then
    update public.provize_nastaveni
    set posledni_sync_at = now(), posledni_sync = v_vysledek
    where service_id = p_service_id;
  end if;
  return v_vysledek || jsonb_build_object('zmeny', v_zmeny);
end;
$$;

revoke all on function public.provize_synchronizuj_interni(uuid, boolean) from public, anon, authenticated;
grant execute on function public.provize_synchronizuj_interni(uuid, boolean) to service_role;

create or replace function public.provize_synchronizuj(p_service_id uuid, p_nanecisto boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.je_root_owner() then
    raise exception 'Jen majitel aplikace.' using errcode = '42501';
  end if;
  return public.provize_synchronizuj_interni(p_service_id, p_nanecisto);
end;
$$;

revoke all on function public.provize_synchronizuj(uuid, boolean) from public, anon;
grant execute on function public.provize_synchronizuj(uuid, boolean) to authenticated;

-- ── 5. Vyúčtování ───────────────────────────────────────────────────────────
create or replace function public.provize_vyuctuj(p_service_id uuid, p_oznaceni text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_oznaceni text := nullif(btrim(coalesce(p_oznaceni, '')), '');
  v_id bigint;
  v_pocet integer;
  v_zaklad numeric;
  v_provize numeric;
begin
  if not public.je_root_owner() then
    raise exception 'Jen majitel aplikace.' using errcode = '42501';
  end if;

  perform public.provize_synchronizuj_interni(p_service_id, false);

  -- Stejné označení jako v tabulce: ISO týden, např. 2026-W38.
  if v_oznaceni is null then
    v_oznaceni := to_char(now() at time zone 'Europe/Prague', 'IYYY"-W"IW');
  end if;

  select count(*), coalesce(sum(zaklad), 0), coalesce(sum(provize), 0)
  into v_pocet, v_zaklad, v_provize
  from public.provize_polozky
  where service_id = p_service_id and vyuctovani_id is null and not vyrazeno;

  if v_pocet = 0 then
    return jsonb_build_object('ok', true, 'pocet', 0, 'oznaceni', v_oznaceni);
  end if;

  insert into public.provize_vyuctovani (service_id, oznaceni, pocet, soucet_zaklad, soucet_provize)
  values (p_service_id, v_oznaceni, v_pocet, v_zaklad, v_provize)
  returning id into v_id;

  update public.provize_polozky
  set vyuctovani_id = v_id
  where service_id = p_service_id and vyuctovani_id is null and not vyrazeno;

  return jsonb_build_object('ok', true, 'id', v_id, 'oznaceni', v_oznaceni, 'pocet', v_pocet, 'soucet_zaklad', v_zaklad, 'soucet_provize', v_provize);
end;
$$;

revoke all on function public.provize_vyuctuj(uuid, text) from public, anon;
grant execute on function public.provize_vyuctuj(uuid, text) to authenticated;

-- Omyl při vyúčtování: řádky se vrátí mezi nevyúčtované.
create or replace function public.provize_zrus_vyuctovani(p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pocet integer;
begin
  if not public.je_root_owner() then
    raise exception 'Jen majitel aplikace.' using errcode = '42501';
  end if;
  update public.provize_polozky set vyuctovani_id = null where vyuctovani_id = p_id;
  get diagnostics v_pocet = row_count;
  delete from public.provize_vyuctovani where id = p_id;
  return jsonb_build_object('ok', true, 'vraceno', v_pocet);
end;
$$;

revoke all on function public.provize_zrus_vyuctovani(bigint) from public, anon;
grant execute on function public.provize_zrus_vyuctovani(bigint) to authenticated;

-- ── 6. Import z Google tabulky ──────────────────────────────────────────────
-- p_radky: [{ id, cena, provize, datum, tyden, priznak, status }] – list RAW.
-- Vyúčtování se odvodí z týdnů u řádků. Import jde pustit znovu: co už
-- importované je, zůstane; nevyúčtovaný řádek vzniklý mezitím v Jobi se
-- nahradí tím z tabulky (tabulka je pro historii zdroj pravdy).
create or replace function public.provize_import(p_service_id uuid, p_radky jsonb, p_od date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_kod text;
  v_poradi integer;
  v_vlozeno integer := 0;
  v_preskoceno integer := 0;
  v_vyuct integer := 0;
  v_tyden record;
  v_id bigint;
begin
  if not public.je_root_owner() then
    raise exception 'Jen majitel aplikace.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_radky) <> 'array' then
    raise exception 'p_radky musí být pole.';
  end if;

  insert into public.provize_nastaveni (service_id, zapnuto, od)
  values (p_service_id, true, p_od)
  on conflict (service_id) do update set od = coalesce(excluded.od, public.provize_nastaveni.od);

  drop table if exists tmp_provize_import;
  create temporary table tmp_provize_import (
    kod text, poradi integer, zaklad numeric, provize numeric, datum timestamptz,
    tyden text, vyrazeno boolean, status text
  ) on commit drop;

  for r in select value as x from jsonb_array_elements(p_radky) loop
    v_kod := btrim(coalesce(r.x ->> 'id', ''));
    if v_kod = '' then
      continue;
    end if;
    v_poradi := case when v_kod ~ '-DOPLATEK$' then 1 else 0 end;
    v_kod := regexp_replace(v_kod, '-DOPLATEK$', '');
    insert into tmp_provize_import values (
      v_kod, v_poradi,
      round(coalesce((r.x ->> 'cena')::numeric, 0), 2),
      round(coalesce((r.x ->> 'provize')::numeric, 0), 2),
      coalesce((r.x ->> 'datum')::timestamptz, now()),
      nullif(btrim(coalesce(r.x ->> 'tyden', '')), ''),
      lower(btrim(coalesce(r.x ->> 'priznak', ''))) = 'a',
      nullif(btrim(coalesce(r.x ->> 'status', '')), '')
    );
  end loop;

  -- Nevyúčtované řádky, které mezitím vznikly v Jobi, ustoupí historii z tabulky.
  delete from public.provize_polozky p
  using tmp_provize_import i
  where p.service_id = p_service_id and p.zakazka_kod = i.kod and p.poradi = i.poradi
    and not p.importovano and p.vyuctovani_id is null;

  for v_tyden in
    select tyden, count(*) as pocet, sum(zaklad) as zaklad, sum(provize) as provize, max(datum) as posledni
    from tmp_provize_import i
    where tyden is not null
      and not exists (select 1 from public.provize_polozky p where p.service_id = p_service_id and p.zakazka_kod = i.kod and p.poradi = i.poradi)
    group by tyden order by tyden
  loop
    select id into v_id from public.provize_vyuctovani
    where service_id = p_service_id and oznaceni = v_tyden.tyden and importovano limit 1;
    if v_id is null then
      insert into public.provize_vyuctovani (service_id, oznaceni, pocet, soucet_zaklad, soucet_provize, importovano, created_at)
      values (p_service_id, v_tyden.tyden, v_tyden.pocet, v_tyden.zaklad, v_tyden.provize, true, v_tyden.posledni)
      returning id into v_id;
      v_vyuct := v_vyuct + 1;
    else
      update public.provize_vyuctovani
      set pocet = pocet + v_tyden.pocet, soucet_zaklad = soucet_zaklad + v_tyden.zaklad, soucet_provize = soucet_provize + v_tyden.provize
      where id = v_id;
    end if;
  end loop;

  with vlozene as (
    insert into public.provize_polozky (service_id, ticket_id, zakazka_kod, poradi, zaklad, sazba, provize, status, zapsano_at, vyuctovani_id, vyrazeno, importovano)
    select p_service_id,
           (select t.id from public.tickets t where t.service_id = p_service_id and t.code = i.kod and t.deleted_at is null limit 1),
           i.kod, i.poradi, i.zaklad,
           case when i.zaklad > 0 then round(i.provize / i.zaklad, 4) end,
           i.provize, i.status, i.datum,
           (select v.id from public.provize_vyuctovani v where v.service_id = p_service_id and v.oznaceni = i.tyden and v.importovano limit 1),
           i.vyrazeno, true
    from tmp_provize_import i
    on conflict (service_id, zakazka_kod, poradi) do nothing
    returning 1
  )
  select count(*) into v_vlozeno from vlozene;

  select count(*) - v_vlozeno into v_preskoceno from tmp_provize_import;

  return jsonb_build_object('ok', true, 'vlozeno', v_vlozeno, 'preskoceno', v_preskoceno, 'vyuctovani', v_vyuct);
end;
$$;

revoke all on function public.provize_import(uuid, jsonb, date) from public, anon;
grant execute on function public.provize_import(uuid, jsonb, date) to authenticated;

-- ── 7. Přehled pro stránku Owner → Provize ──────────────────────────────────
create or replace function public.provize_prehled(p_service_id uuid)
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
  return jsonb_build_object(
    'nastaveni', (select to_jsonb(n) from public.provize_nastaveni n where n.service_id = p_service_id),
    'statusy_servisu', coalesce((select jsonb_agg(s.label order by s.order_index) from public.service_statuses s where s.service_id = p_service_id), '[]'::jsonb),
    'vyuctovani', coalesce((
      select jsonb_agg(to_jsonb(v) order by v.created_at desc, v.id desc)
      from public.provize_vyuctovani v where v.service_id = p_service_id
    ), '[]'::jsonb),
    'polozky', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'kod', p.zakazka_kod, 'poradi', p.poradi, 'zaklad', p.zaklad, 'provize', p.provize,
        'sazba', p.sazba, 'status', p.status, 'zapsano_at', p.zapsano_at, 'vyuctovani_id', p.vyuctovani_id,
        'vyrazeno', p.vyrazeno, 'importovano', p.importovano, 'ticket_id', p.ticket_id,
        'stav_ted', (select s.label from public.tickets t join public.service_statuses s on s.service_id = t.service_id and s.key = t.status where t.id = p.ticket_id)
      ) order by p.zapsano_at desc, p.id desc)
      from public.provize_polozky p where p.service_id = p_service_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.provize_prehled(uuid) from public, anon;
grant execute on function public.provize_prehled(uuid) to authenticated;

-- ── 8. Plánovač ─────────────────────────────────────────────────────────────
-- Čistě v databázi, bez edge funkce: zapíše nové zakázky s časem, kdy se do
-- sledovaného stavu dostaly (na hodinu přesně). Stránka si sync pouští i sama.
create or replace function public.provize_sync_vse()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
begin
  for s in select service_id from public.provize_nastaveni where zapnuto loop
    begin
      perform public.provize_synchronizuj_interni(s.service_id, false);
    exception when others then
      raise warning 'provize_sync_vse: servis % selhal: %', s.service_id, sqlerrm;
    end;
  end loop;
end;
$$;

revoke all on function public.provize_sync_vse() from public, anon, authenticated;
grant execute on function public.provize_sync_vse() to service_role;

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron není k dispozici – provize se synchronizují jen při otevření stránky.';
    return;
  end if;
  create extension if not exists pg_cron;
  perform cron.unschedule('jobi-provize-sync')
  where exists (select 1 from cron.job where jobname = 'jobi-provize-sync');
  perform cron.schedule('jobi-provize-sync', '50 * * * *', 'SELECT public.provize_sync_vse()');
exception
  when insufficient_privilege or undefined_table or undefined_function or undefined_object then
    raise notice 'pg_cron se nepodařilo nastavit (%).', sqlerrm;
end $$;
