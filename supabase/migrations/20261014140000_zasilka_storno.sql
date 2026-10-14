-- Storno odeslané zásilky mezi pobočkami.
--
-- Koncept se dal smazat vždycky, odeslaná zásilka ale neměla cestu ven –
-- omylem (nebo zkušebně) odeslaná krabice visela „na cestě“ navždy a její
-- zakázky s ní. Storno vrátí nepřevzaté zakázky tam, odkud zásilka vyjela,
-- a zásilku označí jako stornovanou (zůstává v přehledu kvůli dohledatelnosti,
-- nic se nemaže). Zakázky, které už cíl převzal, zůstávají, kde jsou.
--
-- Stornovat smí člen pobočky odeslání i cílové pobočky (krabice nedorazila).

alter table public.ticket_shipments drop constraint if exists ticket_shipments_status_check;
alter table public.ticket_shipments
  add constraint ticket_shipments_status_check check (status in ('draft', 'sent', 'received', 'cancelled'));

alter table public.ticket_shipments
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references auth.users(id) on delete set null;

-- Hlídač ručních změn stavu (ticket_shipments_jen_hlavicka) nově hlídá i storno.
create or replace function public.ticket_shipments_jen_hlavicka()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new; -- service_role, RPC (ty běží jako definer, ale auth.uid() mají – viz níž)
  end if;
  if current_setting('jobi.zasilka_rpc', true) = '1' then
    return new;
  end if;
  if new.status is distinct from old.status
     or new.sent_at is distinct from old.sent_at or new.sent_by is distinct from old.sent_by
     or new.received_at is distinct from old.received_at or new.received_by is distinct from old.received_by
     or new.cancelled_at is distinct from old.cancelled_at or new.cancelled_by is distinct from old.cancelled_by
     or new.service_id is distinct from old.service_id or new.cislo is distinct from old.cislo then
    raise exception 'Stav zásilky se mění jen přes odeslání, převzetí a storno.' using errcode = '42501';
  end if;
  if old.status <> 'draft' and (new.from_branch_id is distinct from old.from_branch_id or new.to_branch_id is distinct from old.to_branch_id) then
    raise exception 'Odeslané zásilce už nejde měnit pobočky.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.zasilka_stornovat(p_shipment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.ticket_shipments%rowtype;
begin
  select * into s from public.ticket_shipments where id = p_shipment_id for update;
  if s.id is null then
    raise exception 'Zásilka nenalezena.' using errcode = 'P0002';
  end if;
  if not public.zasilka_clen(s.service_id) then
    raise exception 'Nejste členem servisu.' using errcode = '42501';
  end if;
  if auth.uid() is not null and not public.servis_smi_pracovat(s.service_id) then
    raise exception 'Servis je vypnutý nebo mu skončil přístup.' using errcode = '42501';
  end if;
  if not public.pobocka_povolena(s.service_id, s.from_branch_id)
     and not public.pobocka_povolena(s.service_id, s.to_branch_id) then
    raise exception 'Zásilku může stornovat jen pobočka odeslání nebo cíle.' using errcode = '42501';
  end if;
  if s.status <> 'sent' then
    raise exception 'Stornovat jde jen zásilku na cestě (koncept se maže).' using errcode = '22023';
  end if;
  perform set_config('jobi.zasilka_rpc', '1', true);
  -- Nepřevzaté zakázky zpátky tam, odkud vyjely.
  update public.tickets t
     set transit_shipment_id = null,
         location_branch_id = case when s.from_branch_id = t.branch_id then null else s.from_branch_id end
   where t.transit_shipment_id = s.id;
  update public.ticket_shipments
     set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid()
   where id = s.id;
end;
$$;
revoke all on function public.zasilka_stornovat(uuid) from public, anon;
grant execute on function public.zasilka_stornovat(uuid) to authenticated, service_role;
