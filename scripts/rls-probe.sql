-- Test oprávnění: co dokáže uživatel přes REST, když obejde aplikaci.
--
-- Spuštění:  npx supabase db query --linked -f scripts/rls-probe.sql
--            (ne přes "$(cat …)" – ta forma se v nové CLI rozbije o pomlčky
--            v komentářích; s -f komentáře nevadí)
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
--   33333333-4444-4555-8666-777777777777  člen TEST2 omezený na pobočku Brno
--                                          (pobocka.test@jobi.test, „Jen vlastní
--                                          pobočka“; hlavní pobočka je pro něj cizí)
--   NULL                                  anon
--
-- Čtení výsledků: PROSLO:n = dotaz prošel a dotkl se n řádků (u SELECT 0 =
-- RLS nic nepustila), ODMITNUTO = pravidlo, grant nebo trigger to zastavil.
-- Sloupec „ocekavano“: nic = PROSLO:0, odmitnuto = ODMITNUTO, projde/neco =
-- PROSLO s nenulovým počtem, kontrola = podívat se ručně.
--
-- Některé sondy (série 600) posílají místo jednoho dotazu blok DO: potřebují
-- si nejdřív jako správce založit řádek, který v testovacím servisu není, a
-- pak se vydat za omezeného člena. Blok vrací vždycky nula řádků, takže se
-- u nich čeká „nic“ – a když ochrana chybí, blok skončí vlastní výjimkou,
-- tedy ODMITNUTO. Zapsané změny se berou zpět stejně jako u ostatních sond.
--
-- POZOR: funkce se MUSÍ po doběhnutí zahodit – dělá se to na posledním
-- řádku tohohle souboru, ať se na to nedá zapomenout. Když v databázi
-- zůstane, může přes ni kdokoli s veřejným klíčem spustit libovolné SQL
-- pod identitou libovolného uživatele. Přesně to se 6. 9. 2026 stalo:
-- funkce tam po předchozím kole auditu zůstala s právem EXECUTE pro anon.

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
  -- ══ 3. kolo (6. 9.): člen omezený na pobočku Brno (33333333-…) ═════════════
  -- Uvnitř vlastního servisu smí jen svou pobočku. Každá tabulka s odkazem na
  -- zakázku musí mít politiku „jen k viditelným zakázkám“, ne jen členství.
  (300, '33333333-4444-4555-8666-777777777777', 'pobocka: vlastni zakazky',            'neco',      'select * from tickets where service_id = ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'' and branch_id = ''01fa9595-3acd-442e-acda-0f84d4146609'' and deleted_at is null'),
  (301, '33333333-4444-4555-8666-777777777777', 'pobocka: cizi zakazky',               'nic',       'select * from tickets where service_id = ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'' and branch_id = ''ea9faf76-26eb-4be9-922c-3705477d423c'''),
  (302, '33333333-4444-4555-8666-777777777777', 'pobocka: cizi historie',              'nic',       'select h.* from ticket_history h join tickets t on t.id = h.ticket_id where t.branch_id = ''ea9faf76-26eb-4be9-922c-3705477d423c'''),
  (303, '33333333-4444-4555-8666-777777777777', 'pobocka: cizi komentare',             'nic',       'select c.* from ticket_comments c join tickets t on t.id = c.ticket_id where t.branch_id = ''ea9faf76-26eb-4be9-922c-3705477d423c'''),
  (304, '33333333-4444-4555-8666-777777777777', 'pobocka: cizi useky prace',           'nic',       'select w.* from ticket_work_sessions w join tickets t on t.id = w.ticket_id where t.branch_id = ''ea9faf76-26eb-4be9-922c-3705477d423c'''),
  (305, '33333333-4444-4555-8666-777777777777', 'pobocka: cizi faktury',               'nic',       'select * from invoices where service_id = ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'' and branch_id = ''ea9faf76-26eb-4be9-922c-3705477d423c'''),
  (306, '33333333-4444-4555-8666-777777777777', 'pobocka: cizi reklamace',             'nic',       'select * from warranty_claims where service_id = ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'' and branch_id = ''ea9faf76-26eb-4be9-922c-3705477d423c'''),
  (307, '33333333-4444-4555-8666-777777777777', 'pobocka: zmena cizi zakazky',         'nic',       'update tickets set customer_name = ''HACK'' where service_id = ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'' and branch_id = ''ea9faf76-26eb-4be9-922c-3705477d423c'' and deleted_at is null'),
  (308, '33333333-4444-4555-8666-777777777777', 'pobocka: presun zakazky mimo pobocku','odmitnuto',       'update tickets set branch_id = null where service_id = ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'' and branch_id = ''01fa9595-3acd-442e-acda-0f84d4146609'' and deleted_at is null'),
  (309, '33333333-4444-4555-8666-777777777777', 'pobocka: zakazka bez pobocky',        'odmitnuto', 'insert into tickets (service_id, title, status, customer_name, branch_id) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''HACK'', ''received'', ''HACK'', null)'),
  (310, '33333333-4444-4555-8666-777777777777', 'pobocka: stav cizi zakazky (RPC)',    'odmitnuto', 'select change_ticket_status((select id from tickets where service_id = ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'' and branch_id = ''ea9faf76-26eb-4be9-922c-3705477d423c'' and deleted_at is null limit 1), ''received'')'),
  (311, '33333333-4444-4555-8666-777777777777', 'pobocka: portal cizi zakazky (RPC)',  'odmitnuto', 'select ensure_portal_token((select id from tickets where service_id = ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'' and branch_id = ''ea9faf76-26eb-4be9-922c-3705477d423c'' and deleted_at is null limit 1))'),
  (312, '33333333-4444-4555-8666-777777777777', 'pobocka: statistiky jen vlastni',     'kontrola',  'select (statistiky_prehled(array[''bbc926bd-25ba-4da1-b528-92b6f1dee24d'']::uuid[], null, null, ''ea9faf76-26eb-4be9-922c-3705477d423c''::uuid) -> ''pocetVObdobi'')::int as zakazek'),
  (202, null, 'anon: home branch',              'odmitnuto', 'select set_member_home_branch(''882beee7-4564-4d10-8ac6-16dc19240b57'', ''3e2e0000-2222-4222-8333-444455556666'', ''a4c7e885-9570-45c2-bcfa-0b5aff665a77'')'),
  -- ══ 4. kolo (6. 9.): ukládání práv členů ═══════════════════════════════════
  -- Rozhraní posílá vždy všechny klíče najednou, takže jediný neznámý zablokuje
  -- celý zápis. Přesně tak nešlo měnit práva po přidání pobočkových omezení.
  (400, '22222222-3333-4444-8555-666666666666', 'spravce: prava vc. branch_only',  'projde',    'select set_member_capabilities(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''11111111-2222-4333-8444-555555555555'', (select jsonb_object_agg(k, true) from unnest(povolene_capability()) k))'),
  (401, '22222222-3333-4444-8555-666666666666', 'spravce: neznamy klic prav',      'odmitnuto', 'select set_member_capabilities(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''11111111-2222-4333-8444-555555555555'', ''{"can_hack_everything": true}''::jsonb)'),
  (402, '11111111-2222-4333-8444-555555555555', 'technik: rozdavani prav',         'odmitnuto', 'select set_member_capabilities(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''11111111-2222-4333-8444-555555555555'', ''{"can_manage_statuses": true}''::jsonb)'),
  (403, null, 'anon: rozdavani prav',                                              'odmitnuto', 'select set_member_capabilities(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''11111111-2222-4333-8444-555555555555'', ''{"can_manage_statuses": true}''::jsonb)'),
  (404, '3e2e0000-1111-4222-8333-444455556666', 'majitel E2E: prava v cizim servisu','odmitnuto','select set_member_capabilities(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''11111111-2222-4333-8444-555555555555'', ''{"can_manage_statuses": true}''::jsonb)'),
  (405, '22222222-3333-4444-8555-666666666666', 'spravce: prava s hodnotou null',   'projde',    'select set_member_capabilities(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''11111111-2222-4333-8444-555555555555'', ''{"can_manage_statuses": null}''::jsonb)'),
  (406, '22222222-3333-4444-8555-666666666666', 'spravce: prazdna prava nic nemenil','projde',   'select set_member_capabilities(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''11111111-2222-4333-8444-555555555555'', ''{}''::jsonb)'),
  -- ══ 5. kolo (6. 9. večer): vedlejší tabulky a skladová RPC vs. pobočka ═════
  (500, '33333333-4444-4555-8666-777777777777', 'pobocka: cizi SMS konverzace',      'nic',       'select c.* from sms_conversations c join tickets t on t.id = c.ticket_id where t.branch_id = ''ea9faf76-26eb-4be9-922c-3705477d423c'''),
  (501, '33333333-4444-4555-8666-777777777777', 'pobocka: cizi SMS zpravy',          'nic',       'select m.* from sms_messages m join sms_conversations c on c.id = m.conversation_id join tickets t on t.id = c.ticket_id where t.branch_id = ''ea9faf76-26eb-4be9-922c-3705477d423c'''),
  (502, '33333333-4444-4555-8666-777777777777', 'pobocka: cizi historie reklamaci',  'nic',       'select h.* from warranty_claim_history h join warranty_claims w on w.id = h.warranty_claim_id where w.branch_id = ''ea9faf76-26eb-4be9-922c-3705477d423c'''),
  (503, '33333333-4444-4555-8666-777777777777', 'pobocka: cizi udalosti portalu',    'nic',       'select e.* from ticket_portal_events e join tickets t on t.id = e.ticket_id where t.branch_id = ''ea9faf76-26eb-4be9-922c-3705477d423c'''),
  (504, '33333333-4444-4555-8666-777777777777', 'pobocka: cizi dokumenty zakazky',   'nic',       'select d.* from ticket_documents d join tickets t on t.id = d.ticket_id where t.branch_id = ''ea9faf76-26eb-4be9-922c-3705477d423c'''),
  (505, '33333333-4444-4555-8666-777777777777', 'pobocka: cizi rezervace dilu',      'nic',       'select r.* from inventory_reservations r join tickets t on t.id = r.ticket_id where t.branch_id = ''ea9faf76-26eb-4be9-922c-3705477d423c'''),
  (506, '33333333-4444-4555-8666-777777777777', 'pobocka: cizi behy automatizaci',   'nic',       'select a.* from automation_runs a join tickets t on t.id = a.ticket_id where t.branch_id = ''ea9faf76-26eb-4be9-922c-3705477d423c'''),
  (507, '33333333-4444-4555-8666-777777777777', 'pobocka: cizi polozky objednavek',  'nic',       'select i.* from inventory_purchase_order_items i join tickets t on t.id = i.ticket_id where t.branch_id = ''ea9faf76-26eb-4be9-922c-3705477d423c'''),
  -- Zakázka z cizí pobočky není pro tenhle účet vidět, takže `insert … select`
  -- nemá co vložit. Nula vložených řádků je stejně bezpečná jako odmítnutí.
  (509, '33333333-4444-4555-8666-777777777777', 'pobocka: komentar na cizi zakazku', 'nic', 'insert into ticket_comments (service_id, ticket_id, content) select ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', t.id, ''HACK'' from tickets t where t.service_id = ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'' and t.branch_id = ''ea9faf76-26eb-4be9-922c-3705477d423c'' limit 1'),
  (510, '33333333-4444-4555-8666-777777777777', 'pobocka: historie na cizi zakazku', 'nic', 'insert into ticket_history (service_id, ticket_id, action) select ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', t.id, ''updated'' from tickets t where t.service_id = ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'' and t.branch_id = ''ea9faf76-26eb-4be9-922c-3705477d423c'' limit 1'),
  (511, '33333333-4444-4555-8666-777777777777', 'pobocka: rezervace cizi zakazky RPC','odmitnuto','select inventory_reserve_for_repair(''f1ee088f-3aef-4380-aa52-897690259ae0''::uuid, ''audit'', array[]::uuid[], 1)'),
  (512, '33333333-4444-4555-8666-777777777777', 'pobocka: uvolneni rezervaci RPC',   'odmitnuto', 'select inventory_release_reservations(''f1ee088f-3aef-4380-aa52-897690259ae0''::uuid)'),
  (513, '33333333-4444-4555-8666-777777777777', 'pobocka: odepsani skladu RPC',      'odmitnuto', 'select inventory_consume_ticket(''f1ee088f-3aef-4380-aa52-897690259ae0''::uuid)'),
  (520, null, 'anon: vypis diagnostickych fotek',                                    'nic',       'select * from storage.objects where bucket_id = ''diagnostic-photos'''),
  -- Úložiště navíc mazání přes SQL zakazuje samo; politika je druhá pojistka.
  (521, '11111111-2222-4333-8444-555555555555', 'clen: cizi fotky smazat',           'odmitnuto',       'delete from storage.objects where bucket_id = ''diagnostic-photos'' and (storage.foldername(name))[1] <> ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'''),
  (530, '721ef873-75c3-4ec1-bf71-13281051ce99', 'clen bez prav: reklamace zalozit',  'odmitnuto', 'insert into warranty_claims (service_id, code, status) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''HACK'', ''new'')'),
  (531, '721ef873-75c3-4ec1-bf71-13281051ce99', 'clen bez prav: reklamace smazat',   'nic',       'delete from warranty_claims where service_id = ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'''),
  (532, '11111111-2222-4333-8444-555555555555', 'clen: telefonni cislo prepsat',     'nic',       'update service_phone_numbers set twilio_number = ''+420000000000'' where service_id = ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'''),
  -- ══ 6. kolo (12. 9.): sedm děr z hloubkového testu poboček ════════════════
  -- Ke každé díře z hlavičky migrace 20260912100000 je tu sonda. Sondy, které
  -- potřebují řádek, jaký v TEST2 není (dokument, SMS konverzace, rezervace),
  -- si ho v bloku DO nejdřív založí jako správce a pak se vydají za omezeného
  -- člena; celý blok se stejně jako každá jiná sonda na konci vrátí zpět.
  -- Očekávání „nic“ u bloku DO znamená „proběhl a nic nenamítal“; když
  -- ochrana chybí, blok skončí výjimkou, tedy ODMITNUTO.

  -- 1) domovskou pobočku si omezený člen nepřepíše sám
  (600, '33333333-4444-4555-8666-777777777777', 'pobocka: prepsat si domovskou',   'odmitnuto', 'select set_member_home_branch(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''33333333-4444-4555-8666-777777777777'', ''ea9faf76-26eb-4be9-922c-3705477d423c'')'),
  (601, '33333333-4444-4555-8666-777777777777', 'pobocka: zrusit si domovskou',    'odmitnuto', 'select set_member_home_branch(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''33333333-4444-4555-8666-777777777777'', null)'),

  -- 2) bez domovské pobočky nevidí nic (dřív viděl celý servis)
  (602, '22222222-3333-4444-8555-666666666666', 'pobocky: po prepnuti na Prahu 6 nevidi Brno',     'nic', 'do $blok$ declare n bigint; begin perform public.set_member_branches(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''33333333-4444-4555-8666-777777777777'', array[''9e397ff1-1489-4e74-8c4d-0241279d82a0'']::uuid[]); perform set_config(''request.jwt.claims'', ''{"sub":"33333333-4444-4555-8666-777777777777","role":"authenticated"}'', true); select count(*) into n from tickets where service_id = ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'' and branch_id = ''01fa9595-3acd-442e-acda-0f84d4146609''; if n <> 0 then raise exception ''clen prepnuty na Prahu 6 vidi % zakazek Brna'', n; end if; end $blok$'),

  -- 3) statistiky se bez domovské pobočky taky nesmí otevřít
  (603, '22222222-3333-4444-8555-666666666666', 'pobocky: statistiky cizi pobocky jsou prazdne',   'nic', 'do $blok$ declare n int; begin perform public.set_member_branches(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''33333333-4444-4555-8666-777777777777'', array[''9e397ff1-1489-4e74-8c4d-0241279d82a0'']::uuid[]); perform set_config(''request.jwt.claims'', ''{"sub":"33333333-4444-4555-8666-777777777777","role":"authenticated"}'', true); select (statistiky_prehled(array[''bbc926bd-25ba-4da1-b528-92b6f1dee24d'']::uuid[], null, null, ''01fa9595-3acd-442e-acda-0f84d4146609'') -> ''kpi'' ->> ''totalTickets'')::int into n; if n is null then raise exception ''statistiky nevratily pocet zakazek – sonda by nic nezmerila''; end if; if n <> 0 then raise exception ''statistiky cizi pobocky vraci % zakazek'', n; end if; end $blok$'),

  -- 4) dokumenty zakázky z cizí pobočky
  (604, '33333333-4444-4555-8666-777777777777', 'pobocka: dokument cizi zakazky',  'odmitnuto', 'insert into ticket_documents (service_id, ticket_id, doc_type, storage_path, content_hash) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''6d652acf-6359-4272-8e26-0cb57bef3c06'', ''diagnostic_protocol'', ''hack/a.pdf'', ''hack'')'),
  (605, '22222222-3333-4444-8555-666666666666', 'pobocka: prepis dokumentu cizi',  'nic', 'do $blok$ declare n int; begin insert into ticket_documents (id, service_id, ticket_id, doc_type, storage_path, content_hash) values (''00000000-0000-4000-8000-000000000605'', ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''6d652acf-6359-4272-8e26-0cb57bef3c06'', ''diagnostic_protocol'', ''sonda/605.pdf'', ''x''); perform set_config(''request.jwt.claims'', ''{"sub":"33333333-4444-4555-8666-777777777777","role":"authenticated"}'', true); update ticket_documents set storage_path = ''HACK'' where id = ''00000000-0000-4000-8000-000000000605''; get diagnostics n = row_count; if n <> 0 then raise exception ''omezeny clen prepsal dokument cizi pobocky''; end if; end $blok$'),

  -- 5) historie reklamace z cizí pobočky
  (606, '33333333-4444-4555-8666-777777777777', 'pobocka: historie cizi reklamace','odmitnuto', 'insert into warranty_claim_history (service_id, warranty_claim_id, action) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''5bd994da-a3b2-49ea-a2a6-4801f9f97f8a'', ''updated'')'),

  -- Poznámka ke změnám a mazání (605, 607, 608, 610, 611): řádek cizí pobočky
  -- je pro omezeného člena neviditelný už restriktivní politikou pro SELECT a
  -- Postgres ji uplatní i při hledání řádků pro UPDATE a DELETE. Ověřeno
  -- mutací: po odstranění nových politik ty sondy pořád projdou. Nové politiky
  -- jsou tedy druhá pojistka – sondy hlídají výsledek, ne konkrétní vrstvu.

  -- 6) SMS konverzace cizí zakázky (archivace i smazání naslepo)
  (607, '22222222-3333-4444-8555-666666666666', 'pobocka: archiv cizi SMS',        'nic', 'do $blok$ declare n int; begin insert into sms_conversations (id, service_id, ticket_id, customer_phone) values (''00000000-0000-4000-8000-000000000607'', ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''6d652acf-6359-4272-8e26-0cb57bef3c06'', ''+420000000607''); perform set_config(''request.jwt.claims'', ''{"sub":"33333333-4444-4555-8666-777777777777","role":"authenticated"}'', true); update sms_conversations set archived = true where id = ''00000000-0000-4000-8000-000000000607''; get diagnostics n = row_count; if n <> 0 then raise exception ''omezeny clen archivoval SMS konverzaci cizi pobocky''; end if; end $blok$'),
  (608, '22222222-3333-4444-8555-666666666666', 'pobocka: smazani cizi SMS',       'nic', 'do $blok$ declare n int; begin insert into sms_conversations (id, service_id, ticket_id, customer_phone) values (''00000000-0000-4000-8000-000000000608'', ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''6d652acf-6359-4272-8e26-0cb57bef3c06'', ''+420000000608''); perform set_config(''request.jwt.claims'', ''{"sub":"33333333-4444-4555-8666-777777777777","role":"authenticated"}'', true); delete from sms_conversations where id = ''00000000-0000-4000-8000-000000000608''; get diagnostics n = row_count; if n <> 0 then raise exception ''omezeny clen smazal SMS konverzaci cizi pobocky''; end if; end $blok$'),

  -- 7) rezervace dílů přes REST (RPC pobočku hlídají od 9. 9., REST ne)
  (609, '22222222-3333-4444-8555-666666666666', 'pobocka: rezervace cizi zakazky', 'nic', 'do $blok$ declare n int; begin perform set_member_capabilities(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''33333333-4444-4555-8666-777777777777'', (select jsonb_object_agg(k, true) from unnest(povolene_capability()) k)); perform set_config(''request.jwt.claims'', ''{"sub":"33333333-4444-4555-8666-777777777777","role":"authenticated"}'', true); begin insert into inventory_reservations (service_id, product_id, ticket_id, qty) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''622e4515-2d11-4f99-af4b-f4d8a7e968a6'', ''6d652acf-6359-4272-8e26-0cb57bef3c06'', 1); get diagnostics n = row_count; raise exception ''rezervace na zakazku cizi pobocky presla (radku: %)'', n; exception when sqlstate ''42501'' then null; end; end $blok$'),
  (610, '22222222-3333-4444-8555-666666666666', 'pobocka: zmena cizi rezervace',   'nic', 'do $blok$ declare n int; begin insert into inventory_reservations (id, service_id, product_id, ticket_id, qty) values (''00000000-0000-4000-8000-000000000610'', ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''622e4515-2d11-4f99-af4b-f4d8a7e968a6'', ''6d652acf-6359-4272-8e26-0cb57bef3c06'', 1); perform set_config(''request.jwt.claims'', ''{"sub":"33333333-4444-4555-8666-777777777777","role":"authenticated"}'', true); update inventory_reservations set qty = 99 where id = ''00000000-0000-4000-8000-000000000610''; get diagnostics n = row_count; if n <> 0 then raise exception ''omezeny clen zmenil rezervaci cizi pobocky''; end if; end $blok$'),
  (611, '22222222-3333-4444-8555-666666666666', 'pobocka: zruseni cizi rezervace', 'nic', 'do $blok$ declare n int; begin insert into inventory_reservations (id, service_id, product_id, ticket_id, qty) values (''00000000-0000-4000-8000-000000000611'', ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''622e4515-2d11-4f99-af4b-f4d8a7e968a6'', ''6d652acf-6359-4272-8e26-0cb57bef3c06'', 1); perform set_config(''request.jwt.claims'', ''{"sub":"33333333-4444-4555-8666-777777777777","role":"authenticated"}'', true); delete from inventory_reservations where id = ''00000000-0000-4000-8000-000000000611''; get diagnostics n = row_count; if n <> 0 then raise exception ''omezeny clen zrusil rezervaci cizi pobocky''; end if; end $blok$'),

  -- Navíc k sedmi dírám: sklady cizí pobočky a rozdělaná práce po přesunu.
  -- Sklad cizí pobočky: aby bylo vidět, že ho hlídá pobočka a ne jen právo na
  -- sklad, dostane omezený člen v bloku na chvíli všechna práva včetně skladu.
  (612, '22222222-3333-4444-8555-666666666666', 'pobocka: cizi sklad prejmenovat', 'nic', 'do $blok$ declare n int; v_msg text; begin perform set_member_capabilities(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''33333333-4444-4555-8666-777777777777'', (select jsonb_object_agg(k, true) from unnest(povolene_capability()) k)); perform set_config(''request.jwt.claims'', ''{"sub":"33333333-4444-4555-8666-777777777777","role":"authenticated"}'', true); begin update inventory_warehouses set name = ''HACK'' where id = ''b7da27a9-6e6d-4492-b1fc-cdf4f39662b4''; get diagnostics n = row_count; raise exception ''sklad cizi pobocky sel prejmenovat (radku: %)'', n; exception when sqlstate ''42501'' then get stacked diagnostics v_msg = message_text; if v_msg not like ''%pobočce%'' then raise exception ''odmitnuto z jineho duvodu: %'', v_msg; end if; end; end $blok$'),
  (613, '22222222-3333-4444-8555-666666666666', 'pobocka: cizi sklad prehodit',    'nic', 'do $blok$ declare n int; v_msg text; begin perform set_member_capabilities(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''33333333-4444-4555-8666-777777777777'', (select jsonb_object_agg(k, true) from unnest(povolene_capability()) k)); perform set_config(''request.jwt.claims'', ''{"sub":"33333333-4444-4555-8666-777777777777","role":"authenticated"}'', true); begin update inventory_warehouses set branch_id = ''01fa9595-3acd-442e-acda-0f84d4146609'' where id = ''b7da27a9-6e6d-4492-b1fc-cdf4f39662b4''; get diagnostics n = row_count; raise exception ''sklad cizi pobocky sel prehodit pod svou pobocku (radku: %)'', n; exception when sqlstate ''42501'' then get stacked diagnostics v_msg = message_text; if v_msg not like ''%pobočce%'' then raise exception ''odmitnuto z jineho duvodu: %'', v_msg; end if; end; end $blok$'),
  (614, '11111111-2222-4333-8444-555555555555', 'clen bez prava na sklad: nazev',  'odmitnuto', 'update inventory_warehouses set name = ''HACK'' where id = ''b7da27a9-6e6d-4492-b1fc-cdf4f39662b4'''),
  -- Sklad se ukládá jako celý snímek: přeuložení beze změny musí projít i tomu,
  -- kdo právo na sklad nemá – jinak by se zaseklo ukládání celého skladu.
  (615, '11111111-2222-4333-8444-555555555555', 'clen bez prava: sklad beze zmeny','projde',    'update inventory_warehouses set name = name where id = ''b7da27a9-6e6d-4492-b1fc-cdf4f39662b4'''),
  (616, '33333333-4444-4555-8666-777777777777', 'pobocka: presun uzavre usek',     'nic', 'do $blok$ declare v_konec timestamptz; begin insert into ticket_work_sessions (id, service_id, ticket_id, user_id, started_at) values (''00000000-0000-4000-8000-000000000616'', ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''6fe7dbf0-44cd-4550-88f4-1de5a7dc0397'', ''33333333-4444-4555-8666-777777777777'', now()); perform set_config(''request.jwt.claims'', ''{"sub":"22222222-3333-4444-8555-666666666666","role":"authenticated"}'', true); update tickets set branch_id = ''ea9faf76-26eb-4be9-922c-3705477d423c'' where id = ''6fe7dbf0-44cd-4550-88f4-1de5a7dc0397''; select ended_at into v_konec from ticket_work_sessions where id = ''00000000-0000-4000-8000-000000000616''; if v_konec is null then raise exception ''po presunu zakazky zustal usek prace otevreny''; end if; end $blok$'),

  -- Kontrola opačným směrem: oprava nesmí zavřít dveře na vlastní pobočku.
  (620, '33333333-4444-4555-8666-777777777777', 'pobocka: dokument vlastni zakazky','projde',   'insert into ticket_documents (service_id, ticket_id, doc_type, storage_path, content_hash) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''6fe7dbf0-44cd-4550-88f4-1de5a7dc0397'', ''diagnostic_protocol'', ''sonda/620.pdf'', ''x'')'),
  (621, '33333333-4444-4555-8666-777777777777', 'pobocka: archiv vlastni SMS',     'projde',    'update sms_conversations set archived = true where ticket_id in (select id from tickets where branch_id = ''01fa9595-3acd-442e-acda-0f84d4146609'')'),
  (622, '22222222-3333-4444-8555-666666666666', 'pobocka: SMS bez zakazky zustava','nic', 'do $blok$ declare n int; begin insert into sms_conversations (id, service_id, ticket_id, customer_phone) values (''00000000-0000-4000-8000-000000000622'', ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', null, ''+420000000622''); perform set_config(''request.jwt.claims'', ''{"sub":"33333333-4444-4555-8666-777777777777","role":"authenticated"}'', true); update sms_conversations set archived = true where id = ''00000000-0000-4000-8000-000000000622''; get diagnostics n = row_count; if n <> 1 then raise exception ''konverzace bez zakazky se omezenemu clenovi ztratila''; end if; end $blok$'),
  -- PIN pro přepínání účtů (20260913120000): tabulka nemá číst nikdo, funkce jen člen stejného servisu.
  (700, '11111111-2222-4333-8444-555555555555', 'pin: cteni tabulky user_pin',        'odmitnuto', 'select * from user_pin'),
  (701, null,                                   'pin: over_pin bez prihlaseni',        'odmitnuto', 'select public.over_pin(''11111111-2222-4333-8444-555555555555'', ''0000'')'),
  (702, '3e2e0000-1111-4222-8333-444455556666', 'pin: over_pin uctu z ciziho servisu', 'odmitnuto', 'select public.over_pin(''11111111-2222-4333-8444-555555555555'', ''0000'')'),
  (703, '11111111-2222-4333-8444-555555555555', 'pin: ma_pin kolegy ze stejneho servisu','projde', 'select public.ma_pin(''22222222-3333-4444-8555-666666666666'')'),
  -- Přístup člena k více pobočkám (20260913160000): množinu nastaví jen správce; RLS podle ní pouští.
  (800, '22222222-3333-4444-8555-666666666666', 'pobocky: clen se dvema pobockami vidi obe, hlavni ne', 'nic', 'do $blok$ begin perform public.set_member_branches(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''33333333-4444-4555-8666-777777777777'', array[''01fa9595-3acd-442e-acda-0f84d4146609'', ''9e397ff1-1489-4e74-8c4d-0241279d82a0'']::uuid[]); perform set_config(''request.jwt.claims'', ''{"sub":"33333333-4444-4555-8666-777777777777","role":"authenticated"}'', true); if not public.pobocka_povolena(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''9e397ff1-1489-4e74-8c4d-0241279d82a0'') then raise exception ''Praha 6 mela byt povolena''; end if; if not public.pobocka_povolena(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''01fa9595-3acd-442e-acda-0f84d4146609'') then raise exception ''Brno melo byt povoleno''; end if; if public.pobocka_povolena(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''ea9faf76-26eb-4be9-922c-3705477d423c'') then raise exception ''Hlavni nemela byt povolena''; end if; end $blok$'),
  (801, '11111111-2222-4333-8444-555555555555', 'pobocky: clen si mnozinu nenastavi',                 'odmitnuto', 'select public.set_member_branches(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''11111111-2222-4333-8444-555555555555'', null)'),
  (802, '33333333-4444-4555-8666-777777777777', 'pobocky: omezeny clen si domovskou neprehodi',       'odmitnuto', 'select public.set_member_home_branch(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''33333333-4444-4555-8666-777777777777'', ''ea9faf76-26eb-4be9-922c-3705477d423c'')'),
  -- ══ Interní chat (20260913180000) ═══════════════════════════════════════════
  -- Kanál pobočky drží stejné pravidlo jako zakázky (pobocka_povolena), soukromá
  -- zpráva je jen pro dva, připíná jen správce, mazání je jen měkké. Bloky DO
  -- si zprávu nejdřív založí (v TEST2 žádná být nemusí) a pak se ptají; vrací
  -- vždy nula řádků, čeká se „nic“ – chybějící ochrana skončí výjimkou.
  (900, '11111111-2222-4333-8444-555555555555', 'chat: technik pise a cte kanal servisu',        'nic',       'do $blok$ declare n int; begin insert into chat_messages (service_id, sender_id, text) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''11111111-2222-4333-8444-555555555555'', ''sonda 900''); select count(*) into n from chat_messages where service_id = ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'' and branch_id is null and recipient_id is null and text = ''sonda 900''; if n <> 1 then raise exception ''technik nevidi vlastni zpravu v kanalu servisu (%)'', n; end if; end $blok$'),
  (901, '33333333-4444-4555-8666-777777777777', 'chat: clen Brna pise do kanalu Hlavni',         'odmitnuto', 'insert into chat_messages (service_id, sender_id, branch_id, text) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''33333333-4444-4555-8666-777777777777'', ''ea9faf76-26eb-4be9-922c-3705477d423c'', ''sonda 901'')'),
  (902, null,                                   'chat: anon cte zpravy',                         'odmitnuto', 'select * from chat_messages'),
  (903, '11111111-2222-4333-8444-555555555555', 'chat: DM cloveku mimo servis',                  'odmitnuto', 'insert into chat_messages (service_id, sender_id, recipient_id, text) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''11111111-2222-4333-8444-555555555555'', ''3e2e0000-1111-4222-8333-444455556666'', ''sonda 903'')'),
  -- Připnutí hlídá trigger výjimkou (ne RLS filtrem), takže blok skončí ODMITNUTO.
  (904, '11111111-2222-4333-8444-555555555555', 'chat: bezny clen pripina vlastni zpravu',       'odmitnuto', 'do $blok$ declare v_id uuid; begin insert into chat_messages (service_id, sender_id, text) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''11111111-2222-4333-8444-555555555555'', ''sonda 904'') returning id into v_id; update chat_messages set pinned = true where id = v_id; end $blok$'),
  (905, '11111111-2222-4333-8444-555555555555', 'chat: neprectene pro technika',                 'projde',    'select public.chat_neprectene(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'')'),
  (906, '11111111-2222-4333-8444-555555555555', 'chat: kanaly pro technika',                     'projde',    'select public.chat_kanaly(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'')'),
  (907, '22222222-3333-4444-8555-666666666666', 'chat: clen Brna vidi kanal Brna',               'nic',       'do $blok$ declare n int; begin insert into chat_messages (service_id, sender_id, branch_id, text) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''22222222-3333-4444-8555-666666666666'', ''01fa9595-3acd-442e-acda-0f84d4146609'', ''sonda 907''); perform set_config(''request.jwt.claims'', ''{"sub":"33333333-4444-4555-8666-777777777777","role":"authenticated"}'', true); select count(*) into n from chat_messages where text = ''sonda 907''; if n <> 1 then raise exception ''clen Brna nevidi zpravu v kanalu Brna (%)'', n; end if; end $blok$'),
  (908, '22222222-3333-4444-8555-666666666666', 'chat: clen Brna nevidi kanal Hlavni',           'nic',       'do $blok$ declare n int; begin insert into chat_messages (service_id, sender_id, branch_id, text) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''22222222-3333-4444-8555-666666666666'', ''ea9faf76-26eb-4be9-922c-3705477d423c'', ''sonda 908''); perform set_config(''request.jwt.claims'', ''{"sub":"33333333-4444-4555-8666-777777777777","role":"authenticated"}'', true); select count(*) into n from chat_messages where branch_id = ''ea9faf76-26eb-4be9-922c-3705477d423c''; if n <> 0 then raise exception ''clen Brna vidi % zprav kanalu Hlavni'', n; end if; end $blok$'),
  (909, '22222222-3333-4444-8555-666666666666', 'chat: DM je jen pro dva',                       'nic',       'do $blok$ declare n int; begin insert into chat_messages (service_id, sender_id, recipient_id, text) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''22222222-3333-4444-8555-666666666666'', ''33333333-4444-4555-8666-777777777777'', ''sonda 909''); perform set_config(''request.jwt.claims'', ''{"sub":"11111111-2222-4333-8444-555555555555","role":"authenticated"}'', true); select count(*) into n from chat_messages where text = ''sonda 909''; if n <> 0 then raise exception ''technik vidi cizi soukromou zpravu''; end if; end $blok$'),
  (910, '33333333-4444-4555-8666-777777777777', 'chat: clen oznaci kanal za precteny',           'projde',    'select public.chat_precteno(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''servis'')'),
  (911, null,                                   'chat: anon vypis priloh',                       'nic',       'select * from storage.objects where bucket_id = ''chat-prilohy'''),
  (912, '11111111-2222-4333-8444-555555555555', 'chat: priloha do slozky ciziho servisu',        'odmitnuto', 'insert into storage.objects (bucket_id, name, owner) values (''chat-prilohy'', ''d9762a27-6c8d-43c4-9207-5c837e2713a0/sonda.txt'', ''11111111-2222-4333-8444-555555555555'')'),

  -- ══ 7. kolo (27. 9.): tabulky a funkce přidané od 9. 9. ═══════════════════
  -- Opravy v migraci 20260927100000_audit_opravneni_4.sql, popis nálezů
  -- v docs/AUDIT_2026-09.md („4. kolo 27. 9.“). Pevná data v TEST2:
  -- f1ee088f… a 714f6f17… (vydaná, s opravou „ajajaj“) = Hlavní pobočka,
  -- 6fe7dbf0… a 723e134e… = Brno, 1fe5895a… = zakázka E2E servisu.

  -- Odměny týmu (20260926190000, 20260926230000)
  (1000, '11111111-2222-4333-8444-555555555555', 'odmeny: clen zapisuje upravu',                'odmitnuto', 'insert into odmeny_upravy (service_id, ticket_id, polozka_id, vyrazeno) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''6fe7dbf0-44cd-4550-88f4-1de5a7dc0397'', ''sonda'', true)'),
  (1001, '11111111-2222-4333-8444-555555555555', 'odmeny: clen zapisuje vyplatu',               'odmitnuto', 'insert into odmeny_vyplaty (service_id, user_id, obdobi, castka) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''11111111-2222-4333-8444-555555555555'', ''2026-09'', 1)'),
  (1002, '22222222-3333-4444-8555-666666666666', 'odmeny: sprava v cizim servisu',              'odmitnuto', 'insert into odmeny_upravy (service_id, ticket_id, polozka_id, vyrazeno) values (''882beee7-4564-4d10-8ac6-16dc19240b57'', ''1fe5895a-2c85-46bd-ae39-167267aa92a9'', ''sonda'', true)'),
  -- Úprava s vlastním servisem, ale se zakázkou cizího: přehled ji dřív
  -- spároval jen podle zakázky, takže šlo cizímu servisu vyřadit odměnu.
  (1003, '22222222-3333-4444-8555-666666666666', 'odmeny: uprava s cizi zakazkou pod svym servisem','odmitnuto', 'insert into odmeny_upravy (service_id, ticket_id, polozka_id, vyrazeno) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''1fe5895a-2c85-46bd-ae39-167267aa92a9'', ''sonda'', true)'),
  (1004, '22222222-3333-4444-8555-666666666666', 'odmeny: uprava vlastni zakazky',              'projde',    'insert into odmeny_upravy (service_id, ticket_id, polozka_id, vyrazeno) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''6fe7dbf0-44cd-4550-88f4-1de5a7dc0397'', ''sonda'', true)'),
  (1005, '22222222-3333-4444-8555-666666666666', 'odmeny: vyplata cloveku mimo servis',         'odmitnuto', 'insert into odmeny_vyplaty (service_id, user_id, obdobi, castka) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''3e2e0000-1111-4222-8333-444455556666'', ''2026-09'', 1)'),
  (1006, '22222222-3333-4444-8555-666666666666', 'odmeny: vyplata clenovi',                     'projde',    'insert into odmeny_vyplaty (service_id, user_id, obdobi, castka) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''11111111-2222-4333-8444-555555555555'', ''2026-09'', 1)'),
  (1007, '3e2e0000-1111-4222-8333-444455556666', 'odmeny: prehled ciziho servisu',              'odmitnuto', 'select odmeny_prehled(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'')'),
  (1008, null,                                   'odmeny: prehled anon',                        'odmitnuto', 'select odmeny_prehled(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'')'),
  (1009, '11111111-2222-4333-8444-555555555555', 'odmeny: prehled vlastniho servisu',           'projde',    'select odmeny_prehled(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'')'),
  (1010, '22222222-3333-4444-8555-666666666666', 'odmeny: clen nevidi vyplaty kolegu',          'nic', 'do $blok$ declare n int; begin insert into odmeny_vyplaty (service_id, user_id, obdobi, castka) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''33333333-4444-4555-8666-777777777777'', ''2026-09'', 1); perform set_config(''request.jwt.claims'', ''{"sub":"11111111-2222-4333-8444-555555555555","role":"authenticated"}'', true); select count(*) into n from odmeny_vyplaty where user_id <> ''11111111-2222-4333-8444-555555555555''; if n <> 0 then raise exception ''clen vidi % cizich vyplat'', n; end if; end $blok$'),
  -- Žebříček (security definer) vracel zákazníka a číslo zakázky i z cizí pobočky.
  (1011, '22222222-3333-4444-8555-666666666666', 'odmeny: omezeny clen nevidi radky cizi pobocky','nic', 'do $blok$ declare v jsonb; c_t constant jsonb := jsonb_build_array(jsonb_build_object(''ticketId'', ''714f6f17-e7f0-46e6-b6a6-7d90201d5a65'')); begin perform update_service_settings(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''{"config":{"odmeny":{"pravidla":[{"id":"sonda","nazev":"Sonda","hledat":"ajajaj","typ":"castka","hodnota":10,"komu":"pridal","aktivni":true}],"verejny_zebricek":true}}}''::jsonb); insert into odmeny_upravy (service_id, ticket_id, polozka_id, nabidnuto) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''714f6f17-e7f0-46e6-b6a6-7d90201d5a65'', ''1767284070543_0.3930041220232541'', true); v := odmeny_prehled(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''2000-01-01''::timestamptz, now()); if not (v -> ''radky'') @> c_t then raise exception ''sonda nic nezmerila: spravce radek nevidi''; end if; perform set_config(''request.jwt.claims'', ''{"sub":"33333333-4444-4555-8666-777777777777","role":"authenticated"}'', true); v := odmeny_prehled(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''2000-01-01''::timestamptz, now()); if (v -> ''radky'') @> c_t then raise exception ''omezeny clen vidi radek odmeny ze zakazky cizi pobocky''; end if; if jsonb_array_length(v -> ''lide'') = 0 then raise exception ''omezenemu clenovi zmizel zebricek''; end if; end $blok$'),
  (1012, '22222222-3333-4444-8555-666666666666', 'odmeny: omezeny clen nevidi upravy cizi pobocky','nic', 'do $blok$ declare n int; begin insert into odmeny_upravy (service_id, ticket_id, polozka_id, poznamka) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''714f6f17-e7f0-46e6-b6a6-7d90201d5a65'', ''sonda'', ''sonda 1012''); perform set_config(''request.jwt.claims'', ''{"sub":"33333333-4444-4555-8666-777777777777","role":"authenticated"}'', true); select count(*) into n from odmeny_upravy where poznamka = ''sonda 1012''; if n <> 0 then raise exception ''omezeny clen vidi upravu odmeny u zakazky cizi pobocky''; end if; end $blok$'),

  -- Platby servisů – jen majitel aplikace (20260926210000)
  (1020, '22222222-3333-4444-8555-666666666666', 'platby: cteni',                               'nic',       'select * from platby'),
  (1021, '22222222-3333-4444-8555-666666666666', 'platby: nastaveni cteni',                     'nic',       'select * from platby_nastaveni'),
  (1022, '22222222-3333-4444-8555-666666666666', 'platby: zapsat si zaplaceno',                 'odmitnuto', 'insert into platby (service_id, obdobi, castka) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''2026-09'', 1)'),
  (1023, '22222222-3333-4444-8555-666666666666', 'platby: zmenit si cenu',                      'odmitnuto', 'insert into platby_nastaveni (service_id, cena_mesicne) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', 0)'),
  (1024, '22222222-3333-4444-8555-666666666666', 'platby: prehled vsech servisu',               'odmitnuto', 'select platby_prehled()'),
  (1025, null,                                   'platby: prehled anon',                        'odmitnuto', 'select platby_prehled()'),
  (1026, '3e2e0000-1111-4222-8333-444455556666', 'platby: prehled majitel servisu',             'odmitnuto', 'select platby_prehled(''2026-09'')'),
  (1027, '22222222-3333-4444-8555-666666666666', 'platby: spustit tik',                         'odmitnuto', 'select platby_tick()'),
  (1028, '22222222-3333-4444-8555-666666666666', 'platby: precist tajemstvi',                   'odmitnuto', 'select platby_cron_secret()'),
  (1029, null,                                   'platby: anon cteni',                          'odmitnuto', 'select * from platby'),

  -- Nápověda (20260926240000)
  (1030, '22222222-3333-4444-8555-666666666666', 'napoveda: cteni dotazu',                      'nic',       'select * from napoveda_dotazy'),
  (1031, '11111111-2222-4333-8444-555555555555', 'napoveda: zapis mimo edge funkci',            'odmitnuto', 'insert into napoveda_dotazy (service_id, user_id, dotaz) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''11111111-2222-4333-8444-555555555555'', ''sonda'')'),
  (1032, null,                                   'napoveda: anon',                              'odmitnuto', 'select * from napoveda_dotazy'),

  -- Provize – jen majitel aplikace a sdílené účty (20260918…–20260926150000)
  (1035, '22222222-3333-4444-8555-666666666666', 'provize: prehled',                            'odmitnuto', 'select provize_prehled(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'')'),
  (1036, '22222222-3333-4444-8555-666666666666', 'provize: sdilene bez sdileni',                'odmitnuto', 'select provize_moje(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'')'),
  (1037, '22222222-3333-4444-8555-666666666666', 'provize: clenove s e-maily',                  'odmitnuto', 'select provize_clenove(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'')'),
  (1038, '22222222-3333-4444-8555-666666666666', 'provize: vyuctovat',                          'odmitnuto', 'select provize_vyuctuj(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''sonda'')'),
  (1039, '22222222-3333-4444-8555-666666666666', 'provize: polozky cist',                       'nic',       'select * from provize_polozky'),
  (1040, '22222222-3333-4444-8555-666666666666', 'provize: nasdilet si',                        'odmitnuto', 'insert into provize_sdileni (service_id, user_id) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''22222222-3333-4444-8555-666666666666'')'),
  (1041, null,                                   'provize: anon',                               'odmitnuto', 'select provize_moje(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'')'),

  -- Statistiky po přepisech (20260926170000, 20260926300000). Obejití přes
  -- service_role z klienta nejde: auth.role() čte roli z JWT, které podepisuje
  -- server, a set_config PostgREST nevystavuje (sondy to nasimulovat neumí,
  -- viz audit). Tady se hlídá právo can_view_statistics.
  (1045, '22222222-3333-4444-8555-666666666666', 'statistiky: clen s odebranym pravem',         'nic', 'do $blok$ begin perform set_member_capabilities(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''11111111-2222-4333-8444-555555555555'', ''{"can_view_statistics": false}''::jsonb); perform set_config(''request.jwt.claims'', ''{"sub":"11111111-2222-4333-8444-555555555555","role":"authenticated"}'', true); begin perform statistiky_prehled(array[''bbc926bd-25ba-4da1-b528-92b6f1dee24d'']::uuid[]); raise exception ''clen bez prava na statistiky dostal cisla''; exception when sqlstate ''42501'' then null; end; end $blok$'),
  (1046, '22222222-3333-4444-8555-666666666666', 'statistiky: technici s odebranym pravem',     'nic', 'do $blok$ begin perform set_member_capabilities(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''11111111-2222-4333-8444-555555555555'', ''{"can_view_statistics": false}''::jsonb); perform set_config(''request.jwt.claims'', ''{"sub":"11111111-2222-4333-8444-555555555555","role":"authenticated"}'', true); begin perform statistiky_technici(array[''bbc926bd-25ba-4da1-b528-92b6f1dee24d'']::uuid[]); raise exception ''clen bez prava na statistiky dostal techniky''; exception when sqlstate ''42501'' then null; end; end $blok$'),
  (1047, '721ef873-75c3-4ec1-bf71-13281051ce99', 'statistiky: clen s pravem',                   'projde',    'select statistiky_prehled(array[''bbc926bd-25ba-4da1-b528-92b6f1dee24d'']::uuid[])'),
  (1048, null,                                   'statistiky: technici anon',                   'odmitnuto', 'select statistiky_technici(array[''882beee7-4564-4d10-8ac6-16dc19240b57'']::uuid[])'),
  (1049, '3e2e0000-1111-4222-8333-444455556666', 'statistiky: technici ciziho servisu',         'odmitnuto', 'select statistiky_technici(array[''bbc926bd-25ba-4da1-b528-92b6f1dee24d'']::uuid[])'),
  (1050, '22222222-3333-4444-8555-666666666666', 'statistiky: tajemstvi reportu',               'odmitnuto', 'select statistiky_report_cron_secret()'),
  -- Log reportu (příjemci e-mailu, chyby). Řádek se založí jako service_role.
  (1051, '22222222-3333-4444-8555-666666666666', 'statistiky: log reportu bez prava',           'nic', 'do $blok$ declare n int; begin perform set_member_capabilities(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''11111111-2222-4333-8444-555555555555'', ''{"can_view_statistics": false}''::jsonb); execute ''set local role service_role''; insert into statistiky_report_odeslani (service_id, klic, frekvence, prijemci) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''sonda-1051'', ''mesicne'', array[''sonda@jobi.test'']); execute ''set local role authenticated''; perform set_config(''request.jwt.claims'', ''{"sub":"11111111-2222-4333-8444-555555555555","role":"authenticated"}'', true); select count(*) into n from statistiky_report_odeslani where klic = ''sonda-1051''; if n <> 0 then raise exception ''clen bez prava na statistiky cte log reportu''; end if; end $blok$'),
  (1052, '22222222-3333-4444-8555-666666666666', 'statistiky: log reportu spravce',             'nic', 'do $blok$ declare n int; begin execute ''set local role service_role''; insert into statistiky_report_odeslani (service_id, klic, frekvence) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''sonda-1052'', ''mesicne''); execute ''set local role authenticated''; select count(*) into n from statistiky_report_odeslani where klic = ''sonda-1052''; if n <> 1 then raise exception ''spravce nevidi log reportu''; end if; end $blok$'),

  -- Nové sloupce zakázky (20260913140000, 20260916120000, 20260926310000):
  -- člen bez „Úprav zakázek“ je nesmí přepsat. Hodnota se vždy opravdu mění.
  (1060, '721ef873-75c3-4ec1-bf71-13281051ce99', 'zakazka bez prav: zarucni oprava',            'odmitnuto', 'update tickets set warranty_claim = not coalesce(warranty_claim, false) where id = ''723e134e-fd3a-4f98-9cce-5d8e180c1a3f'''),
  (1061, '721ef873-75c3-4ec1-bf71-13281051ce99', 'zakazka bez prav: datum nakupu',              'odmitnuto', 'update tickets set purchase_date = coalesce(purchase_date, current_date) - 1 where id = ''723e134e-fd3a-4f98-9cce-5d8e180c1a3f'''),
  (1062, '721ef873-75c3-4ec1-bf71-13281051ce99', 'zakazka bez prav: doklad o koupi',            'odmitnuto', 'update tickets set purchase_proof = coalesce(purchase_proof, '''') || ''HACK'' where id = ''723e134e-fd3a-4f98-9cce-5d8e180c1a3f'''),
  (1063, '721ef873-75c3-4ec1-bf71-13281051ce99', 'zakazka bez prav: Find My',                   'odmitnuto', 'update tickets set find_my_off = not coalesce(find_my_off, false) where id = ''723e134e-fd3a-4f98-9cce-5d8e180c1a3f'''),
  (1064, '721ef873-75c3-4ec1-bf71-13281051ce99', 'zakazka bez prav: prideleny technik',         'odmitnuto', 'update tickets set assigned_to = case when assigned_to = ''721ef873-75c3-4ec1-bf71-13281051ce99'' then ''11111111-2222-4333-8444-555555555555''::uuid else ''721ef873-75c3-4ec1-bf71-13281051ce99''::uuid end where id = ''723e134e-fd3a-4f98-9cce-5d8e180c1a3f'''),
  (1065, '721ef873-75c3-4ec1-bf71-13281051ce99', 'zakazka bez prav: misto zarizeni',            'odmitnuto', 'update tickets set location_branch_id = case when location_branch_id is distinct from ''9e397ff1-1489-4e74-8c4d-0241279d82a0'' then ''9e397ff1-1489-4e74-8c4d-0241279d82a0''::uuid else ''ea9faf76-26eb-4be9-922c-3705477d423c''::uuid end where id = ''723e134e-fd3a-4f98-9cce-5d8e180c1a3f'''),
  (1066, '11111111-2222-4333-8444-555555555555', 'zakazka s pravem: zarucni oprava',            'projde',    'update tickets set warranty_claim = not coalesce(warranty_claim, false) where id = ''723e134e-fd3a-4f98-9cce-5d8e180c1a3f'''),

  -- Položky objednávek s ticket_id (§5 – i zápis, ne jen čtení)
  (1070, '22222222-3333-4444-8555-666666666666', 'objednavky: omezeny clen polozka k cizi zakazce','nic', 'do $blok$ begin perform set_member_capabilities(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''33333333-4444-4555-8666-777777777777'', (select jsonb_object_agg(k, true) from unnest(povolene_capability()) k)); perform set_config(''request.jwt.claims'', ''{"sub":"33333333-4444-4555-8666-777777777777","role":"authenticated"}'', true); begin insert into inventory_purchase_order_items (order_id, product_id, ticket_id, qty) values (''50545142-fa07-46e5-afce-51b3c2044996'', ''622e4515-2d11-4f99-af4b-f4d8a7e968a6'', ''f1ee088f-3aef-4380-aa52-897690259ae0'', 1); raise exception ''polozka objednavky k zakazce cizi pobocky presla''; exception when sqlstate ''42501'' then null; end; end $blok$'),
  (1071, '22222222-3333-4444-8555-666666666666', 'objednavky: omezeny clen polozka bez zakazky', 'nic', 'do $blok$ begin perform set_member_capabilities(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''33333333-4444-4555-8666-777777777777'', (select jsonb_object_agg(k, true) from unnest(povolene_capability()) k)); perform set_config(''request.jwt.claims'', ''{"sub":"33333333-4444-4555-8666-777777777777","role":"authenticated"}'', true); insert into inventory_purchase_order_items (order_id, product_id, ticket_id, qty) values (''50545142-fa07-46e5-afce-51b3c2044996'', ''622e4515-2d11-4f99-af4b-f4d8a7e968a6'', null, 1); end $blok$'),

  -- Rezervace z webu převedená na zakázku (řádek zakládá service_role jako public-booking)
  (1075, '22222222-3333-4444-8555-666666666666', 'rezervace: omezeny clen, zakazka cizi pobocky','nic', 'do $blok$ declare n int; begin execute ''set local role service_role''; insert into bookings (id, service_id, status, customer_name, customer_phone, device_label, ticket_id) values (''00000000-0000-4000-8000-000000001075'', ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''converted'', ''Sonda'', ''+420000001075'', ''Sonda'', ''f1ee088f-3aef-4380-aa52-897690259ae0''); execute ''set local role authenticated''; perform set_config(''request.jwt.claims'', ''{"sub":"33333333-4444-4555-8666-777777777777","role":"authenticated"}'', true); select count(*) into n from bookings where id = ''00000000-0000-4000-8000-000000001075''; if n <> 0 then raise exception ''omezeny clen vidi rezervaci (s telefonem) zakazky cizi pobocky''; end if; end $blok$'),
  (1076, '22222222-3333-4444-8555-666666666666', 'rezervace: omezeny clen, zakazka vlastni',    'nic', 'do $blok$ declare n int; begin execute ''set local role service_role''; insert into bookings (id, service_id, status, customer_name, customer_phone, device_label, ticket_id) values (''00000000-0000-4000-8000-000000001076'', ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''converted'', ''Sonda'', ''+420000001076'', ''Sonda'', ''6fe7dbf0-44cd-4550-88f4-1de5a7dc0397''); execute ''set local role authenticated''; perform set_config(''request.jwt.claims'', ''{"sub":"33333333-4444-4555-8666-777777777777","role":"authenticated"}'', true); select count(*) into n from bookings where id = ''00000000-0000-4000-8000-000000001076''; if n <> 1 then raise exception ''omezeny clen nevidi rezervaci vlastni zakazky''; end if; end $blok$'),

  -- Zásilky mezi pobočkami (20260916120000). Nejvážnější nález kola: omezený
  -- člen si přes zásilku „přivezl“ zakázku cizí pobočky a tím ji uviděl.
  (1080, '33333333-4444-4555-8666-777777777777', 'zasilky: omezeny clen zasilka z cizi pobocky','odmitnuto', 'insert into ticket_shipments (service_id, from_branch_id, to_branch_id) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''ea9faf76-26eb-4be9-922c-3705477d423c'', ''01fa9595-3acd-442e-acda-0f84d4146609'')'),
  (1081, '22222222-3333-4444-8555-666666666666', 'zasilky: omezeny clen vklada cizi zakazku',   'nic', 'do $blok$ begin insert into ticket_shipments (id, service_id, from_branch_id, to_branch_id) values (''00000000-0000-4000-8000-000000001081'', ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''01fa9595-3acd-442e-acda-0f84d4146609'', ''9e397ff1-1489-4e74-8c4d-0241279d82a0''); perform set_config(''request.jwt.claims'', ''{"sub":"33333333-4444-4555-8666-777777777777","role":"authenticated"}'', true); begin insert into ticket_shipment_items (shipment_id, ticket_id) values (''00000000-0000-4000-8000-000000001081'', ''f1ee088f-3aef-4380-aa52-897690259ae0''); raise exception ''omezeny clen vlozil do zasilky zakazku cizi pobocky''; exception when sqlstate ''42501'' then null; end; end $blok$'),
  (1082, '22222222-3333-4444-8555-666666666666', 'zasilky: omezeny clen si odesle cizi zakazku','nic', 'do $blok$ declare n int; begin insert into ticket_shipments (id, service_id, from_branch_id, to_branch_id) values (''00000000-0000-4000-8000-000000001082'', ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''ea9faf76-26eb-4be9-922c-3705477d423c'', ''01fa9595-3acd-442e-acda-0f84d4146609''); insert into ticket_shipment_items (shipment_id, ticket_id) values (''00000000-0000-4000-8000-000000001082'', ''f1ee088f-3aef-4380-aa52-897690259ae0''); perform set_config(''request.jwt.claims'', ''{"sub":"33333333-4444-4555-8666-777777777777","role":"authenticated"}'', true); begin perform zasilka_odeslat(''00000000-0000-4000-8000-000000001082''); select count(*) into n from tickets where id = ''f1ee088f-3aef-4380-aa52-897690259ae0''; raise exception ''omezeny clen odeslal zasilku z cizi pobocky na svou (zakazku ted vidi: %)'', n; exception when sqlstate ''42501'' then null; end; end $blok$'),
  (1083, '22222222-3333-4444-8555-666666666666', 'zasilky: omezeny clen cte polozky cizi pobocky','nic', 'do $blok$ declare n int; begin insert into ticket_shipments (id, service_id, from_branch_id, to_branch_id) values (''00000000-0000-4000-8000-000000001083'', ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''ea9faf76-26eb-4be9-922c-3705477d423c'', ''9e397ff1-1489-4e74-8c4d-0241279d82a0''); insert into ticket_shipment_items (shipment_id, ticket_id) values (''00000000-0000-4000-8000-000000001083'', ''f1ee088f-3aef-4380-aa52-897690259ae0''); perform set_config(''request.jwt.claims'', ''{"sub":"33333333-4444-4555-8666-777777777777","role":"authenticated"}'', true); select count(*) into n from ticket_shipment_items where shipment_id = ''00000000-0000-4000-8000-000000001083''; if n <> 0 then raise exception ''omezeny clen vidi id zakazky cizi pobocky v zasilce''; end if; end $blok$'),
  -- Kontrola opačným směrem: vlastní zakázku z vlastní pobočky poslat jde.
  (1084, '33333333-4444-4555-8666-777777777777', 'zasilky: omezeny clen posle vlastni zakazku','nic', 'do $blok$ declare v_loc uuid; begin insert into ticket_shipments (id, service_id, from_branch_id, to_branch_id) values (''00000000-0000-4000-8000-000000001084'', ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''01fa9595-3acd-442e-acda-0f84d4146609'', ''9e397ff1-1489-4e74-8c4d-0241279d82a0''); insert into ticket_shipment_items (shipment_id, ticket_id) values (''00000000-0000-4000-8000-000000001084'', ''6fe7dbf0-44cd-4550-88f4-1de5a7dc0397''); perform zasilka_odeslat(''00000000-0000-4000-8000-000000001084''); select location_branch_id into v_loc from tickets where id = ''6fe7dbf0-44cd-4550-88f4-1de5a7dc0397''; if v_loc is distinct from ''9e397ff1-1489-4e74-8c4d-0241279d82a0'' then raise exception ''vlastni zakazka neodjela (misto %)'', v_loc; end if; end $blok$'),
  (1085, '3e2e0000-1111-4222-8333-444455556666', 'zasilky: cizi servis cte',                    'nic',       'select * from ticket_shipments where service_id = ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'''),
  (1086, '3e2e0000-1111-4222-8333-444455556666', 'zasilky: odeslat cizi zasilku',               'odmitnuto', 'select zasilka_odeslat(''6f444f5f-4d9b-42ec-a952-ba5bbb40c573'')'),
  (1087, '3e2e0000-1111-4222-8333-444455556666', 'zasilky: prevzit cizi zasilku',               'odmitnuto', 'select zasilka_prevzit(''6f444f5f-4d9b-42ec-a952-ba5bbb40c573'', array[]::uuid[])'),
  (1088, null,                                   'zasilky: anon cteni',                         'odmitnuto', 'select * from ticket_shipments'),
  (1089, '22222222-3333-4444-8555-666666666666', 'zasilky: stav primo mimo RPC',                'odmitnuto', 'do $blok$ begin insert into ticket_shipments (id, service_id, from_branch_id, to_branch_id) values (''00000000-0000-4000-8000-000000001089'', ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''01fa9595-3acd-442e-acda-0f84d4146609'', ''9e397ff1-1489-4e74-8c4d-0241279d82a0''); update ticket_shipments set status = ''received'' where id = ''00000000-0000-4000-8000-000000001089''; end $blok$'),
  (1090, '22222222-3333-4444-8555-666666666666', 'zasilky: na pobocku jineho servisu',          'odmitnuto', 'insert into ticket_shipments (service_id, from_branch_id, to_branch_id) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''01fa9595-3acd-442e-acda-0f84d4146609'', ''a4c7e885-9570-45c2-bcfa-0b5aff665a77'')'),

  -- Mazání a obnova zakázky (security definer s ticket_id, §5)
  (1095, '22222222-3333-4444-8555-666666666666', 'zakazky: omezeny clen smaze cizi zakazku',    'nic', 'do $blok$ begin perform set_member_capabilities(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''33333333-4444-4555-8666-777777777777'', ''{"can_delete_tickets": true, "can_manage_ticket_archive": true}''::jsonb); perform set_config(''request.jwt.claims'', ''{"sub":"33333333-4444-4555-8666-777777777777","role":"authenticated"}'', true); begin perform soft_delete_ticket(''f1ee088f-3aef-4380-aa52-897690259ae0''); raise exception ''omezeny clen smazal zakazku cizi pobocky''; exception when sqlstate ''42501'' then null; end; end $blok$'),
  (1096, '22222222-3333-4444-8555-666666666666', 'zakazky: omezeny clen obnovi cizi zakazku',   'nic', 'do $blok$ begin perform soft_delete_ticket(''f1ee088f-3aef-4380-aa52-897690259ae0''); perform set_member_capabilities(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''33333333-4444-4555-8666-777777777777'', ''{"can_delete_tickets": true, "can_manage_ticket_archive": true}''::jsonb); perform set_config(''request.jwt.claims'', ''{"sub":"33333333-4444-4555-8666-777777777777","role":"authenticated"}'', true); begin perform restore_ticket(''f1ee088f-3aef-4380-aa52-897690259ae0''); raise exception ''omezeny clen obnovil zakazku cizi pobocky''; exception when sqlstate ''42501'' then null; end; end $blok$'),
  (1097, '22222222-3333-4444-8555-666666666666', 'zakazky: omezeny clen smaze vlastni zakazku', 'nic', 'do $blok$ begin perform set_member_capabilities(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''33333333-4444-4555-8666-777777777777'', ''{"can_delete_tickets": true}''::jsonb); perform set_config(''request.jwt.claims'', ''{"sub":"33333333-4444-4555-8666-777777777777","role":"authenticated"}'', true); perform soft_delete_ticket(''6fe7dbf0-44cd-4550-88f4-1de5a7dc0397''); end $blok$'),

  -- Podpis převzetí (20260913100000)
  (1100, '33333333-4444-4555-8666-777777777777', 'podpis: zakazka cizi pobocky',                'nic',       'select 1 where public.smim_cist_podpis(''signatures/f1ee088f-3aef-4380-aa52-897690259ae0-sonda.png'')'),
  (1101, '33333333-4444-4555-8666-777777777777', 'podpis: zakazka vlastni pobocky',             'neco',      'select 1 where public.smim_cist_podpis(''signatures/6fe7dbf0-44cd-4550-88f4-1de5a7dc0397-sonda.png'')'),

  -- Počet členů a limit tarifu (20260913200000)
  (1105, null,                                   'clenove: limit tarifu anon',                  'odmitnuto', 'select members_allowed(''882beee7-4564-4d10-8ac6-16dc19240b57'')'),
  (1106, null,                                   'clenove: obsazenost anon',                    'odmitnuto', 'select service_seat_count(''882beee7-4564-4d10-8ac6-16dc19240b57'')'),
  (1107, '3e2e0000-1111-4222-8333-444455556666', 'clenove: obsazenost ciziho servisu',          'nic',       'select 1 where service_seat_count(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'') is not null'),
  (1108, '22222222-3333-4444-8555-666666666666', 'clenove: obsazenost vlastniho',               'neco',      'select 1 where service_seat_count(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'') is not null'),
  (1109, '3e2e0000-1111-4222-8333-444455556666', 'clenove: limit ciziho servisu',               'nic',       'select 1 where members_allowed(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'') is not null'),
  (1110, '22222222-3333-4444-8555-666666666666', 'clenove: seznam ciziho servisu',              'nic',       'select * from clenove_servisu(''882beee7-4564-4d10-8ac6-16dc19240b57'')'),

  -- Ostatní od 9. 9.
  (1115, '22222222-3333-4444-8555-666666666666', 'app_nastaveni (id majitele)',                 'odmitnuto', 'select * from app_nastaveni'),
  (1116, '11111111-2222-4333-8444-555555555555', 'chat: hledani v cizim servisu',               'nic',       'select * from chat_hledej(''882beee7-4564-4d10-8ac6-16dc19240b57'', ''a'', 10)'),
  (1117, '11111111-2222-4333-8444-555555555555', 'chat: precteno v cizim servisu',              'odmitnuto', 'insert into chat_reads (user_id, service_id, kanal) values (''11111111-2222-4333-8444-555555555555'', ''882beee7-4564-4d10-8ac6-16dc19240b57'', ''servis'')'),
  (1118, '33333333-4444-4555-8666-777777777777', 'prace: stopky na cizi pobocce',               'odmitnuto', 'select spust_praci(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''f1ee088f-3aef-4380-aa52-897690259ae0'')'),
  (1119, '3e2e0000-1111-4222-8333-444455556666', 'reklamace: cislo ciziho servisu',             'odmitnuto', 'select dalsi_cislo_reklamace(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''X'')'),
  (1120, null,                                   'odhlaseni vsech zarizeni: anon',              'odmitnuto', 'select odhlas_vsechna_zarizeni(''11111111-2222-4333-8444-555555555555'')'),
  (1121, '22222222-3333-4444-8555-666666666666', 'odhlaseni vsech zarizeni: prihlaseny',        'odmitnuto', 'select odhlas_vsechna_zarizeni(''11111111-2222-4333-8444-555555555555'')'),
  -- Hradba (vypnutý servis / propadlý přístup) i na tabulkách po 12. 9. –
  -- vypnout servis v sondě nejde, proto kontrola, že politiky existují.
  (1125, '22222222-3333-4444-8555-666666666666', 'hradba: odmeny a zasilky',                    'neco',      'select 1 from pg_policies where schemaname = ''public'' and policyname in (''ticket_shipments_jen_zapnuty_servis'', ''ticket_shipments_jen_s_pristupem_vlozeni'', ''odmeny_upravy_jen_zapnuty_servis'', ''odmeny_upravy_jen_s_pristupem_vlozeni'', ''odmeny_vyplaty_jen_zapnuty_servis'', ''odmeny_vyplaty_jen_s_pristupem_vlozeni'', ''po_items_jen_s_pristupem_vlozeni'') having count(*) = 7')
  -- ══ Žádost o recenzi (20260927140000) ═══════════════════════════════════════
  -- Frontu i záznam odeslaných píše jen server; člen čte jen svůj servis a jen
  -- viditelné zakázky (omezený na pobočku nevidí cizí pobočku).
  (1200, '33333333-4444-4555-8666-777777777777', 'recenze: cizi pobocka ve fronte',        'nic',       'select s.* from automation_schedule s join tickets t on t.id = s.ticket_id where t.branch_id = ''ea9faf76-26eb-4be9-922c-3705477d423c'''),
  (1201, '33333333-4444-4555-8666-777777777777', 'recenze: cizi pobocka v odeslanych',     'nic',       'select z.* from zadosti_o_recenzi z join tickets t on t.id = z.ticket_id where t.branch_id = ''ea9faf76-26eb-4be9-922c-3705477d423c'''),
  (1202, '11111111-2222-4333-8444-555555555555', 'recenze: cizi servis fronta',            'nic',       'select * from automation_schedule where service_id = ''d9762a27-6c8d-43c4-9207-5c837e2713a0'''),
  (1203, '11111111-2222-4333-8444-555555555555', 'recenze: cizi servis odeslane',          'nic',       'select * from zadosti_o_recenzi where service_id = ''d9762a27-6c8d-43c4-9207-5c837e2713a0'''),
  (1204, '22222222-3333-4444-8555-666666666666', 'recenze: spravce zapise do fronty',      'odmitnuto', 'insert into automation_schedule (service_id, run_at) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', now())'),
  (1205, '22222222-3333-4444-8555-666666666666', 'recenze: spravce zapise odeslanou',      'odmitnuto', 'insert into zadosti_o_recenzi (service_id, kanal) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''sms'')'),
  (1206, null,                                   'recenze: anon cte frontu',               'nic',       'select * from automation_schedule'),
  (1207, '721ef873-75c3-4ec1-bf71-13281051ce99', 'recenze: clen bez prav prepne zakaznika','nic',       'update customers set neposilat_zadost_o_recenzi = true where service_id = ''bbc926bd-25ba-4da1-b528-92b6f1dee24d''')
  -- ══ Inventura skladu (20260927110000) ═══════════════════════════════════════
  -- Hlavička i řádky se zakládají jen přes RPC; přes REST jde jen napočítat.
  -- Sklad b7da27a9 patří hlavní pobočce, pro člena Brna je cizí.
  (1300, '11111111-2222-4333-8444-555555555555', 'inventura: technik bez prava na sklad zahajit', 'odmitnuto', 'select public.inventura_zahajit(''b7da27a9-6e6d-4492-b1fc-cdf4f39662b4''::uuid)'),
  (1301, null,                                   'inventura: anon cte inventury',                 'nic',       'select * from inventory_stocktakes'),
  (1302, '11111111-2222-4333-8444-555555555555', 'inventura: cizi servis',                        'nic',       'select * from inventory_stocktakes where service_id = ''d9762a27-6c8d-43c4-9207-5c837e2713a0'''),
  (1303, '11111111-2222-4333-8444-555555555555', 'inventura: hlavicka primo pres REST',           'odmitnuto', 'insert into inventory_stocktakes (service_id, warehouse_id, cislo) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''b7da27a9-6e6d-4492-b1fc-cdf4f39662b4'', ''INV-SONDA'')'),
  (1304, '22222222-3333-4444-8555-666666666666', 'inventura: clen Brna nevidi inventuru Hlavni',  'nic',       'do $blok$ declare v_id uuid; n int; begin v_id := public.inventura_zahajit(''b7da27a9-6e6d-4492-b1fc-cdf4f39662b4''::uuid, ''sonda 1004'', true); perform set_config(''request.jwt.claims'', ''{"sub":"33333333-4444-4555-8666-777777777777","role":"authenticated"}'', true); select count(*) into n from inventory_stocktakes where id = v_id; if n <> 0 then raise exception ''clen Brna vidi inventuru cizi pobocky''; end if; select count(*) into n from inventory_stocktake_items where stocktake_id = v_id; if n <> 0 then raise exception ''clen Brna vidi % radku inventury cizi pobocky'', n; end if; end $blok$'),
  (1305, '22222222-3333-4444-8555-666666666666', 'inventura: clen Brna nenapocita cizi pobocku', 'nic',       'do $blok$ declare v_id uuid; n int; begin v_id := public.inventura_zahajit(''b7da27a9-6e6d-4492-b1fc-cdf4f39662b4''::uuid, ''sonda 1005'', true); perform set_member_capabilities(''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''33333333-4444-4555-8666-777777777777'', (select jsonb_object_agg(k, true) from unnest(povolene_capability()) k)); perform set_config(''request.jwt.claims'', ''{"sub":"33333333-4444-4555-8666-777777777777","role":"authenticated"}'', true); update inventory_stocktake_items set napocitano = 1 where stocktake_id = v_id; get diagnostics n = row_count; if n <> 0 then raise exception ''clen Brna napocital % radku cizi pobocky'', n; end if; end $blok$'),
  -- Celý cyklus správce: napočítat o kus víc, uzavřít, sklad = napočítáno, pak už nic nezapsat.
  (1306, '22222222-3333-4444-8555-666666666666', 'inventura: uzavreni srovna sklad a zamkne',    'nic',       'do $blok$ declare v_id uuid; v_item uuid; v_cil int; v_stav int; begin v_id := public.inventura_zahajit(''b7da27a9-6e6d-4492-b1fc-cdf4f39662b4''::uuid, ''sonda 1006'', true); select id, ocekavano + 1 into v_item, v_cil from inventory_stocktake_items where stocktake_id = v_id and product_id = ''622e4515-2d11-4f99-af4b-f4d8a7e968a6''; if v_item is null then raise exception ''produkt sondy neni v inventure''; end if; update inventory_stocktake_items set napocitano = v_cil, ocekavano = 999 where id = v_item; if (select ocekavano from inventory_stocktake_items where id = v_item) = 999 then raise exception ''ocekavano slo prepsat pres REST''; end if; perform public.inventura_uzavrit(v_id, true); select quantity into v_stav from inventory_stock where product_id = ''622e4515-2d11-4f99-af4b-f4d8a7e968a6'' and warehouse_id = ''b7da27a9-6e6d-4492-b1fc-cdf4f39662b4''; if v_stav is distinct from v_cil then raise exception ''po uzavreni je ve skladu % misto %'', v_stav, v_cil; end if; begin update inventory_stocktake_items set napocitano = 0 where id = v_item; raise exception ''uzavrena inventura sla prepsat''; exception when sqlstate ''42501'' then null; end; end $blok$')
  -- ══ Souhrnná faktura (20260927130000) ═══════════════════════════════════════
  -- Vazba faktura ↔ zakázka: omezený člen nevidí ani nezaloží vazbu cizí pobočky,
  -- zakázka nejde na dvě nestornované faktury (souhrnnou ani jednotlivou), storno ji uvolní.
  -- Bloky si nejdřív stornují případnou dosavadní fakturu zakázky; vše se na konci vrátí.
  (1400, '22222222-3333-4444-8555-666666666666', 'souhrnna: omezeny clen nevidi vazbu cizi zakazky', 'nic', 'do $blok$ declare n int; begin update invoices set status = ''cancelled'' where id in (select invoice_id from invoice_tickets where ticket_id = ''6d652acf-6359-4272-8e26-0cb57bef3c06'' and aktivni); insert into invoices (id, service_id, branch_id, number) values (''00000000-0000-4000-8000-000000001000'', ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''ea9faf76-26eb-4be9-922c-3705477d423c'', ''SONDA-1000''); insert into invoice_tickets (invoice_id, ticket_id, service_id) values (''00000000-0000-4000-8000-000000001000'', ''6d652acf-6359-4272-8e26-0cb57bef3c06'', ''bbc926bd-25ba-4da1-b528-92b6f1dee24d''); perform set_config(''request.jwt.claims'', ''{"sub":"33333333-4444-4555-8666-777777777777","role":"authenticated"}'', true); select count(*) into n from invoice_tickets where ticket_id = ''6d652acf-6359-4272-8e26-0cb57bef3c06''; if n <> 0 then raise exception ''omezeny clen vidi % vazeb cizi zakazky'', n; end if; end $blok$'),
  (1401, '33333333-4444-4555-8666-777777777777', 'souhrnna: vazba na cizi zakazku', 'odmitnuto', 'do $blok$ begin insert into invoices (id, service_id, branch_id, number) values (''00000000-0000-4000-8000-000000001001'', ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''01fa9595-3acd-442e-acda-0f84d4146609'', ''SONDA-1001''); insert into invoice_tickets (invoice_id, ticket_id, service_id) values (''00000000-0000-4000-8000-000000001001'', ''6d652acf-6359-4272-8e26-0cb57bef3c06'', ''bbc926bd-25ba-4da1-b528-92b6f1dee24d''); end $blok$'),
  (1402, '22222222-3333-4444-8555-666666666666', 'souhrnna: zakazka na dvou fakturach', 'odmitnuto', 'do $blok$ begin update invoices set status = ''cancelled'' where id in (select invoice_id from invoice_tickets where ticket_id = ''6d652acf-6359-4272-8e26-0cb57bef3c06'' and aktivni); insert into invoices (id, service_id, branch_id, number) values (''00000000-0000-4000-8000-000000001002'', ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''ea9faf76-26eb-4be9-922c-3705477d423c'', ''SONDA-1002''), (''00000000-0000-4000-8000-000000001012'', ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''ea9faf76-26eb-4be9-922c-3705477d423c'', ''SONDA-1012''); insert into invoice_tickets (invoice_id, ticket_id, service_id) values (''00000000-0000-4000-8000-000000001002'', ''6d652acf-6359-4272-8e26-0cb57bef3c06'', ''bbc926bd-25ba-4da1-b528-92b6f1dee24d''); insert into invoice_tickets (invoice_id, ticket_id, service_id) values (''00000000-0000-4000-8000-000000001012'', ''6d652acf-6359-4272-8e26-0cb57bef3c06'', ''bbc926bd-25ba-4da1-b528-92b6f1dee24d''); end $blok$'),
  (1403, '22222222-3333-4444-8555-666666666666', 'souhrnna: jednotliva faktura po souhrnne', 'odmitnuto', 'do $blok$ begin update invoices set status = ''cancelled'' where id in (select invoice_id from invoice_tickets where ticket_id = ''6d652acf-6359-4272-8e26-0cb57bef3c06'' and aktivni); insert into invoices (id, service_id, branch_id, number) values (''00000000-0000-4000-8000-000000001003'', ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''ea9faf76-26eb-4be9-922c-3705477d423c'', ''SONDA-1003''); insert into invoice_tickets (invoice_id, ticket_id, service_id) values (''00000000-0000-4000-8000-000000001003'', ''6d652acf-6359-4272-8e26-0cb57bef3c06'', ''bbc926bd-25ba-4da1-b528-92b6f1dee24d''); insert into invoices (service_id, branch_id, ticket_id, number) values (''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''ea9faf76-26eb-4be9-922c-3705477d423c'', ''6d652acf-6359-4272-8e26-0cb57bef3c06'', ''SONDA-1013''); end $blok$'),
  (1404, '22222222-3333-4444-8555-666666666666', 'souhrnna: storno uvolni zakazku', 'nic', 'do $blok$ declare n int; begin update invoices set status = ''cancelled'' where id in (select invoice_id from invoice_tickets where ticket_id = ''6d652acf-6359-4272-8e26-0cb57bef3c06'' and aktivni); insert into invoices (id, service_id, branch_id, number) values (''00000000-0000-4000-8000-000000001004'', ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''ea9faf76-26eb-4be9-922c-3705477d423c'', ''SONDA-1004''), (''00000000-0000-4000-8000-000000001014'', ''bbc926bd-25ba-4da1-b528-92b6f1dee24d'', ''ea9faf76-26eb-4be9-922c-3705477d423c'', ''SONDA-1014''); insert into invoice_tickets (invoice_id, ticket_id, service_id) values (''00000000-0000-4000-8000-000000001004'', ''6d652acf-6359-4272-8e26-0cb57bef3c06'', ''bbc926bd-25ba-4da1-b528-92b6f1dee24d''); update invoices set status = ''cancelled'' where id = ''00000000-0000-4000-8000-000000001004''; insert into invoice_tickets (invoice_id, ticket_id, service_id) values (''00000000-0000-4000-8000-000000001014'', ''6d652acf-6359-4272-8e26-0cb57bef3c06'', ''bbc926bd-25ba-4da1-b528-92b6f1dee24d''); select count(*) into n from invoice_tickets where ticket_id = ''6d652acf-6359-4272-8e26-0cb57bef3c06'' and aktivni; if n <> 1 then raise exception ''po stornu je aktivnich vazeb %'', n; end if; end $blok$'),
  (1405, null                                  , 'souhrnna: anon cte vazby', 'odmitnuto', 'select * from invoice_tickets')
)
select p.poradi, p.oblast, p.ocekavano, public.__rls_probe(p.kdo::uuid, p.dotaz) as vysledek
  from p
 order by p.poradi;

-- Úklid: ladicí funkce nesmí v databázi zůstat ani na minutu.
drop function if exists public.__rls_probe(uuid, text);
