-- Fotky a podpisy: konec listování pro celý internet a mazání napříč servisy.
--
-- Bucket `diagnostic-photos` měl politiku pro čtení bez klauzule `TO`, takže
-- platila i pro roli `anon`. Kdokoli s veřejným klíčem (a ten je v každé
-- instalaci aplikace) si přes storage API mohl **vypsat obsah celého
-- bucketu** – diagnostické fotky všech servisů i podpisy zákazníků při
-- převzetí. Cesty jsou sice náhodné, ale výpis je vydá.
--
-- Zápis a mazání měly `TO authenticated` bez jakéhokoli omezení na servis,
-- takže kterýkoli přihlášený uživatel mohl smazat fotky a podpisy cizího
-- servisu.
--
-- Nově platí totéž, co u `product-images`: první složka cesty je id servisu
-- a musí to být servis, jehož jsem člen. Veřejné odkazy `/object/public/…`
-- fungují dál (bucket zůstává veřejný), takže se náhledy v aplikaci ani
-- v dokumentech nerozbijí – zmizí jen možnost vypsat si, co v bucketu je.
--
-- Podpisy z portálu leží v `signatures/…` a nahrává je edge funkce pod
-- `service_role`, která politiky obchází; ty se tímhle nerozbijí a zároveň
-- se k nim přes klientské API nedostane nikdo.

drop policy if exists "diagnostic_photos_select" on storage.objects;
create policy "diagnostic_photos_select"
on storage.objects for select
to authenticated
using (
  bucket_id = 'diagnostic-photos'
  and (storage.foldername(name))[1] in (
    select m.service_id::text from public.service_memberships m where m.user_id = auth.uid()
  )
);

drop policy if exists "diagnostic_photos_insert" on storage.objects;
create policy "diagnostic_photos_insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'diagnostic-photos'
  and (storage.foldername(name))[1] in (
    select m.service_id::text from public.service_memberships m where m.user_id = auth.uid()
  )
);

drop policy if exists "diagnostic_photos_update" on storage.objects;
create policy "diagnostic_photos_update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'diagnostic-photos'
  and (storage.foldername(name))[1] in (
    select m.service_id::text from public.service_memberships m where m.user_id = auth.uid()
  )
);

drop policy if exists "diagnostic_photos_delete" on storage.objects;
create policy "diagnostic_photos_delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'diagnostic-photos'
  and (storage.foldername(name))[1] in (
    select m.service_id::text from public.service_memberships m where m.user_id = auth.uid()
  )
);
