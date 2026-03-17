-- Funkce pro e-mail pozvánky: zjistí, zda pozvaný e-mail už má členství v nějakém servisu.
-- Edge Function invite-create/invite_create podle toho změní text v mailu (registrace vs. Nastavení – Můj profil).
CREATE OR REPLACE FUNCTION public.invited_email_has_any_membership(p_email text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users u
    JOIN public.service_memberships m ON m.user_id = u.id
    WHERE u.email = lower(trim(p_email))
    LIMIT 1
  );
$$;

COMMENT ON FUNCTION public.invited_email_has_any_membership(text) IS
  'Vrací true, pokud uživatel s daným e-mailem už je členem alespoň jednoho servisu (pro text v e-mailu pozvánky).';
