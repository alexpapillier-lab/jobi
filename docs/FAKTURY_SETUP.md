# Faktury – co udělat

**Stačí jednou. Nic jiného k fakturám na DB pushovat nemusíš.**

1. **Otevři terminál a jdi do složky projektu:**
   ```bash
   cd /Volumes/backup/jobi
   ```

2. **Napoj projekt na Supabase** (když jsi to ještě nedělal):
   ```bash
   npx supabase link
   ```
   Vyber svůj projekt, případně zadej database heslo z Dashboardu.

3. **Spusť migrace** (vytvoří tabulky pro faktury):
   ```bash
   npm run db:migrate
   ```

Hotovo. Faktury v aplikaci pak půjdou ukládat a zobrazovat.

*(Odesílání e-mailem používá Edge Function `invoice-send-email` – tu nasadíš zvlášť, až budeš chtít posílat faktury mailem.)*

## Souhrnná faktura (firemní zákazníci)

Faktury → **Souhrnná faktura**: vyberete zákazníka (napovídá firmy podle názvu,
IČO i „(B2B)“ v jménu), měsíc nebo období od–do a aplikace nabídne jeho
**vydané** zakázky z toho období (koncový stav, ne storno; datum vydání =
`completed_at`, stejně jako Statistiky), které ještě nejsou na žádné
nestornované faktuře. Nabízejí se i zakázky jiných kontaktních osob se
stejným IČO. Po odškrtání se otevře obyčejný editor faktury – řádek za
zakázku („Zakázka SRV… · zařízení · opravy“, cena po slevě), nebo s volbou
„Rozepsat na jednotlivé opravy“ oprava po opravě se slevou jako záporným
řádkem. DPH jako u faktury ze zakázky (neplátce 0 %); když má servis ceny
oprav s DPH, daň se z ceny vyjme, aby faktura zněla na stejnou částku jako
zakázky. Tisk (JobiDocs, typ „faktura“), e-mail i export do iDokladu /
Fakturoidu jsou beze změny – souhrnná faktura je běžná faktura (`kind =
invoice`) s víc položkami.

Co faktura kryje, drží tabulka `invoice_tickets` (migrace
`20260927130000_souhrnna_faktura.sql`, je potřeba ji nasadit). Zakázka smí být
jen na jedné nestornované faktuře – hlídá to unikátní index, a to i proti
faktuře vystavené z detailu zakázky (trigger zrcadlí `invoices.ticket_id` do
`invoice_tickets`). Storno faktury nebo smazání konceptu zakázky uvolní.
Souhrnnou fakturu nejde duplikovat (kopie by nesla tytéž zakázky bez vazby).
Po nasazení migrace spusťte `scripts/rls-probe.sql` (sondy 1000–1005).
