# Klíče a hesla: kde leží, kdo je vidí, jak se mění

Přehled všeho, čím se Jobi někam přihlašuje. Stav k 5. 9. 2026.

Pravidlo, které platí všude: **tajemství se nikam neopisuje.** Když je někde
potřeba na dvou místech, je to chyba návrhu, ne důvod si ho poznamenat do
třetího.

## Kde co leží

### Supabase – secrets edge funkcí

Nastavují se `npx supabase secrets set JMENO=hodnota`, čte je jen běžící edge
funkce. V dashboardu ani ve výpisu `secrets list` nejsou vidět v čitelné
podobě, jen otisky.

| Secret | K čemu | Kde vzít nový |
|---|---|---|
| `RESEND_API_KEY` | odesílání e-mailů (pozvánky, faktury, hlídač, hlášení chyb) | resend.com → API Keys |
| `RESEND_FROM_EMAIL`, `RESEND_FROM_EMAIL_PASSWORD_RESET` | odesílatel | jen adresa, není tajemství |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | SMS | console.twilio.com |
| `ROOT_OWNER_ID` | kdo je root owner | id uživatele, není tajemství |
| `SUPABASE_*` | doplňuje Supabase sám | nesahat |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | platby – **zatím nenastavené** | dashboard.stripe.com |
| `ALERT_EMAIL`, `SUPPORT_EMAIL` | kam chodí upozornění a hlášení – nenastavené, platí výchozí | — |

### Supabase – Vault

Sdílená tajemství mezi pg_cron a edge funkcemi. Vytvářejí se
`select vault.create_secret('<náhodná hodnota>', '<název>')`.

| Název | K čemu |
|---|---|
| `automations_cron_secret` | pg_cron → `automations-run` |
| `alerts_cron_secret` | pg_cron → `alerts-check` |

Nikam jinam se nekopírují a nikdo je nepotřebuje znát.

### GitHub – secrets akcí

| Secret | K čemu |
|---|---|
| `SUPABASE_DB_URL` | denní záloha databáze |
| `BACKUP_PASSPHRASE` | šifrování zálohy |
| `TAURI_SIGNING_PRIVATE_KEY`, `..._PASSWORD` | podpis aktualizací aplikace |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_ROOT_OWNER_ID` | sestavení klienta, nejsou tajná |

### Na počítači

`.env` v repozitáři obsahuje jen `VITE_` proměnné, které stejně končí
v prohlížeči. Nic tajného tam není a být nemá.

Heslo k databázi, heslo k notarizaci u Apple, klíč k podepisování aktualizací
a heslo k záloze patří do správce hesel. Ne do poznámek, které se synchronizují
na všechna zařízení.

## Kdo se k čemu dostane

- **Root owner** (jeden účet) – Owner panel, moduly servisů, mazání a export dat.
- **Správce servisu** – nastavení a tým svého servisu, žádné cizí servisy,
  žádné moduly.
- **Edge funkce** – service role klíč, ale každá jen k tomu, co dělá.
- **Nikdo z aplikace** se nedostane k service role klíči ani k tokenům
  veřejného API: v databázi jsou jen otisky.

## Co dělat, když se něco prozradí

Pořadí je vždycky stejné: **vyměnit, nasadit, teprve pak řešit jak se to stalo.**

| Co uniklo | Co udělat |
|---|---|
| Heslo k databázi | Dashboard → Settings → Database → Reset. Pak přenastavit `SUPABASE_DB_URL` v GitHub secrets. Aplikace na něm neběží, nic se nerozbije. |
| `RESEND_API_KEY` | Nový klíč v Resendu, starý smazat, `supabase secrets set`. |
| Twilio token | Console → Auth Token → rotace, pak `supabase secrets set`. |
| Service role klíč | Dashboard → API keys → rotace. **Pozor:** rozbije všechny edge funkce, dokud se nepřenasadí. |
| Anon klíč | Rotace znamená vydat novou verzi aplikace, protože je v ní zabudovaný. |
| Klíč k podpisu aktualizací | Nový pár, nová veřejná část do `tauri.conf.json`, vydat verzi. Staří klienti se neaktualizují, dokud verzi nenainstalují ručně. |
| Apple heslo pro aplikace | appleid.apple.com → zrušit a vytvořit nové. |
| GitHub token | github.com/settings/tokens → revoke. |
| `BACKUP_PASSPHRASE` | Nové heslo. Starší zálohy zůstávají zašifrované tím starým, takže si ho schovat, dokud nevyprší. |
| Token veřejného API zákazníka | Nastavení → API → odvolat. |

## Co ještě není hotové

- Rotace se nikde nehlídá časem, dělá se jen při podezření.
- Není druhý člověk, který by se k tomu dostal, kdyby byl majitel nedostupný.
  U jednoho člověka to je v pořádku, u firmy s druhým zaměstnancem už ne.
