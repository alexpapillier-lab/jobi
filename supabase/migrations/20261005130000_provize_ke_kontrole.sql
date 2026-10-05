-- Provize: zakázky ke kontrole a ruční rozhodnutí o základu
-- ============================================================================
--
-- PROČ: Vyloučené opravy (výměna těla, baterie…) se vyřazují po položkách.
-- Když je ale na zakázce jedna položka, ve které je víc práce najednou –
-- „Výměna baterie + servisní čištění“ za jednu cenu –, vyřadí se celá
-- a čištění z ní se do provize nedostane. Rozdělit cenu umí jen člověk.
--
-- Synchronizace proto takovou zakázku označí „ke kontrole“ (ke_kontrole)
-- a uloží, které položky jsou nejasné. Majitel v panelu vybere, jak ji
-- započítat: bez vyloučených položek (jak to spočítal automat), plně,
-- nebo vlastní částkou (rucni_zaklad). Dokud nerozhodne, do vyúčtování
-- nepůjde – vyúčtovaný řádek se už nemění a rozhodnutí by přišlo pozdě.
--
-- Když se na zakázce nejasné položky změní (někdo ji upraví), rozhodnutí
-- se zahodí a zakázka je ke kontrole znovu – ruční částka patřila jiným
-- opravám.

alter table public.provize_polozky add column if not exists ke_kontrole boolean not null default false;
alter table public.provize_polozky add column if not exists nejasne_opravy text[];
alter table public.provize_polozky add column if not exists rucni_zaklad numeric(12,2);
alter table public.provize_polozky add column if not exists zkontrolovano_at timestamptz;

comment on column public.provize_polozky.ke_kontrole is
  'Zakázka má vyloučenou položku, která zjevně obsahuje i jinou práci; čeká na rozhodnutí majitele a do vyúčtování nejde.';
comment on column public.provize_polozky.nejasne_opravy is
  'Názvy nejasných položek z poslední synchronizace (jen první položka zakázky).';
comment on column public.provize_polozky.rucni_zaklad is
  'Základ zakázky stanovený majitelem ručně. Přebíjí automatický výpočet, dokud se nejasné položky nezmění.';
comment on column public.provize_polozky.zkontrolovano_at is
  'Kdy majitel o nejasné zakázce rozhodl.';

-- ── Je vyloučená položka nejasná? ───────────────────────────────────────────
-- Nejasná = vyloučená (obsahuje vyloučené slovo) a v názvu je víc úkonů
-- spojených dohromady: „+“, čárka, středník, „&“, lomítko, závorka nebo
-- spojka „ a “, „ i “, „ s “, „ plus “, „vč.“, „včetně“. „Výměna baterie“
-- nejasná není, „Výměna baterie + servisní čištění“ ano.
create or replace function public.provize_oprava_nejasna(p_nazev text, p_vylouceno text[])
returns boolean
language sql
immutable
set search_path = public
as $$
  select not public.provize_oprava_zapocitana(p_nazev, p_vylouceno)
     and lower(coalesce(p_nazev, '')) ~ '([+,;&/(]|\s(a|i|s|plus)\s|\mvč\.|\mvčetně\M)';
$$;

comment on function public.provize_oprava_nejasna(text, text[]) is
  'True, když je položka vyloučená a podle názvu obsahuje víc úkonů – cenu musí rozdělit člověk.';

-- Názvy nejasných položek zakázky; prázdné pole = nic nejasného.
create or replace function public.provize_nejasne_opravy(p_opravy jsonb, p_vylouceno text[])
returns text[]
language sql
immutable
set search_path = public
as $$
  select coalesce(array_agg(r ->> 'name' order by n), array[]::text[])
  from jsonb_array_elements(case when jsonb_typeof(p_opravy) = 'array' then p_opravy else '[]'::jsonb end)
       with ordinality as x(r, n)
  where public.provize_oprava_nejasna(r ->> 'name', p_vylouceno);
$$;

-- ── Synchronizace ze zakázek ────────────────────────────────────────────────
-- Proti předchozí verzi (20260926130000):
--   * spočítá nejasné položky a zakázku s nimi označí ke kontrole,
--   * ruční základ (rucni_zaklad) přebíjí automatický i „plnou cenu“,
--   * změna nejasných položek zahodí rozhodnutí a označí zakázku znovu.
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
  v_prvni public.provize_polozky;
  v_rozdil numeric;
  v_nove integer := 0;
  v_doplatky integer := 0;
  v_upraveno integer := 0;
  v_vyloucene integer := 0;
  v_ke_kontrole integer := 0;
  v_cena numeric;
  v_pocitat_vse boolean;
  v_rucni numeric;
  v_zmena_nejasnych boolean;
  v_nejasna boolean;
  v_zmeny jsonb := '[]'::jsonb;
  v_vysledek jsonb;
begin
  select * into n from public.provize_nastaveni where service_id = p_service_id;
  if not found or not n.zapnuto then
    return jsonb_build_object('ok', false, 'duvod', 'provize nejsou pro servis zapnuté');
  end if;

  for r in
    select t.id, t.code, s.label,
           public.provize_cena(t.performed_repairs, t.discount_type, t.discount_value, n.vylouceny_opravy) as cena,
           public.provize_cena(t.performed_repairs, t.discount_type, t.discount_value, null::text[]) as cena_vse,
           public.provize_nejasne_opravy(t.performed_repairs, n.vylouceny_opravy) as nejasne
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
    v_nejasna := cardinality(r.nejasne) > 0;

    select coalesce(sum(zaklad), 0), count(*), coalesce(bool_or(pocitat_vse), false)
    into v_total, v_pocet, v_pocitat_vse
    from public.provize_polozky
    where service_id = p_service_id and zakazka_kod = r.code;

    if v_pocet = 0 then
      if v_nejasna then
        v_ke_kontrole := v_ke_kontrole + 1;
      end if;
      -- Zakázka, na které jsou jen vyloučené opravy, se zapíše jako vyřazená
      -- s nulou a plnou cenou vedle: ať je vidět, co se vyloučilo, a jde to
      -- jedním klikem započítat. Zakázka bez oprav (cena_vse = 0) jako dřív.
      if r.cena = 0 and r.cena_vse > 0 then
        v_vyloucene := v_vyloucene + 1;
        v_zmeny := v_zmeny || jsonb_build_object('kod', r.code, 'akce', 'vyloucena', 'zaklad_plny', r.cena_vse, 'status', r.label, 'ke_kontrole', v_nejasna);
        if not p_nanecisto then
          insert into public.provize_polozky (service_id, ticket_id, zakazka_kod, poradi, zaklad, sazba, provize, status, vyrazeno, poznamka, zaklad_plny, ke_kontrole, nejasne_opravy)
          values (p_service_id, r.id, r.code, 0, 0, n.sazba, 0, r.label, true, 'jen vyloučené opravy', r.cena_vse, v_nejasna, case when v_nejasna then r.nejasne end);
        end if;
        continue;
      end if;
      v_nove := v_nove + 1;
      v_zmeny := v_zmeny || jsonb_build_object('kod', r.code, 'akce', 'nova', 'zaklad', r.cena, 'status', r.label, 'ke_kontrole', v_nejasna);
      if not p_nanecisto then
        insert into public.provize_polozky (service_id, ticket_id, zakazka_kod, poradi, zaklad, sazba, provize, status, zaklad_plny, ke_kontrole, nejasne_opravy)
        values (p_service_id, r.id, r.code, 0, r.cena, n.sazba, round(r.cena * n.sazba, 2), r.label, r.cena_vse, v_nejasna, case when v_nejasna then r.nejasne end);
      end if;
      continue;
    end if;

    select * into v_prvni from public.provize_polozky
    where service_id = p_service_id and zakazka_kod = r.code and poradi = 0;

    -- Nejasné položky se změnily (zakázku někdo upravil, nebo se změnil
    -- seznam vyloučených slov) → staré rozhodnutí neplatí.
    v_zmena_nejasnych := coalesce(v_prvni.nejasne_opravy, array[]::text[]) is distinct from r.nejasne;
    v_rucni := case when v_zmena_nejasnych then null else v_prvni.rucni_zaklad end;

    -- Pořadí přednosti: ruční částka > „započítat plně“ > automat.
    v_cena := case
      when v_rucni is not null then v_rucni
      when v_pocitat_vse then r.cena_vse
      else r.cena end;

    if v_nejasna and v_prvni.vyuctovani_id is null
       and (v_zmena_nejasnych or v_prvni.zkontrolovano_at is null) then
      v_ke_kontrole := v_ke_kontrole + 1;
    end if;

    -- Plná cena a stav kontroly se u první položky drží aktuální i beze
    -- změny základu. Vyúčtovaný řádek už ke kontrole není – rozhodnutí by
    -- přišlo pozdě, zdražení jde do doplatku jako dřív.
    if not p_nanecisto then
      update public.provize_polozky
      set zaklad_plny = r.cena_vse,
          nejasne_opravy = case when v_nejasna then r.nejasne end,
          ke_kontrole = v_nejasna and vyuctovani_id is null
                        and (v_zmena_nejasnych or zkontrolovano_at is null),
          zkontrolovano_at = case when v_zmena_nejasnych then null else zkontrolovano_at end,
          rucni_zaklad = case when v_zmena_nejasnych then null else rucni_zaklad end
      where id = v_prvni.id
        and (zaklad_plny is distinct from r.cena_vse
             or v_zmena_nejasnych
             or ke_kontrole is distinct from (v_nejasna and vyuctovani_id is null and zkontrolovano_at is null));
    end if;

    v_rozdil := v_cena - v_total;
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
        if v_cena = 0 and r.cena_vse > 0 then
          v_vyloucene := v_vyloucene + 1;
        end if;
        v_zmeny := v_zmeny || jsonb_build_object('kod', r.code, 'akce', 'uprava', 'z', v_posl.zaklad, 'na', greatest(0, v_posl.zaklad + v_rozdil));
        if not p_nanecisto then
          update public.provize_polozky
          set zaklad = greatest(0, zaklad + v_rozdil),
              provize = round(greatest(0, zaklad + v_rozdil) * coalesce(sazba, n.sazba), 2),
              sazba = coalesce(sazba, n.sazba),
              status = r.label,
              ticket_id = coalesce(ticket_id, r.id),
              vyrazeno = case
                when v_cena = 0 and r.cena_vse > 0 then true
                when poznamka = 'jen vyloučené opravy' then false
                else vyrazeno end,
              poznamka = case
                when v_cena = 0 and r.cena_vse > 0 then 'jen vyloučené opravy'
                when poznamka = 'jen vyloučené opravy' then null
                else poznamka end
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

  -- Sledované stavy platí i zpětně (beze změny proti 20260926130000).
  if not p_nanecisto then
    update public.provize_polozky p
    set vyrazeno = true, poznamka = 'stav mimo sledované'
    from public.tickets t
    left join public.service_statuses s on s.service_id = t.service_id and s.key = t.status
    where p.service_id = p_service_id and p.vyuctovani_id is null and p.poradi = 0 and not p.vyrazeno
      and t.id = p.ticket_id and t.deleted_at is null
      and (s.label is null or not (s.label = any (n.statusy)));

    update public.provize_polozky p
    set vyrazeno = false, poznamka = null
    from public.tickets t
    join public.service_statuses s on s.service_id = t.service_id and s.key = t.status
    where p.service_id = p_service_id and p.vyuctovani_id is null and p.poznamka = 'stav mimo sledované'
      and t.id = p.ticket_id and s.label = any (n.statusy);
  end if;

  v_vysledek := jsonb_build_object('ok', true, 'nanecisto', p_nanecisto, 'nove', v_nove, 'doplatky', v_doplatky, 'upraveno', v_upraveno, 'vyloucene', v_vyloucene, 'ke_kontrole', v_ke_kontrole);
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

-- ── Rozhodnutí majitele ─────────────────────────────────────────────────────
--   'bez'    – bez vyloučených položek (automatický výpočet),
--   'plne'   – plná cena včetně vyloučených položek,
--   'castka' – vlastní základ p_zaklad (0 až plná cena).
create or replace function public.provize_rozhodni(p_id bigint, p_volba text, p_zaklad numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.provize_polozky;
begin
  if not public.je_root_owner() then
    raise exception 'Jen majitel aplikace.' using errcode = '42501';
  end if;
  select * into p from public.provize_polozky where id = p_id and poradi = 0;
  if not found then
    raise exception 'Položka neexistuje nebo je to doplatek.';
  end if;
  if p.vyuctovani_id is not null then
    raise exception 'Vyúčtovaný řádek se nemění.';
  end if;
  if p_volba not in ('bez', 'plne', 'castka') then
    raise exception 'Neznámá volba %.', p_volba;
  end if;
  if p_volba = 'castka' then
    if p_zaklad is null or p_zaklad < 0 then
      raise exception 'Částka musí být nula nebo víc.';
    end if;
    if p.zaklad_plny is not null and p_zaklad > p.zaklad_plny then
      raise exception 'Částka % je vyšší než cena celé zakázky %.', p_zaklad, p.zaklad_plny;
    end if;
  end if;

  update public.provize_polozky
  set pocitat_vse = (p_volba = 'plne'),
      rucni_zaklad = case when p_volba = 'castka' then round(p_zaklad, 2) end,
      zkontrolovano_at = now(),
      ke_kontrole = false,
      vyrazeno = case when p_volba = 'bez' then vyrazeno else false end,
      poznamka = case
        when p_volba = 'plne' then 'započítáno včetně vyloučených oprav'
        when p_volba = 'castka' then 'základ stanoven ručně'
        when poznamka in ('započítáno včetně vyloučených oprav', 'základ stanoven ručně') then null
        else poznamka end
  where id = p_id;

  -- Základ srovná synchronizace podle rozhodnutí.
  perform public.provize_synchronizuj_interni(p.service_id, false);
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.provize_rozhodni(bigint, text, numeric) from public, anon;
grant execute on function public.provize_rozhodni(bigint, text, numeric) to authenticated;

-- „Započítat plně / Zase vyloučit“ ze starší verze panelu: vypnutí smaže
-- i ruční částku, ať se nepřebíjejí dvě různá rozhodnutí.
create or replace function public.provize_pocitat_vse(p_id bigint, p_zapnout boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.provize_rozhodni(p_id, case when p_zapnout then 'plne' else 'bez' end, null);
end;
$$;

revoke all on function public.provize_pocitat_vse(bigint, boolean) from public, anon;
grant execute on function public.provize_pocitat_vse(bigint, boolean) to authenticated;

-- ── Vyúčtování bez zakázek ke kontrole ──────────────────────────────────────
-- Stejné jako 20260918180000, jen řádky ke kontrole počkají na rozhodnutí.
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
  v_ceka integer;
begin
  if not public.je_root_owner() then
    raise exception 'Jen majitel aplikace.' using errcode = '42501';
  end if;

  perform public.provize_synchronizuj_interni(p_service_id, false);

  if v_oznaceni is null then
    v_oznaceni := to_char(now() at time zone 'Europe/Prague', 'FMDD. FMMM. YYYY');
    if exists (select 1 from public.provize_vyuctovani where service_id = p_service_id and oznaceni = v_oznaceni) then
      v_oznaceni := v_oznaceni || to_char(now() at time zone 'Europe/Prague', ' HH24:MI');
    end if;
  end if;

  select count(*) into v_ceka
  from public.provize_polozky
  where service_id = p_service_id and vyuctovani_id is null and ke_kontrole;

  select count(*), coalesce(sum(zaklad), 0), coalesce(sum(provize), 0)
  into v_pocet, v_zaklad, v_provize
  from public.provize_polozky
  where service_id = p_service_id and vyuctovani_id is null and not vyrazeno and not ke_kontrole;

  if v_pocet = 0 then
    return jsonb_build_object('ok', true, 'pocet', 0, 'oznaceni', v_oznaceni, 'ceka_na_kontrolu', v_ceka);
  end if;

  insert into public.provize_vyuctovani (service_id, oznaceni, pocet, soucet_zaklad, soucet_provize)
  values (p_service_id, v_oznaceni, v_pocet, v_zaklad, v_provize)
  returning id into v_id;

  update public.provize_polozky
  set vyuctovani_id = v_id
  where service_id = p_service_id and vyuctovani_id is null and not vyrazeno and not ke_kontrole;

  return jsonb_build_object('ok', true, 'id', v_id, 'oznaceni', v_oznaceni, 'pocet', v_pocet, 'soucet_zaklad', v_zaklad, 'soucet_provize', v_provize, 'ceka_na_kontrolu', v_ceka);
end;
$$;

revoke all on function public.provize_vyuctuj(uuid, text) from public, anon;
grant execute on function public.provize_vyuctuj(uuid, text) to authenticated;

-- ── Přehled pro panel ───────────────────────────────────────────────────────
-- Proti 20260926120000 navíc stav kontroly, ruční částka, automatický
-- základ a u zakázek s nejasnými položkami rozpis oprav – ať jde rozhodnout
-- bez otevírání zakázky.
create or replace function public.provize_prehled(p_service_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_vylouceno text[];
begin
  if not public.je_root_owner() then
    raise exception 'Jen majitel aplikace.' using errcode = '42501';
  end if;
  select vylouceny_opravy into v_vylouceno from public.provize_nastaveni where service_id = p_service_id;
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
        'poznamka', p.poznamka, 'zaklad_plny', p.zaklad_plny, 'pocitat_vse', p.pocitat_vse,
        'ke_kontrole', p.ke_kontrole, 'nejasne_opravy', p.nejasne_opravy,
        'rucni_zaklad', p.rucni_zaklad, 'zkontrolovano_at', p.zkontrolovano_at,
        'zaklad_auto', case when p.nejasne_opravy is not null then (
          select public.provize_cena(t.performed_repairs, t.discount_type, t.discount_value, v_vylouceno)
          from public.tickets t where t.id = p.ticket_id) end,
        'opravy', case when p.nejasne_opravy is not null then (
          select coalesce(jsonb_agg(jsonb_build_object(
                   'nazev', r ->> 'name',
                   'cena', r -> 'price',
                   'pocita', public.provize_oprava_zapocitana(r ->> 'name', v_vylouceno),
                   'nejasna', public.provize_oprava_nejasna(r ->> 'name', v_vylouceno))), '[]'::jsonb)
          from public.tickets t
          cross join jsonb_array_elements(case when jsonb_typeof(t.performed_repairs) = 'array' then t.performed_repairs else '[]'::jsonb end) r
          where t.id = p.ticket_id) end,
        'zarizeni', (select coalesce(nullif(btrim(t.title), ''), t.device_label) from public.tickets t where t.id = p.ticket_id),
        'stav_ted', (select s.label from public.tickets t join public.service_statuses s on s.service_id = t.service_id and s.key = t.status where t.id = p.ticket_id)
      ) order by p.ke_kontrole desc, p.zapsano_at desc, p.id desc)
      from public.provize_polozky p where p.service_id = p_service_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.provize_prehled(uuid) from public, anon;
grant execute on function public.provize_prehled(uuid) to authenticated;
