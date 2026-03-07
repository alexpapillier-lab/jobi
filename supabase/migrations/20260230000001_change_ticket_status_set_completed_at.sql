-- Upravit change_ticket_status RPC: při přepnutí na finální status nastavit completed_at

CREATE OR REPLACE FUNCTION public.change_ticket_status(
  p_ticket_id UUID,
  p_next TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket_service_id UUID;
  v_ticket_status TEXT;
  v_ticket_deleted_at TIMESTAMPTZ;
  v_user_role TEXT;
  v_user_id UUID;
  v_is_final BOOLEAN;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT service_id, status, deleted_at
  INTO v_ticket_service_id, v_ticket_status, v_ticket_deleted_at
  FROM public.tickets
  WHERE id = p_ticket_id;

  IF v_ticket_service_id IS NULL THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;

  IF v_ticket_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot change status of deleted ticket';
  END IF;

  SELECT role INTO v_user_role
  FROM public.service_memberships
  WHERE service_id = v_ticket_service_id
    AND user_id = v_user_id;

  IF v_user_role IS NULL THEN
    RAISE EXCEPTION 'Not authorized: User is not a member of this service';
  END IF;

  IF v_user_role IN ('owner', 'admin') THEN
    NULL; -- proceed
  ELSIF v_user_role = 'member' THEN
    IF NOT public.has_capability(v_ticket_service_id, v_user_id, 'can_change_ticket_status') THEN
      RAISE EXCEPTION 'Not authorized: Member does not have can_change_ticket_status capability';
    END IF;
  ELSE
    RAISE EXCEPTION 'Not authorized: Invalid role';
  END IF;

  SELECT COALESCE(is_final, false) INTO v_is_final
  FROM public.service_statuses
  WHERE service_id = v_ticket_service_id AND key = p_next
  LIMIT 1;

  IF v_is_final THEN
    UPDATE public.tickets
    SET status = p_next, completed_at = now()
    WHERE id = p_ticket_id AND service_id = v_ticket_service_id;
  ELSE
    UPDATE public.tickets
    SET status = p_next
    WHERE id = p_ticket_id AND service_id = v_ticket_service_id;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found or update failed';
  END IF;
END;
$$;
