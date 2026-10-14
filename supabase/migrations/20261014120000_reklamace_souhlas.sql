-- Elektronický souhlas z webu i na reklamaci + „Není to reklamace“ u
-- reklamace z objednávky.
--
-- Reklamace má stejné podmínky jako zakázkový list, takže souhlas, který
-- zákazník na webu dal (odsouhlasení nebo podpis na displeji), patří i na
-- reklamaci vzniklou z objednávky a tiskne se na Příjemce reklamace.
--
--   warranty_claims.intake_consent   – kopie web_objednavky.souhlas, zapisuje
--                                      jen web_objednavka_prevest_reklamaci
--   warranty_claims_intake_consent_ochrana – klient souhlas nezaloží ani nezmění
--   reklamace_prevod_objednavka      – reklamace převedená na zakázku („Není to
--                                      reklamace“): souhlas jde na zakázku,
--                                      objednávka se přepojí na zakázku a web
--                                      dostane order.converted s kódem zakázky
--                                      (pak i její stavy jako u běžné zakázky)

alter table public.warranty_claims add column if not exists intake_consent jsonb;
comment on column public.warranty_claims.intake_consent is
  'Elektronické odsouhlasení zakázkového listu na webu servisu (z objednávky přes API), stejný tvar jako tickets.intake_consent. Zapisuje jen web_objednavka_prevest_reklamaci.';

-- Klient souhlas nezaloží ani nezmění (obdoba tickets_intake_consent_ochrana).
create or replace function public.warranty_claims_intake_consent_ochrana()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new; -- service_role, migrace
  end if;
  if current_setting('app.souhlas_reklamace', true) is not distinct from new.id::text then
    return new;
  end if;
  if tg_op = 'INSERT' and new.intake_consent is not null then
    raise exception 'Elektronický souhlas se na reklamaci přenáší jen z objednávky.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.intake_consent is distinct from old.intake_consent then
    raise exception 'Elektronický souhlas se na reklamaci nemění.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.warranty_claims_intake_consent_ochrana() from public, anon, authenticated;

drop trigger if exists warranty_claims_intake_consent_ochrana on public.warranty_claims;
create trigger warranty_claims_intake_consent_ochrana
  before insert or update of intake_consent on public.warranty_claims
  for each row execute function public.warranty_claims_intake_consent_ochrana();

-- Převod objednávky na reklamaci – nově se souhlasem.
create or replace function public.web_objednavka_prevest_reklamaci(p_id uuid, p_claim_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_o public.web_objednavky;
  v_c record;
begin
  if v_uid is null then
    raise exception 'Nepřihlášený' using errcode = '42501';
  end if;
  select * into v_o from public.web_objednavky where id = p_id for update;
  if not found then
    raise exception 'Objednávka neexistuje' using errcode = 'P0002';
  end if;
  if not public.has_capability(v_o.service_id, v_uid, 'can_manage_tickets_basic')
     or not (v_o.service_id = any (public.servisy_kde_smim_pracovat()))
     or not public.pobocka_povolena(v_o.service_id, v_o.branch_id) then
    raise exception 'Na převod objednávky nemáte oprávnění' using errcode = '42501';
  end if;
  select id, service_id, branch_id into v_c from public.warranty_claims where id = p_claim_id;
  if not found or v_c.service_id <> v_o.service_id then
    raise exception 'Reklamace k objednávce nepatří' using errcode = '42501';
  end if;
  if not public.pobocka_povolena(v_c.service_id, v_c.branch_id) then
    raise exception 'Reklamace je na pobočce, kterou nevidíte' using errcode = '42501';
  end if;
  if v_o.stav not in ('nova', 'na_ceste', 'dorazilo') then
    return false;
  end if;
  update public.web_objednavky
     set stav = 'prevedeno', claim_id = p_claim_id, prevedeno_at = now(),
         dorazilo_at = coalesce(dorazilo_at, now())
   where id = p_id;
  -- Souhlas z webu na reklamaci (jen když tam ještě žádný není).
  if v_o.souhlas is not null then
    perform set_config('app.souhlas_reklamace', p_claim_id::text, true);
    update public.warranty_claims
       set intake_consent = v_o.souhlas || jsonb_build_object(
             'order_id', v_o.id, 'external_id', v_o.externi_cislo, 'source', v_o.zdroj, 'transferred_at', now())
     where id = p_claim_id and intake_consent is null;
    perform set_config('app.souhlas_reklamace', '', true);
  end if;
  perform public.api_webhook_zarad(p_id, 'order.converted');
  return true;
end;
$$;
revoke all on function public.web_objednavka_prevest_reklamaci(uuid, uuid) from public, anon;
grant execute on function public.web_objednavka_prevest_reklamaci(uuid, uuid) to authenticated, service_role;

-- „Není to reklamace“: reklamace dostala converted_ticket_id (hlídač
-- reklamace_prevod_hlidac už ověřil, že zakázka patří servisu).
create or replace function public.reklamace_prevod_objednavka()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_obj uuid;
begin
  if new.converted_ticket_id is null or old.converted_ticket_id is not null then
    return new;
  end if;
  if new.intake_consent is not null then
    perform set_config('app.souhlas_ticket', new.converted_ticket_id::text, true);
    update public.tickets
       set intake_consent = new.intake_consent || jsonb_build_object('claim_id', new.id, 'claim_code', new.code)
     where id = new.converted_ticket_id and intake_consent is null;
    perform set_config('app.souhlas_ticket', '', true);
  end if;
  for v_obj in
    update public.web_objednavky
       set ticket_id = new.converted_ticket_id
     where claim_id = new.id and ticket_id is null
    returning id
  loop
    perform public.api_webhook_zarad(v_obj, 'order.converted');
  end loop;
  return new;
end;
$$;
revoke all on function public.reklamace_prevod_objednavka() from public, anon, authenticated;

drop trigger if exists trg_warranty_claims_prevod_objednavka on public.warranty_claims;
create trigger trg_warranty_claims_prevod_objednavka
  after update of converted_ticket_id on public.warranty_claims
  for each row execute function public.reklamace_prevod_objednavka();
