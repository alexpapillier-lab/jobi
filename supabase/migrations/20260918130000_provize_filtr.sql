-- Provize: jen zakázky se zařízením, které odpovídá filtru (např. „dyson“)
-- ============================================================================
--
-- PROČ: Provize 7,5 % se platí jen z Dysonů. Bot nad Zakázkovým listem to
-- hlídal (`/dyson/i` na řádku zakázky); při přepisu do Jobi se na filtr
-- zapomnělo a do tabulky provizí se 17.–18. 9. dostalo osm iPhonů a iPadů.
-- Značka bývá prázdná, typ zařízení je v názvu zakázky (title) nebo
-- v device_label – filtr hledá ve všech čtyřech polích.

alter table public.provize_nastaveni add column if not exists filtr text;

comment on column public.provize_nastaveni.filtr is
  'Provize jen ze zakázek, jejichž zařízení (title, device_label, značka, model) obsahuje tento text bez ohledu na velikost písmen. NULL = všechny.';

create or replace function public.provize_odpovida_filtru(p_filtr text, p_title text, p_label text, p_brand text, p_model text)
returns boolean
language sql
stable
set search_path = public
as $$
  select nullif(btrim(coalesce(p_filtr, '')), '') is null
      or position(lower(btrim(p_filtr)) in lower(concat_ws(' ', p_title, p_label, p_brand, p_model))) > 0;
$$;

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
      and public.provize_odpovida_filtru(n.filtr, t.title, t.device_label, t.device_brand, t.device_model)
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

drop function if exists public.provize_import(uuid, jsonb, date);

create or replace function public.provize_import(p_service_id uuid, p_radky jsonb, p_od date default null, p_filtr text default null)
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
  v_mimo integer := 0;
  v_filtr text;
  v_tyden record;
  v_id bigint;
begin
  if not public.je_root_owner() then
    raise exception 'Jen majitel aplikace.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_radky) <> 'array' then
    raise exception 'p_radky musí být pole.';
  end if;

  insert into public.provize_nastaveni (service_id, zapnuto, od, filtr)
  values (p_service_id, true, p_od, nullif(btrim(coalesce(p_filtr, '')), ''))
  on conflict (service_id) do update
  set od = coalesce(excluded.od, public.provize_nastaveni.od),
      filtr = coalesce(excluded.filtr, public.provize_nastaveni.filtr);

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

  -- Nevyúčtované řádky zakázek, které filtru zařízení neodpovídají, se vyřadí
  -- (nemažou – jsou vidět a jdou vrátit). Do tabulky se tak dostaly zakázky
  -- jiných značek v době, kdy je zapisovala edge funkce provize-sheets bez filtru.
  select filtr into v_filtr from public.provize_nastaveni where service_id = p_service_id;
  if v_filtr is not null then
    update public.provize_polozky p
    set vyrazeno = true, poznamka = 'mimo filtr zařízení'
    from public.tickets t
    where p.service_id = p_service_id and p.importovano and p.vyuctovani_id is null and not p.vyrazeno
      and t.id = p.ticket_id
      and not public.provize_odpovida_filtru(v_filtr, t.title, t.device_label, t.device_brand, t.device_model);
    get diagnostics v_mimo = row_count;
  end if;

  return jsonb_build_object('ok', true, 'vlozeno', v_vlozeno, 'preskoceno', v_preskoceno, 'vyuctovani', v_vyuct, 'mimo_filtr', v_mimo);
end;
$$;

revoke all on function public.provize_import(uuid, jsonb, date, text) from public, anon;
grant execute on function public.provize_import(uuid, jsonb, date, text) to authenticated;

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
        'poznamka', p.poznamka,
        'zarizeni', (select coalesce(nullif(btrim(t.title), ''), t.device_label) from public.tickets t where t.id = p.ticket_id),
        'stav_ted', (select s.label from public.tickets t join public.service_statuses s on s.service_id = t.service_id and s.key = t.status where t.id = p.ticket_id)
      ) order by p.zapsano_at desc, p.id desc)
      from public.provize_polozky p where p.service_id = p_service_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.provize_prehled(uuid) from public, anon;
grant execute on function public.provize_prehled(uuid) to authenticated;
