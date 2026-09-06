-- Způsob platby u zaplacené faktury – pro denní uzávěrku (kolik přišlo
-- hotově, kartou a převodem). Vyplňuje se při označení Zaplaceno.
alter table public.invoices
  add column if not exists payment_method text
    constraint invoices_payment_method_check check (payment_method in ('cash', 'card', 'transfer', 'other'));
comment on column public.invoices.payment_method is 'cash = hotově, card = kartou, transfer = převodem, other = jinak. Null u nezaplacených a u starších faktur.';
