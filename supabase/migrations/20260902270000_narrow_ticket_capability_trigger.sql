-- Zúžení triggeru z 20260902260000.
--
-- Při auditu jsem přehlédl, že na `tickets` už dva triggery na oprávnění byly:
-- enforce_ticket_basic_update_permissions (can_manage_tickets_basic) a
-- enforce_ticket_status_change_permissions (can_change_ticket_status). Můj sken
-- je nenašel kvůli chybnému regulárnímu výrazu — `has_capability\([^)]*'cap'`
-- se zarazil o závorku uvnitř vnořeného auth.uid().
--
-- Ty dvě věci tedy hlídané byly a můj trigger je hlídal podruhé. Dvě místa
-- dělající totéž jsou past pro toho, kdo bude pravidla měnit, takže zůstává
-- jen část, která opravdu chyběla: sloupec `deleted_at`. Starý trigger ho
-- nekontroluje, takže can_delete_tickets a can_manage_ticket_archive se daly
-- obejít přímým PATCH na /rest/v1/tickets mimo RPC funkce.

create or replace function public.enforce_ticket_capabilities()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  -- Bez přihlášeného uživatele jde o volání ze service_role (edge funkce,
  -- migrace, obsluha webhooků). Ty mají plný přístup záměrně.
  if uid is null then
    return new;
  end if;

  -- Stav a běžné úpravy řeší enforce_ticket_status_change_permissions
  -- a enforce_ticket_basic_update_permissions. Tady jen archivace.
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

  return new;
end;
$$;

comment on function public.enforce_ticket_capabilities() is
  'Hlídá can_delete_tickets a can_manage_ticket_archive u sloupce deleted_at. '
  'Stav a ostatní sloupce hlídají enforce_ticket_status_change_permissions '
  'a enforce_ticket_basic_update_permissions.';
