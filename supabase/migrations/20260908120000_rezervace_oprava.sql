-- Rezervace z webu: vybraná oprava z ceníku a předběžná cena.
--
-- Formulář na webu nabídne model a opravu z veřejného ceníku servisu; cena
-- se ověřuje na serveru (klientovi se nevěří), a v Jobi se z rezervace
-- založí zakázka rovnou s plánovanou opravou. Volný text zůstává možný.
alter table public.bookings
  add column if not exists repair_id uuid references public.repairs(id) on delete set null,
  add column if not exists model_name text,
  add column if not exists price_estimate numeric;
comment on column public.bookings.repair_id is 'Oprava z ceníku (repairs.id), když si ji zákazník vybral ve formuláři.';
comment on column public.bookings.price_estimate is 'Předběžná cena podle ceníku v době rezervace (Kč, tak jak ji servis uvádí v ceníku).';
