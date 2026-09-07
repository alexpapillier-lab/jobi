-- Platnost odkazu do zákaznického portálu.
--
-- PROČ: `portal-ticket` už o sloupci `portal_token_expires_at` ví – čte ho
-- v `TICKET_COLUMNS` a `odkazVyprsel` podle něj odkaz zavírá. V databázi ale
-- sloupec nikdy nevznikl, takže select s ním pokaždé skončil chybou a funkce
-- spadla na záložní `TICKET_COLUMNS_ZAKLAD`. Následek: každé otevření portálu
-- dělalo DVA dotazy místo jednoho a platnost odkazu byla úplně mrtvá – odkaz,
-- který zákazník dostal SMS, platil napořád. Kdo se k němu dostal (přeposlaná
-- zpráva, půjčený telefon, prodané zařízení), četl jméno, zařízení, ceny
-- i podpis převzetí i po letech.
--
-- Záložní větev v `loadTicket` se po nasazení téhle migrace přestane používat,
-- ale zůstává: nasazení funkce a migrace se nemusí trefit do stejné minuty a
-- při opačném pořadí by portál přestal vydávat cokoli.

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS portal_token_expires_at timestamptz;

COMMENT ON COLUMN public.tickets.portal_token_expires_at IS
  'Do kdy platí odkaz do zákaznického portálu. NULL = bez omezení (odkazy '
  'založené před zavedením platnosti; ty se zákazníkovi neuzavřou zpětně).';

-- Vyhledávání jde přes `portal_token` (UNIQUE), platnost se kontroluje až
-- v aplikaci nad jedním řádkem – vlastní index by tu nic nepřinesl.

-- Zápis sloupce: `enforce_ticket_basic_update_permissions` hlídá všechno mimo
-- výslovné výjimky, takže platnost smí měnit jen člen s „Úpravy zakázek“.
-- Do seznamu `c_portal` (sloupce, které smí psát JEN portál) nepatří – tenhle
-- naopak nastavuje servis a portál ho pouze čte.
