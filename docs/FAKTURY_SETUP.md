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
