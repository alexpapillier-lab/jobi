-- Připojení fotky k zakázce jedním atomickým zápisem.
--
-- Edge funkce `capture-upload` a `capture-claim-draft` fotku připojovaly tak,
-- že načetly pole, přidaly do něj URL a celé pole přepsaly. Když technik
-- vybere na telefonu víc fotek najednou, běží ty požadavky souběžně a
-- poslední zápis vyhraje – ostatní fotky z pole zmizí. Soubor v úložišti
-- zůstane, ale zakázka o něm neví.
--
-- Funkci volá jen server (edge funkce pod service_role), proto ji z klienta
-- nikdo nespustí.

create or replace function public.pridej_fotku_zakazky(
  p_ticket_id uuid,
  p_url text,
  p_pred boolean default false
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.tickets
     set diagnostic_photos_before = case when p_pred
           then coalesce(diagnostic_photos_before, '[]'::jsonb) || to_jsonb(p_url)
           else diagnostic_photos_before end,
         diagnostic_photos = case when p_pred
           then diagnostic_photos
           else coalesce(diagnostic_photos, '[]'::jsonb) || to_jsonb(p_url) end
   where id = p_ticket_id;
$$;

revoke all on function public.pridej_fotku_zakazky(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.pridej_fotku_zakazky(uuid, text, boolean) to service_role;
