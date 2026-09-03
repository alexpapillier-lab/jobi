-- Nákupní cena u skladové položky.
--
-- Sklad měl dosud jediné pole `price`, které se v seznamu ukazuje jako
-- „Cena". Servisy si ale vedou i nákupní cenu, aby viděly marži – při
-- importu skladu iSwapu se ukázalo, že ji do aplikace neměly kam dát.
--
-- POZOR NA CITLIVOST: nákupní cena prozrazuje marži. Do veřejného API
-- se proto NEPOSÍLÁ, dokud si to servis výslovně nezapne přepínačem níž.
-- Výchozí hodnota je záměrně false.

ALTER TABLE public.inventory_products
  ADD COLUMN IF NOT EXISTS purchase_price numeric(12,2);

COMMENT ON COLUMN public.inventory_products.purchase_price IS
  'Nákupní cena. NULL = neuvedena. Do veřejného API jde jen když to servis zapne.';

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS public_inventory_show_purchase_price boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.services.public_inventory_show_purchase_price IS
  'Posílat nákupní cenu ve veřejném API skladu? Výchozí false – prozrazuje marži.';
