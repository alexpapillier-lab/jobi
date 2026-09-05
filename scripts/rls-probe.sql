-- Test oprávnění: co dokáže člen servisu přes REST, když obejde aplikaci.
--
-- Spuštění:  npx supabase db query --linked "$(cat scripts/rls-probe.sql)"
--
-- Funguje tak, že se vydá za daného uživatele (request.jwt.claims + role
-- authenticated) a zkusí sadu dotazů. Zápisy se vždy vrátí zpět, takže se
-- testem nic nezmění. Testovací člen: technik.test@jobi.test na servisu TEST2,
-- role member, práva jen „Úpravy zakázek“ a „Změna stavu“.
--
-- Čtení: PROSLO:n = dotaz prošel a dotkl se n řádků (u SELECT 0 = RLS nic
-- nepustila), ODMITNUTO = pravidlo nebo trigger to zastavil.
--
-- Po doběhnutí funkci zase zahodit:  drop function public.__rls_probe(uuid, text);

create or replace function public.__rls_probe(p_user uuid, p_sql text) returns text
language plpgsql as $$
declare n bigint; msg text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user::text, 'role', 'authenticated', 'aud', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    execute p_sql;
    get diagnostics n = row_count;
    -- Vlastní výjimka vrátí podtransakci zpět, takže zápisy z testu nezůstanou.
    raise exception using errcode = 'ZZ001', message = n::text;
  exception
    when sqlstate 'ZZ001' then
      msg := sqlerrm;
      execute 'reset role';
      return 'PROSLO:' || msg;
    when others then
      msg := sqlerrm;
      execute 'reset role';
      return 'ODMITNUTO: ' || left(msg, 90);
  end;
end $$;

with t as (
  select '11111111-2222-4333-8444-555555555555'::uuid as clen,
         'bbc926bd-25ba-4da1-b528-92b6f1dee24d'::uuid as vlastni,
         'd9762a27-6c8d-43c4-9207-5c837e2713a0'::uuid as cizi
), p(poradi, oblast, ocekavano, dotaz) as (values
  (1,  'cizi servis: zakazky',        'nic',      'select * from tickets where service_id = ''d9762a27-6c8d-43c4-9207-5c837e2713a0'''),
  (2,  'cizi servis: zakaznici',      'nic',      'select * from customers where service_id = ''d9762a27-6c8d-43c4-9207-5c837e2713a0'''),
  (3,  'cizi servis: faktury',        'nic',      'select * from invoices where service_id = ''d9762a27-6c8d-43c4-9207-5c837e2713a0'''),
  (4,  'cizi servis: sklad',          'nic',      'select * from inventory_products where service_id = ''d9762a27-6c8d-43c4-9207-5c837e2713a0'''),
  (5,  'cizi servis: komentare',      'nic',      'select c.* from ticket_comments c join tickets t on t.id=c.ticket_id where t.service_id = ''d9762a27-6c8d-43c4-9207-5c837e2713a0'''),
  (6,  'cizi servis: SMS',            'nic',      'select * from sms_messages m where m.conversation_id in (select id from sms_conversations where service_id = ''d9762a27-6c8d-43c4-9207-5c837e2713a0'')'),
  (7,  'cizi servis: nastaveni',      'nic',      'select * from service_settings where service_id = ''d9762a27-6c8d-43c4-9207-5c837e2713a0'''),
  (8,  'cizi servis: zmena zakazky',  'nic',      'update tickets set customer_name = ''HACK'' where service_id = ''d9762a27-6c8d-43c4-9207-5c837e2713a0'''),
  (9,  'cizi servis: seznam servisu', 'nic',      'select * from services where id = ''d9762a27-6c8d-43c4-9207-5c837e2713a0'''),
  (10, 'cizi servis: pripojeni na cizi servis', 'odmitnuto', 'insert into service_memberships (service_id, user_id, role) values (''d9762a27-6c8d-43c4-9207-5c837e2713a0'', ''11111111-2222-4333-8444-555555555555'', ''owner'')'),
  (11, 'vlastni servis: zakazky',     'neco',     'select * from tickets where service_id = ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'''),
  (12, 'vlastni servis: pobocky',     'neco',     'select * from branches where service_id = ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'''),
  (13, 'ma pravo: uprava zakazky',    'projde',   'update tickets set customer_name = ''Test'' where service_id = ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'' and deleted_at is null'),
  (14, 'ma pravo: zmena stavu',       'projde',   'update tickets set status = ''received'' where service_id = ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'' and deleted_at is null'),
  (15, 'nema pravo: smazani zakazky', 'odmitnuto','update tickets set deleted_at = now() where service_id = ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'' and deleted_at is null'),
  (16, 'nema pravo: sklad zapis',     'odmitnuto','update inventory_products set stock = 999 where service_id = ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'''),
  (17, 'nema pravo: sklad mnozstvi',  'odmitnuto','update inventory_stock set quantity = 999 where service_id = ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'''),
  (18, 'nema pravo: zarizeni',        'odmitnuto','insert into device_models (service_id, name) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''HACK'')'),
  (19, 'nema pravo: statusy',         'odmitnuto','insert into service_statuses (service_id, key, label) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''hack'', ''HACK'')'),
  (20, 'nema pravo: nastaveni RPC',   'odmitnuto','select update_service_settings(''bbc926bd-25ba-4da1-b528-92b6f1dee24d''::uuid, ''{\"config\":{\"abbreviation\":\"HACK\"}}''::jsonb)'),
  (21, 'jen admin: pobocka pridat',   'odmitnuto','insert into branches (service_id, name) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''HACK'')'),
  (22, 'jen admin: pobocka zmenit',   'odmitnuto','update branches set name = ''HACK'' where service_id = ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'''),
  (23, 'tajemstvi: iDoklad klice',    'nic',      'select * from service_integrations'),
  (24, 'tajemstvi: API tokeny',       'nic',      'select * from api_tokens'),
  (25, 'tajemstvi: capture tokeny',   'nic',      'select * from capture_tokens'),
  (26, 'tajemstvi: fotky z pristroju','nic',      'select * from draft_capture_photos'),
  (27, 'tajemstvi: telefonni cisla',  'nic',      'select * from service_phone_numbers where service_id = ''d9762a27-6c8d-43c4-9207-5c837e2713a0'''),
  (28, 'eskalace: povysit se',        'odmitnuto','update service_memberships set role = ''owner'' where user_id = ''11111111-2222-4333-8444-555555555555'''),
  (29, 'eskalace: pridat si prava',   'odmitnuto','update service_memberships set capabilities = ''{\"can_edit_inventory\":true}''::jsonb where user_id = ''11111111-2222-4333-8444-555555555555'''),
  (30, 'eskalace: zapnout si modul',  'odmitnuto','insert into service_entitlements (service_id, module, active) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''sms'', true)'),
  (31, 'eskalace: zvysit limit',      'odmitnuto','update service_entitlements set quota = 99 where service_id = ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'''),
  (32, 'eskalace: pozvat sam sebe',   'odmitnuto','insert into service_invites (service_id, email, role, token) values (''d9762a27-6c8d-43c4-9207-5c837e2713a0'', ''x@x.cz'', ''owner'', ''hack'')'),
  (33, 'soukromi: cizi profily',      'kontrola', 'select * from profiles'),
  (34, 'soukromi: cizi predvolby',    'nic',      'select * from user_preferences where user_id <> ''11111111-2222-4333-8444-555555555555'''),
  (35, 'soukromi: chyby aplikace',    'kontrola', 'select * from error_logs'),
  (36, 'automatizace: pridat pravidlo','kontrola','insert into automation_rules (service_id, name, trigger, action) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''HACK'', ''{\"type\":\"ticket_created\"}''::jsonb, ''{\"type\":\"notify\",\"message\":\"x\"}''::jsonb)'),
  (37, 'portal: udalosti cizi zakazky','nic',     'select e.* from ticket_portal_events e join tickets t on t.id = e.ticket_id where t.service_id = ''d9762a27-6c8d-43c4-9207-5c837e2713a0'''),
  (38, 'portal: token cizi zakazky',  'nic',      'select portal_token from tickets where service_id = ''d9762a27-6c8d-43c4-9207-5c837e2713a0'' and portal_token is not null')
)
select p.poradi, p.oblast, p.ocekavano, public.__rls_probe(t.clen, p.dotaz) as vysledek
  from p, t
 order by p.poradi;
