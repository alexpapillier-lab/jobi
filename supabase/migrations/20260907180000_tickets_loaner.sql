-- Půjčení náhradního zařízení k zakázce.
--
-- Servis půjčí zákazníkovi na dobu opravy náhradní telefon nebo notebook.
-- Co, s čím, za jakou kauci a kdy se vrátilo se drží u zakázky; k tomu se
-- tiskne smlouva o zápůjčce (nový typ dokumentu smlouva_zapujcka v JobiDocs).
-- Tvar: {nazev, seriove?, prislusenstvi?, kauce?, pujceno (datum), vraceno?, poznamka?}.
alter table public.tickets add column if not exists loaner jsonb;
comment on column public.tickets.loaner is
  'Náhradní zařízení půjčené zákazníkovi: název, sériové číslo, příslušenství, kauce, datum půjčení a vrácení. Null = nic nepůjčeno.';
