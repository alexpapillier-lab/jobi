-- Rezervace: předpokládaná délka opravy podle ceníku (minuty).
-- Formulář ji ukáže zákazníkovi („trvá cca 1 hodinu“), v Jobi jde do
-- předpokládaného dokončení zakázky založené z rezervace.
alter table public.bookings add column if not exists duration_min integer;
comment on column public.bookings.duration_min is 'Odhad délky opravy v minutách z ceníku (repairs.estimated_time) v době rezervace.';
