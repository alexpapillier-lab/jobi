-- Seznam souborů servisu v úložišti.
--
-- PostgREST vystavuje jen public schéma, takže se na storage.objects nedá
-- sáhnout ani service_role klíčem. Export dat servisu a jeho úklid při mazání
-- ale potřebují vědět, co v úložišti leží: fotky a produktové obrázky jsou ve
-- složce <service_id>/…, podpisy ze zákaznického portálu v signatures/ podle
-- id zakázky.
create or replace function public.service_storage_objects(p_service_id uuid)
returns table (bucket_id text, name text)
language sql
security definer
set search_path = public, storage
as $$
  select o.bucket_id, o.name
  from storage.objects o
  where o.name like p_service_id::text || '/%'
     or (
       o.name like 'signatures/%'
       and exists (
         select 1 from public.tickets t
         where t.service_id = p_service_id
           and o.name like 'signatures/' || t.id::text || '-%'
       )
     )
$$;

revoke all on function public.service_storage_objects(uuid) from public, anon, authenticated;
grant execute on function public.service_storage_objects(uuid) to service_role;

comment on function public.service_storage_objects(uuid) is
  'Soubory servisu v úložišti (složka podle service_id + podpisy podle zakázek). Jen service_role – používá edge funkce service-manage při exportu a mazání.';
