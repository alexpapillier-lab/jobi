-- Opravy z auditu rolí a oprávnění (docs/AUDIT_ROLE_2026-09.md).
--
-- Jádro problému: schopnosti členů se vyhodnocovaly v RPC funkcích
-- (change_ticket_status, soft_delete_ticket, restore_ticket), jenže role
-- `authenticated` má UPDATE na všech sloupcích `tickets` a politika hlídala
-- pouhé členství. Kdokoli tedy mohl poslat PATCH na /rest/v1/tickets a všechny
-- ty funkce obejít. Kontrola proto patří do triggeru, kudy projde každá cesta.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Protichůdné politiky na tickets
--
-- Existovaly dvě permisivní UPDATE politiky. Ta volnější (bez podmínky
-- deleted_at) se s druhou spojovala přes OR, takže ochrana měkce smazaných
-- zakázek nefungovala. Navíc mířila na roli `public`, tedy i na anon.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "Service members can update tickets" on public.tickets;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Schopnosti u zakázek vynucené triggerem
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.enforce_ticket_capabilities()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  zbytek_new jsonb;
  zbytek_old jsonb;
begin
  -- Bez přihlášeného uživatele jde o volání ze service_role (edge funkce,
  -- migrace, obsluha webhooků). Ty mají plný přístup záměrně.
  if uid is null then
    return new;
  end if;

  if new.status is distinct from old.status
     and not public.has_capability(new.service_id, uid, 'can_change_ticket_status') then
    raise exception 'Nemáte oprávnění měnit stav zakázky' using errcode = '42501';
  end if;

  if new.deleted_at is distinct from old.deleted_at then
    if old.deleted_at is null then
      -- přesun do archivu
      if not (public.has_capability(new.service_id, uid, 'can_delete_tickets')
           or public.has_capability(new.service_id, uid, 'can_manage_ticket_archive')) then
        raise exception 'Nemáte oprávnění mazat zakázky' using errcode = '42501';
      end if;
    else
      -- obnovení z archivu je vyhrazené správě archivu
      if not public.has_capability(new.service_id, uid, 'can_manage_ticket_archive') then
        raise exception 'Nemáte oprávnění obnovovat zakázky z archivu' using errcode = '42501';
      end if;
    end if;
  end if;

  -- Zbylé sloupce spadají pod „Úpravy zakázek“. Stav a smazání už jsou
  -- ošetřené výše, updated_at a version mění aplikace u každé změny.
  zbytek_new := to_jsonb(new) - 'status' - 'deleted_at' - 'updated_at' - 'version';
  zbytek_old := to_jsonb(old) - 'status' - 'deleted_at' - 'updated_at' - 'version';
  if zbytek_new is distinct from zbytek_old
     and not public.has_capability(new.service_id, uid, 'can_manage_tickets_basic') then
    raise exception 'Nemáte oprávnění upravovat zakázky' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_ticket_capabilities on public.tickets;
create trigger trg_enforce_ticket_capabilities
  before update on public.tickets
  for each row execute function public.enforce_ticket_capabilities();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Množství na skladě
--
-- inventory_products vyžadovalo jen can_edit_inventory, takže samostatný
-- přepínač pro úpravu množství nic nedělal.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.enforce_inventory_capabilities()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    return new;
  end if;

  if new.stock is distinct from old.stock
     and not public.has_capability(new.service_id, uid, 'can_adjust_inventory_quantity') then
    raise exception 'Nemáte oprávnění měnit množství na skladě' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_inventory_capabilities on public.inventory_products;
create trigger trg_enforce_inventory_capabilities
  before update on public.inventory_products
  for each row execute function public.enforce_inventory_capabilities();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Statusy zakázek
--
-- RLS pouštělo jen owner/admin, přepínač „Statusy zakázek v nastavení“ tedy
-- členovi nikdy nic nedal. has_capability vrací pro owner/admin true, takže
-- pro ně se nic nemění.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists service_statuses_insert_by_owner_admin on public.service_statuses;
drop policy if exists service_statuses_update_by_owner_admin on public.service_statuses;
drop policy if exists service_statuses_delete_by_owner_admin on public.service_statuses;

create policy service_statuses_insert_by_capability on public.service_statuses
  for insert to authenticated
  with check (public.has_capability(service_id, auth.uid(), 'can_manage_statuses'));

create policy service_statuses_update_by_capability on public.service_statuses
  for update to authenticated
  using (public.has_capability(service_id, auth.uid(), 'can_manage_statuses'))
  with check (public.has_capability(service_id, auth.uid(), 'can_manage_statuses'));

create policy service_statuses_delete_by_capability on public.service_statuses
  for delete to authenticated
  using (public.has_capability(service_id, auth.uid(), 'can_manage_statuses'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. API tokeny
--
-- Zápis byl otevřený každému členovi. Token se sice ukládá hashovaný, ale
-- vložit řádek znamená vydat si vlastní token s libovolnými scopes.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists api_tokens_write_members on public.api_tokens;

create policy api_tokens_write_owner_admin on public.api_tokens
  for all to authenticated
  using (public.is_owner_or_admin(service_id))
  with check (public.is_owner_or_admin(service_id));

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Nastavení DPH a veřejný slug
--
-- services_update_vat_members byla permisivní politika pro každého člena;
-- spojením přes OR přebíjela adminskou. Sloupcové granty sice bránily změně
-- jména a aktivity servisu, ale sazby DPH a adresu veřejného ceníku
-- mohl přenastavit kdokoli. Zůstává services_update_by_admin.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists services_update_vat_members on public.services;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Profily
--
-- USING (true) znamenalo, že přihlášený uživatel čte přezdívky a avatary
-- napříč všemi servisy. Omezeno na sebe a na lidi, se kterými sdílí servis.
-- Root owner čte týmy přes edge funkce pod service_role, ty RLS obcházejí.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists profiles_select_authenticated on public.profiles;

create policy profiles_select_shared_service on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1
      from public.service_memberships ja
      join public.service_memberships oni on oni.service_id = ja.service_id
      where ja.user_id = auth.uid()
        and oni.user_id = public.profiles.id
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Zbytečné granty pro anon
--
-- Žádná politika anonymnímu přístupu neprojde (podmínky stojí na auth.uid()),
-- takže to dnes nic neotevírá. Je to ale nastražená past: první politika bez
-- kontroly uživatele by rovnou pustila i přejmenování a deaktivaci servisu.
-- ─────────────────────────────────────────────────────────────────────────────
revoke update on public.services from anon;
revoke update on public.tickets from anon;
revoke insert, update, delete on public.api_tokens from anon;
