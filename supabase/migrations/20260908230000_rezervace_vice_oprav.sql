-- Rezervace: víc oprav najednou.
--
-- Zákazník si často nese dvě věci naráz (displej i baterie). Dosud šla
-- vybrat jedna oprava; teď se ukládají všechny vybrané, cena a délka jsou
-- jejich součty. `repair_id` zůstává (první vybraná) kvůli starším datům
-- a jednoduchým integracím.
alter table public.bookings add column if not exists repair_ids jsonb;
comment on column public.bookings.repair_ids is 'Id oprav z ceníku vybraných v rezervaci (pole). price_estimate a duration_min jsou jejich součty.';
