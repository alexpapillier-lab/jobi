-- Druhy dokladů ve fakturaci: běžná faktura, zálohová faktura (proforma)
-- a dobropis (opravný daňový doklad).
--
-- Všechny tři žijí v jedné tabulce invoices – mají stejné hlavičky, položky,
-- stavy i tisk; liší se jen číselnou řadou (FV / ZF / DB), nadpisem na
-- dokladu a tím, jak se k nim chová účetnictví. Vazba related_invoice_id
-- drží, ke které faktuře dobropis patří, resp. kterou zálohu vyúčtovací
-- faktura odečítá.
--
-- Číslování nepotřebuje nic nového: next_invoice_number() má řady klíčované
-- (service_id, prefix, year), klient jen posílá jinou předponu.
--
-- Statistiky (statistiky_prehled) se počítají ze zakázek, ne z faktur,
-- takže proformy do tržeb nikdy nevstupovaly a dobropisy je nesnižují –
-- tam se nic nemění. Export do iDokladu se v aplikaci nabízí jen u běžných
-- faktur.

alter table public.invoices
  add column if not exists kind text not null default 'invoice'
    constraint invoices_kind_check check (kind in ('invoice', 'proforma', 'credit_note')),
  add column if not exists related_invoice_id uuid references public.invoices(id) on delete set null;

create index if not exists invoices_related_invoice_id_idx
  on public.invoices (related_invoice_id)
  where related_invoice_id is not null;

comment on column public.invoices.kind is
  'Druh dokladu: invoice = faktura (řada FV), proforma = zálohová faktura (řada ZF, bez DUZP), credit_note = dobropis (řada DB, záporné částky).';
comment on column public.invoices.related_invoice_id is
  'Související doklad: u dobropisu původní faktura, u vyúčtovací faktury zaplacená záloha. Po smazání souvisejícího dokladu zůstane NULL.';
