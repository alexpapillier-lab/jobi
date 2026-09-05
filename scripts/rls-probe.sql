-- Test oprávnění: co dokáže uživatel přes REST, když obejde aplikaci.
--
-- Spuštění:  NODE_OPTIONS=--dns-result-order=ipv4first npx supabase db query --linked "$(cat scripts/rls-probe.sql)"
--
-- Funguje tak, že se vydá za daného uživatele (request.jwt.claims + role
-- authenticated; NULL = role anon bez přihlášení) a zkusí sadu dotazů.
-- Zápisy se vždy vrátí zpět, takže se testem nic nezmění.
--
-- Testovací identity (servis TEST2 = bbc926bd-…, E2E servis = 882beee7-…):
--   11111111-2222-4333-8444-555555555555  technik TEST2, člen s právy jen
--                                          „Úpravy zakázek“ a „Změna stavu“
--   721ef873-75c3-4ec1-bf71-13281051ce99  člen TEST2 bez jediného práva
--   22222222-3333-4444-8555-666666666666  správce TEST2 (spravce.test@jobi.test)
--   3e2e0000-1111-4222-8333-444455556666  majitel E2E servisu
--   NULL                                  anon
--
-- Čtení výsledků: PROSLO:n = dotaz prošel a dotkl se n řádků (u SELECT 0 =
-- RLS nic nepustila), ODMITNUTO = pravidlo, grant nebo trigger to zastavil.
-- Sloupec „ocekavano“: nic = PROSLO:0, odmitnuto = ODMITNUTO, projde/neco =
-- PROSLO s nenulovým počtem, kontrola = podívat se ručně.
--
-- Po doběhnutí funkci zase zahodit:  drop function public.__rls_probe(uuid, text);

create or replace function public.__rls_probe(p_user uuid, p_sql text) returns text
language plpgsql as $$
declare n bigint; msg text;
begin
  if p_user is null then
    perform set_config('request.jwt.claims', json_build_object('role', 'anon', 'aud', 'anon')::text, true);
    execute 'set local role anon';
  else
    perform set_config('request.jwt.claims', json_build_object('sub', p_user::text, 'role', 'authenticated', 'aud', 'authenticated')::text, true);
    execute 'set local role authenticated';
  end if;
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

-- Poznámka k očekáváním u zápisů: RLS zápis do cizích/nedovolených řádků
-- neodmítne chybou, jen ho odfiltruje (PROSLO:0); chybějící grant naopak
-- skončí ODMITNUTO. Obojí znamená, že se nic nestalo – u každé probe je
-- zapsané to, co danou tabulku skutečně chrání (16, 28, 29, 31 = RLS filtr;
-- 24, 108 = grant).
with p(poradi, kdo, oblast, ocekavano, dotaz) as (values
  -- ══ 1. kolo (5. 9.): technik TEST2 (11111111-…) ══════════════════════════
  (1,  '11111111-2222-4333-8444-555555555555', 'cizi servis: zakazky',        'nic',      'select * from tickets where service_id = ''d9762a27-6c8d-43c4-9207-5c837e2713a0'''),
  (2,  '11111111-2222-4333-8444-555555555555', 'cizi servis: zakaznici',      'nic',      'select * from customers where service_id = ''d9762a27-6c8d-43c4-9207-5c837e2713a0'''),
  (3,  '11111111-2222-4333-8444-555555555555', 'cizi servis: faktury',        'nic',      'select * from invoices where service_id = ''d9762a27-6c8d-43c4-9207-5c837e2713a0'''),
  (4,  '11111111-2222-4333-8444-555555555555', 'cizi servis: sklad',          'nic',      'select * from inventory_products where service_id = ''d9762a27-6c8d-43c4-9207-5c837e2713a0'''),
  (5,  '11111111-2222-4333-8444-555555555555', 'cizi servis: komentare',      'nic',      'select c.* from ticket_comments c join tickets t on t.id=c.ticket_id where t.service_id = ''d9762a27-6c8d-43c4-9207-5c837e2713a0'''),
  (6,  '11111111-2222-4333-8444-555555555555', 'cizi servis: SMS',            'nic',      'select * from sms_messages m where m.conversation_id in (select id from sms_conversations where service_id = ''d9762a27-6c8d-43c4-9207-5c837e2713a0'')'),
  (7,  '11111111-2222-4333-8444-555555555555', 'cizi servis: nastaveni',      'nic',      'select * from service_settings where service_id = ''d9762a27-6c8d-43c4-9207-5c837e2713a0'''),
  (8,  '11111111-2222-4333-8444-555555555555', 'cizi servis: zmena zakazky',  'nic',      'update tickets set customer_name = ''HACK'' where service_id = ''d9762a27-6c8d-43c4-9207-5c837e2713a0'''),
  (9,  '11111111-2222-4333-8444-555555555555', 'cizi servis: seznam servisu', 'nic',      'select * from services where id = ''d9762a27-6c8d-43c4-9207-5c837e2713a0'''),
  (10, '11111111-2222-4333-8444-555555555555', 'cizi servis: pripojeni na cizi servis', 'odmitnuto', 'insert into service_memberships (service_id, user_id, role) values (''d9762a27-6c8d-43c4-9207-5c837e2713a0'', ''11111111-2222-4333-8444-555555555555'', ''owner'')'),
  (11, '11111111-2222-4333-8444-555555555555', 'vlastni servis: zakazky',     'neco',     'select * from tickets where service_id = ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'''),
  (12, '11111111-2222-4333-8444-555555555555', 'vlastni servis: pobocky',     'neco',     'select * from branches where service_id = ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'''),
  (13, '11111111-2222-4333-8444-555555555555', 'ma pravo: uprava zakazky',    'projde',   'update tickets set customer_name = ''Test'' where service_id = ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'' and deleted_at is null'),
  (14, '11111111-2222-4333-8444-555555555555', 'ma pravo: zmena stavu',       'projde',   'update tickets set status = ''received'' where service_id = ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'' and deleted_at is null'),
  (15, '11111111-2222-4333-8444-555555555555', 'nema pravo: smazani zakazky', 'odmitnuto','update tickets set deleted_at = now() where service_id = ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'' and deleted_at is null'),
  (16, '11111111-2222-4333-8444-555555555555', 'nema pravo: sklad zapis',     'nic','update inventory_products set stock = 999 where service_id = ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'''),
  (17, '11111111-2222-4333-8444-555555555555', 'nema pravo: sklad mnozstvi',  'odmitnuto','update inventory_stock set quantity = 999 where service_id = ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'''),
  (18, '11111111-2222-4333-8444-555555555555', 'nema pravo: zarizeni',        'odmitnuto','insert into device_models (service_id, name) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''HACK'')'),
  (19, '11111111-2222-4333-8444-555555555555', 'nema pravo: statusy',         'odmitnuto','insert into service_statuses (service_id, key, label) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''hack'', ''HACK'')'),
  (20, '11111111-2222-4333-8444-555555555555', 'nema pravo: nastaveni RPC',   'odmitnuto','select update_service_settings(''bbc926bd-25ba-4da1-b528-92b6f1dee24d''::uuid, ''{"config":{"abbreviation":"HACK"}}''::jsonb)'),
  (21, '11111111-2222-4333-8444-555555555555', 'jen admin: pobocka pridat',   'odmitnuto','insert into branches (service_id, name) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''HACK'')'),
  (22, '11111111-2222-4333-8444-555555555555', 'jen admin: pobocka zmenit',   'nic',      'update branches set name = ''HACK'' where service_id = ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'''),
  (23, '11111111-2222-4333-8444-555555555555', 'tajemstvi: iDoklad klice',    'nic',      'select * from service_integrations'),
  (24, '11111111-2222-4333-8444-555555555555', 'tajemstvi: API tokeny',       'odmitnuto',      'select * from api_tokens'),
  (25, '11111111-2222-4333-8444-555555555555', 'tajemstvi: capture tokeny',   'nic',      'select * from capture_tokens'),
  (26, '11111111-2222-4333-8444-555555555555', 'tajemstvi: fotky z pristroju','nic',      'select * from draft_capture_photos'),
  (27, '11111111-2222-4333-8444-555555555555', 'tajemstvi: telefonni cisla',  'nic',      'select * from service_phone_numbers where service_id = ''d9762a27-6c8d-43c4-9207-5c837e2713a0'''),
  (28, '11111111-2222-4333-8444-555555555555', 'eskalace: povysit se',        'nic','update service_memberships set role = ''owner'' where user_id = ''11111111-2222-4333-8444-555555555555'''),
  (29, '11111111-2222-4333-8444-555555555555', 'eskalace: pridat si prava',   'nic','update service_memberships set capabilities = ''{"can_edit_inventory":true}''::jsonb where user_id = ''11111111-2222-4333-8444-555555555555'''),
  (30, '11111111-2222-4333-8444-555555555555', 'eskalace: zapnout si modul',  'odmitnuto','insert into service_entitlements (service_id, module, active) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''sms'', true)'),
  (31, '11111111-2222-4333-8444-555555555555', 'eskalace: zvysit limit',      'nic','update service_entitlements set quota = 99 where service_id = ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'''),
  (32, '11111111-2222-4333-8444-555555555555', 'eskalace: pozvat sam sebe',   'odmitnuto','insert into service_invites (service_id, email, role, token) values (''d9762a27-6c8d-43c4-9207-5c837e2713a0'', ''x@x.cz'', ''owner'', ''hack'')'),
  (33, '11111111-2222-4333-8444-555555555555', 'soukromi: cizi profily',      'kontrola', 'select * from profiles'),
  (34, '11111111-2222-4333-8444-555555555555', 'soukromi: cizi predvolby',    'nic',      'select * from user_preferences where user_id <> ''11111111-2222-4333-8444-555555555555'''),
  (35, '11111111-2222-4333-8444-555555555555', 'soukromi: chyby aplikace',    'kontrola', 'select * from error_logs'),
  (36, '11111111-2222-4333-8444-555555555555', 'automatizace: pridat pravidlo','kontrola','insert into automation_rules (service_id, name, trigger, action) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''HACK'', ''{"type":"ticket_created"}''::jsonb, ''{"type":"notify","message":"x"}''::jsonb)'),
  (37, '11111111-2222-4333-8444-555555555555', 'portal: udalosti cizi zakazky','nic',     'select e.* from ticket_portal_events e join tickets t on t.id = e.ticket_id where t.service_id = ''d9762a27-6c8d-43c4-9207-5c837e2713a0'''),
  (38, '11111111-2222-4333-8444-555555555555', 'portal: token cizi zakazky',  'nic',      'select portal_token from tickets where service_id = ''d9762a27-6c8d-43c4-9207-5c837e2713a0'' and portal_token is not null'),

  -- ══ 2. kolo (7. 9.): správce TEST2 (22222222-…) proti E2E servisu ════════
  (101, '22222222-3333-4444-8555-666666666666', 'admin: cizi pobocky cist',        'nic',       'select * from branches where service_id = ''882beee7-4564-4d10-8ac6-16dc19240b57'''),
  (102, '22222222-3333-4444-8555-666666666666', 'admin: cizi pobocky menit',       'nic',       'update branches set name = ''HACK'' where service_id = ''882beee7-4564-4d10-8ac6-16dc19240b57'''),
  (103, '22222222-3333-4444-8555-666666666666', 'admin: cizi pobocka pridat',      'odmitnuto', 'insert into branches (service_id, name) values (''882beee7-4564-4d10-8ac6-16dc19240b57'', ''HACK'')'),
  (104, '22222222-3333-4444-8555-666666666666', 'admin: cizi pobocku smazat',      'nic',       'delete from branches where service_id = ''882beee7-4564-4d10-8ac6-16dc19240b57'' and not is_default'),
  (105, '22222222-3333-4444-8555-666666666666', 'admin: cizi predplatne cist',     'nic',       'select * from service_billing where service_id = ''882beee7-4564-4d10-8ac6-16dc19240b57'''),
  (106, '22222222-3333-4444-8555-666666666666', 'admin: cizi integrace cist',      'nic',       'select * from service_integrations where service_id = ''882beee7-4564-4d10-8ac6-16dc19240b57'''),
  (107, '22222222-3333-4444-8555-666666666666', 'admin: cizi integrace pridat',    'odmitnuto', 'insert into service_integrations (service_id, provider, config) values (''882beee7-4564-4d10-8ac6-16dc19240b57'', ''idoklad'', ''{}'')'),
  (108, '22222222-3333-4444-8555-666666666666', 'admin: vlastni predplatne menit', 'odmitnuto',       'update service_billing set status = ''active'' where service_id = ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'''),
  (109, '22222222-3333-4444-8555-666666666666', 'admin: vlastni predplatne vlozit','odmitnuto', 'insert into service_billing (service_id, status) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''active'')'),
  (110, '22222222-3333-4444-8555-666666666666', 'admin: vlastni integrace pridat', 'projde',    'insert into service_integrations (service_id, provider, config) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''fakturoid'', ''{}'')'),
  (111, '22222222-3333-4444-8555-666666666666', 'admin: rate_hits',                'odmitnuto', 'select * from rate_hits'),
  (112, '22222222-3333-4444-8555-666666666666', 'admin: alert_events',             'odmitnuto', 'select * from alert_events'),
  (113, '22222222-3333-4444-8555-666666666666', 'admin: ticket_code_counters',     'odmitnuto', 'select * from ticket_code_counters'),
  (114, '22222222-3333-4444-8555-666666666666', 'admin: cislo zakazky cizi',       'odmitnuto', 'select dalsi_cislo_zakazky(''882beee7-4564-4d10-8ac6-16dc19240b57'', ''HACK26'')'),
  (115, '22222222-3333-4444-8555-666666666666', 'admin: cislo zakazky vlastni',    'projde',    'select dalsi_cislo_zakazky(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''AUDIT26'')'),
  (116, '22222222-3333-4444-8555-666666666666', 'admin: statistiky s cizim',       'odmitnuto', 'select statistiky_prehled(array[''bbc926bd-25ba-4da1-b528-92b6f1dee24d'',''882beee7-4564-4d10-8ac6-16dc19240b57'']::uuid[])'),
  (117, '22222222-3333-4444-8555-666666666666', 'admin: statistiky vlastni',       'projde',    'select statistiky_prehled(array[''bbc926bd-25ba-4da1-b528-92b6f1dee24d'']::uuid[])'),
  (118, '22222222-3333-4444-8555-666666666666', 'admin: service_storage_objects',  'odmitnuto', 'select * from service_storage_objects(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'')'),
  (119, '22222222-3333-4444-8555-666666666666', 'admin: zapocitej_udalost',        'odmitnuto', 'select zapocitej_udalost(''x'', ''y'')'),
  (120, '22222222-3333-4444-8555-666666666666', 'admin: pocet_udalosti',           'odmitnuto', 'select pocet_udalosti(''x'', ''y'', 5)'),
  (121, '22222222-3333-4444-8555-666666666666', 'admin: smazat cizi servis RPC',   'odmitnuto', 'select delete_service_for_root(''882beee7-4564-4d10-8ac6-16dc19240b57'')'),
  (122, '22222222-3333-4444-8555-666666666666', 'admin: alerts_uklid',             'odmitnuto', 'select alerts_uklid()'),
  (123, '22222222-3333-4444-8555-666666666666', 'admin: rate_hits_uklid',          'odmitnuto', 'select rate_hits_uklid()'),
  (124, '22222222-3333-4444-8555-666666666666', 'admin: purge_old_error_logs',     'odmitnuto', 'select purge_old_error_logs()'),
  (125, '22222222-3333-4444-8555-666666666666', 'admin: default_branch_id cizi',   'odmitnuto', 'select default_branch_id(''882beee7-4564-4d10-8ac6-16dc19240b57'')'),
  (126, '22222222-3333-4444-8555-666666666666', 'admin: branches_allowed cizi',    'odmitnuto', 'select branches_allowed(''882beee7-4564-4d10-8ac6-16dc19240b57'')'),
  (127, '22222222-3333-4444-8555-666666666666', 'admin: ucet podle e-mailu',       'odmitnuto', 'select get_auth_user_id_by_email(''e2e@jobi.test'')'),
  (128, '22222222-3333-4444-8555-666666666666', 'admin: clenstvi podle e-mailu',   'odmitnuto', 'select invited_email_has_any_membership(''e2e@jobi.test'')'),
  (129, '22222222-3333-4444-8555-666666666666', 'admin: cislo faktury cizi',       'odmitnuto', 'select next_invoice_number(''882beee7-4564-4d10-8ac6-16dc19240b57'', ''HACK'', 2026)'),
  (130, '22222222-3333-4444-8555-666666666666', 'admin: cislo faktury vlastni',    'projde',    'select next_invoice_number(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''AUDIT'', 2026)'),
  (131, '22222222-3333-4444-8555-666666666666', 'admin: cizi nabidka prepsat',     'nic',       'update tickets set quote_items = ''[]'' where service_id = ''882beee7-4564-4d10-8ac6-16dc19240b57'''),
  (132, '22222222-3333-4444-8555-666666666666', 'admin: home branch cizimu',       'odmitnuto', 'select set_member_home_branch(''882beee7-4564-4d10-8ac6-16dc19240b57'', ''3e2e0000-2222-4222-8333-444455556666'', ''a4c7e885-9570-45c2-bcfa-0b5aff665a77'')'),
  (133, '22222222-3333-4444-8555-666666666666', 'admin: integrace cizi providers', 'nic',       'select 1 from unnest(service_integration_providers(''882beee7-4564-4d10-8ac6-16dc19240b57''))'),
  (134, '22222222-3333-4444-8555-666666666666', 'admin: cizi chyby aplikace',      'nic',       'select * from error_logs where service_id = ''882beee7-4564-4d10-8ac6-16dc19240b57'''),
  (135, '22222222-3333-4444-8555-666666666666', 'admin: cizi naroky',              'nic',       'select * from service_entitlements where service_id = ''882beee7-4564-4d10-8ac6-16dc19240b57'''),
  (136, '22222222-3333-4444-8555-666666666666', 'admin: vlastni narok zapnout',    'odmitnuto', 'insert into service_entitlements (service_id, module, active) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''consolidated'', true)'),
  (137, '22222222-3333-4444-8555-666666666666', 'admin: cizi clenove',             'nic',       'select * from service_memberships where service_id = ''882beee7-4564-4d10-8ac6-16dc19240b57'''),
  (138, '22222222-3333-4444-8555-666666666666', 'admin: cizi servis prejmenovat',  'odmitnuto', 'update services set name = ''HACK'' where id = ''882beee7-4564-4d10-8ac6-16dc19240b57'''),

  -- ══ 2. kolo: člen TEST2 – technik (1111…) a člen bez práv (721ef873) ═════
  (140, '11111111-2222-4333-8444-555555555555', 'clen: pobocka menit',             'nic',       'update branches set phone = ''HACK'' where service_id = ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'''),
  (141, '11111111-2222-4333-8444-555555555555', 'clen: pobocka smazat',            'nic',       'delete from branches where service_id = ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'' and not is_default'),
  (142, '11111111-2222-4333-8444-555555555555', 'clen: predplatne cist',           'nic',       'select * from service_billing where service_id = ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'''),
  (143, '11111111-2222-4333-8444-555555555555', 'clen: integrace pridat',          'odmitnuto', 'insert into service_integrations (service_id, provider, config) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''fakturoid'', ''{}'')'),
  (144, '11111111-2222-4333-8444-555555555555', 'clen: cislo zakazky vlastni',     'projde',    'select dalsi_cislo_zakazky(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''AUDIT26'')'),
  (145, '11111111-2222-4333-8444-555555555555', 'clen s upravami: nabidka',        'projde',    'update tickets set quote_items = ''[{"name":"x","price":1}]'', quote_amount = 1 where id = ''723e134e-fd3a-4f98-9cce-5d8e180c1a3f'''),
  (146, '11111111-2222-4333-8444-555555555555', 'clen: smazat servis RPC',         'odmitnuto', 'select delete_service_for_root(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'')'),
  (150, '721ef873-75c3-4ec1-bf71-13281051ce99', 'clen bez prav: nabidka polozky',  'odmitnuto', 'update tickets set quote_items = ''[{"name":"x","price":1}]'' where id = ''723e134e-fd3a-4f98-9cce-5d8e180c1a3f'''),
  (151, '721ef873-75c3-4ec1-bf71-13281051ce99', 'clen bez prav: nabidka castka',   'odmitnuto', 'update tickets set quote_amount = 99999 where id = ''723e134e-fd3a-4f98-9cce-5d8e180c1a3f'''),
  (152, '721ef873-75c3-4ec1-bf71-13281051ce99', 'clen bez prav: nabidka schvalit', 'odmitnuto', 'update tickets set quote_status = ''approved'' where id = ''723e134e-fd3a-4f98-9cce-5d8e180c1a3f'''),
  (153, '721ef873-75c3-4ec1-bf71-13281051ce99', 'clen bez prav: pobocka zakazky',  'odmitnuto', 'update tickets set branch_id = ''ea9faf76-26eb-4be9-922c-3705477d423c'' where id = ''723e134e-fd3a-4f98-9cce-5d8e180c1a3f'''),
  (154, '721ef873-75c3-4ec1-bf71-13281051ce99', 'clen bez prav: termin',           'odmitnuto', 'update tickets set expected_completion_at = now() where id = ''723e134e-fd3a-4f98-9cce-5d8e180c1a3f'''),
  (155, '721ef873-75c3-4ec1-bf71-13281051ce99', 'clen bez prav: prislusenstvi',    'odmitnuto', 'update tickets set device_accessories = ''HACK'' where id = ''723e134e-fd3a-4f98-9cce-5d8e180c1a3f'''),
  (156, '721ef873-75c3-4ec1-bf71-13281051ce99', 'clen bez prav: portal token',     'odmitnuto', 'update tickets set portal_token = ''HACKHACKHACKHACKHACKHACKHACKHACK'' where id = ''723e134e-fd3a-4f98-9cce-5d8e180c1a3f'''),
  (157, '721ef873-75c3-4ec1-bf71-13281051ce99', 'clen bez prav: podpis prevzeti',  'odmitnuto', 'update tickets set intake_signed_at = now() where id = ''723e134e-fd3a-4f98-9cce-5d8e180c1a3f'''),
  (158, '721ef873-75c3-4ec1-bf71-13281051ce99', 'clen bez prav: zakladni udaj',    'odmitnuto', 'update tickets set customer_name = ''HACK'' where id = ''723e134e-fd3a-4f98-9cce-5d8e180c1a3f'''),
  (159, '721ef873-75c3-4ec1-bf71-13281051ce99', 'clen bez prav: stav + udaj',      'odmitnuto', 'update tickets set status = ''received'', customer_name = ''HACK'' where id = ''723e134e-fd3a-4f98-9cce-5d8e180c1a3f'''),
  (160, '721ef873-75c3-4ec1-bf71-13281051ce99', 'clen bez prav: smazat servis RPC','odmitnuto', 'select delete_service_for_root(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'')'),
  -- Technik s „Úpravy zakázek“ a „Změna stavu“, ale bez „Správy zákazníků“ – pro pořádek i portálový token.
  (161, '11111111-2222-4333-8444-555555555555', 'clen: portal token primo',        'odmitnuto', 'update tickets set portal_token = ''HACKHACKHACKHACKHACKHACKHACKHACK'' where id = ''723e134e-fd3a-4f98-9cce-5d8e180c1a3f'''),
  (162, '11111111-2222-4333-8444-555555555555', 'clen: portal token pres RPC',     'projde',    'select ensure_portal_token(''723e134e-fd3a-4f98-9cce-5d8e180c1a3f'')'),

  -- ══ 2. kolo: majitel E2E (3e2e…1111) proti TEST2 ═════════════════════════
  (170, '3e2e0000-1111-4222-8333-444455556666', 'owner: cizi pobocky',             'nic',       'select * from branches where service_id = ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'''),
  (171, '3e2e0000-1111-4222-8333-444455556666', 'owner: cizi pobocky menit',       'nic',       'update branches set name = ''HACK'' where service_id = ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'''),
  (172, '3e2e0000-1111-4222-8333-444455556666', 'owner: cizi integrace',           'nic',       'select * from service_integrations where service_id = ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'''),
  (173, '3e2e0000-1111-4222-8333-444455556666', 'owner: cizi predplatne',          'nic',       'select * from service_billing where service_id = ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'''),
  (174, '3e2e0000-1111-4222-8333-444455556666', 'owner: cizi zakazky',             'nic',       'select * from tickets where service_id = ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'''),
  (175, '3e2e0000-1111-4222-8333-444455556666', 'owner: cizi statistiky',          'odmitnuto', 'select statistiky_prehled(array[''bbc926bd-25ba-4da1-b528-92b6f1dee24d'']::uuid[])'),
  (176, '3e2e0000-1111-4222-8333-444455556666', 'owner: cizi cislo zakazky',       'odmitnuto', 'select dalsi_cislo_zakazky(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''HACK26'')'),
  (177, '3e2e0000-1111-4222-8333-444455556666', 'owner: smazat cizi servis RPC',   'odmitnuto', 'select delete_service_for_root(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'')'),
  (178, '3e2e0000-1111-4222-8333-444455556666', 'owner: cizi cislo faktury',       'odmitnuto', 'select next_invoice_number(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''HACK'', 2026)'),
  (179, '3e2e0000-1111-4222-8333-444455556666', 'owner: cizi clenove',             'nic',       'select * from service_memberships where service_id = ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'''),
  (180, '3e2e0000-1111-4222-8333-444455556666', 'owner: vlastni pobocka pridat',   'projde',    'insert into branches (service_id, name, code) values (''882beee7-4564-4d10-8ac6-16dc19240b57'', ''Audit'', ''AU'')'),

  -- ══ 2. kolo: anon (bez přihlášení) ══════════════════════════════════════
  (190, null, 'anon: smazat servis RPC',        'odmitnuto', 'select delete_service_for_root(''882beee7-4564-4d10-8ac6-16dc19240b57'')'),
  (191, null, 'anon: pobocky',                  'odmitnuto', 'select * from branches'),
  (192, null, 'anon: integrace',                'odmitnuto', 'select * from service_integrations'),
  (193, null, 'anon: predplatne',               'odmitnuto', 'select * from service_billing'),
  (194, null, 'anon: cislo zakazky',            'odmitnuto', 'select dalsi_cislo_zakazky(''882beee7-4564-4d10-8ac6-16dc19240b57'', ''X'')'),
  (195, null, 'anon: statistiky',               'odmitnuto', 'select statistiky_prehled(array[''882beee7-4564-4d10-8ac6-16dc19240b57'']::uuid[])'),
  (196, null, 'anon: default_branch_id',        'odmitnuto', 'select default_branch_id(''882beee7-4564-4d10-8ac6-16dc19240b57'')'),
  (197, null, 'anon: alerts_uklid',             'odmitnuto', 'select alerts_uklid()'),
  (198, null, 'anon: rate_hits_uklid',          'odmitnuto', 'select rate_hits_uklid()'),
  (199, null, 'anon: ucet podle e-mailu',       'odmitnuto', 'select get_auth_user_id_by_email(''e2e@jobi.test'')'),
  (200, null, 'anon: clenstvi podle e-mailu',   'odmitnuto', 'select invited_email_has_any_membership(''e2e@jobi.test'')'),
  (201, null, 'anon: cislo faktury',            'odmitnuto', 'select next_invoice_number(''882beee7-4564-4d10-8ac6-16dc19240b57'', ''HACK'', 2026)'),
  (202, null, 'anon: home branch',              'odmitnuto', 'select set_member_home_branch(''882beee7-4564-4d10-8ac6-16dc19240b57'', ''3e2e0000-2222-4222-8333-444455556666'', ''a4c7e885-9570-45c2-bcfa-0b5aff665a77'')')
)
select p.poradi, p.oblast, p.ocekavano, public.__rls_probe(p.kdo::uuid, p.dotaz) as vysledek
  from p
 order by p.poradi;
