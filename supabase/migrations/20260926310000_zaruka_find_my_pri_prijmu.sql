-- ============================================================================
-- Záruka a Find My při příjmu zařízení (roadmapa bod 8)
-- ============================================================================
--
-- PROČ: Při příjmu servis potřebuje hned vědět, jestli jde o záruční
-- opravu (a mít k ní datum nákupu nebo doklad, jinak ji nelze uplatnit)
-- a u zařízení Apple, jestli zákazník vypnul Find My – s aktivačním
-- zámkem se telefon u autorizovaných dílů neopraví. Dosud se to psalo do
-- poznámky a technik to hledal až u stolu.
--
-- Sloupce jsou nullable: starší zakázky nic neuvádí a u ne-Apple zařízení
-- se na Find My neptáme (null = neuvedeno, false = NEVYPNUTO).
-- ============================================================================

alter table public.tickets
  add column if not exists warranty_claim boolean,
  add column if not exists purchase_date date,
  add column if not exists purchase_proof text,
  add column if not exists find_my_off boolean;

comment on column public.tickets.warranty_claim is 'Záruční oprava (true) / pozáruční (false); null = neuvedeno';
comment on column public.tickets.purchase_date is 'Datum nákupu zařízení – podklad záruky';
comment on column public.tickets.purchase_proof is 'Doklad o koupi (číslo účtenky, faktura, kde ho zákazník má)';
comment on column public.tickets.find_my_off is 'Apple: Find My vypnuto při příjmu (true) / nevypnuto (false); null = neuvedeno / netýká se';
