-- =====================================================================
-- anonymizace.sql — osobní údaje z produkční zálohy pryč, zakázky zůstanou
-- =====================================================================
-- Spouští obnov-do-stagingu.sh HNED za nahráním dat, ve STEJNÉ transakci
-- (psql -1). Když cokoli selže – i závěrečná kontrola, že nezůstal žádný
-- skutečný e-mail nebo telefon –, vrátí se celá obnova a reálná data se do
-- stagingu nikdy nezapíšou.
--
-- Co se děje:
--   * zákazníci (customers) a kontaktní údaje na zakázkách, reklamacích,
--     rezervacích, fakturách a v SMS dostanou vymyšlená, ale konzistentní
--     data: „Zákazník 12“, +420 999 000 012, zakaznik-12@staging.jobi.test.
--     Zakázka převezme údaje své karty zákazníka, takže hledání funguje.
--   * volné texty (poznámky, diagnostika, komentáře, chat) zůstávají, jen se
--     z nich vymažou e-maily a telefonní čísla,
--   * podpisy, fotky, kód k odemčení zařízení, IP adresy a tokeny portálu
--     pryč (fotky a podpisy leží v úložišti produkce),
--   * tajemství integrací (iDoklad), webhooky servisů, Stripe ID pryč –
--     staging nesmí nikam nic posílat jménem skutečného servisu,
--   * uživatelé (auth.users): e-mail -> uzivatel-N@staging.jobi.test, heslo
--     všem = STAGING_TEST_PASSWORD. Výjimky: adresy @jobi.test (testovací
--     účty z e2e/README.md) a STAGING_PONECHAT_EMAILY si e-mail nechají.
--     Skutečné otisky hesel na staging nepatří.
--
-- Co zůstává: servisy a jejich firemní údaje (na každé faktuře, veřejný
-- rejstřík), pobočky, ceník, sklad, statusy, přezdívky techniků, všechna
-- ID, čísla zakázek a částky.
--
-- Pravidla jsou v tabulce níž. Sloupec, který v obnovené databázi není
-- (produkce je o migraci pozadu), se přeskočí s poznámkou – anonymizace
-- tím nespadne, a kontrola na konci ověří jen to, co existuje.
--
-- Proměnné psql: vyprazdnit (seznam tabulek), heslo a ponechat (\getenv).
-- =====================================================================

\getenv heslo STAGING_TEST_PASSWORD
\getenv ponechat STAGING_PONECHAT_EMAILY

-- Triggery vypnuté: anonymizace nemá psát historii, zvedat version ani
-- měnit updated_at, a trigger na historii by bez přihlášeného uživatele spadl.
set local session_replication_role = replica;
-- pg_dump v data.sql nastavuje client_min_messages = warning; hlášky anonymizace chceme vidět.
set local client_min_messages = notice;
set local search_path = public, extensions, pg_temp;

-- Výstup pryč: set_config vrací nastavenou hodnotu a heslo nemá skončit v logu.
\o /dev/null
select set_config('jobi.heslo', :'heslo', true),
       set_config('jobi.ponechat', coalesce(:'ponechat', ''), true),
       set_config('jobi.vyprazdnit', :'vyprazdnit', true);
\o

-- ---------------------------------------------------------------------
-- Pomocné funkce (jen pro tuhle relaci, v databázi nezůstanou)
-- ---------------------------------------------------------------------

-- Z volného textu vymaže e-maily a telefonní čísla (9 až 15 číslic ve
-- skupinách po třech, s mezinárodní předvolbou i bez). Datum ani cenu nechá.
create function pg_temp.anon_text(t text) returns text language sql immutable as $f$
  select case when t is null then null else
    regexp_replace(
      regexp_replace(t, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', 'anonym@staging.jobi.test', 'g'),
      '(\+|00)?(\d{3}[ -]?){2,4}\d{3}', '[telefon]', 'g')
  end
$f$;

-- Projde jsonb. Pod citlivým klíčem (jméno zákazníka, telefon, e-mail,
-- adresa, IP, prohlížeč, podpis, kód k zařízení) nahradí všechny řetězce,
-- jinde jen vyčistí volný text. „name“ samo citlivé není – tak se jmenují
-- i opravy a díly. vse=true = anonymizovat úplně všechno (historie zákazníka).
create function pg_temp.anon_json(j jsonb, vse boolean default false) returns jsonb language plpgsql immutable as $f$
declare
  k text; v jsonb; vysledek jsonb;
begin
  if j is null then return null; end if;
  case jsonb_typeof(j)
    when 'object' then
      vysledek := '{}'::jsonb;
      for k, v in select key, value from jsonb_each(j) loop
        vysledek := vysledek || jsonb_build_object(k, pg_temp.anon_json(v, vse or k ~* (
          '^(customer_?(name|phone|email|address.*|company|ico|dic|info)|customer(name|phone|email|address|company|ico|dic|info).*'
          || '|zakaznik.*|jmeno|prijmeni|full_?name|phone.*|telefon.*|tel|mobil.*|e_?mail|mail'
          || '|address.*|adresa|street|ulice|city|mesto|zip|psc'
          || '|ip|ip_?address|user_?agent|device_?passcode|passcode|kod_?odemceni|heslo|password'
          || '|signature.*|podpis.*)$')));
      end loop;
      return vysledek;
    when 'array' then
      return coalesce((select jsonb_agg(pg_temp.anon_json(e, vse) order by i)
                         from jsonb_array_elements(j) with ordinality as x(e, i)), '[]'::jsonb);
    when 'string' then
      if vse then return to_jsonb('[anonymizováno]'::text); end if;
      return to_jsonb(pg_temp.anon_text(j #>> '{}'));
    else
      if vse and jsonb_typeof(j) = 'number' then return 'null'::jsonb; end if;
      return j;
  end case;
end
$f$;

-- ---------------------------------------------------------------------
-- 1) Tabulky, které staging nepotřebuje a které nesou tajemství nebo
--    osobní údaje: tokeny, PINy, hesla k obnově, logy chyb (kontext z
--    prohlížeče), uložené odpovědi API. Seznam dodává skript (vyprazdnit),
--    aby s ním počítala i kontrola počtů.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array string_to_array(current_setting('jobi.vyprazdnit'), ',') loop
    t := btrim(t);
    continue when t = '';
    if to_regclass('public.' || quote_ident(t)) is null then
      raise notice 'anonymizace: tabulka % není, přeskočeno', t;
      continue;
    end if;
    -- delete, ne truncate: truncate odmítne tabulku, na kterou vede cizí klíč
    -- (a replika triggery cizích klíčů stejně nehlídá).
    execute format('delete from public.%I', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2) Sloupce podle pravidel
-- ---------------------------------------------------------------------
create temp table _pravidla (tabulka text, sloupec text, druh text) on commit drop;
insert into _pravidla values
  -- karta zákazníka
  ('customers', 'name', 'jmeno'),
  ('customers', 'phone', 'telefon'),
  ('customers', 'phone_norm', 'telefon_norm'),
  ('customers', 'email', 'email'),
  ('customers', 'address_street', 'ulice'),
  ('customers', 'address_city', 'mesto'),
  ('customers', 'address_zip', 'psc'),
  ('customers', 'company', 'firma'),
  ('customers', 'ico', 'ico'),
  ('customers', 'dic', 'dic'),
  ('customers', 'info', 'text'),
  ('customers', 'note', 'text'),
  -- zakázky
  ('tickets', 'customer_name', 'jmeno'),
  ('tickets', 'customer_phone', 'telefon'),
  ('tickets', 'customer_email', 'email'),
  ('tickets', 'customer_address_street', 'ulice'),
  ('tickets', 'customer_address_city', 'mesto'),
  ('tickets', 'customer_address_zip', 'psc'),
  ('tickets', 'customer_company', 'firma'),
  ('tickets', 'customer_ico', 'ico'),
  ('tickets', 'customer_info', 'text'),
  ('tickets', 'notes', 'text'),
  ('tickets', 'device_note', 'text'),
  ('tickets', 'diagnostic_text', 'text'),
  ('tickets', 'quote_note', 'text'),
  ('tickets', 'device_serial', 'serial'),
  ('tickets', 'device_imei', 'imei'),
  ('tickets', 'device_passcode', 'null'),
  ('tickets', 'intake_signature_url', 'null'),
  ('tickets', 'purchase_proof', 'null'),
  ('tickets', 'diagnostic_photos', 'prazdne_pole'),
  ('tickets', 'diagnostic_photos_before', 'prazdne_pole'),
  ('tickets', 'portal_token', 'token'),
  ('tickets', 'quote_decision_meta', 'json'),
  ('tickets', 'loaner', 'json'),
  -- reklamace
  ('warranty_claims', 'customer_name', 'jmeno'),
  ('warranty_claims', 'customer_phone', 'telefon'),
  ('warranty_claims', 'customer_email', 'email'),
  ('warranty_claims', 'customer_address_street', 'ulice'),
  ('warranty_claims', 'customer_address_city', 'mesto'),
  ('warranty_claims', 'customer_address_zip', 'psc'),
  ('warranty_claims', 'customer_company', 'firma'),
  ('warranty_claims', 'customer_ico', 'ico'),
  ('warranty_claims', 'customer_info', 'text'),
  ('warranty_claims', 'notes', 'text'),
  ('warranty_claims', 'resolution_summary', 'text'),
  ('warranty_claims', 'device_note', 'text'),
  ('warranty_claims', 'device_serial', 'serial'),
  ('warranty_claims', 'device_imei', 'imei'),
  ('warranty_claims', 'device_passcode', 'null'),
  -- online rezervace
  ('bookings', 'customer_name', 'jmeno'),
  ('bookings', 'customer_phone', 'telefon'),
  ('bookings', 'customer_email', 'email'),
  ('bookings', 'note', 'text'),
  -- faktury (odběratel; dodavatel je servis sám)
  ('invoices', 'customer_name', 'jmeno'),
  ('invoices', 'customer_ico', 'ico'),
  ('invoices', 'customer_dic', 'dic'),
  ('invoices', 'customer_address', 'adresa'),
  ('invoices', 'customer_email', 'email'),
  ('invoices', 'customer_phone', 'telefon'),
  ('invoices', 'notes', 'text'),
  ('invoices', 'internal_note', 'text'),
  ('invoice_events', 'payload', 'json'),
  -- SMS
  ('sms_conversations', 'customer_phone', 'telefon'),
  ('sms_conversations', 'customer_name', 'jmeno'),
  ('sms_messages', 'body', 'sms'),
  -- historie a události
  ('customer_history', 'diff', 'json_vse'),
  ('ticket_history', 'details', 'json'),
  ('warranty_claim_history', 'details', 'json'),
  ('ticket_portal_events', 'meta', 'json'),
  ('automation_runs', 'detail', 'text'),
  -- komentáře, chat, nápověda
  ('ticket_comments', 'content', 'text'),
  ('ticket_comments', 'author_avatar_url', 'null'),
  ('chat_messages', 'text', 'text'),
  ('chat_messages', 'attachments', 'prazdne_pole'),
  ('napoveda_dotazy', 'dotaz', 'text'),
  ('napoveda_dotazy', 'odpoved', 'text'),
  -- zásilky a drobnosti s poznámkou
  ('ticket_shipments', 'tracking_number', 'serial'),
  ('ticket_shipments', 'note', 'text'),
  ('ticket_shipment_items', 'note', 'text'),
  ('ticket_work_sessions', 'note', 'text'),
  ('inventory_purchase_orders', 'note', 'text'),
  -- kontakty mimo zákazníky
  ('service_invites', 'email', 'email'),
  ('provize_nastaveni', 'email', 'email'),
  ('statistiky_report_odeslani', 'prijemci', 'email_pole'),
  ('inventory_suppliers', 'email', 'email'),
  ('inventory_suppliers', 'phone', 'telefon'),
  ('profiles', 'avatar_url', 'null'),
  -- nic jménem skutečného servisu ven
  ('service_integrations', 'config', 'prazdny_objekt'),
  ('service_integrations', 'last_error', 'null'),
  ('service_phone_numbers', 'forwarding_number', 'telefon'),
  ('services', 'public_webhook_url', 'null'),
  ('service_billing', 'stripe_customer_id', 'null'),
  ('service_billing', 'stripe_subscription_id', 'null');

-- Jeden UPDATE na tabulku: číslo řádku (r.n) je pak pro všechny sloupce
-- téhož řádku stejné – „Zákazník 12“ má telefon …012 i e-mail zakaznik-12@.
-- (Po každém UPDATE má řádek nové ctid, takže číslovat sloupec po sloupci
-- by každému sloupci dalo jiné číslo.)
do $$
declare
  tab text;
  p record;
  vyraz text;
  predpona text;
  sety text[];
  n_radku bigint;
  n_sloupcu int := 0;
  celkem bigint := 0;
begin
  for tab in select distinct tabulka from _pravidla order by 1 loop
    if to_regclass('public.' || quote_ident(tab)) is null then
      raise notice 'anonymizace: tabulka % není, přeskočeno', tab;
      continue;
    end if;
    -- Čitelné předpony: karta zákazníka je „Zákazník 12“, zakázka bez karty
    -- „Zákazník Z-12“ – ať se dva různí lidé nejmenují stejně.
    predpona := case tab when 'tickets' then 'Z-' when 'warranty_claims' then 'R-' when 'bookings' then 'B-'
                         when 'invoices' then 'F-' when 'sms_conversations' then 'S-' else '' end;
    sety := '{}';
    for p in select * from _pravidla where tabulka = tab loop
      if not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = tab and column_name = p.sloupec) then
        raise notice 'anonymizace: sloupec %.% není, přeskočeno', tab, p.sloupec;
        continue;
      end if;
      vyraz := case p.druh
        when 'jmeno'          then format($v$'Zákazník %s' || r.n$v$, predpona)
        when 'telefon'        then $v$'+420 999 ' || substr(lpad(r.n::text, 6, '0'), 1, 3) || ' ' || substr(lpad(r.n::text, 6, '0'), 4, 3)$v$
        when 'telefon_norm'   then $v$'+420999' || lpad(r.n::text, 6, '0')$v$
        when 'email'          then format($v$'%s-' || r.n || '@staging.jobi.test'$v$, case tab
                                     when 'customers' then 'zakaznik' when 'tickets' then 'zakazka' when 'warranty_claims' then 'reklamace'
                                     when 'bookings' then 'rezervace' when 'invoices' then 'faktura' when 'service_invites' then 'pozvanka'
                                     when 'provize_nastaveni' then 'provize' when 'inventory_suppliers' then 'dodavatel'
                                     else replace(tab, '_', '-') end)
        when 'email_pole'     then format($v$array(select format('prijemce-%%s-%%s@staging.jobi.test', r.n, i) from generate_subscripts(t.%I, 1) i)$v$, p.sloupec)
        when 'ulice'          then $v$'Testovací ' || r.n$v$
        when 'mesto'          then $v$'Praha'$v$
        when 'psc'            then $v$'110 00'$v$
        when 'adresa'         then $v$'Testovací ' || r.n || ', 110 00 Praha'$v$
        when 'firma'          then $v$'Firma ' || r.n || ' s.r.o.'$v$
        when 'ico'            then $v$lpad(r.n::text, 8, '0')$v$
        when 'dic'            then $v$'CZ' || lpad(r.n::text, 8, '0')$v$
        when 'serial'         then $v$'SN-STAGING-' || r.n$v$
        when 'imei'           then $v$'35' || lpad(r.n::text, 13, '0')$v$
        when 'token'          then $v$replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')$v$
        when 'text'           then format('pg_temp.anon_text(t.%I)', p.sloupec)
        when 'json'           then format('pg_temp.anon_json(t.%I)', p.sloupec)
        when 'json_vse'       then format('pg_temp.anon_json(t.%I, true)', p.sloupec)
        when 'sms'            then $v$'[obsah SMS na stagingu odstraněn]'$v$
        when 'null'           then 'null'
        when 'prazdne_pole'   then $v$'[]'::jsonb$v$
        when 'prazdny_objekt' then $v$'{}'::jsonb$v$
      end;
      if vyraz is null then raise exception 'anonymizace: neznámý druh pravidla %', p.druh; end if;
      -- Null zůstává null a prázdný text prázdný – neexistující údaj se nemá
      -- „vymyslet“ (zákazník bez telefonu zůstane bez telefonu).
      if p.druh in ('null', 'prazdne_pole', 'prazdny_objekt') then
        sety := sety || format('%I = case when t.%I is null then null else %s end', p.sloupec, p.sloupec, vyraz);
      else
        sety := sety || format($f$%I = case when t.%I is null then null when t.%I::text = '' then t.%I else %s end$f$,
                               p.sloupec, p.sloupec, p.sloupec, p.sloupec, vyraz);
      end if;
      n_sloupcu := n_sloupcu + 1;
    end loop;
    continue when cardinality(sety) = 0;
    -- Číslo řádku podle ctid: v tabulce jedinečné (unikátní telefon v servisu,
    -- e-mail pozvánky) a pro celý řádek jedno.
    execute format(
      'update public.%I t set %s
         from (select ctid as c, row_number() over (order by ctid) as n from public.%I) r
        where t.ctid = r.c',
      tab, array_to_string(sety, ', '), tab);
    get diagnostics n_radku = row_count;
    celkem := celkem + n_radku;
  end loop;
  raise notice 'anonymizace: % sloupců ve % řádcích', n_sloupcu, celkem;
end $$;

-- Zakázka, reklamace a faktura převezmou jméno, telefon a e-mail ze své
-- karty zákazníka – po anonymizaci by jinak zakázka „Zákazník 7“ patřila
-- kartě „Zákazník 31“ a hledání podle zákazníka by nesedělo.
do $$
declare
  t text;
  sloupce text[];
  prirazeni text;
begin
  foreach t in array array['tickets', 'warranty_claims', 'invoices'] loop
    if to_regclass('public.' || t) is null or to_regclass('public.customers') is null then continue; end if;
    select array_agg(format('%I = c.%I', cil, zdroj)) into sloupce
      from (values ('customer_name', 'name'), ('customer_phone', 'phone'), ('customer_email', 'email')) as m(cil, zdroj)
     where exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'customer_id')
       and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = m.cil)
       and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customers' and column_name = m.zdroj);
    continue when sloupce is null;
    prirazeni := array_to_string(sloupce, ', ');
    execute format('update public.%I x set %s from public.customers c where x.customer_id = c.id', t, prirazeni);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3) Uživatelé
-- ---------------------------------------------------------------------
do $$
declare
  heslo text := current_setting('jobi.heslo');
  ponechat text[] := coalesce(string_to_array(lower(replace(current_setting('jobi.ponechat'), ' ', '')), ','), '{}');
  sl text;
  n bigint;
begin
  if heslo is null or length(heslo) < 12 then
    raise exception 'STAGING_TEST_PASSWORD musí mít aspoň 12 znaků';
  end if;
  if to_regclass('auth.users') is null then
    raise notice 'anonymizace: auth.users není, přeskočeno';
    return;
  end if;

  create temp table _uzivatele on commit drop as
    select u.id, lower(u.email) as puvodni,
           case
             when u.email is null or u.email = '' then u.email
             when lower(u.email) like '%@jobi.test' or lower(u.email) = any (ponechat) then lower(u.email)
             else 'uzivatel-' || row_number() over (order by u.created_at, u.id) || '@staging.jobi.test'
           end as novy
      from auth.users u;

  update auth.users u set email = x.novy from _uzivatele x where x.id = u.id and u.email is distinct from x.novy;
  get diagnostics n = row_count;
  raise notice 'anonymizace: % e-mailů uživatelů přepsáno', n;

  -- Metadata: pryč jméno, telefon a avatar, e-mail podle nového.
  update auth.users u
     set raw_user_meta_data = (coalesce(u.raw_user_meta_data, '{}'::jsonb)
                                 - 'email' - 'phone' - 'full_name' - 'name' - 'avatar_url' - 'picture')
                              || case when u.raw_user_meta_data ? 'email' then jsonb_build_object('email', x.novy) else '{}'::jsonb end
    from _uzivatele x where x.id = u.id;

  -- Sloupce, které se liší podle verze GoTrue – jen když existují.
  foreach sl in array array['phone', 'phone_change', 'new_phone'] loop
    if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = sl) then
      execute format('update auth.users set %I = null where %I is not null', sl, sl);
    end if;
  end loop;
  foreach sl in array array['confirmation_token', 'recovery_token', 'email_change_token_new',
                            'email_change_token_current', 'email_change', 'phone_change_token',
                            'reauthentication_token'] loop
    if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = sl) then
      execute format($q$update auth.users set %I = '' where coalesce(%I, '') <> ''$q$, sl, sl);
    end if;
  end loop;

  -- Heslo všem stejné. Na stagingu se tak dá přihlásit za kohokoli
  -- (anonymizovaného) a vyzkoušet jeho role; skutečné otisky hesel tu nejsou.
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'encrypted_password') then
    execute 'update auth.users set encrypted_password = extensions.crypt($1, extensions.gen_salt(''bf''))' using heslo;
    get diagnostics n = row_count;
    raise notice 'anonymizace: heslo nastaveno % uživatelům', n;
  else
    raise notice 'anonymizace: auth.users nemá encrypted_password, heslo nenastaveno';
  end if;

  -- Identity: e-mail v identity_data musí sedět s auth.users, jinak se
  -- přihlášení e-mailem rozejde. Starší identity měly jako provider_id e-mail.
  if to_regclass('auth.identities') is not null then
    update auth.identities i
       set identity_data = (coalesce(i.identity_data, '{}'::jsonb) - 'email' - 'phone' - 'full_name' - 'name' - 'avatar_url' - 'picture')
                           || case when x.novy is not null then jsonb_build_object('email', x.novy) else '{}'::jsonb end
      from _uzivatele x where x.id = i.user_id;
    if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'identities' and column_name = 'provider_id') then
      update auth.identities set provider_id = user_id::text where provider = 'email' and provider_id like '%@%';
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4) Kontrola: nezůstalo nic skutečného? Výjimka tady vrátí celou obnovu.
-- ---------------------------------------------------------------------
do $$
declare
  p record;
  podminka text;
  n bigint;
  spatne text := '';
  ponechat text[] := coalesce(string_to_array(lower(replace(current_setting('jobi.ponechat'), ' ', '')), ','), '{}');
begin
  for p in select * from _pravidla where druh in ('jmeno', 'telefon', 'telefon_norm', 'email', 'null', 'prazdne_pole', 'prazdny_objekt') loop
    continue when not exists (select 1 from information_schema.columns
                               where table_schema = 'public' and table_name = p.tabulka and column_name = p.sloupec);
    podminka := case p.druh
      when 'jmeno'          then $c$%1$I is not null and %1$I <> '' and %1$I not like 'Zákazník %%'$c$
      when 'telefon'        then $c$%1$I is not null and %1$I <> '' and %1$I not like '+420 999 %%'$c$
      when 'telefon_norm'   then $c$%1$I is not null and %1$I <> '' and %1$I not like '+420999%%'$c$
      when 'email'          then $c$%1$I is not null and %1$I::text <> '' and %1$I::text not like '%%@staging.jobi.test'$c$
      when 'null'           then $c$%1$I is not null$c$
      when 'prazdne_pole'   then $c$%1$I is not null and %1$I <> '[]'::jsonb$c$
      when 'prazdny_objekt' then $c$%1$I is not null and %1$I <> '{}'::jsonb$c$
    end;
    execute format('select count(*) from public.%2$I where ' || podminka, p.sloupec, p.tabulka) into n;
    if n > 0 then spatne := spatne || format(E'\n  %s.%s: %s řádků', p.tabulka, p.sloupec, n); end if;
  end loop;

  if to_regclass('auth.users') is not null then
    select count(*) into n from auth.users
     where email is not null and email <> ''
       and lower(email) not like '%@staging.jobi.test' and lower(email) not like '%@jobi.test'
       and not lower(email) = any (ponechat);
    if n > 0 then spatne := spatne || format(E'\n  auth.users.email: %s řádků', n); end if;
  end if;

  if spatne <> '' then
    raise exception 'Anonymizace nedoběhla – skutečné údaje zůstaly v:%', spatne;
  end if;
  raise notice 'anonymizace: kontrola prošla, žádný skutečný kontakt nezůstal';
end $$;
