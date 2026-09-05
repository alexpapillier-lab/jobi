-- Přístup do aplikace jako nárok.
--
-- Zkušební období nemá být „placené moduly na měsíc a pak se jede zadarmo
-- dál“ – po jeho konci si servis musí vybrat plán, jinak aplikace skončí.
-- Nárok `access` je proto podmínka pro práci v aplikaci: zkušebnímu servisu
-- se dá na dobu určitou, platícímu natrvalo.
--
-- Všem stávajícím servisům se uděluje bez omezení, aby nikoho nezamkl.

insert into public.service_entitlements (service_id, module, active, valid_until, note)
select s.id, 'access', true, null, 'Stávající servis před zavedením zkušebního období'
  from public.services s
 where not exists (
   select 1 from public.service_entitlements e
    where e.service_id = s.id and e.module = 'access'
 );

comment on table public.service_entitlements is
  'Co má který servis zaplacené. Modul „access“ = smí se v aplikaci pracovat (po zkušebním období jen s plánem). Zapisuje jen Edge Function entitlements-manage (root owner).';
