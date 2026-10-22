-- Objednávka z webu převedená na REKLAMACI (ne na novou zakázku).
--
-- Zákazník pošle přes web zařízení, které je u servisu v záruce (notas
-- opravený dřív). Servis z objednávky založí reklamaci navázanou na původní
-- zakázku (warranty_claims.source_ticket_id) – objednávka se tím vyřídí
-- stejně jako převodem na zakázku.
--
--   web_objednavky.claim_id                 – reklamace, na kterou se převedla
--   web_objednavka_prevest_reklamaci(id, claim) – obdoba web_objednavka_prevest
--   web_objednavka_payload                  – ticket_code nese i kód reklamace
--                                             (web ukazuje „kód v Jobi“), navíc
--                                             converted_to a claim_code
--
-- Souhlas ze zakázkového listu (souhlas) se na reklamaci nepřenáší – reklamace
-- nemá intake_consent; zůstává u objednávky.

alter table public.web_objednavky
  add column if not exists claim_id uuid references public.warranty_claims(id) on delete set null;

create index if not exists idx_web_objednavky_claim_id
  on public.web_objednavky(claim_id) where claim_id is not null;

comment on column public.web_objednavky.claim_id is
  'Reklamace, na kterou se objednávka převedla (místo zakázky ticket_id).';

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
  perform public.api_webhook_zarad(p_id, 'order.converted');
  return true;
end;
$$;
revoke all on function public.web_objednavka_prevest_reklamaci(uuid, uuid) from public, anon;
grant execute on function public.web_objednavka_prevest_reklamaci(uuid, uuid) to authenticated, service_role;

-- Webhook: u reklamace jde do ticket_code její kód (web ho ukazuje jako
-- „kód v Jobi“) a status/total zůstávají prázdné – stav reklamace se zatím
-- webhookem neposílá.
create or replace function public.web_objednavka_payload(p_objednavka_id uuid, p_udalost text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'event', p_udalost,
    'external_id', o.externi_cislo,
    'source', o.zdroj,
    'order_status', public.web_objednavka_stav_api(o.stav),
    'converted_to', case when o.ticket_id is not null then 'ticket' when o.claim_id is not null then 'claim' end,
    'ticket_code', coalesce(z ->> 'code', c.code),
    'claim_code', c.code,
    'status', z -> 'status',
    'total', z -> 'total',
    'updated_at', to_jsonb(greatest(o.updated_at, coalesce((z ->> 'updated_at')::timestamptz, o.updated_at)))
  )
  from public.web_objednavky o
  left join lateral (select public.web_objednavka_zakazka_json(o.ticket_id) as z) j on true
  left join public.warranty_claims c on c.id = o.claim_id
  where o.id = p_objednavka_id;
$$;
revoke all on function public.web_objednavka_payload(uuid, text) from public, anon, authenticated;
grant execute on function public.web_objednavka_payload(uuid, text) to service_role;
