-- Test migrace 20261013100000_api_objednavky na LOKÁLNÍ databázi.
--
-- NE proti produkci. Spouští se nad clusterem z test-migrace-na-cisto.sh:
--   KEEP_CLUSTER=1 PGPORT_TEST=55461 bash scripts/test-migrace-na-cisto.sh
--   psql -h 127.0.0.1 -p 55461 -U postgres -d jobi_test -v ON_ERROR_STOP=1 -f scripts/test-objednavky.sql
--
-- Celý běží v transakci a na konci se vrátí. Při chybě skončí výjimkou
-- s popisem, co nesedí; jinak vypíše „OBJEDNÁVKY: vše OK“.

begin;

-- Identity a servisy (vlastní, nezávislé na kouřové zkoušce).
insert into auth.users (id, email) select public.root_owner_id(), 'root@test.cz'
  where not exists (select 1 from auth.users where id = public.root_owner_id());
insert into auth.users (id, email) values
  ('a1000000-0000-4000-8000-000000000001', 'majitel@obj.test'),
  ('a1000000-0000-4000-8000-000000000002', 'technik@obj.test'),
  ('a1000000-0000-4000-8000-000000000003', 'bezprav@obj.test'),
  ('a1000000-0000-4000-8000-000000000004', 'cizi@obj.test'),
  ('a1000000-0000-4000-8000-000000000005', 'pobocka@obj.test');

insert into public.services (id, name) values
  ('b1000000-0000-4000-8000-000000000001', 'Servis A'),
  ('b1000000-0000-4000-8000-000000000002', 'Servis B');
insert into public.service_entitlements (service_id, module, active, quota) values
  ('b1000000-0000-4000-8000-000000000001', 'access', true, null),
  ('b1000000-0000-4000-8000-000000000001', 'api_catalog', true, null),
  ('b1000000-0000-4000-8000-000000000002', 'access', true, null),
  ('b1000000-0000-4000-8000-000000000002', 'api_catalog', true, null),
  ('b1000000-0000-4000-8000-000000000001', 'branches', true, 5)
on conflict (service_id, module) do update set active = true, valid_until = null, quota = excluded.quota;

insert into public.branches (id, service_id, name) values
  ('c1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Praha'),
  ('c1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000001', 'Brno');

insert into public.service_memberships (service_id, user_id, role, capabilities) values
  ('b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'owner', '{}'),
  ('b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002', 'member', '{"can_manage_tickets_basic":true,"can_change_ticket_status":true}'),
  ('b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000003', 'member', '{}'),
  ('b1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000004', 'owner', '{}');
insert into public.service_memberships (service_id, user_id, role, capabilities, home_branch_id) values
  ('b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000005', 'member', '{"can_manage_tickets_basic":true,"branch_only":true}', 'c1000000-0000-4000-8000-000000000002');

insert into public.service_statuses (service_id, key, label, order_index, is_final) values
  ('b1000000-0000-4000-8000-000000000001', 'received', 'Přijato', 0, false),
  ('b1000000-0000-4000-8000-000000000001', 'in_progress', 'V opravě', 1, false),
  ('b1000000-0000-4000-8000-000000000001', 'done', 'Vydáno', 2, true),
  ('b1000000-0000-4000-8000-000000000002', 'received', 'Přijato', 0, false),
  ('b1000000-0000-4000-8000-000000000002', 'done', 'Hotovo', 1, true);

insert into public.tickets (id, service_id, branch_id, title, status, code, performed_repairs, discount_type, discount_value) values
  ('d1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'iPhone 13', 'received', 'A-1', '[{"name":"Displej","price":2000},{"name":"Baterie","price":1000}]', 'percentage', 10),
  ('d1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000002', null, 'Cizí', 'received', 'B-1', '[]', null, null);

-- Objednávky zapisuje server (tady superuživatel = service_role).
insert into public.web_objednavky (id, service_id, branch_id, externi_cislo, zdroj, zakaznik_jmeno, zarizeni) values
  ('e1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'SRV-2026-0001', 'web', 'Jan Novák', 'iPhone 13'),
  ('e1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000001', null, 'SRV-2026-0002', 'web', 'Eva', 'Pixel'),
  ('e1000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000002', null, 'X-1', 'web', 'Cizí', 'Nokia');

create or replace function pg_temp.jako(p_user uuid) returns void language plpgsql as $$
begin
  if p_user is null then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    execute 'set local role anon';
  else
    perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
  end if;
end $$;

create or replace function pg_temp.server() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

create or replace function pg_temp.ocekavej_chybu(p_sql text, p_popis text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    return;
  end;
  raise exception 'MĚLO SELHAT: %', p_popis;
end $$;

do $$
declare
  n int;
  v jsonb;
  t text;
  ok boolean;
begin
  -- Unikátnost čísla v servisu (idempotence), jiný servis smí stejné číslo.
  begin
    insert into public.web_objednavky (service_id, externi_cislo) values ('b1000000-0000-4000-8000-000000000001', 'SRV-2026-0001');
    raise exception 'duplicitní externí číslo prošlo';
  exception when unique_violation then null;
  end;
  insert into public.web_objednavky (service_id, externi_cislo) values ('b1000000-0000-4000-8000-000000000002', 'SRV-2026-0001');
  -- Limit dat ~20 kB.
  begin
    insert into public.web_objednavky (service_id, externi_cislo, data) values ('b1000000-0000-4000-8000-000000000001', 'VELKA', jsonb_build_object('x', repeat('a', 21000)));
    raise exception 'data přes 20 kB prošla';
  exception when check_violation then null;
  end;

  -- ── čtení ──────────────────────────────────────────────────────────────
  perform pg_temp.jako('a1000000-0000-4000-8000-000000000001');
  select count(*) into n from public.web_objednavky;
  if n <> 2 then raise exception 'majitel A vidí % objednávek, čekaly se 2', n; end if;
  perform pg_temp.jako('a1000000-0000-4000-8000-000000000004');
  select count(*) into n from public.web_objednavky where service_id = 'b1000000-0000-4000-8000-000000000001';
  if n <> 0 then raise exception 'cizí servis vidí % objednávek A', n; end if;
  -- Omezený na pobočku Brno nevidí objednávku pro Prahu, bez pobočky ano.
  perform pg_temp.jako('a1000000-0000-4000-8000-000000000005');
  select count(*) into n from public.web_objednavky;
  if n <> 1 then raise exception 'člen omezený na Brno vidí % objednávek, čekala se 1 (bez pobočky)', n; end if;
  -- Zápis přes REST nikdo z klientů nemá.
  perform pg_temp.jako('a1000000-0000-4000-8000-000000000001');
  perform pg_temp.ocekavej_chybu($q$insert into public.web_objednavky (service_id, externi_cislo) values ('b1000000-0000-4000-8000-000000000001', 'HACK')$q$, 'insert majitele přes REST');
  perform pg_temp.ocekavej_chybu($q$update public.web_objednavky set stav = 'prevedeno'$q$, 'update majitele přes REST');
  perform pg_temp.ocekavej_chybu($q$select tajemstvi from public.api_webhooky$q$, 'tajemství webhooku čte klient');
  perform pg_temp.jako(null);
  perform pg_temp.ocekavej_chybu($q$select * from public.web_objednavky$q$, 'anon čte objednávky');
  perform pg_temp.ocekavej_chybu($q$select public.web_objednavka_nastav_stav('e1000000-0000-4000-8000-000000000002', 'zrusena')$q$, 'anon ruší objednávku');
  perform pg_temp.server();

  -- ── webhook ────────────────────────────────────────────────────────────
  perform pg_temp.jako('a1000000-0000-4000-8000-000000000002');
  perform pg_temp.ocekavej_chybu($q$select public.api_webhook_ulozit('b1000000-0000-4000-8000-000000000001', 'https://x.cz/h', array['order.converted'], true)$q$, 'technik nastavuje webhook');
  perform pg_temp.jako('a1000000-0000-4000-8000-000000000001');
  perform pg_temp.ocekavej_chybu($q$select public.api_webhook_ulozit('b1000000-0000-4000-8000-000000000001', 'http://x.cz/h', array['order.converted'], true)$q$, 'webhook na http');
  perform pg_temp.ocekavej_chybu($q$select public.api_webhook_ulozit('b1000000-0000-4000-8000-000000000002', 'https://x.cz/h', array['order.converted'], true)$q$, 'webhook cizímu servisu');
  v := public.api_webhook_ulozit('b1000000-0000-4000-8000-000000000001', 'https://web.test/hook', array['order.converted', 'ticket.status_changed', 'ticket.completed', 'order.cancelled', 'nesmysl'], true);
  if v ->> 'tajemstvi' is null or v ->> 'tajemstvi' not like 'whsec_%' then raise exception 'první uložení nevrátilo tajemství: %', v; end if;
  v := public.api_webhook_ulozit('b1000000-0000-4000-8000-000000000001', 'https://web.test/hook2', array['order.converted', 'ticket.status_changed', 'ticket.completed', 'order.cancelled'], true);
  if v ? 'tajemstvi' then raise exception 'druhé uložení vrátilo tajemství'; end if;
  select array_to_string(udalosti, ',') into t from public.api_webhooky;
  if t <> 'order.cancelled,order.converted,ticket.completed,ticket.status_changed' then raise exception 'události: %', t; end if;
  t := public.api_webhook_nove_tajemstvi('b1000000-0000-4000-8000-000000000001');
  if t not like 'whsec_%' then raise exception 'nové tajemství: %', t; end if;
  perform pg_temp.server();

  -- ── převod a stav ──────────────────────────────────────────────────────
  perform pg_temp.jako('a1000000-0000-4000-8000-000000000003');
  perform pg_temp.ocekavej_chybu($q$select public.web_objednavka_prevest('e1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001')$q$, 'člen bez práva převádí');
  perform pg_temp.ocekavej_chybu($q$select public.web_objednavka_nastav_stav('e1000000-0000-4000-8000-000000000001', 'zrusena')$q$, 'člen bez práva ruší');
  perform pg_temp.jako('a1000000-0000-4000-8000-000000000004');
  perform pg_temp.ocekavej_chybu($q$select public.web_objednavka_prevest('e1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002')$q$, 'cizí servis převádí');
  perform pg_temp.jako('a1000000-0000-4000-8000-000000000005');
  perform pg_temp.ocekavej_chybu($q$select public.web_objednavka_nastav_stav('e1000000-0000-4000-8000-000000000001', 'dorazilo')$q$, 'omezený na Brno mění pražskou');
  perform pg_temp.jako('a1000000-0000-4000-8000-000000000002');
  perform pg_temp.ocekavej_chybu($q$select public.web_objednavka_prevest('e1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002')$q$, 'převod na zakázku cizího servisu');
  ok := public.web_objednavka_nastav_stav('e1000000-0000-4000-8000-000000000001', 'dorazilo');
  if not ok then raise exception 'dorazilo neprošlo'; end if;
  ok := public.web_objednavka_prevest('e1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001');
  if not ok then raise exception 'převod neprošel'; end if;
  ok := public.web_objednavka_prevest('e1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001');
  if ok then raise exception 'druhý převod téže objednávky prošel'; end if;
  ok := public.web_objednavka_nastav_stav('e1000000-0000-4000-8000-000000000002', 'zrusena');
  if not ok then raise exception 'zrušení neprošlo'; end if;
  perform pg_temp.server();

  select count(*) into n from public.api_webhook_doruceni where udalost = 'order.converted' and objednavka_id = 'e1000000-0000-4000-8000-000000000001';
  if n <> 1 then raise exception 'order.converted ve frontě %×', n; end if;
  select payload into v from public.api_webhook_doruceni where udalost = 'order.converted';
  if v ->> 'external_id' <> 'SRV-2026-0001' or v ->> 'ticket_code' <> 'A-1' or (v -> 'status' ->> 'key') <> 'received'
     or (v ->> 'total')::numeric <> 2700 or v ->> 'order_status' <> 'converted' then
    raise exception 'payload order.converted: %', v;
  end if;
  select count(*) into n from public.api_webhook_doruceni where udalost = 'order.cancelled';
  if n <> 1 then raise exception 'order.cancelled ve frontě %×', n; end if;

  -- ── trigger na zakázce ─────────────────────────────────────────────────
  perform pg_temp.jako('a1000000-0000-4000-8000-000000000002');
  update public.tickets set status = 'in_progress' where id = 'd1000000-0000-4000-8000-000000000001';
  update public.tickets set title = 'jen název' where id = 'd1000000-0000-4000-8000-000000000001';
  update public.tickets set status = 'done' where id = 'd1000000-0000-4000-8000-000000000001';
  perform pg_temp.server();
  select count(*) into n from public.api_webhook_doruceni where udalost = 'ticket.status_changed';
  if n <> 2 then raise exception 'ticket.status_changed %×, čekaly se 2', n; end if;
  select count(*) into n from public.api_webhook_doruceni where udalost = 'ticket.completed';
  if n <> 1 then raise exception 'ticket.completed %×, čekal se 1', n; end if;
  select payload into v from public.api_webhook_doruceni where udalost = 'ticket.completed';
  if (v -> 'status' ->> 'is_final')::boolean is not true or v -> 'status' ->> 'label' <> 'Vydáno' then raise exception 'payload completed: %', v; end if;
  -- Zakázka bez objednávky frontu neplní.
  update public.tickets set status = 'done' where id = 'd1000000-0000-4000-8000-000000000002';
  select count(*) into n from public.api_webhook_doruceni where service_id = 'b1000000-0000-4000-8000-000000000002';
  if n <> 0 then raise exception 'zakázka bez objednávky plní frontu'; end if;

  -- Neodebíraná událost se do fronty nezapíše; vypnutý webhook taky ne.
  update public.api_webhooky set udalosti = array['order.converted'] where service_id = 'b1000000-0000-4000-8000-000000000001';
  update public.tickets set status = 'in_progress' where id = 'd1000000-0000-4000-8000-000000000001';
  update public.api_webhooky set udalosti = array['ticket.status_changed'], aktivni = false where service_id = 'b1000000-0000-4000-8000-000000000001';
  update public.tickets set status = 'received' where id = 'd1000000-0000-4000-8000-000000000001';
  select count(*) into n from public.api_webhook_doruceni where udalost = 'ticket.status_changed';
  if n <> 2 then raise exception 'neodebíraná/vypnutá událost se zařadila (% řádků)', n; end if;

  -- ── log a fronta ───────────────────────────────────────────────────────
  perform pg_temp.jako('a1000000-0000-4000-8000-000000000002');
  select count(*) into n from public.api_webhook_doruceni;
  if n <> 0 then raise exception 'technik vidí log webhooků (% řádků)', n; end if;
  perform pg_temp.ocekavej_chybu($q$select * from public.api_webhooky_k_odeslani(10, null)$q$, 'klient bere frontu');
  perform pg_temp.jako('a1000000-0000-4000-8000-000000000001');
  select count(*) into n from public.api_webhook_doruceni;
  if n <> 5 then raise exception 'majitel vidí % záznamů logu, čekalo se 5', n; end if;
  perform pg_temp.server();

  select count(*) into n from public.api_webhooky_k_odeslani(2, null);
  if n <> 2 then raise exception 'k odeslání % místo 2', n; end if;
  select count(*) into n from public.api_webhooky_k_odeslani(50, null);
  if n <> 3 then raise exception 'zbytek fronty % místo 3 (zamčené se nesmí vzít znovu)', n; end if;
  select count(*) into n from public.api_webhooky_k_odeslani(50, null);
  if n <> 0 then raise exception 'zamčené se vzaly znovu'; end if;

  perform public.api_webhook_vysledek(d.id, false, 500, 'Server error', now() + interval '1 minute', false)
     from public.api_webhook_doruceni d where d.udalost = 'order.converted';
  perform public.api_webhook_vysledek(d.id, true, 200, null, null, false)
     from public.api_webhook_doruceni d where d.udalost = 'order.cancelled';
  perform public.api_webhook_vysledek(d.id, false, 410, 'Gone', null, false)
     from public.api_webhook_doruceni d where d.udalost = 'ticket.completed';
  select string_agg(udalost || '=' || stav, ',' order by udalost) into t from public.api_webhook_doruceni where udalost <> 'ticket.status_changed';
  if t <> 'order.cancelled=odeslano,order.converted=ceka,ticket.completed=chyba' then raise exception 'stavy po výsledku: %', t; end if;
  select count(*) into n from public.api_webhooky where posledni_uspech_at is not null and posledni_chyba = 'Gone';
  if n <> 1 then raise exception 'poslední úspěch/chyba webhooku se nezapsaly'; end if;

  -- Smazání webhooku zahodí čekající.
  perform pg_temp.jako('a1000000-0000-4000-8000-000000000001');
  perform public.api_webhook_smazat('b1000000-0000-4000-8000-000000000001');
  perform pg_temp.server();
  select count(*) into n from public.api_webhook_doruceni where stav in ('ceka', 'odesila');
  if n <> 0 then raise exception 'po smazání webhooku zůstalo % čekajících', n; end if;

  -- Tik bez pg_net a Vaultu nespadne.
  perform public.api_webhooky_tick();
  perform public.api_webhooky_uklid();

  -- Stav pro API.
  if public.web_objednavka_stav_api('na_ceste') <> 'in_transit' then raise exception 'stav_api'; end if;

  raise notice 'OBJEDNÁVKY: vše OK';
end $$;

rollback;
