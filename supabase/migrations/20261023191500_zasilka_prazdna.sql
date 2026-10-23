-- Zásilka bez zakázek jde odeslat (vozí se i jiné věci než zakázky).
-- Jinak beze změny proti 20260927100000_audit_opravneni_4.sql.

create or replace function public.zasilka_odeslat(p_shipment_id uuid)
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
  -- Definer obchází RLS: bez těchhle dvou kontrol by omezený člen odeslal
  -- (a tím si zpřístupnil) zakázku cizí pobočky.
  if not public.pobocka_povolena(s.service_id, s.from_branch_id) then
    raise exception 'Zásilku může odeslat jen pobočka, ze které jede.' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.ticket_shipment_items i join public.tickets t on t.id = i.ticket_id
     where i.shipment_id = s.id
       and not public.zakazka_viditelna_podle_mista(t.service_id, t.branch_id, t.location_branch_id)
  ) then
    raise exception 'V zásilce je zakázka jiné pobočky.' using errcode = '42501';
  end if;
  if s.status <> 'draft' then
    raise exception 'Zásilka už byla odeslána.' using errcode = '22023';
  end if;
  -- Prázdná zásilka jde odeslat taky: mezi pobočkami se vozí i díly,
  -- nářadí nebo dokumenty (přání majitele 23. 10. 2026). Převezme se
  -- pak zasilka_prevzit s prázdným seznamem.
  -- Zakázka, která mezitím odjela jinou zásilkou, se v téhle nesmí tvářit, že jede.
  if exists (
    select 1 from public.ticket_shipment_items i join public.tickets t on t.id = i.ticket_id
     where i.shipment_id = s.id and t.transit_shipment_id is not null
  ) then
    raise exception 'Některá zakázka právě cestuje v jiné zásilce.' using errcode = '23505';
  end if;
  perform set_config('jobi.zasilka_rpc', '1', true);
  update public.ticket_shipments
     set status = 'sent', sent_at = now(), sent_by = auth.uid()
   where id = s.id;
  update public.tickets t
     set transit_shipment_id = s.id,
         location_branch_id = case when s.to_branch_id = t.branch_id then null else s.to_branch_id end
    from public.ticket_shipment_items i
   where i.shipment_id = s.id and t.id = i.ticket_id;
end;
$$;
revoke all on function public.zasilka_odeslat(uuid) from public, anon;
grant execute on function public.zasilka_odeslat(uuid) to authenticated, service_role;
