-- Provize: je vyúčtování už vyplacené?
--
-- Vyúčtování říká, kolik provize za období vzniklo; jestli už peníze přišly,
-- nebylo kde poznamenat. NULL = čeká na vyplacení.
alter table public.provize_vyuctovani add column if not exists vyplaceno_at timestamptz;

comment on column public.provize_vyuctovani.vyplaceno_at is
  'Kdy bylo vyúčtování označené jako vyplacené. NULL = ještě ne.';
