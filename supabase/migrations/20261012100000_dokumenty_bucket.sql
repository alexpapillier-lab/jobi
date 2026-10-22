-- Bucket pro logo, razítko a hlavičkový papír dokumentů (JobiDocs a editor
-- šablon ve webové verzi).
--
-- JobiDocs (jobidocs/api/supabaseSync.ts) i webový editor
-- (src/lib/sablonyDokumentuWeb.ts) obrázky značky při uložení šablon nahrávají
-- do bucketu `service-document-assets` a v configu nechávají jen adresu
-- z getPublicUrl. Bucket ale v produkci nikdy nevznikl, nahrání tiše selhalo
-- a obrázky zůstávaly v service_document_settings.config.v2.brand jako
-- data: URL (12. 10. 2026: jeden servis má v configu 850 kB, z toho razítko
-- 770 kB). Funguje to, jen se celý config tahá při každém tisku.
--
-- Po této migraci se obrázky při příštím uložení šablon přesunou do bucketu.
-- Stávající data: URL zůstávají platné, nic se nepřepisuje.
--
-- Cesty (stejné v JobiDocs i ve webu, přepisují se, nehromadí):
--   {service_id}/logo.{png|jpg|webp|gif}
--   {service_id}/stamp.{png|jpg|webp|gif}
--   {service_id}/letterhead.pdf
--
-- Čtení: bucket je veřejný jako dnes očekává getPublicUrl – adresa jde do
-- HTML dokumentu, který kreslí JobiDocs (bez relace), tiskový iframe
-- prohlížeče a server pro PDF. Veřejná cesta /object/public/… se vyřizuje
-- mimo RLS. VÝPIS obsahu bucketu ale anonym nedostane (na rozdíl od
-- product-images, viz docs/BEZPECNOST_FOTKY.md): SELECT politika je jen pro
-- členy toho servisu – potřebuje ji nahrání s upsert.
--
-- Zápis: jen člen servisu z první části cesty, který smí měnit dokumenty
-- (majitel, správce, nebo člen s can_manage_documents – stejně jako
-- politiky service_document_settings) a jehož servis smí pracovat
-- (servisy_kde_smim_pracovat: zapnutý servis s platným přístupem).
--
-- Idempotentní: bucket ON CONFLICT DO UPDATE, politiky DROP IF EXISTS.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'service-document-assets',
  'service-document-assets',
  true,
  10485760,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Servisy, kam volající smí nahrávat obrázky dokumentů (jako text kvůli
-- porovnání s první částí cesty). security definer + row_security off:
-- politika na storage.objects se tak neptá RLS service_memberships.
create or replace function public.servisy_pro_dokumenty_uloziste()
returns text[]
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select coalesce(array_agg(sm.service_id::text), '{}')
    from public.service_memberships sm
   where sm.user_id = auth.uid()
     and (
       sm.role in ('owner', 'admin')
       or (sm.role = 'member' and public.has_capability(sm.service_id, auth.uid(), 'can_manage_documents'))
     )
     and sm.service_id = any (public.servisy_kde_smim_pracovat());
$$;

comment on function public.servisy_pro_dokumenty_uloziste() is
  'Servisy (id jako text), kde volající smí měnit nastavení dokumentů a servis smí pracovat. Pro politiky bucketu service-document-assets.';

revoke all on function public.servisy_pro_dokumenty_uloziste() from public, anon;
grant execute on function public.servisy_pro_dokumenty_uloziste() to authenticated, service_role;

drop policy if exists "service_document_assets_select" on storage.objects;
create policy "service_document_assets_select"
on storage.objects for select
to authenticated
using (
  bucket_id = 'service-document-assets'
  and (storage.foldername(name))[1] in (
    select m.service_id::text from public.service_memberships m where m.user_id = auth.uid()
  )
);

drop policy if exists "service_document_assets_insert" on storage.objects;
create policy "service_document_assets_insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'service-document-assets'
  and (storage.foldername(name))[1] = any (public.servisy_pro_dokumenty_uloziste())
);

drop policy if exists "service_document_assets_update" on storage.objects;
create policy "service_document_assets_update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'service-document-assets'
  and (storage.foldername(name))[1] = any (public.servisy_pro_dokumenty_uloziste())
)
with check (
  bucket_id = 'service-document-assets'
  and (storage.foldername(name))[1] = any (public.servisy_pro_dokumenty_uloziste())
);

drop policy if exists "service_document_assets_delete" on storage.objects;
create policy "service_document_assets_delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'service-document-assets'
  and (storage.foldername(name))[1] = any (public.servisy_pro_dokumenty_uloziste())
);
