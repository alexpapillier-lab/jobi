-- Automatizace „přepnout zakázku do stavu“ nikdy neproběhla.
--
-- Edge funkce automations-run mění stav pod `service_role`, takže
-- `auth.uid()` je NULL. Trigger enforce_ticket_status_change_permissions
-- si NULL vyložil jako „volající není členem servisu“ a zápis shodil
-- výjimkou. Akce `set_status` proto v každém servisu skončila řádkem
-- `error` v automation_runs s hláškou „Not authorized: not a service
-- member“ – ověřeno na E2E servisu 6. 9. 2026.
--
-- Sousední triggery na téže tabulce (enforce_ticket_capabilities,
-- enforce_ticket_basic_update_permissions) NULL už roky pouštějí právě
-- s odůvodněním „bez přihlášeného uživatele jde o volání ze service_role
-- (edge funkce, migrace, obsluha webhooků)“. Tenhle jediný to nedělal –
-- šlo o opomenutí, ne o záměr.
--
-- Bezpečnost tím netrpí: `anon` má také `auth.uid() IS NULL`, ale k UPDATE
-- na tickets se nedostane, RLS ho odmítne dřív, než trigger vůbec vznikne
-- (politika tickets_update vyžaduje členství podle auth.uid()). Sem se
-- dostane jen service_role, tedy náš vlastní server.
CREATE OR REPLACE FUNCTION public.enforce_ticket_status_change_permissions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
BEGIN
  -- Bez přihlášeného uživatele jde o volání ze service_role (edge funkce
  -- automations-run, obsluha webhooků, migrace). Stejné pravidlo jako
  -- v enforce_ticket_capabilities.
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    SELECT sm.role INTO v_role
    FROM public.service_memberships sm
    WHERE sm.service_id = NEW.service_id
      AND sm.user_id = v_uid
    LIMIT 1;

    IF v_role IS NULL THEN
      RAISE EXCEPTION 'Not authorized: not a service member';
    END IF;

    IF v_role IN ('owner', 'admin')
       OR public.has_capability(NEW.service_id, v_uid, 'can_change_ticket_status')
    THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Not authorized: missing can_change_ticket_status';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_ticket_status_change_permissions() IS
  'Kdo smí měnit stav zakázky. auth.uid() NULL = server (service_role) – ten smí, jinak by nefungovaly automatizace se set_status.';
