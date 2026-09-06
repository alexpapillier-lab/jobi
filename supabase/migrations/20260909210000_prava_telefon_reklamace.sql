-- Dorovnání práv u telefonního čísla a reklamací.
--
-- Dvě nekonzistence, na které narazila revize:
--
--   1) `service_phone_numbers`: mazat smí owner nebo admin, ale číst, vložit
--      a **změnit** smí kterýkoli člen. Běžný technik tak mohl přepsat
--      odesílací číslo SMS celého servisu.
--   2) `warranty_claims`: zakládat, měnit i mazat reklamace smí kdokoli, kdo
--      je členem, bez jediné kontroly práv – zatímco u zakázek to hlídají tři
--      triggery a u stavů `can_manage_statuses`. Člen bez jediného
--      zaškrtnutého práva tak mohl reklamace zakládat i mazat.
--
-- Reklamace se váže na stejné právo jako základní úpravy zakázek
-- (`can_manage_tickets_basic`); mazání na `can_manage_ticket_archive`, jako
-- u zakázek.

-- ── 1. Telefonní číslo servisu mění jen majitel nebo správce ────────────────
drop policy if exists "service_phone_numbers_insert" on public.service_phone_numbers;
drop policy if exists "service_phone_numbers_update" on public.service_phone_numbers;

create policy "service_phone_numbers_insert" on public.service_phone_numbers
  for insert to authenticated
  with check (public.is_owner_or_admin(service_id));

create policy "service_phone_numbers_update" on public.service_phone_numbers
  for update to authenticated
  using (public.is_owner_or_admin(service_id))
  with check (public.is_owner_or_admin(service_id));

-- ── 2. Reklamace potřebují stejné právo jako zakázky ────────────────────────
create policy "warranty_claims_jen_s_pravem_zapis" on public.warranty_claims
  as restrictive for insert to authenticated
  with check (public.has_capability(service_id, auth.uid(), 'can_manage_tickets_basic'));

create policy "warranty_claims_jen_s_pravem_uprava" on public.warranty_claims
  as restrictive for update to authenticated
  using (public.has_capability(service_id, auth.uid(), 'can_manage_tickets_basic'))
  with check (public.has_capability(service_id, auth.uid(), 'can_manage_tickets_basic'));

create policy "warranty_claims_jen_s_pravem_mazani" on public.warranty_claims
  as restrictive for delete to authenticated
  using (public.has_capability(service_id, auth.uid(), 'can_manage_ticket_archive'));

-- ── 3. Drobnost: `ma_modul` se volá uvnitř politik, ať má pevnou cestu ──────
-- Bez `set search_path` by šlo funkci teoreticky podstrčit jinou tabulku;
-- ostatní funkce v projektu to nastavené mají.
alter function public.ma_modul(uuid, text) set search_path = public;
