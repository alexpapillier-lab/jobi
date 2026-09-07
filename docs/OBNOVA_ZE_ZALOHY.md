# Obnova ze zálohy (po havárii)

Postup krok za krokem pro člověka, který zrovna přišel o databázi. Čti shora
dolů, nic nepřeskakuj. Kdo zálohu ještě nikdy nezkoušel obnovit, ať si to
nanečisto projde podle kapitoly 2 – trvá to deset minut a je to jediný způsob,
jak zjistit, že záloha není jen soubor.

Kde se zálohy berou: `.github/workflows/backup-db.yml` (denně 02:30 UTC),
šifrovaný artefakt `zaloha-db-RRRRMMDD.tar.gz.gpg`, uložený 90 dní.
Heslo k rozšifrování je secret `BACKUP_PASSPHRASE` – **bez něj je záloha
k ničemu, měj ho i mimo GitHub** (správce hesel, papír v šuplíku).

---

## 1. Co v záloze je a co ne

**V záloze je:**

| Soubor | Obsah |
|--------|-------|
| `schema.sql` | tabulky, indexy, funkce, triggery, RLS politiky, publikace pro realtime (schéma `public`) |
| `data.sql` | data schématu `public` **a k tomu `auth` a `storage`** – tedy i uživatelé a evidence souborů |
| `roles.sql` | nastavení rolí (timeouty), ne hesla |
| `storage-soubory.csv` | seznam souborů ve Storage – jen seznam, ne obsah |
| `cron-ulohy.sql` | naplánované úlohy pg_cron, připravené ke spuštění |
| `migrace.csv` | historie migrací (`supabase_migrations.schema_migrations`) |
| `vault-nazvy.txt` | názvy tajemství ve Vaultu, **bez hodnot** |

**V záloze NENÍ a po havárii se to musí udělat ručně** (kapitola 5):

* **soubory ve Storage** – fotky z diagnostiky, podpisy, obrázky produktů.
  Zálohují se zvlášť, jednou týdně (v neděli), do artefaktu
  `zaloha-storage-RRRRMMDD.tar.gz.gpg`. Mezi nedělemi můžeš přijít o týden fotek.
* **hodnoty tajemství ve Vaultu** (`alerts_cron_secret`, `automations_cron_secret`)
* **tajemství edge funkcí** – `RESEND_API_KEY`, `TWILIO_*`,
  `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWKS`, … (`supabase secrets list`)
* **nastavení Auth** – poskytovatelé přihlášení, SMTP, adresy pro přesměrování,
  JWT secret. Nový projekt = nový JWT secret a nové API klíče.
* **nasazené edge funkce** – kód je v gitu (`supabase/functions`), nasazení ne.
* **nastavení projektu** – region, plán, vlastní doména, síťová omezení.

---

## 2. Zkouška nanečisto (dělej to i mimo havárii)

Ověří, že poslední záloha jde obnovit a že obnovená databáze funguje.
Nepotřebuje Docker ani ostrou databázi, běží celé lokálně.

```bash
# 1) stáhni poslední zálohu
gh run list --workflow backup-db.yml -L 5
gh run download <ID_BEHU> -n zaloha-db-RRRRMMDD

# 2) rozšifruj a rozbal
gpg --decrypt --output zaloha.tar.gz zaloha-RRRRMMDD.tar.gz.gpg
mkdir -p zaloha && tar -xzf zaloha.tar.gz -C zaloha

# 3) obnov do prázdného Postgresu a nech to zkontrolovat
brew install postgresql@17          # jednou, jde o server, ne jen klienta
npm run test:obnova -- zaloha
```

Skript `scripts/zkouska-obnovy.sh` postaví prázdný cluster, doplní prostředí
Supabase (role, schémata `auth` a `storage`), nahraje `roles.sql`, `schema.sql`
a `data.sql`, a pak ověří, že:

* obnova proběhla bez chyb (kromě rozšíření `pg_cron`, `pg_net`,
  `supabase_vault`, která v holém Postgresu nejsou a na Supabase je má platforma),
* v **každé** tabulce sedí počet řádků proti tomu, co je v záloze,
* jsou zpátky RLS politiky, funkce, triggery, publikace pro realtime a uživatelé,
* databáze funguje: člen servisu vidí své zakázky a cizí uživatel ne, triggery
  na verzi a `updated_at` běží, optimistické zamykání odmítne starou verzi.

Skončí `Záloha se obnovila a obnovená databáze funguje.` – jinak spadne a řekne proč.
Chceš-li se do obnovené databáze podívat, spusť to s `KEEP_CLUSTER=1`.

> Ověřeno 7. 9. 2026 nad ostrou zálohou: 61 tabulek, 320 RLS politik, 89 funkcí,
> 50 triggerů, 25 tabulek v realtime publikaci, 31 uživatelů, 183 záznamů
> o souborech. Chyby při obnově dat: 0.

---

## 3. Obnova do nového projektu Supabase

Když je ostrý projekt nedostupný nebo smazaný.

**3.1 Založ nový projekt** ve stejném regionu (eu-west-1). Poznamenej si nový
project ref a heslo k databázi.

**3.2 Nejdřív si obnovu zkus lokálně** podle kapitoly 2. Do ostrého projektu
sypej až zálohu, o které víš, že je v pořádku.

**3.3 Nahraj zálohu** (nové připojení je `postgresql://postgres.[NOVY_REF]:[HESLO]@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`):

```bash
export NOVA_DB_URL="postgresql://postgres.[NOVY_REF]:[HESLO]@...pooler.supabase.com:5432/postgres"

psql "$NOVA_DB_URL" -v ON_ERROR_STOP=0 -f zaloha/roles.sql
psql "$NOVA_DB_URL" -v ON_ERROR_STOP=0 -f zaloha/schema.sql
# session_replication_role=replica: data jdou v pořadí z dumpu, ne v pořadí
# cizích klíčů – bez vypnutých triggerů by to spadlo hned na první tabulce.
PGOPTIONS="-c session_replication_role=replica" \
  psql "$NOVA_DB_URL" -v ON_ERROR_STOP=0 -f zaloha/data.sql
```

Chyby typu `extension "pg_cron" is not available` jsou v pořádku, pokud jsou
příslušná rozšíření v novém projektu zapnutá (Dashboard → Database → Extensions:
`pg_cron`, `pg_net`, `supabase_vault`, `pg_trgm`, `btree_gist`, `pgcrypto`).
Zapni je **před** nahráním schématu.

**3.4 Zkontroluj počty** – to samé, co dělá zkouška obnovy:

```bash
psql "$NOVA_DB_URL" -c "
select
  (select count(*) from public.tickets) as zakazky,
  (select count(*) from public.customers) as zakaznici,
  (select count(*) from auth.users) as uzivatele,
  (select count(*) from pg_policies where schemaname='public') as politiky;"
```

**3.5 Historie migrací** – ať `supabase db push` nechce přehrát všechno znovu:

```bash
psql "$NOVA_DB_URL" -c "\copy supabase_migrations.schema_migrations (version, name) from 'zaloha/migrace.csv' with (format csv)"
```

---

## 4. Naplánované úlohy a Vault

Bez tohohle po obnově tiše nefungují automatizace, hlídač provozu ani noční úklid.

```bash
# tajemství pro cron (hodnoty v záloze NEJSOU – vygeneruj nové a zapiš si je)
psql "$NOVA_DB_URL" -c "select vault.create_secret('<nove-heslo>', 'alerts_cron_secret');"
psql "$NOVA_DB_URL" -c "select vault.create_secret('<nove-heslo>', 'automations_cron_secret');"

# stejné hodnoty musí dostat i edge funkce
supabase secrets set ALERTS_CRON_SECRET=<nove-heslo> AUTOMATIONS_CRON_SECRET=<nove-heslo>

# a teprve pak úlohy
psql "$NOVA_DB_URL" -f zaloha/cron-ulohy.sql
psql "$NOVA_DB_URL" -c "select jobname, schedule, active from cron.job order by jobid;"
```

Názvy tajemství, která tam byla, jsou v `zaloha/vault-nazvy.txt`.

---

## 5. Co se musí nastavit ručně

Pořadí je záměrné – bez klíčů se aplikace nepřihlásí, bez souborů jsou zakázky
bez fotek.

1. **Rozšíření a bucket(y) Storage.** V novém projektu vytvoř buckety
   `diagnostic-photos` a `product-images` (viz `docs/JOBIDOCS_STORAGE_BUCKET.md`)
   se stejným nastavením veřejnosti a limitem velikosti.
2. **Soubory ve Storage.** Rozbal poslední artefakt `zaloha-storage-*` a nahraj
   soubory zpět, cesty musí sedět na `storage-soubory.csv`:
   ```bash
   gpg --decrypt --output soubory.tar.gz zaloha-storage-RRRRMMDD.tar.gz.gpg
   tar -xzf soubory.tar.gz
   # nahrání (potřebuje service role klíč nového projektu)
   supabase storage cp -r soubory/diagnostic-photos ss://diagnostic-photos
   supabase storage cp -r soubory/product-images ss://product-images
   ```
   Řádky ve `storage-soubory.csv`, ke kterým soubor nemáš, jsou fotky pořízené
   po poslední nedělní záloze – ty jsou pryč.
3. **Edge funkce.** `supabase functions deploy` (kód je v gitu) a znovu nastavit
   všechna tajemství: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`,
   `RESEND_FROM_EMAIL_PASSWORD_RESET`, `ROOT_OWNER_ID`, `SUPABASE_ANON_KEY`,
   `SUPABASE_URL`, `SUPABASE_DB_URL`, `SUPABASE_JWKS`, `SUPABASE_PUBLISHABLE_KEYS`,
   `SUPABASE_SECRET_KEYS`, `SUPABASE_SERVICE_ROLE_KEY`, `TWILIO_ACCOUNT_SID`,
   `TWILIO_AUTH_TOKEN`. Aktuální seznam názvů: `supabase secrets list`.
4. **Auth.** Zapnout přihlášení e-mailem, nastavit SMTP (Resend), adresy pro
   přesměrování a šablony e-mailů (`docs/INVITE_EMAIL_RESEND.md`).
   Uživatelé sami se obnoví z `data.sql`, ale **hesla se obnoví jen tehdy,
   když se obnovila i tabulka `auth.users`** – ověř `select count(*) from auth.users`.
5. **Nové API klíče všude, kde jsou zadrátované.** Nový projekt má jiný ref
   i jiný anon klíč. Projdi: `.env`, secrets v GitHubu (`VITE_SUPABASE_URL`,
   `VITE_SUPABASE_ANON_KEY`, `SUPABASE_DB_URL`), `infra/cloudflare/jobi-api-worker.js`,
   `web/z/portal-config.js`, `web/_headers`, `capture/index.html` a znovu vydej
   desktopové aplikace – URL projektu se do nich zapéká při buildu.
6. **Zálohování samo.** Nastav `SUPABASE_DB_URL` na nový projekt v secrets
   repozitáře, spusť `Actions → Záloha databáze → Run workflow` a přesvědč se,
   že proběhla i zkouška obnovy.

---

## 6. Kontrolní seznam po obnově

- [ ] `npm run test:obnova -- <záloha>` prošel ještě před sypáním do ostra
- [ ] počty zakázek, zákazníků a uživatelů sedí
- [ ] přihlášení do aplikace funguje (majitel i technik)
- [ ] zakázky se v seznamu aktualizují samy (realtime publikace)
- [ ] fotky u zakázek se zobrazují (Storage)
- [ ] `select jobname, active from cron.job` vrací čtyři úlohy
- [ ] přijde e-mail (pozvánka do servisu) a SMS
- [ ] denní záloha nového projektu proběhla a zkouška obnovy v ní prošla

---

## 7. Co se nevrátí

Buď na to připravený a řekni to majiteli dřív, než se zeptá:

* **Data od poslední noční zálohy** – až 24 hodin práce (bez PITR).
* **Fotky od poslední nedělní zálohy souborů** – až 7 dní.
* **Relace přihlášených uživatelů** – všichni se budou muset přihlásit znovu.
* **Hodnoty tajemství** – Vault i edge funkce, nastavují se nová.
