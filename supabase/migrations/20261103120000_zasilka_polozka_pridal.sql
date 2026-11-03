-- Zásilky: kdo přidal zakázku do zásilky
-- ============================================================================
--
-- Položka zásilky nově nese added_by (kdo ji vložil). Plní se výchozí hodnotou
-- auth.uid() při vložení, klient nic navíc neposílá. Starší položky autora
-- nemají a zůstávají bez něj (nikdo ho zpětně neuhodne).

alter table public.ticket_shipment_items
  add column if not exists added_by uuid default auth.uid() references auth.users(id) on delete set null;
