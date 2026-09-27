# Obnova ze zálohy (po havárii)

Postup krok za krokem pro člověka, který zrovna přišel o databázi. Čti shora
dolů, nic nepřeskakuj. Kdo zálohu ještě nikdy nezkoušel obnovit, ať si to
nanečisto projde podle kapitoly 2 – trvá to deset minut a je to jediný způsob,
jak zjistit, že záloha není jen soubor.

Kde se zálohy berou: `.github/workflows/backup-db.yml` (denně 02:30 UTC),
šifrovaný artefakt `zaloha-db-RRRRMMDD.tar.gz.gpg`, uložený 90 dní.
Heslo k rozšifrování je secret `BACKUP_PASSPHRASE` – **bez něj je záloha
k ničemu, měj ho i mimo GitHub** (správce hesel, papír v šuplíku).

Soubory ze Storage (fotky, podpisy, obrázky produktů, přílohy chatu) jsou
jinde: `.github/workflows/backup-storage.yml` je denně zrcadlí do Cloudflare
R2, bucket `jobi-zaloha-storage` (kapitola 5, krok 2). Přístup k R2 (API
token) měj taky mimo GitHub – po havárii se bude hodit na tvém počítači.

---

## 1. Co v záloze je a co ne

**V záloze je:**

| Soubor | Obsah |
|--------|-------|
| `schema.sql` | tabulky, indexy, funkce, triggery, RLS politiky, publikace pro realtime (schéma `public`) |
| `data.sql` | data schématu `public` **a k tomu `auth` a `storage`** – tedy i uživatelé (`auth.users` včetně otisků hesel), relace a evidence souborů |
| `roles.sql` | nastavení rolí (timeouty), ne hesla |
| `storage-soubory.csv` | seznam souborů ve Storage – jen seznam, ne obsah |
| `cron-ulohy.sql` | naplánované úlohy pg_cron, připravené ke spuštění |
| `migrace.csv` | historie migrací (`supabase_migrations.schema_migrations`) |
| `vault-nazvy.txt` | názvy tajemství ve Vaultu, **bez hodnot** |

**V záloze NENÍ a po havárii se to musí udělat ručně** (kapitola 5):

* **soubory ve Storage** – fotky z diagnostiky, podpisy, obrázky produktů,
  přílohy chatu. Zálohují se zvlášť, denně, do Cloudflare R2
  (`backup-storage.yml`, obnova `scripts/obnov-storage.sh`, kapitola 5).
  Smazané a přepsané soubory se tam drží ještě 30 dní.
  (Týdenní artefakt `zaloha-storage-*` z `backup-db.yml` od zavedení
  neveřejného bucketu `chat-prilohy` nevzniká – krok padá, viz
  docs/ZALOHY_DATABAZE.md kap. 6.)
* **hodnoty tajemství ve Vaultu** (`alerts_cron_secret`, `automations_cron_secret`)
* **tajemství edge funkcí** – `RESEND_API_KEY`, `TWILIO_*`,
  `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWKS`, … (`supabase secrets list`)
* **nastavení Auth** – poskytovatelé přihlášení, SMTP, adresy pro přesměrování,
  JWT secret. Nový projekt = nový JWT secret a nové API klíče.
* **nasazené edge funkce** – kód je v gitu (`supabase/functions`), nasazení ne.
* **nastavení projektu** – region, plán, vlastní doména, síťová omezení.

> **Záloha je stejně citlivá jako celá databáze.** V `data.sql` jsou otisky
> hesel z `auth.users`, telefonní čísla i celá historie zakázek. Proto je
> artefakt šifrovaný GPG a proto se rozbalená záloha nenechává ležet na disku.

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

### Co je ověřené (7. 9. 2026)

* **Skript projde do zelena.** Obnova databáze postavené ze všech 146 migrací
  do prázdného Postgresu 17: 0 chyb ve schématu, 0 chyb v datech, počty řádků
  sedí ve všech 61 tabulkách, 338 RLS politik, 94 funkcí, 52 triggerů,
  25 tabulek v realtime publikaci. Kouřová zkouška (RLS, triggery, optimistické
  zamykání) prošla. Čísla sedí s ostrou databází – ta má dnes taky 338 politik
  a 25 tabulek v realtime.
* **Nad skutečnou zálohou ostré databáze taky.** 7. 9. 2026 se udělal dump
  ostré databáze (`supabase db dump`, jen čtení) a obnovil se novým skriptem
  do prázdného lokálního Postgresu: 0 chyb v datech, počty řádků sedí ve všech
  61 tabulkách, 320 RLS politik, 89 funkcí, 50 triggerů, 25 tabulek v realtime,
  **31 uživatelů a 183 záznamů o souborech** (ta čísla jsou nižší než u obnovy
  z migrací výš proto, že ostrá databáze má nasazeno 142 migrací ze 146).
  Kouřová zkouška prošla. Ověřilo se i to, že skript nemlčí: do `data.sql` se
  vložil vadný řádek a obnova skončila chybou.
* **Zálohu z artefaktu GitHubu obnovit nezkoušel nikdo** – potřebuje heslo
  `BACKUP_PASSPHRASE`, které má jen majitel. Až ho budeš mít po ruce, projdi
  kapitolu 2; obsah artefaktu je stejný jako obsah dumpu výš.
  **Nezaměňuj zelený běh workflow za ověřenou zálohu:** běhy z 5. a
  6. 9. byly zelené, ale zkouška obnovy v nich chyby jen vypisovala – v logu
  jich je přes dvě stě (`function auth.uid() does not exist`,
  `publication "supabase_realtime" does not exist`, chybějící tabulky `auth`
  a `storage`). Teprve tahle verze skriptu obnovu **zastaví**, když se schéma
  nebo data nenahrají čistě, a chybějící prostředí Supabase (role, `auth`,
  `storage`, publikace) si nejdřív doplní z `supabase/bootstrap-test.sql`.
  První ostrý běh nové verze je až ten po nasazení – u něj se koukni, že krok
  „Zkouška obnovy do čistého Postgresu" doběhl bez `CHYBA:`.

### Co zkouška obnovy neověří

Projde i nad zálohou, ze které servis po havárii nerozjedeš. Chybí v ní totiž
věci, které v databázi vůbec nejsou (kapitola 1 a 5):

* **soubory ve Storage** – 27. 9. 2026 545 souborů, 101 MB; v `data.sql` je
  jen jejich evidence (`storage.objects`), obsah je v R2 (kapitola 5),
* **hodnoty tajemství** – Vault (dnes 2) i tajemství edge funkcí,
* **naplánované úlohy** – `cron.job` (dnes 4) je v `cron-ulohy.sql`, ale spustit
  se musí ručně, po obnově se samo nerozjede nic,
* **nastavení Auth a klíče projektu** – uživatelé (dnes 32) i otisky hesel
  v záloze jsou, ale bez zapnutého přihlášení, SMTP a nových API klíčů se
  do aplikace nikdo nepřihlásí.

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

1. **Buckety Storage.** Obnova `data.sql` (kapitola 3) vrátí i řádky
   `storage.buckets` a `storage.objects` – buckety tedy v novém projektu už
   jsou, i s nastavením veřejnosti a limity. Kdyby ne, založí je skript
   z kroku 2 podle `metadata/buckety.json` v záloze (proměnná `CIL_DB_URL`).
   **Obsah souborů ale v databázi není** – aplikace ukáže u zakázek rozbité
   fotky, dokud neproběhne krok 2.
2. **Soubory ve Storage** – z Cloudflare R2 skriptem `scripts/obnov-storage.sh`
   (potřebuje `rclone`: `brew install rclone`; podrobnosti o záloze
   v docs/ZALOHY_DATABAZE.md kap. 7).

   V novém projektu nejdřív vygeneruj S3 klíč: Dashboard → Storage → Settings
   → *Enable connection via S3 protocol* → Access keys → New access key.
   Proměnné cíle mají schválně jiné názvy než u zálohy (`CIL_…`), ať se
   obnova nepustí omylem proti produkci.

1. **Rozšíření a bucket(y) Storage.** V novém projektu vytvoř buckety
   `diagnostic-photos` a `product-images` (viz `docs/JOBIDOCS_STORAGE_BUCKET.md`)
   se stejným nastavením veřejnosti a limitem velikosti.
   **Politiky nad `storage.objects` v záloze nejsou** (`schema.sql` bere jen
   schéma `public`) – bez nich nejde nahrát ani zobrazit fotku. Vrátí je
   příkazy `create policy … on storage.objects` z migrací
   (`grep -li 'policy.*on storage.objects' supabase/migrations/*.sql`),
   poslední verze každé politiky. Viz i docs/STAGING.md, kapitola Politiky Storage.
2. **Soubory ve Storage.** Rozbal poslední artefakt `zaloha-storage-*` a nahraj
   soubory zpět, cesty musí sedět na `storage-soubory.csv`:
   ```bash
   export R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=…
   export CIL_SUPABASE_URL="https://[NOVY_REF].supabase.co"
   export CIL_S3_ACCESS_KEY=… CIL_S3_SECRET_KEY=…
   export CIL_DB_URL="$NOVA_DB_URL"        # volitelně: doplní chybějící buckety

   bash scripts/obnov-storage.sh --nanecisto    # co by se nahrálo
   bash scripts/obnov-storage.sh                # nahraje poslední stav, zeptá se na ref projektu
   ```

   Skript nahraje obsah `aktualni/` ze zálohy do stejnojmenných bucketů
   a pak ho **porovná stažením** z obou stran (`rclone check --download`).
   Porovnání jen velikostí by nestačilo: po obnově `data.sql` S3 výpis
   nového projektu vrací soubory z evidence v databázi, i když jejich obsah
   chybí. Ze stejného důvodu se ve výchozím stavu **přepisuje** všechno –
   `--jen-chybejici` by tu nenahrálo nic.

   Region nového projektu, pokud není `eu-west-1`: `export CIL_S3_REGION=…`.

   **Obnova k určitému dni** (třeba když se zjistí, že před týdnem někdo
   přepsal nebo smazal soubory a denní záloha to mezitím zrcadlila):

   ```bash
   bash scripts/obnov-storage.sh --stav 2026-09-20
   ```

   Složí stav ke konci toho dne (UTC): zrcadlo bez souborů nahraných
   později, doplněné o verze, které se ve dnech po něm smazaly nebo
   přepsaly (`smazane/<den>/`). Jde nejvýš 30 dní zpátky – starší koš
   R2 samo maže. Skládá se v dočasné složce na tvém disku, pak se nahraje.

   Řádky ve `storage.objects`, ke kterým soubor v záloze není, jsou fotky
   pořízené po poslední záloze souborů (nejvýš den) – ty jsou pryč.

**Bez havárie – někdo smazal fotky v ostrém projektu.** Smazané soubory
jsou v koši zálohy pod dnem, kdy je noční záloha přestala vidět (den po
smazání, pokud se mazalo po záloze):

```bash
rclone lsf -R "r2:jobi-zaloha-storage/smazane/2026-09-27/diagnostic-photos"   # co v koši je
export CIL_SUPABASE_URL="https://ijtvcgolsdsrquqbvjrz.supabase.co" CIL_S3_ACCESS_KEY=… CIL_S3_SECRET_KEY=…
bash scripts/obnov-storage.sh --kos 2026-09-27 --bucket diagnostic-photos --nanecisto
bash scripts/obnov-storage.sh --kos 2026-09-27 --bucket diagnostic-photos
```

U `--kos` se existující soubory nepřepisují (výchozí `--jen-chybejici`),
takže se vrátí jen to, co v produkci chybí. Soubor se nahraje na původní
cestu, takže odkaz uložený v zakázce zase funguje. (`rclone lsf` potřebuje
remote `r2` – buď proměnné `RCLONE_CONFIG_R2_*` jako v
`scripts/zaloha-storage-spolecne.sh`, nebo `rclone config`.)
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
   že proběhla i zkouška obnovy. Pro zálohu souborů přepiš i
   `SUPABASE_S3_ACCESS_KEY`, `SUPABASE_S3_SECRET_KEY` (klíč nového projektu)
   a případně `SUPABASE_S3_ENDPOINT`, pak `Actions → Záloha souborů (Storage)`
   nejdřív s *nanecisto*. Starý obsah `aktualni/` v R2 se tím neztratí: co
   v novém projektu chybí, odejde do `smazane/<datum>/` a drží se 30 dní –
   proto záloha souborů smí běžet až **po** kroku 2 z kapitoly 5.

---

## 6. Kontrolní seznam po obnově

- [ ] `npm run test:obnova -- <záloha>` prošel ještě před sypáním do ostra
- [ ] počty zakázek, zákazníků a uživatelů sedí
- [ ] přihlášení do aplikace funguje (majitel i technik)
- [ ] zakázky se v seznamu aktualizují samy (realtime publikace)
- [ ] fotky u zakázek se zobrazují (Storage)
- [ ] `select jobname, active from cron.job` vrací čtyři úlohy
- [ ] přijde e-mail (pozvánka do servisu) a SMS
- [ ] `scripts/obnov-storage.sh` doběhl bez chyby včetně porovnání (`rclone check`)
- [ ] denní záloha nového projektu proběhla a zkouška obnovy v ní prošla
- [ ] záloha souborů (`backup-storage.yml`) proběhla proti novému projektu a ověření sedí

---

## 7. Co se nevrátí

Buď na to připravený a řekni to majiteli dřív, než se zeptá:

* **Data od poslední noční zálohy** – až 24 hodin práce (bez PITR).
* **Fotky od poslední zálohy souborů** – až 24 hodin (záloha do R2 běží
  denně). Dokud nejsou nastavené její secrets (docs/ZALOHY_DATABAZE.md
  kap. 7), **žádná použitelná záloha souborů není**.
* **Relace přihlášených uživatelů** – všichni se budou muset přihlásit znovu.
* **Hodnoty tajemství** – Vault i edge funkce, nastavují se nová.
