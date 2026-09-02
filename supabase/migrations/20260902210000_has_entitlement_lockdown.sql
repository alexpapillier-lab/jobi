-- Omezení přístupu k has_entitlement().
--
-- Funkce je SECURITY DEFINER, takže ve výchozím nastavení ji mohl volat
-- kdokoli s anon klíčem – a ten je vestavěný v každé instalaci aplikace
-- i ve veřejné capture stránce. Šlo tedy zvenčí zjišťovat, který servis
-- má jaký modul zaplacený. Není to únik osobních údajů, ale je to
-- informace o zákaznících, která ven nepatří.
--
-- Funkci potřebují jen edge funkce, které běží pod service_role.
-- Klientský hook useEntitlements čte tabulku přímo přes RLS, tuhle
-- funkci nevolá.

REVOKE ALL ON FUNCTION public.has_entitlement(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_entitlement(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.has_entitlement(uuid, text) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.has_entitlement(uuid, text) TO service_role;

COMMENT ON FUNCTION public.has_entitlement(uuid, text) IS
  'Má servis platný nárok na modul? Volat jen ze serveru (service_role) – anon a authenticated nemají EXECUTE.';
