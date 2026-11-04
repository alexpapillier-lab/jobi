-- Provize: měsíční připomínka pevné částky
-- ============================================================================
--
-- Majitel si každý měsíc připisuje k provizím pevnou částku v cizí měně
-- (15 USD). Owner → Provize ho na to upozorní, přepočte ji kurzem ČNB na Kč
-- a jedním klepnutím ji zapíše jako řádek provizí s kódem MESICNI-RRRR-MM
-- (jde pak do dalšího vyúčtování jako ostatní). Synchronizace ze zakázek
-- řádky bez zakázky nemění. Prázdná částka = připomínka vypnutá.

alter table public.provize_nastaveni
  add column if not exists mesicni_castka numeric(12, 2) check (mesicni_castka is null or mesicni_castka > 0),
  add column if not exists mesicni_mena text not null default 'USD' check (mesicni_mena ~ '^[A-Z]{3}$');

-- iSwap Repair Point Praha: 15 USD měsíčně (zadání majitele 4. 11. 2026).
update public.provize_nastaveni
   set mesicni_castka = 15, mesicni_mena = 'USD'
 where service_id = 'd9762a27-6c8d-43c4-9207-5c837e2713a0'
   and mesicni_castka is null;
