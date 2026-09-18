-- Provize: e-mail se souhrnem po vyúčtování
--
-- Apps Script nad tabulkou posílal po „Vyúčtovat aktuální týden“ e-mail se
-- součty. V Jobi ho posílá edge funkce provize-mail; adresa je tady. Prázdná =
-- přihlašovací e-mail majitele aplikace, který vyúčtování spustil.
alter table public.provize_nastaveni add column if not exists email text;

comment on column public.provize_nastaveni.email is
  'Kam poslat souhrn po vyúčtování (provize-mail). NULL = e-mail účtu, který vyúčtoval.';
