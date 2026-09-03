-- Webhook při změně ceníku nebo skladu.
--
-- Statický web (Cloudflare Pages) se sám nedozví, že servis zdražil.
-- Servis si sem zadá adresu, na kterou po úpravě pingneme, a build se
-- spustí sám. Typicky je to „deploy hook“ z Cloudflare Pages nebo Vercelu.
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS public_webhook_url text,
  ADD COLUMN IF NOT EXISTS public_webhook_last_at timestamptz,
  ADD COLUMN IF NOT EXISTS public_webhook_last_status integer;

COMMENT ON COLUMN public.services.public_webhook_url IS
  'Adresa, na kterou se pošle POST po změně veřejného ceníku nebo skladu. Jen https.';

-- Adresu si nastavuje servis sám, stejně jako slug a DPH. Výsledek
-- posledního pokusu zapisuje jen edge funkce (service_role), aby si ho
-- klient nemohl přepsat na „všechno v pořádku“.
GRANT UPDATE (public_webhook_url) ON public.services TO authenticated;
