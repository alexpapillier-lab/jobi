-- Zásilky: kdo převzal kterou zakázku
-- ============================================================================
--
-- Historie zásilky ukazuje, kdo ji založil, odeslal, převzal a stornoval. Ze
-- zásilky samotné to jde (created_by, sent_by, received_by, cancelled_by), jen
-- převzetí po částech (zakázky dorazí v několika dávkách) neslo autora: v
-- položce byl jen čas. Nově položka nese i received_by.
--
-- Zpětně: položky převzaté ve stejném okamžiku jako celá zásilka (poslední
-- dávka, jedna transakce = stejné now()) dostanou received_by ze zásilky.
-- Dřívější dílčí dávky autora nemají a zůstávají bez něj.

alter table public.ticket_shipment_items
  add column if not exists received_by uuid references auth.users(id) on delete set null;

update public.ticket_shipment_items i
   set received_by = s.received_by
  from public.ticket_shipments s
 where i.shipment_id = s.id
   and i.received_at is not null
   and i.received_by is null
   and s.received_by is not null
   and i.received_at = s.received_at;

-- Jinak beze změny proti 20260927100000.
create or replace function public.zasilka_prevzit(p_shipment_id uuid, p_ticket_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.ticket_shipments%rowtype;
  v_zbyva integer;
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
  if s.status = 'draft' then
    raise exception 'Zásilka ještě nebyla odeslána.' using errcode = '22023';
  end if;
  perform set_config('jobi.zasilka_rpc', '1', true);
  update public.ticket_shipment_items
     set received_at = now(), received_by = auth.uid()
   where shipment_id = s.id and received_at is null and ticket_id = any(p_ticket_ids);
  update public.tickets t
     set transit_shipment_id = null,
         location_branch_id = case when s.to_branch_id = t.branch_id then null else s.to_branch_id end
   where t.id = any(p_ticket_ids) and t.transit_shipment_id = s.id;
  select count(*) into v_zbyva from public.ticket_shipment_items where shipment_id = s.id and received_at is null;
  if v_zbyva = 0 then
    update public.ticket_shipments
       set status = 'received', received_at = now(), received_by = auth.uid()
     where id = s.id;
  end if;
end;
$$;
revoke all on function public.zasilka_prevzit(uuid, uuid[]) from public, anon;
grant execute on function public.zasilka_prevzit(uuid, uuid[]) to authenticated, service_role;
