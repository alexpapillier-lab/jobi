-- ============================================================================
-- GDPR: automatická anonymizace starých zákazníků
-- ============================================================================
--
-- PROČ: Servis nesmí osobní údaje zákazníků držet napořád. Pravidlo
-- „zákazníka, který nemá žádnou zakázku mladší než N let, anonymizovat“
-- (N = 3–10, výchozí 5) si zapne správce v Nastavení → Firma → Ochrana
-- údajů. Podrobně, co se maže a proč: docs/GDPR_ANONYMIZACE.md.
--
-- Co se anonymizuje (u zákazníka a všech jeho zakázek a reklamací):
--   - jméno → „Anonymizovaný zákazník #<začátek id>“, telefon, e-mail,
--     adresa, poznámka, info → null; IČO, DIČ a firma zůstávají,
--   - na zakázkách kód zařízení, podpis převzetí, fotky, odkaz do portálu
--     a otisk schválení nabídky (IP, prohlížeč) → pryč,
--   - historie zakázky (ticket_history) přijde o osobní klíče, historie
--     karty zákazníka (customer_history) se smaže celá,
--   - SMS konverzace s ním se smažou (i se zprávami),
--   - události portálu a log automatizací přijdou o detail (IP, telefon),
--   - soubory (fotky, podpisy) se zapíšou do fronty a smaže je edge funkce
--     gdpr-anonymizace přes Storage API – Supabase přímé mazání ze
--     storage.objects nedovolí.
--
-- Co se NEMĚNÍ: faktury a jejich položky (účetní doklad, archivace 10 let),
-- zakázky jako záznam (číslo, zařízení, opravy, ceny – kvůli statistikám
-- a záruce), IČO/DIČ/firma (identifikují právnickou osobu nebo podnikatele
-- z veřejného rejstříku a stejně zůstávají na fakturách).
--
-- Kdo je kandidát – musí odpovídat src/lib/anonymizace.ts (vyberKandidaty):
--   poslední aktivita = nejpozdější created_at/completed_at jeho zakázek,
--   data reklamací a vystavení faktur; bez nich datum založení karty.
--   Nikdy: otevřená zakázka/reklamace, nezaplacená faktura.
--
-- Nevratné. Proto:
--   - náhled (anonymizace_nahled) ukáže, koho se to dotkne,
--   - spuštění (anonymizace_spustit) chce napsané slovo ANONYMIZOVAT a jen
--     od majitele/správce servisu,
--   - denní cron (jobi-gdpr-anonymizace) servis zpracuje, jen když správce
--     aspoň jednou spustil anonymizaci ručně se stejně nebo přísněji
--     nastaveným počtem let. První běh tedy nikdy není automatický a ani
--     zpřísnění pravidla (5 → 3 roky) se bez nového potvrzení nepoužije.
--
-- Nastavení žije v service_settings.config.gdpr.anonymizacePoLetech
-- (null = vypnuto), stejně jako ostatní nastavení servisu. Zapisuje se
-- přes anonymizace_nastavit (jen správce) – obecné update_service_settings
-- by ho pustilo i členovi s právem „nastavení servisu“; kdyby ho přesto
-- někdo přepsal, cron podle předchozího odstavce stejně nepoužije nic, co
-- správce nepotvrdil.
--
-- Nasazení: docs/GDPR_ANONYMIZACE.md → „Nasazení“.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Poznačení anonymizované karty
-- ---------------------------------------------------------------------------
alter table public.customers add column if not exists anonymized_at timestamptz;
comment on column public.customers.anonymized_at is
  'Kdy byla karta anonymizována (GDPR, anonymizace_spustit). Null = běžná karta. Podruhé se neanonymizuje.';

-- ---------------------------------------------------------------------------
-- 2) Protokol běhů
-- ---------------------------------------------------------------------------
create table if not exists public.gdpr_anonymizace_log (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  spusteno_at timestamptz not null default now(),
  -- 'rucne' = správce v Nastavení (napsal potvrzovací slovo), 'cron' = denní úloha
  zdroj text not null check (zdroj in ('rucne', 'cron')),
  spustil uuid references auth.users(id) on delete set null,
  po_letech integer not null check (po_letech between 3 and 10),
  hranice timestamptz not null,
  pocet_zakazniku integer not null default 0,
  -- zakázky bez karty zákazníka (jméno a telefon jen na zakázce)
  pocet_zakazek_bez_karty integer not null default 0,
  -- všechny dotčené zakázky (zákazníků i bez karty)
  pocet_zakazek integer not null default 0,
  pocet_reklamaci integer not null default 0,
  pocet_sms_konverzaci integer not null default 0,
  pocet_souboru integer not null default 0,
  -- id anonymizovaných záznamů – po anonymizaci už nic neprozradí, ale
  -- dohledá se podle nich, jestli a kdy se konkrétní karta anonymizovala
  zakaznici uuid[] not null default '{}',
  zakazky uuid[] not null default '{}',
  -- cesty v bucketu diagnostic-photos, které ještě čekají na smazání
  soubory_cekaji text[] not null default '{}',
  soubory_smazano_at timestamptz,
  chyba_souboru text
);
create index if not exists gdpr_anonymizace_log_service_idx
  on public.gdpr_anonymizace_log (service_id, spusteno_at desc);
create index if not exists gdpr_anonymizace_log_cekaji_idx
  on public.gdpr_anonymizace_log (spusteno_at)
  where soubory_cekaji <> '{}';

alter table public.gdpr_anonymizace_log enable row level security;
drop policy if exists gdpr_anonymizace_log_cteni on public.gdpr_anonymizace_log;
create policy gdpr_anonymizace_log_cteni on public.gdpr_anonymizace_log
  for select to authenticated
  using (public.is_owner_or_admin(service_id));
-- Zapisují jen funkce níže (security definer) a edge funkce pod service_role.
revoke all on table public.gdpr_anonymizace_log from anon, authenticated;
grant select on table public.gdpr_anonymizace_log to authenticated;
grant select, insert, update, delete on table public.gdpr_anonymizace_log to service_role;
comment on table public.gdpr_anonymizace_log is
  'GDPR anonymizace: jeden řádek na běh (ručně/cron) – kolik čeho, kdo, fronta souborů ke smazání. Čte majitel/správce servisu.';

-- ---------------------------------------------------------------------------
-- 3) Pomocné funkce
-- ---------------------------------------------------------------------------

-- Nastavený počet let (celé číslo 3–10), jinak null = vypnuto.
create or replace function public.anonymizace_po_letech(p_service_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case
    when jsonb_typeof(v) = 'number'
     and (v #>> '{}')::numeric = trunc((v #>> '{}')::numeric)
     and (v #>> '{}')::numeric between 3 and 10
    then (v #>> '{}')::numeric::integer
  end
  from (
    select s.config -> 'gdpr' -> 'anonymizacePoLetech' as v
    from public.service_settings s
    where s.service_id = p_service_id
  ) x;
$$;
revoke all on function public.anonymizace_po_letech(uuid) from public, anon, authenticated;
grant execute on function public.anonymizace_po_letech(uuid) to service_role;

-- „Anonymizovaný zákazník #1a2b3c4d“ (stejně jako anonymniJmeno v src/lib/anonymizace.ts).
create or replace function public.anonymizace_jmeno(p_customer_id uuid)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_customer_id is null then 'Anonymizovaný zákazník'
    else 'Anonymizovaný zákazník' || ' #' || left(replace(p_customer_id::text, '-', ''), 8)
  end;
$$;
revoke all on function public.anonymizace_jmeno(uuid) from public, anon;
grant execute on function public.anonymizace_jmeno(uuid) to authenticated, service_role;

-- Cesta v bucketu diagnostic-photos z uložené URL (veřejný, podepsaný tvar
-- i holá cesta) – stejně jako cestaFotky v src/lib/podepsaneFotky.ts.
create or replace function public.anonymizace_cesta(p_url text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_url is null or btrim(p_url) = '' or btrim(p_url) like 'data:%' then null
    when btrim(p_url) ~* '^https?://' then
      (regexp_match(btrim(p_url), '/storage/v1/object/(public|sign|authenticated)/diagnostic-photos/([^?#]+)'))[2]
    else nullif(regexp_replace(split_part(btrim(p_url), '?', 1), '^/+', ''), '')
  end;
$$;
revoke all on function public.anonymizace_cesta(text) from public, anon;
grant execute on function public.anonymizace_cesta(text) to authenticated, service_role;

-- Všechny odkazy na soubory u zakázky (fotky před/po, podpis převzetí).
create or replace function public.anonymizace_odkazy_zakazky(p_photos jsonb, p_before jsonb, p_signature text)
returns setof text
language sql
immutable
set search_path = public
as $$
  select e #>> '{}'
  from jsonb_array_elements(case when jsonb_typeof(p_photos) = 'array' then p_photos else '[]'::jsonb end) e
  where jsonb_typeof(e) = 'string'
  union all
  select e #>> '{}'
  from jsonb_array_elements(case when jsonb_typeof(p_before) = 'array' then p_before else '[]'::jsonb end) e
  where jsonb_typeof(e) = 'string'
  union all
  select p_signature where p_signature is not null;
$$;
revoke all on function public.anonymizace_odkazy_zakazky(jsonb, jsonb, text) from public, anon;
grant execute on function public.anonymizace_odkazy_zakazky(jsonb, jsonb, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) Kdo je kandidát (stejné pravidlo jako vyberKandidaty v src/lib/anonymizace.ts)
-- ---------------------------------------------------------------------------
-- druh = 'zakaznik' (karta zákazníka) nebo 'zakazka' (zakázka bez karty).
create or replace function public.anonymizace_kandidati(p_service_id uuid, p_hranice timestamptz)
returns table (druh text, id uuid, jmeno text, kod text, posledni timestamptz, zakazek integer)
language sql
stable
security definer
set search_path = public
as $$
  with koncove as (
    select st.key from public.service_statuses st
    where st.service_id = p_service_id and st.is_final
  ),
  zak as (
    select
      t.id,
      t.customer_id,
      greatest(t.created_at, t.completed_at) as posledni,
      -- Nesmazaná a ne v koncovém stavu = otevřená. Neznámý stav je otevřená (opatrně).
      (t.deleted_at is null
        and coalesce(nullif(t.status, ''), 'received') not in (select k.key from koncove k)) as otevrena
    from public.tickets t
    where t.service_id = p_service_id
  ),
  rekl as (
    select
      coalesce(w.customer_id, z.customer_id) as customer_id,
      w.source_ticket_id,
      greatest(w.created_at, w.received_at, w.released_at, w.completed_at) as posledni,
      coalesce(nullif(w.status, ''), 'received') not in (select k.key from koncove k) as otevrena
    from public.warranty_claims w
    left join zak z on z.id = w.source_ticket_id
    where w.service_id = p_service_id
  ),
  fakt as (
    select
      coalesce(i.customer_id, z.customer_id) as customer_id,
      i.ticket_id,
      i.issue_date::timestamptz as posledni,
      (i.deleted_at is null and i.paid_at is null and i.status in ('issued', 'sent', 'overdue')) as nezaplacena
    from public.invoices i
    left join zak z on z.id = i.ticket_id
    where i.service_id = p_service_id
  ),
  aktivita as (
    select a.customer_id, max(a.posledni) as posledni, bool_or(a.otevrena) as otevrena, bool_or(a.nezaplacena) as nezaplacena
    from (
      select z.customer_id, z.posledni, z.otevrena, false as nezaplacena from zak z where z.customer_id is not null
      union all
      select r.customer_id, r.posledni, r.otevrena, false from rekl r where r.customer_id is not null
      union all
      select f.customer_id, f.posledni, false, f.nezaplacena from fakt f where f.customer_id is not null
    ) a
    group by a.customer_id
  ),
  pocty as (
    select z.customer_id, count(*)::integer as pocet from zak z where z.customer_id is not null group by z.customer_id
  )
  select 'zakaznik'::text, c.id, c.name, null::text, coalesce(a.posledni, c.created_at), coalesce(p.pocet, 0)
  from public.customers c
  left join aktivita a on a.customer_id = c.id
  left join pocty p on p.customer_id = c.id
  where c.service_id = p_service_id
    and c.anonymized_at is null
    and not coalesce(a.otevrena, false)
    and not coalesce(a.nezaplacena, false)
    -- Bez zakázek, reklamací a faktur rozhoduje založení karty.
    and coalesce(a.posledni, c.created_at) < p_hranice

  union all

  -- Zakázky bez karty zákazníka: každá sama za sebe.
  select 'zakazka'::text, t.id, t.customer_name, t.code, z.posledni, 1
  from public.tickets t
  join zak z on z.id = t.id
  where t.service_id = p_service_id
    and t.customer_id is null
    and not z.otevrena
    and z.posledni < p_hranice
    and not exists (select 1 from fakt f where f.ticket_id = t.id and f.nezaplacena)
    and not exists (select 1 from rekl r where r.source_ticket_id = t.id and (r.otevrena or r.posledni >= p_hranice))
    -- Je na ní ještě co anonymizovat?
    and (
      (t.customer_name is not null and t.customer_name not like 'Anonymizovaný zákazník%')
      or t.customer_phone is not null or t.customer_email is not null
      or t.customer_address_street is not null or t.customer_address_city is not null
      or t.customer_address_zip is not null or t.customer_info is not null
      or t.device_passcode is not null or t.intake_signature_url is not null
      or t.portal_token is not null or t.quote_decision_meta is not null
      or (t.diagnostic_photos is not null and t.diagnostic_photos not in ('[]'::jsonb, 'null'::jsonb))
      or (t.diagnostic_photos_before is not null and t.diagnostic_photos_before not in ('[]'::jsonb, 'null'::jsonb))
    );
$$;
revoke all on function public.anonymizace_kandidati(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.anonymizace_kandidati(uuid, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 5) Soubory ke smazání: fotky a podpisy dotčených zakázek
-- ---------------------------------------------------------------------------
-- Z odkazů uložených u zakázek i z toho, co v úložišti leží ve složce zakázky
-- (<service_id>/<ticket_id>/…) a v signatures/<ticket_id>-…. Jen cesty, které
-- tomuhle servisu opravdu patří (odkaz u zakázky je zapisovatelný, nesmí
-- přes něj jít smazat cizí soubor), a ne ty, na které se ještě odkazuje jiná
-- zakázka (sloučené zakázky sdílejí fotky).
create or replace function public.anonymizace_soubory(p_service_id uuid, p_zakazky uuid[])
returns text[]
language sql
stable
security definer
set search_path = public, storage
as $$
  with dotcene as (
    select unnest(coalesce(p_zakazky, '{}'::uuid[])) as id
  ),
  z_odkazu as (
    select public.anonymizace_cesta(u) as cesta
    from public.tickets t
    cross join lateral public.anonymizace_odkazy_zakazky(t.diagnostic_photos, t.diagnostic_photos_before, t.intake_signature_url) u
    where t.service_id = p_service_id and t.id in (select d.id from dotcene d)
  ),
  z_uloziste as (
    select o.name as cesta
    from storage.objects o
    where o.bucket_id = 'diagnostic-photos'
      and (
        (o.name like p_service_id::text || '/%'
          and split_part(o.name, '/', 2) in (select d.id::text from dotcene d))
        or (o.name like 'signatures/%'
          and substring(o.name from '^signatures/([0-9a-fA-F-]{36})-') in (select d.id::text from dotcene d))
      )
  ),
  kandidati as (
    select distinct c.cesta from (select cesta from z_odkazu union all select cesta from z_uloziste) c
    where c.cesta is not null
      and (
        c.cesta like p_service_id::text || '/%'
        or substring(c.cesta from '^signatures/([0-9a-fA-F-]{36})-') in (select d.id::text from dotcene d)
      )
  ),
  jinde as (
    select public.anonymizace_cesta(u) as cesta
    from public.tickets t
    cross join lateral public.anonymizace_odkazy_zakazky(t.diagnostic_photos, t.diagnostic_photos_before, t.intake_signature_url) u
    where t.service_id = p_service_id and t.id not in (select d.id from dotcene d)
  )
  select coalesce(array_agg(k.cesta order by k.cesta), '{}'::text[])
  from kandidati k
  where not exists (select 1 from jinde j where j.cesta = k.cesta);
$$;
revoke all on function public.anonymizace_soubory(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.anonymizace_soubory(uuid, uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- 6) Náhled: koho se to dotkne
-- ---------------------------------------------------------------------------
create or replace function public.anonymizace_nahled(p_service_id uuid, p_po_letech integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, storage
as $$
declare
  v_nastaveno integer;
  v_let integer;
  v_hranice timestamptz;
  v_vysledek jsonb;
begin
  if auth.role() is distinct from 'service_role'
     and (auth.uid() is null or not public.is_owner_or_admin(p_service_id)) then
    raise exception 'Náhled anonymizace vidí jen majitel nebo správce servisu.' using errcode = '42501';
  end if;
  v_nastaveno := public.anonymizace_po_letech(p_service_id);
  v_let := coalesce(p_po_letech, v_nastaveno, 5);
  if v_let not between 3 and 10 then
    raise exception 'Počet let musí být 3 až 10.' using errcode = '22023';
  end if;
  v_hranice := now() - make_interval(years => v_let);

  -- Jeden dotaz (funkce je stable a PostgREST ji pouští v transakci jen pro čtení).
  with k as materialized (
    select * from public.anonymizace_kandidati(p_service_id, v_hranice)
  ),
  ids as (
    select coalesce(array_agg(k.id) filter (where k.druh = 'zakaznik'), '{}'::uuid[]) as zakaznici,
           coalesce(array_agg(k.id) filter (where k.druh = 'zakazka'), '{}'::uuid[]) as bez_karty
    from k
  ),
  zak as (
    select coalesce(array_agg(t.id), '{}'::uuid[]) as zakazky
    from public.tickets t, ids
    where t.service_id = p_service_id and (t.customer_id = any(ids.zakaznici) or t.id = any(ids.bez_karty))
  )
  select jsonb_build_object(
    'poLetech', v_let,
    'nastaveno', v_nastaveno,
    'hranice', v_hranice,
    'pocetZakazniku', cardinality(ids.zakaznici),
    'pocetZakazekBezKarty', cardinality(ids.bez_karty),
    'pocetZakazek', cardinality(zak.zakazky),
    'pocetSouboru', cardinality(public.anonymizace_soubory(p_service_id, zak.zakazky)),
    'idZakazniku', to_jsonb(ids.zakaznici),
    'idZakazek', to_jsonb(ids.bez_karty),
    -- Seznam do dialogu: nejstarší napřed, nejvýš 300 (celkový počet je výše).
    'zakaznici', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'jmeno', x.jmeno, 'posledni', x.posledni, 'zakazek', x.zakazek) order by x.posledni, x.jmeno)
      from (select * from k where k.druh = 'zakaznik' order by k.posledni, k.jmeno limit 300) x
    ), '[]'::jsonb),
    'zakazkyBezKarty', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'jmeno', x.jmeno, 'kod', x.kod, 'posledni', x.posledni) order by x.posledni, x.kod)
      from (select * from k where k.druh = 'zakazka' order by k.posledni, k.kod limit 300) x
    ), '[]'::jsonb),
    -- Smí denní úloha pokračovat sama? Jen po ručním běhu se stejně nebo přísněji nastaveným počtem let.
    'potvrzenoRucne', exists (
      select 1 from public.gdpr_anonymizace_log l
      where l.service_id = p_service_id and l.zdroj = 'rucne' and l.po_letech <= v_let
    ),
    'automatickyBezi', v_nastaveno is not null and exists (
      select 1 from public.gdpr_anonymizace_log l
      where l.service_id = p_service_id and l.zdroj = 'rucne' and l.po_letech <= v_nastaveno
    )
  )
  into v_vysledek
  from ids, zak;

  return v_vysledek;
end;
$$;
revoke all on function public.anonymizace_nahled(uuid, integer) from public, anon;
grant execute on function public.anonymizace_nahled(uuid, integer) to authenticated, service_role;
comment on function public.anonymizace_nahled(uuid, integer) is
  'GDPR: kolik a kterých zákazníků (a zakázek bez karty) by anonymizace zasáhla. Bez p_po_letech podle nastavení (nebo 5). Jen majitel/správce.';

-- ---------------------------------------------------------------------------
-- 7) Provedení (vnitřní, jen service_role a funkce níže)
-- ---------------------------------------------------------------------------
create or replace function public.anonymizace_provest(p_service_id uuid, p_zdroj text, p_spustil uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, storage
as $$
declare
  v_let integer;
  v_hranice timestamptz;
  v_zakaznici uuid[];
  v_bez_karty uuid[];
  v_zakazky uuid[];
  v_reklamace uuid[];
  v_telefony text[];
  v_soubory text[];
  v_sms integer := 0;
  v_log uuid;
  -- Klíče historie zakázky s osobními údaji (nebo odkazy na smazané soubory).
  c_klice constant text[] := array[
    'customer_name', 'customer_phone', 'customer_email',
    'customer_address_street', 'customer_address_city', 'customer_address_zip', 'customer_address_country',
    'customer_info', 'device_passcode', 'intake_signature_url',
    'diagnostic_photos', 'diagnostic_photos_before',
    'quote_decision_meta', 'portal_token', 'portal_token_expires_at'
  ];
begin
  if p_zdroj not in ('rucne', 'cron') then
    raise exception 'Neznámý zdroj spuštění.' using errcode = '22023';
  end if;
  v_let := public.anonymizace_po_letech(p_service_id);
  if v_let is null then
    raise exception 'Pravidlo anonymizace je vypnuté – nejdřív ho zapněte a uložte počet let.' using errcode = '22023';
  end if;
  if p_zdroj = 'cron' and not exists (
    select 1 from public.gdpr_anonymizace_log l
    where l.service_id = p_service_id and l.zdroj = 'rucne' and l.po_letech <= v_let
  ) then
    raise exception 'První anonymizaci musí ručně potvrdit správce servisu (i po zpřísnění počtu let).' using errcode = '42501';
  end if;

  -- Dva běhy téhož servisu naráz (ruční + cron) by si šlapaly po frontě souborů.
  perform pg_advisory_xact_lock(hashtextextended('gdpr_anonymizace:' || p_service_id::text, 0));

  v_hranice := now() - make_interval(years => v_let);

  select coalesce(array_agg(k.id) filter (where k.druh = 'zakaznik'), '{}'),
         coalesce(array_agg(k.id) filter (where k.druh = 'zakazka'), '{}')
    into v_zakaznici, v_bez_karty
  from public.anonymizace_kandidati(p_service_id, v_hranice) k;

  -- Denní úloha bez práce nic nezapisuje – protokol by zaplavily prázdné řádky.
  if p_zdroj = 'cron' and cardinality(v_zakaznici) = 0 and cardinality(v_bez_karty) = 0 then
    return jsonb_build_object('logId', null, 'pocetZakazniku', 0, 'pocetZakazekBezKarty', 0, 'pocetZakazek', 0, 'soubory', '[]'::jsonb);
  end if;

  select coalesce(array_agg(t.id), '{}') into v_zakazky
  from public.tickets t
  where t.service_id = p_service_id and (t.customer_id = any(v_zakaznici) or t.id = any(v_bez_karty));

  select coalesce(array_agg(w.id), '{}') into v_reklamace
  from public.warranty_claims w
  where w.service_id = p_service_id
    and (w.customer_id = any(v_zakaznici) or (w.customer_id is null and w.source_ticket_id = any(v_zakazky)));

  -- Telefony pro SMS konverzace: jen ty, které nepatří i jinému (neanonymizovanému) zákazníkovi.
  select coalesce(array_agg(distinct c.phone_norm), '{}') into v_telefony
  from public.customers c
  where c.service_id = p_service_id and c.id = any(v_zakaznici) and c.phone_norm is not null
    and not exists (
      select 1 from public.customers c2
      where c2.service_id = p_service_id and c2.phone_norm = c.phone_norm and not (c2.id = any(v_zakaznici))
    );

  -- Soubory ještě podle odkazů, které se za chvíli vymažou.
  v_soubory := public.anonymizace_soubory(p_service_id, v_zakazky);

  -- Zakázky: osobní údaje pryč, zakázka jako záznam zůstává. IČO a firma zůstávají.
  update public.tickets t set
    customer_name = public.anonymizace_jmeno(case when t.customer_id = any(v_zakaznici) then t.customer_id end),
    customer_phone = null,
    customer_email = null,
    customer_address_street = null,
    customer_address_city = null,
    customer_address_zip = null,
    customer_address_country = null,
    customer_info = null,
    device_passcode = null,
    intake_signature_url = null,
    diagnostic_photos = '[]'::jsonb,
    diagnostic_photos_before = '[]'::jsonb,
    portal_token = null,
    portal_token_expires_at = null,
    quote_decision_meta = null
  where t.service_id = p_service_id and t.id = any(v_zakazky);

  -- Historie zakázky: trigger právě zapsal staré hodnoty (jméno, telefon…) –
  -- z historie se osobní klíče odstraní, a to i ze starších záznamů.
  update public.ticket_history h set details =
    case when jsonb_typeof(h.details -> 'changes') = 'object'
      then jsonb_set(h.details - c_klice, '{changes}', (h.details -> 'changes') - c_klice)
      else h.details - c_klice
    end
  where h.service_id = p_service_id and h.ticket_id = any(v_zakazky)
    and (h.details ?| c_klice or (jsonb_typeof(h.details -> 'changes') = 'object' and (h.details -> 'changes') ?| c_klice));
  -- Záznamy „upraveno“, ve kterých po vyčištění nic nezbylo (i ten dnešní), pryč.
  delete from public.ticket_history h
  where h.service_id = p_service_id and h.ticket_id = any(v_zakazky)
    and h.action = 'updated' and h.details -> 'changes' = '{}'::jsonb;

  -- Reklamace zákazníka: stejné sloupce jako zakázka.
  update public.warranty_claims w set
    customer_name = public.anonymizace_jmeno(case when w.customer_id = any(v_zakaznici) then w.customer_id end),
    customer_phone = null,
    customer_email = null,
    customer_address_street = null,
    customer_address_city = null,
    customer_address_zip = null,
    customer_address_country = null,
    customer_info = null,
    device_passcode = null
  where w.service_id = p_service_id and w.id = any(v_reklamace);
  -- Trigger historie reklamace zapsal prázdné „updated“ – nic neříká, pryč.
  delete from public.warranty_claim_history h
  where h.service_id = p_service_id and h.warranty_claim_id = any(v_reklamace)
    and h.action = 'updated' and h.details = '{}'::jsonb and h.created_at = now();

  -- Karta zákazníka.
  update public.customers c set
    name = public.anonymizace_jmeno(c.id),
    phone = null,
    phone_norm = null,
    email = null,
    address_street = null,
    address_city = null,
    address_zip = null,
    address_country = null,
    info = null,
    note = null,
    anonymized_at = now()
  where c.service_id = p_service_id and c.id = any(v_zakaznici);
  -- Historie karty = staré kontakty a adresy. Celá pryč.
  delete from public.customer_history h
  where h.service_id = p_service_id and h.customer_id = any(v_zakaznici);

  -- SMS: konverzace k dotčeným zakázkám nebo na telefon zákazníka, ve kterých
  -- se od hranice nic nedělo. Zprávy se smažou kaskádou. Živá konverzace
  -- (psal nedávno) zůstane – s tím číslem se zjevně pořád komunikuje.
  with smazane as (
    delete from public.sms_conversations k
    where k.service_id = p_service_id
      and k.updated_at < v_hranice
      and (k.ticket_id = any(v_zakazky)
        or (k.customer_phone = any(v_telefony) and (k.ticket_id is null or k.ticket_id = any(v_zakazky))))
    returning 1
  )
  select count(*) into v_sms from smazane;

  -- Portál: otisk (IP, prohlížeč, poznámka zákazníka) pryč, událost zůstává.
  update public.ticket_portal_events e set meta = null
  where e.service_id = p_service_id and e.ticket_id = any(v_zakazky) and e.meta is not null;

  -- Log automatizací: detail nese telefon nebo e-mail („SMS na +420…“).
  -- Předpona event:<id> slouží k odfiltrování zpracovaných událostí, zůstává.
  update public.automation_runs r set detail = substring(r.detail from '^event:[0-9a-fA-F-]{36}')
  where r.service_id = p_service_id and r.ticket_id = any(v_zakazky) and r.detail is not null;

  -- Online rezervace, ze kterých zakázka vznikla.
  update public.bookings b set
    customer_name = public.anonymizace_jmeno(null),
    customer_phone = '',
    customer_email = null,
    note = null
  where b.service_id = p_service_id and b.ticket_id = any(v_zakazky);

  insert into public.gdpr_anonymizace_log (
    service_id, zdroj, spustil, po_letech, hranice,
    pocet_zakazniku, pocet_zakazek_bez_karty, pocet_zakazek, pocet_reklamaci, pocet_sms_konverzaci, pocet_souboru,
    zakaznici, zakazky, soubory_cekaji, soubory_smazano_at
  ) values (
    p_service_id, p_zdroj, p_spustil, v_let, v_hranice,
    cardinality(v_zakaznici), cardinality(v_bez_karty), cardinality(v_zakazky), cardinality(v_reklamace), v_sms, cardinality(v_soubory),
    v_zakaznici, v_zakazky, v_soubory, case when cardinality(v_soubory) = 0 then now() end
  ) returning id into v_log;

  return jsonb_build_object(
    'logId', v_log,
    'poLetech', v_let,
    'pocetZakazniku', cardinality(v_zakaznici),
    'pocetZakazekBezKarty', cardinality(v_bez_karty),
    'pocetZakazek', cardinality(v_zakazky),
    'pocetReklamaci', cardinality(v_reklamace),
    'pocetSmsKonverzaci', v_sms,
    'soubory', to_jsonb(v_soubory)
  );
end;
$$;
revoke all on function public.anonymizace_provest(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.anonymizace_provest(uuid, text, uuid) to service_role;
comment on function public.anonymizace_provest(uuid, text, uuid) is
  'GDPR: vlastní anonymizace (bez kontroly volajícího). Volá ji anonymizace_spustit a edge funkce gdpr-anonymizace pod service_role.';

-- ---------------------------------------------------------------------------
-- 8) Spuštění: správce s potvrzením, nebo cron
-- ---------------------------------------------------------------------------
create or replace function public.anonymizace_spustit(p_service_id uuid, p_potvrzeni text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, storage
as $$
begin
  if auth.role() = 'service_role' and p_potvrzeni = 'cron' then
    return public.anonymizace_provest(p_service_id, 'cron', null);
  end if;
  if auth.uid() is null or not public.is_owner_or_admin(p_service_id) then
    raise exception 'Anonymizaci může spustit jen majitel nebo správce servisu.' using errcode = '42501';
  end if;
  if upper(btrim(coalesce(p_potvrzeni, ''))) <> 'ANONYMIZOVAT' then
    raise exception 'Pro spuštění napište slovo ANONYMIZOVAT.' using errcode = '22023';
  end if;
  return public.anonymizace_provest(p_service_id, 'rucne', auth.uid());
end;
$$;
revoke all on function public.anonymizace_spustit(uuid, text) from public, anon;
grant execute on function public.anonymizace_spustit(uuid, text) to authenticated, service_role;
comment on function public.anonymizace_spustit(uuid, text) is
  'GDPR: nevratná anonymizace starých zákazníků servisu. Správce musí poslat p_potvrzeni = ANONYMIZOVAT; cron (service_role) posílá ''cron''. Soubory maže edge funkce gdpr-anonymizace.';

-- ---------------------------------------------------------------------------
-- 9) Nastavení (jen správce) a protokol
-- ---------------------------------------------------------------------------
create or replace function public.anonymizace_nastavit(p_service_id uuid, p_po_letech integer)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_owner_or_admin(p_service_id) then
    raise exception 'Pravidlo anonymizace nastavuje jen majitel nebo správce servisu.' using errcode = '42501';
  end if;
  if p_po_letech is not null and p_po_letech not between 3 and 10 then
    raise exception 'Počet let musí být 3 až 10.' using errcode = '22023';
  end if;
  insert into public.service_settings (service_id, config)
  values (p_service_id, jsonb_build_object('gdpr', jsonb_build_object('anonymizacePoLetech', p_po_letech)))
  on conflict (service_id) do update set config =
    coalesce(public.service_settings.config, '{}'::jsonb)
    || jsonb_build_object('gdpr',
         case when jsonb_typeof(public.service_settings.config -> 'gdpr') = 'object'
           then public.service_settings.config -> 'gdpr' else '{}'::jsonb end
         || jsonb_build_object('anonymizacePoLetech', p_po_letech));
end;
$$;
revoke all on function public.anonymizace_nastavit(uuid, integer) from public, anon;
grant execute on function public.anonymizace_nastavit(uuid, integer) to authenticated;

create or replace function public.anonymizace_protokol(p_service_id uuid, p_limit integer default 10)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_owner_or_admin(p_service_id) then
    raise exception 'Protokol anonymizace vidí jen majitel nebo správce servisu.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    -- Nejpřísnější ručně potvrzené pravidlo: denní úloha běží, když je
    -- nastavený počet let stejný nebo mírnější.
    'potvrzenoLet', (
      select min(x.po_letech) from public.gdpr_anonymizace_log x
      where x.service_id = p_service_id and x.zdroj = 'rucne'
    ),
    'behy', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', l.id,
      'spustenoAt', l.spusteno_at,
      'zdroj', l.zdroj,
      'spustil', coalesce(nullif(btrim(p.nickname), ''), case when l.spustil is not null then 'člen týmu' end),
      'poLetech', l.po_letech,
      'hranice', l.hranice,
      'pocetZakazniku', l.pocet_zakazniku,
      'pocetZakazekBezKarty', l.pocet_zakazek_bez_karty,
      'pocetZakazek', l.pocet_zakazek,
      'pocetSmsKonverzaci', l.pocet_sms_konverzaci,
      'pocetSouboru', l.pocet_souboru,
      'souboruCeka', cardinality(l.soubory_cekaji),
      'souboryHotovo', l.soubory_smazano_at,
      'chybaSouboru', l.chyba_souboru
    ) order by l.spusteno_at desc)
    from (
      select * from public.gdpr_anonymizace_log x
      where x.service_id = p_service_id
      order by x.spusteno_at desc
      limit greatest(1, least(coalesce(p_limit, 10), 50))
    ) l
    left join public.profiles p on p.id = l.spustil
  ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.anonymizace_protokol(uuid, integer) from public, anon;
grant execute on function public.anonymizace_protokol(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 10) Pro edge funkci: které servisy smí cron zpracovat, hotové soubory
-- ---------------------------------------------------------------------------
create or replace function public.anonymizace_cron_servisy()
returns table (service_id uuid, po_letech integer)
language sql
stable
security definer
set search_path = public
as $$
  select s.service_id, public.anonymizace_po_letech(s.service_id)
  from public.service_settings s
  where public.anonymizace_po_letech(s.service_id) is not null
    and exists (
      select 1 from public.gdpr_anonymizace_log l
      where l.service_id = s.service_id and l.zdroj = 'rucne'
        and l.po_letech <= public.anonymizace_po_letech(s.service_id)
    );
$$;
revoke all on function public.anonymizace_cron_servisy() from public, anon, authenticated;
grant execute on function public.anonymizace_cron_servisy() to service_role;

create or replace function public.anonymizace_soubory_hotovo(p_log_id uuid, p_smazane text[], p_chyba text default null)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_zbyva integer;
begin
  update public.gdpr_anonymizace_log l set
    soubory_cekaji = coalesce(array(
      select c from unnest(l.soubory_cekaji) c
      where not (c = any(coalesce(p_smazane, '{}'::text[])))
      order by c
    ), '{}'::text[]),
    chyba_souboru = p_chyba
  where l.id = p_log_id
  returning cardinality(l.soubory_cekaji) into v_zbyva;
  if v_zbyva = 0 then
    update public.gdpr_anonymizace_log set soubory_smazano_at = coalesce(soubory_smazano_at, now()) where id = p_log_id;
  end if;
  return coalesce(v_zbyva, 0);
end;
$$;
revoke all on function public.anonymizace_soubory_hotovo(uuid, text[], text) from public, anon, authenticated;
grant execute on function public.anonymizace_soubory_hotovo(uuid, text[], text) to service_role;

-- ---------------------------------------------------------------------------
-- 11) Tajemství a denní tik (vzor: platby_servisu 20260926210000)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'vault') then
    raise notice 'Vault není k dispozici – tajemství gdpr_anonymizace_cron_secret se nezaložilo.';
    return;
  end if;
  if not exists (select 1 from vault.secrets where name = 'gdpr_anonymizace_cron_secret') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      'gdpr_anonymizace_cron_secret',
      'Sdílené tajemství pro plánované volání edge funkce gdpr-anonymizace (pg_cron → pg_net).'
    );
  end if;
exception
  when insufficient_privilege or undefined_table or undefined_function or undefined_object then
    raise notice 'Vault se nepodařilo použít (%). Tajemství gdpr_anonymizace_cron_secret založ ručně.', sqlerrm;
end $$;

create or replace function public.gdpr_anonymizace_cron_secret()
returns text
language plpgsql
security definer
stable
set search_path = public, vault, extensions
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'gdpr_anonymizace_cron_secret'
  order by created_at desc
  limit 1;
  return v_secret;
end;
$$;
revoke all on function public.gdpr_anonymizace_cron_secret() from public, anon, authenticated;
grant execute on function public.gdpr_anonymizace_cron_secret() to service_role;

create or replace function public.gdpr_anonymizace_tick()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_secret text;
  v_request_id bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'pg_net není zapnutý – gdpr_anonymizace_tick nemá jak zavolat edge funkci.';
    return;
  end if;
  v_secret := public.gdpr_anonymizace_cron_secret();
  if v_secret is null or v_secret = '' then
    raise notice 'Chybí tajemství gdpr_anonymizace_cron_secret ve Vaultu – tik se přeskočil.';
    return;
  end if;
  select net.http_post(
    url := 'https://ijtvcgolsdsrquqbvjrz.supabase.co/functions/v1/gdpr-anonymizace',
    body := jsonb_build_object('secret', v_secret),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 60000
  ) into v_request_id;
end;
$$;
revoke all on function public.gdpr_anonymizace_tick() from public, anon, authenticated;
grant execute on function public.gdpr_anonymizace_tick() to service_role;

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron není k dispozici – anonymizace se nenaplánovala.';
    return;
  end if;
  create extension if not exists pg_cron;
  perform cron.unschedule('jobi-gdpr-anonymizace')
  where exists (select 1 from cron.job where jobname = 'jobi-gdpr-anonymizace');
  -- 2:40 UTC = 4:40 letního / 3:40 zimního času v Praze; v noci, kdy nikdo nepracuje.
  perform cron.schedule('jobi-gdpr-anonymizace', '40 2 * * *', 'SELECT public.gdpr_anonymizace_tick()');
exception
  when insufficient_privilege or undefined_table or undefined_function or undefined_object then
    raise notice 'pg_cron se nepodařilo nastavit (%). Tik gdpr_anonymizace_tick() naplánuj ručně.', sqlerrm;
end $$;
