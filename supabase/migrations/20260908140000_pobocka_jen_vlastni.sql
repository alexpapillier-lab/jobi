-- Člen omezený na vlastní pobočku.
--
-- Servis s víc pobočkami nechce, aby technik v Brně viděl (a měnil) zakázky,
-- reklamace a faktury z Prahy. Omezení je v capabilities členství jako
-- `branch_only: true`; správci a majitelé se neomezují. Hlídá to databáze
-- restriktivní politikou (AND k těm stávajícím), ne jen filtr v aplikaci.
-- Záznamy bez pobočky (staré, ještě nepřiřazené) vidí každý.
create or replace function public.pobocka_povolena(p_service_id uuid, p_branch_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_role text;
  v_caps jsonb;
  v_home uuid;
begin
  if auth.uid() is null then
    return true; -- service_role (portál, edge funkce) není člen; omezení je pro lidi
  end if;
  select role, capabilities, home_branch_id into v_role, v_caps, v_home
    from public.service_memberships
   where service_id = p_service_id and user_id = auth.uid();
  if v_role is null then
    return false;
  end if;
  if v_role in ('owner', 'admin') then
    return true;
  end if;
  if coalesce(v_caps ->> 'branch_only', 'false') <> 'true' then
    return true;
  end if;
  return p_branch_id is null or v_home is null or p_branch_id = v_home;
end;
$$;

revoke all on function public.pobocka_povolena(uuid, uuid) from public, anon;
grant execute on function public.pobocka_povolena(uuid, uuid) to authenticated, service_role;

create policy "tickets_jen_vlastni_pobocka" on public.tickets
  as restrictive for select to authenticated
  using (public.pobocka_povolena(service_id, branch_id));
create policy "tickets_jen_vlastni_pobocka_zapis" on public.tickets
  as restrictive for update to authenticated
  using (public.pobocka_povolena(service_id, branch_id))
  with check (public.pobocka_povolena(service_id, branch_id));
create policy "tickets_jen_vlastni_pobocka_vlozeni" on public.tickets
  as restrictive for insert to authenticated
  with check (public.pobocka_povolena(service_id, branch_id));

create policy "warranty_claims_jen_vlastni_pobocka" on public.warranty_claims
  as restrictive for select to authenticated
  using (public.pobocka_povolena(service_id, branch_id));
create policy "warranty_claims_jen_vlastni_pobocka_zapis" on public.warranty_claims
  as restrictive for update to authenticated
  using (public.pobocka_povolena(service_id, branch_id))
  with check (public.pobocka_povolena(service_id, branch_id));

create policy "invoices_jen_vlastni_pobocka" on public.invoices
  as restrictive for select to authenticated
  using (public.pobocka_povolena(service_id, branch_id));
create policy "invoices_jen_vlastni_pobocka_zapis" on public.invoices
  as restrictive for update to authenticated
  using (public.pobocka_povolena(service_id, branch_id))
  with check (public.pobocka_povolena(service_id, branch_id));
