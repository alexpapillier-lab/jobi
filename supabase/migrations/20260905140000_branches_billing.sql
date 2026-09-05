-- Pobočka může být samostatný subjekt: vlastní IČO, DIČ a bankovní účet.
--
-- Servis s víc provozovnami často vede každou pod jinou firmou (s.r.o.
-- vs. OSVČ, franšíza). Dokumenty, portál (QR platba) a faktury pak musí
-- nést údaje pobočky, ne firmy. Prázdné = bere se z firemních údajů.
alter table public.branches
  add column if not exists ico text,
  add column if not exists dic text,
  add column if not exists bank_account text,
  add column if not exists iban text,
  add column if not exists company_name text;

comment on column public.branches.company_name is 'Název subjektu pobočky na dokumentech (prázdné = název firmy).';
