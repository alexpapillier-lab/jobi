-- Druhé kolo auditu oprávnění (správce, člen, cizí servis, anon) – opravy.
--
-- Testováno probe skriptem scripts/rls-probe.sql z účtů správce TEST2,
-- technika TEST2, člena bez práv, majitele E2E servisu a role anon. Oddělení
-- servisů v tabulkách (branches, service_billing, service_integrations,
-- tickets.quote_items) drží; díry byly ve funkcích a v triggeru zakázek:
--
--   1) delete_service_for_root() – SECURITY DEFINER bez kontroly volajícího,
--      EXECUTE pro PUBLIC. Kdokoli s anon klíčem mohl přes
--      /rest/v1/rpc/delete_service_for_root smazat libovolný servis i se
--      všemi daty (ověřeno v odvolané transakci: servis 0, zakázek 0).
--   2) get_auth_user_id_by_email() a invited_email_has_any_membership() –
--      z anon role šlo zjistit, zda e-mail má účet / členství (enumerace
--      uživatelů). Volají je jen edge funkce pod service_role.
--   3) next_invoice_number() – bez kontroly členství: kdokoli mohl posunout
--      číselnou řadu faktur cizího servisu (mezery v číslování dokladů).
--   4) alerts_uklid(), rate_hits_uklid(), purge_old_error_logs(),
--      default_branch_id(), branches_allowed() – provozní funkce s EXECUTE
--      pro PUBLIC; nikdo z klienta je nepotřebuje.
--   5) Trigger enforce_ticket_basic_update_permissions hlídal pevný seznam
--      sloupců, takže člen bez „Úprav zakázek“ přepsal cenovou nabídku
--      (quote_items, quote_amount, quote_status → approved), pobočku,
--      termín, příslušenství, portálový token i podpis převzetí. A když
--      poslal změnu stavu, kontrola se přeskočila úplně – i pro customer_name.
--   6) anon měl plné tabulkové granty na branches, service_billing a
--      service_integrations; authenticated měl TRUNCATE/REFERENCES/TRIGGER.
--      RLS to zatím drželo, ale první anon politika by otevřela i zápis.

-- ── 1. Mazání servisu jen ze serveru ─────────────────────────────────────────
create or replace function public.delete_service_for_root(p_service_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claims text := current_setting('request.jwt.claims', true);
begin
  -- Volá jen edge funkce service-manage pod service_role (ta ověřuje root
  -- ownera). Přihlášený uživatel ani anon sem nesmí, i kdyby EXECUTE dostal.
  if auth.uid() is not null
     or (coalesce(v_claims, '') <> '' and (v_claims::jsonb ->> 'role') is distinct from 'service_role') then
    raise exception 'Servis smí mazat jen server.' using errcode = '42501';
  end if;
  -- Značka pro triggery (poslední vlastník, výchozí pobočka), aby pustily kaskádu.
  perform set_config('app.deleting_service_id', p_service_id::text, true);
  delete from public.services where id = p_service_id;
end;
$$;

revoke all on function public.delete_service_for_root(uuid) from public, anon, authenticated;
grant execute on function public.delete_service_for_root(uuid) to service_role;

-- ── 2. Dohledání účtu podle e-mailu jen pro server ──────────────────────────
revoke all on function public.get_auth_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.get_auth_user_id_by_email(text) to service_role;

revoke all on function public.invited_email_has_any_membership(text) from public, anon, authenticated;
grant execute on function public.invited_email_has_any_membership(text) to service_role;

-- ── 3. Číslo faktury jen členovi servisu ────────────────────────────────────
create or replace function public.next_invoice_number(
  p_service_id uuid,
  p_prefix text default 'FV',
  p_year integer default extract(year from now())::integer
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next int;
begin
  -- Funkce běží jako definer a posouvá řadu; bez přihlášení jde o service_role.
  if auth.uid() is not null and not exists (
    select 1 from public.service_memberships m
     where m.service_id = p_service_id and m.user_id = auth.uid()
  ) then
    raise exception 'Nemáte přístup k tomuto servisu.' using errcode = '42501';
  end if;

  insert into public.invoice_series (service_id, prefix, year, next_value)
  values (p_service_id, p_prefix, p_year, 2)
  on conflict (service_id, prefix, year)
  do update set next_value = invoice_series.next_value + 1
  returning next_value - 1 into v_next;

  return p_prefix || p_year::text || '-' || lpad(v_next::text, 4, '0');
end;
$$;

revoke all on function public.next_invoice_number(uuid, text, integer) from public, anon;
grant execute on function public.next_invoice_number(uuid, text, integer) to authenticated, service_role;

-- ── 4. Provozní funkce nepatří klientovi ────────────────────────────────────
revoke all on function public.alerts_uklid() from public, anon, authenticated;
revoke all on function public.rate_hits_uklid() from public, anon, authenticated;
revoke all on function public.purge_old_error_logs() from public, anon, authenticated;
-- default_branch_id a branches_allowed volají jen triggery (SECURITY DEFINER),
-- takže granty pro role nepotřebují; z klienta prozrazovaly údaje o cizím servisu.
revoke all on function public.default_branch_id(uuid) from public, anon, authenticated;
revoke all on function public.branches_allowed(uuid) from public, anon, authenticated;
-- Funkce s vnitřní kontrolou, které ale anon nemá důvod volat.
revoke all on function public.set_member_home_branch(uuid, uuid, uuid) from public, anon;
revoke all on function public.service_integration_providers(uuid) from public, anon;
revoke all on function public.change_ticket_status(uuid, text) from public, anon;
revoke all on function public.ma_modul(uuid, text) from public, anon;

-- ── 5. Úpravy zakázky: co není výslovně volné, chce „Úpravy zakázek“ ────────
-- Místo seznamu hlídaných sloupců (který každá nová migrace zapomene rozšířit)
-- se hlídá všechno kromě několika výjimek: stav (má vlastní trigger a RPC),
-- completed_at (plní se se stavem), archivace (vlastní trigger) a sloupce,
-- které plní databáze sama. Změna stavu už neomlouvá ostatní sloupce.
--
-- Zákaznický portál (service_role, auth.uid() je null) může vše: podpis,
-- rozhodnutí o nabídce, poslední otevření. Z aplikace se tyhle tři sloupce
-- nemění nikdy, portálový token vzniká jen přes ensure_portal_token.
create or replace function public.enforce_ticket_basic_update_permissions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  c_volne constant text[] := array['status', 'completed_at', 'deleted_at', 'updated_at', 'version'];
  c_portal constant text[] := array['portal_last_opened_at', 'intake_signature_url', 'intake_signed_at'];
  j_old jsonb;
  j_new jsonb;
  k text;
begin
  if tg_op <> 'UPDATE' or uid is null then
    return new;
  end if;

  j_old := to_jsonb(old);
  j_new := to_jsonb(new);

  foreach k in array c_portal loop
    if j_new -> k is distinct from j_old -> k then
      raise exception 'Sloupec % zapisuje jen zákaznický portál.', k using errcode = '42501';
    end if;
  end loop;

  if new.portal_token is distinct from old.portal_token
     and current_setting('app.portal_token_ticket', true) is distinct from new.id::text then
    raise exception 'Portálový odkaz se zakládá jen přes ensure_portal_token.' using errcode = '42501';
  end if;

  if (j_new - c_volne - c_portal - 'portal_token') = (j_old - c_volne - c_portal - 'portal_token') then
    return new;
  end if;

  if not public.has_capability(new.service_id, uid, 'can_manage_tickets_basic') then
    raise exception 'Not authorized: missing can_manage_tickets_basic for ticket updates' using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ensure_portal_token si před zápisem tokenu nastaví značku, podle které ho
-- trigger pustí. Kdo token zakládá, dál hlídá funkce sama (členství v servisu).
create or replace function public.ensure_portal_token(p_ticket_id uuid)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_service_id uuid;
  v_token text;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select service_id, portal_token
    into v_service_id, v_token
  from public.tickets
  where id = p_ticket_id
    and deleted_at is null;

  if v_service_id is null then
    raise exception 'Zakázka nenalezena' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.service_memberships m
    where m.service_id = v_service_id and m.user_id = v_uid
  ) then
    raise exception 'Nemáte oprávnění k této zakázce' using errcode = '42501';
  end if;

  if v_token is not null then
    return v_token;
  end if;

  perform set_config('app.portal_token_ticket', p_ticket_id::text, true);

  -- Kolize je při 192 bitech prakticky vyloučená, ale UNIQUE constraint
  -- ji stejně chytí – v tom případě zkusíme znovu.
  loop
    v_token := translate(
      rtrim(encode(gen_random_bytes(24), 'base64'), '='),
      '+/', '-_'
    );
    begin
      update public.tickets
         set portal_token = v_token
       where id = p_ticket_id
         and portal_token is null;
      exit;
    exception when unique_violation then
      null; -- zkusit jiný token
    end;
  end loop;

  -- Pokud mezitím token založil kolega (souběh), vrátíme ten jeho.
  select portal_token into v_token from public.tickets where id = p_ticket_id;
  return v_token;
end;
$$;

-- ── 6. Tabulkové granty nových tabulek ──────────────────────────────────────
revoke all on table public.branches, public.service_billing, public.service_integrations from anon;
revoke truncate, references, trigger on table public.branches, public.service_billing, public.service_integrations from authenticated;
-- service_billing píše jen billing-webhook; politika už zápis zakazuje, grant to jen potvrzuje.
revoke insert, update, delete on table public.service_billing from authenticated;
