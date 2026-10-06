# Zálohy databáze (Supabase)

Jak zálohovat a obnovit databázi projektu Jobi.

---

## Co Supabase nabízí podle plánu

| Plán | Automatické zálohy | Poznámka |
|------|--------------------|----------|
| **Free** | ❌ žádné | Záloha jen ručně (CLI nebo pg_dump). |
| **Pro** | ✅ denní (logical) | Posledních 7 dní v Dashboardu → Database → Backups. Lze obnovit na konkrétní den. |
| **Team** | ✅ denní | 14 dní. |
| **Enterprise** | ✅ denní | 30 dní. |
| **PITR** (add-on, Pro+) | ✅ průběžné | Point-in-Time Recovery – obnova na libovolný okamžik (až sekundy). Placený add-on. |

**Důležité:** Zálohy databáze **neobsahují** soubory ve Storage (jen metadata). Smazané soubory z Storage se obnovením zálohy nevrátí. Soubory zálohuje zvlášť `.github/workflows/backup-storage.yml` do Cloudflare R2 – kapitola 7.

---

## 1. Ruční záloha (funguje na všech plánech)

Použij **Supabase CLI** a connection string k databázi. Vhodné před migrací nebo jako pravidelné „vlastní“ zálohy (např. do úložiště).

### Kde vzít connection string a heslo

1. **Dashboard** → tvůj projekt → **Connect** (nebo **Project Settings → Database**).
2. **Database password:** Pokud ho neznáš, v **Database Settings** ho resetuj a zapiš si ho.
3. **Connection string:**  
   - **Session pooler:** `postgresql://postgres.[PROJECT-REF]:[YOUR-PASSWORD]@aws-0-REGION.pooler.supabase.com:5432/postgres`  
   - **Direct:** `postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres`  
   (PROJECT-REF najdeš v URL projektu v Dashboardu.)

### Příkazy pro zálohu (CLI)

V terminálu (nahraď `[CONNECTION_STRING]` celým connection stringem včetně hesla):

```bash
cd /Volumes/backup/jobi

# Role (práva, uživatelé)
supabase db dump --db-url "[CONNECTION_STRING]" -f backup/roles.sql --role-only

# Schéma (tabulky, funkce, RLS, triggery…)
supabase db dump --db-url "[CONNECTION_STRING]" -f backup/schema.sql

# Data (obsah tabulek)
supabase db dump --db-url "[CONNECTION_STRING]" -f backup/data.sql --use-copy --data-only
```

Doporučení: vytvoř složku `backup/` (a přidej ji do `.gitignore`, aby se zálohy s heslem necommitovaly). Případně ukládej zálohy mimo repo (externí disk, cloud).

### Jednoduchá „vše v jednom“ záloha (jen data + schéma)

Pokud ti stačí obnova do čistého projektu s migracemi a nepotřebuješ zachovat role z dumpu:

```bash
supabase db dump --db-url "[CONNECTION_STRING]" -f backup/full-schema.sql
supabase db dump --db-url "[CONNECTION_STRING]" -f backup/full-data.sql --use-copy --data-only
```

Obnova pak: nejdřív migrace (nebo `schema.sql`), pak `data.sql` s `session_replication_role = replica`.

---

## 2. Automatické denní zálohy (Pro plán a výše)

- V **Dashboardu** → **Database** → **Backups** (nebo **Scheduled backups**).
- Zde vidíš seznam denních záloh a můžeš **stáhnout** zálohu (pokud je typ „logical“) nebo **obnovit** projekt na vybraný den.
- Obnova probíhá přes Dashboard; projekt je po dobu obnovy nedostupný.

Pro Free plán automatické zálohy **nejsou** – musíš používat ruční dump (viz výše).

---

## 3. Pravidelná ruční záloha (skript / cron)

Můžeš si naplánovat vlastní zálohy (např. týdně) a ukládat je mimo repo:

1. Ulož connection string do env (ne do gitu), např. v `.env.backup` (a přidej do `.gitignore`):
   ```bash
   # .env.backup (necommituj)
   SUPABASE_DB_URL="postgresql://postgres.[REF]:[PASSWORD]@..."
   ```
2. Skript (příklad), který můžeš spouštět ručně nebo z cronu:
   ```bash
   # scripts/backup-db.sh
   set -e
   source .env.backup  # nebo export SUPABASE_DB_URL=...
   BACKUP_DIR="$HOME/backups/jobi"
   mkdir -p "$BACKUP_DIR"
   DATE=$(date +%Y%m%d-%H%M)
   supabase db dump --db-url "$SUPABASE_DB_URL" -f "$BACKUP_DIR/schema-$DATE.sql"
   supabase db dump --db-url "$SUPABASE_DB_URL" -f "$BACKUP_DIR/data-$DATE.sql" --use-copy --data-only
   ```
3. Zálohy z `BACKUP_DIR` můžeš kopírovat na externí disk nebo do cloudu.

---

## 4. Obnova z ruční zálohy

- **Do nového Supabase projektu:** Vytvoř nový projekt, vezmi jeho connection string a heslo, pak (po přípravě prázdného DB – migrace nebo restore schema) načti data:
  ```bash
  psql "[NEW_CONNECTION_STRING]" --single-transaction -v ON_ERROR_STOP=1 -f backup/schema.sql
  psql "[NEW_CONNECTION_STRING]" -c "SET session_replication_role = replica" -f backup/data.sql
  ```
- Detailní postup včetně rolí a migrací: [Supabase – Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

---

## 5. Doporučení pro Jobi

- **Free plán:** Před většími změnami (migrace, hromadné mazání) spusť ruční dump (schema + data) a ulož ho mimo repo. Skript: `scripts/backup-db.sh` (potřebuje `SUPABASE_DB_URL`).
- **Pro plán:** Automatické denní zálohy v Dashboardu (Database → Backups). K tomu můžeš před rizikovou operací udělat navíc ruční dump (viz výše).
- **Storage:** Zálohy DB neobsahují soubory ve Storage – ty se zálohují zvlášť do Cloudflare R2, viz kapitola 7.

Plán: na Free používat ruční zálohy podle potřeby; po přechodu na Pro ($25/měsíc) spoléhat na vestavěné denní zálohy.

---

## 6. Automatická denní záloha (GitHub Actions)

Od 5. 9. 2026 běží `.github/workflows/backup-db.yml`: každý den ve 2:30 UTC
udělá dump, ověří ho obnovou do prázdného Postgresu a uloží zašifrovaný
artefakt na 90 dní. Jde spustit i ručně (Actions → Záloha databáze → Run workflow).

**Obnova po havárii má vlastní postup krok za krokem:
[docs/OBNOVA_ZE_ZALOHY.md](OBNOVA_ZE_ZALOHY.md).** Tady je jen popis, co
zálohování dělá.

### Co se musí jednou nastavit

V repozitáři **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Hodnota |
|--------|---------|
| `SUPABASE_DB_URL` | connection string i s heslem (session pooler, port 5432) – viz kapitola 1 |
| `BACKUP_PASSPHRASE` | heslo k šifrování zálohy; **ulož si ho zvlášť, i mimo GitHub**, bez něj je záloha k ničemu |

Dokud secrets nejsou, workflow se ukončí hláškou, která to řekne. Nic
nezkouší naslepo.

### Co záloha obsahuje

`roles.sql`, `schema.sql`, `data.sql` (data schémat `public`, `auth`
i `storage` – tedy včetně uživatelů), `storage-soubory.csv` (seznam souborů
v úložišti), `cron-ulohy.sql` (naplánované úlohy pg_cron), `migrace.csv`
(historie migrací), `vault-nazvy.txt` (názvy tajemství, nikdy hodnoty)
a `CO_CHYBI.md`. Všechno zabalené do `zaloha-RRRRMMDD.tar.gz.gpg`,
symetricky šifrované AES-256.

**Soubory ve Storage** (fotky z příjmu, podpisy, obrázky produktů, přílohy
chatu) zálohuje samostatný workflow `backup-storage.yml` do Cloudflare R2,
denně a inkrementálně – **kapitola 7**.

> **Soubory tenhle workflow nezálohuje** (jen jejich seznam). Dřívější
> nedělní krok „Soubory ve Storage" stahoval soubory přes veřejné adresy,
> od vzniku neveřejného bucketu `chat-prilohy` padal a 6. 10. 2026 byl
> odebrán. Soubory kryje denní `backup-storage.yml` do R2 (kapitola 7),
> poprvé ověřený naostro 6. 10. 2026.

### Zkouška obnovy

Součástí každého běhu je `scripts/zkouska-obnovy.sh` – ten samý skript, který
si člověk pustí lokálně nad staženou zálohou (`npm run test:obnova -- <složka>`).
Nahraje zálohu do prázdného Postgresu a ověří, že se obnovila bez chyb, že
v každé tabulce sedí počet řádků proti záloze, že jsou zpátky RLS politiky,
funkce, triggery, realtime publikace i uživatelé, a že databáze funguje
(RLS, triggery, optimistické zamykání). Když ne, workflow spadne.

Druhý krok pak porovná ostrou databázi s obnovenou a hlásí tabulku, která je
v ostré plná a v záloze prázdná – tak se pozná, že z dumpu vypadla celá tabulka.
Přesná shoda počtů proti ostré databázi se nehlídá schválně: mezi dumpem
a kontrolou vznikne na ostré databázi další zakázka a kontrola by padala náhodně.

Na chybějících rozšířeních (`pg_cron`, `pg_net`, `supabase_vault`) v holém
Postgresu nezáleží – na Supabase je má platforma.

### Rozbalení zálohy

```bash
gh run download <ID_BEHU> -n zaloha-db-20260906
gpg --decrypt --output zaloha.tar.gz zaloha-20260906.tar.gz.gpg
mkdir zaloha && tar -xzf zaloha.tar.gz -C zaloha
npm run test:obnova -- zaloha
```

Obnova do nového projektu: [docs/OBNOVA_ZE_ZALOHY.md](OBNOVA_ZE_ZALOHY.md).

---

## 7. Záloha souborů ze Storage (Cloudflare R2)

Od 27. 9. 2026 je připravený `.github/workflows/backup-storage.yml`
(skript `scripts/backup-storage.sh`). Zrcadlí **všechny buckety** Supabase
Storage do Cloudflare R2, denně ve 4:15 UTC (po záloze databáze; GitHub
plánované běhy spouští se zpožděním). Jde spustit i ručně: Actions → Záloha
souborů (Storage) → Run workflow, se vstupy *rezim*, *nanecisto*
a *plne_porovnani*.

**Proč zvlášť a proč R2.** Dump databáze obsahuje jen evidenci souborů
(`storage.objects`), ne jejich obsah. Artefakty GitHubu se na fotky nehodí:
každý běh by nahrál celé úložiště znovu, drží se nejvýš 90 dní a neumí
„přenes jen změny". R2 je S3 kompatibilní, neúčtuje stahování (obnova nic
nestojí) a úložiště Jobi se ještě dlouho vejde do bezplatných 10 GB.

### Kolik toho je (naměřeno 27. 9. 2026 v ostré databázi)

| Bucket | Veřejný | Souborů | Velikost | Obsah |
|--------|---------|---------|----------|-------|
| `diagnostic-photos` | ano (má se zavřít, BEZPECNOST_FOTKY.md) | 511 | 100 MB | 504 fotek zařízení ve složkách servisů, 7 podpisů převzetí (`signatures/`) |
| `product-images` | ano (záměr) | 34 | 1,4 MB | obrázky produktů skladu |
| `chat-prilohy` | ne | 0 | 0 | přílohy chatu týmu |
| **celkem** | | **545** | **~101 MB** | |

Bucket `service-document-assets` (logo, razítko a hlavičkový papír
z JobiDocs, `docs/JOBIDOCS_STORAGE_BUCKET.md`) **v ostrém projektu není** –
nikdo ho nezaložil. Záloha bere buckety ze `storage.buckets`, takže až
vznikne, začne se zálohovat sama.

Největší soubor má 8 MB, soubory bez velikosti v evidenci nejsou, verzování
Storage je vypnuté. Od února přibylo ~100 MB a tempo poroste s počtem
servisů – při 50 servisech počítej s jednotkami GB, pořád v bezplatném
limitu R2.

### Jak to funguje

```
Supabase Storage ──rclone sync (S3)──▶ r2:jobi-zaloha-storage/aktualni/<bucket>/…
                                      │ smazané a přepsané:
                                      └▶ r2:jobi-zaloha-storage/smazane/<RRRR-MM-DD>/<bucket>/…
storage.buckets + storage.objects ───▶ r2:jobi-zaloha-storage/metadata/  (a denik/<RRRR-MM-DD>/)
```

* **`aktualni/`** – zrcadlo produkce po posledním běhu. Přenáší se jen nové
  a změněné soubory (`--update --use-server-modtime`: soubor se kopíruje,
  když je v produkci novější než kopie v R2, bez dotazu na každý soubor).
* **`smazane/<datum>/`** – co ten den z produkce zmizelo nebo bylo
  přepsáno, rclone sem **přesune** (`--backup-dir`). Smazání fotky v aplikaci
  tedy neznamená její smazání ze zálohy – drží se 30 dní (lifecycle pravidlo
  níž), pak ji R2 smaže samo.
* **`metadata/`** – `buckety.json` (veřejnost, limity, povolené typy
  souborů – bez nich by obnovené buckety vznikly neveřejné a bez limitů),
  `objekty.tsv` (evidence souborů z databáze), `posledni-beh.txt`.
  Totéž k danému dni v `denik/<datum>/`.
* **Pojistky před synchronizací:** když S3 vypíše výrazně míň souborů, než
  eviduje databáze (odebraná práva klíče, výpadek), bucket se
  nesynchronizuje – jinak by rclone „chybějící" soubory odklidil ze zrcadla.
  Stejně tak když databáze eviduje méně než polovinu souborů, které jsou
  v záloze (secrets omylem ukazují na nový prázdný projekt): zrcadlo by
  skončilo v koši a za 30 dní by ho R2 smazalo. Opravdové hromadné mazání
  (zrušený servis s tisícem fotek) se pustí ručním během se vstupem
  *povolit_hromadne_mazani*.
* **Bucket, který v produkci zmizí,** zůstává v `aktualni/` a běh na něj
  jen upozorní. Kvůli zmizení celého bucketu se ze zálohy nemaže nic.

### Ověření po synchronizaci

Skript porovná R2 s `storage.objects` v databázi (přes `SUPABASE_DB_URL`)
a při nesouladu **workflow spadne**:

1. **Bez tolerance:** každý soubor, který se v produkci naposledy změnil
   před začátkem zálohy (podle hodin databáze), musí být v R2 a mít stejnou
   velikost. Soubory nahrané během zálohy se nepočítají, takže tahle kontrola
   nepadá náhodně. Vypíše prvních 20 chybějících.
2. **S tolerancí:** počet souborů a součet velikostí po bucketech se smí
   lišit nejvýš o 5 souborů / 20 MB, nebo o 1 % (co je víc) – mezi
   synchronizací a kontrolou se v servisech dál fotí a maže. Nastavitelné
   `ZALOHA_TOLERANCE_POCET` a `ZALOHA_TOLERANCE_PROCENT`.

Tabulka s počty je v souhrnu běhu (Summary).

### Dvě cesty ke Storage

| Cesta | Kdy | Jak |
|-------|-----|-----|
| **S3** (preferovaná) | jsou `SUPABASE_S3_ACCESS_KEY` a `SUPABASE_S3_SECRET_KEY` | `rclone sync` přímo proti S3 rozhraní Storage `https://<ref>.storage.supabase.co/storage/v1/s3`, region `eu-west-1` |
| **REST** (náhradní) | S3 klíče nejsou, je `SUPABASE_SERVICE_ROLE_KEY` | seznam souborů z databáze (REST výpis vrací jen jednu úroveň složek), porovnání s R2, stažení jen nových a změněných přes `/storage/v1/object/authenticated/…` po dávkách (6 souběžně), nahrání `rclone copy`; smazané se v R2 přesunou do `smazane/<datum>/` |

S3 rozhraní projektu odpovídá: 27. 9. 2026 vrátil dotaz bez klíče S3 chybu
`AccessDenied: Missing signature`, tedy endpoint žije a chce podpis. Jestli
je v Dashboardu zapnutý přepínač S3 protokolu, se z venku nepozná – ověř
při generování klíčů (krok 2 níž).

### Co se musí jednou nastavit

**1. Bucket v Cloudflare R2**

1. Cloudflare Dashboard → **R2 Object Storage** → **Create bucket**,
   název `jobi-zaloha-storage`, lokace *Automatic*. (Jurisdikce *EU* drží
   data v EU, ale mění endpoint na `https://<account>.eu.r2.cloudflarestorage.com`
   – pak je potřeba upravit `nastav_r2` v `scripts/zaloha-storage-spolecne.sh`.)
2. Bucket **nesmí mít veřejný přístup** (Settings → Public access: vypnuto,
   žádná vlastní doména). Jsou v něm fotky zařízení a podpisy zákazníků.
3. **Lifecycle pravidla** (Settings → Object lifecycle rules → Add rule):
   * `smazane-30-dni`: prefix `smazane/`, smazat objekty po 30 dnech
   * `denik-30-dni`: prefix `denik/`, totéž

   Nebo z příkazové řádky:
   ```bash
   npx wrangler r2 bucket lifecycle add jobi-zaloha-storage smazane-30-dni smazane/ --expire-days 30
   npx wrangler r2 bucket lifecycle add jobi-zaloha-storage denik-30-dni denik/ --expire-days 30
   npx wrangler r2 bucket lifecycle list jobi-zaloha-storage
   ```
   Stáří se počítá od chvíle, kdy soubor do `smazane/` dorazil (přesun je
   v R2 nové nahrání), ne od pořízení fotky. R2 maže do 24 hodin po
   vypršení. Na prefixy `aktualni/` a `metadata/` **žádné pravidlo
   nedávej** – to je samotná záloha.
4. **API token:** R2 → **Manage R2 API Tokens** → Create API token →
   oprávnění *Object Read & Write*, *Apply to specific buckets only* →
   `jobi-zaloha-storage`. Po vytvoření se jednou ukáže *Access Key ID*
   a *Secret Access Key*. *Account ID* je na přehledu R2 vpravo (i v URL
   dashboardu).

**2. S3 klíče Supabase Storage**

Supabase Dashboard → projekt → **Storage** → **Settings** (část S3
Connection): zapnout *Enable connection via S3 protocol*, pokud není, pak
**Access keys → New access key** (popis např. „záloha do R2"). Ukáže se
*Access key ID* a *Secret access key* – tajemství jen jednou. Klíč má plný
přístup ke všem bucketům a obchází RLS, **patří jen do secrets GitHubu**.
Region projektu je `eu-west-1`.

**3. Secrets v repozitáři** (Settings → Secrets and variables → Actions)

| Secret | Odkud | Povinný |
|--------|-------|---------|
| `SUPABASE_DB_URL` | už je (záloha databáze) | ano |
| `VITE_SUPABASE_URL` | už je (build) – z něj se odvodí S3 endpoint | ano, pokud není `SUPABASE_S3_ENDPOINT` |
| `R2_ACCOUNT_ID` | Cloudflare → R2 → přehled, *Account ID* | ano |
| `R2_ACCESS_KEY_ID` | R2 API token, *Access Key ID* | ano |
| `R2_SECRET_ACCESS_KEY` | R2 API token, *Secret Access Key* | ano |
| `SUPABASE_S3_ACCESS_KEY` | Supabase → Storage → Settings → Access keys | ano (cesta S3) |
| `SUPABASE_S3_SECRET_KEY` | tamtéž | ano (cesta S3) |
| `SUPABASE_S3_ENDPOINT` | `https://ijtvcgolsdsrquqbvjrz.storage.supabase.co/storage/v1/s3` | ne – jen kdyby se nedal odvodit |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API Keys (secret / service_role) | ne – jen pro náhradní cestu REST |

Dokud chybí, workflow skončí hláškou, co přesně chybí.

**4. První běh:** Actions → Záloha souborů (Storage) → Run workflow se
zaškrtnutým *nanecisto* (vypíše, co by přenesl, nic nezapíše), pak ostře.
První ostrý běh přenese celé úložiště (~100 MB, pár minut), další jen změny.

### Ruční spuštění lokálně

```bash
brew install rclone libpq                       # rclone a psql
export SUPABASE_DB_URL="postgresql://…"          # jako u zálohy DB
export SUPABASE_URL="https://ijtvcgolsdsrquqbvjrz.supabase.co"
export SUPABASE_S3_ACCESS_KEY=… SUPABASE_S3_SECRET_KEY=…
export R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=…
NANECISTO=1 bash scripts/backup-storage.sh       # nejdřív nanečisto
bash scripts/backup-storage.sh
```

Skript nečte `~/.config/rclone/rclone.conf` – všechno nastaví
z proměnných a klíče na disk nezapisuje.

### Když workflow spadne

| Hláška | Co to znamená |
|--------|---------------|
| `Chybí secrets: …` | doplnit secrets podle tabulky výš |
| `S3 vypsalo jen X z Y souborů` | klíč S3 přestal vidět soubory (smazaný, zneplatněný) nebo výpadek; nic se nesynchronizovalo, záloha v R2 zůstala netknutá |
| `v záloze je N souborů, databáze eviduje jen M` | secrets ukazují na jiný (nový) projekt, nebo se v produkci opravdu smazala většina bucketu. Když je to druhé, spusť ručně se vstupem *povolit_hromadne_mazani*; smazané zůstanou 30 dní v `smazane/<datum>/` |
| `přes S3 se nepodařilo vypsat soubory` | špatný klíč, endpoint nebo region, případně vypnutý S3 protokol |
| `v R2 chybí N … souborů, které v produkci existovaly už před zálohou` | soubor je v evidenci, ale do R2 se nedostal. Buď chyba přenosu (spusť znovu), nebo je v produkci jen řádek v `storage.objects` bez obsahu – takový soubor nejde otevřít ani v aplikaci |
| `jinou velikost má N souborů` | přepsaný soubor, který `--update` nepřenesl; spusť ručně s *plne_porovnani* |
| `počet souborů se liší o …` | větší rozdíl, než je tolerance; v tabulce je vidět, u kterého bucketu |

Obnova: `scripts/obnov-storage.sh`, postup v
[docs/OBNOVA_ZE_ZALOHY.md](OBNOVA_ZE_ZALOHY.md), kapitola 5.

### Co zatím není ověřené

* **Nic z toho neběželo proti skutečnému R2 ani S3 rozhraní Supabase** –
  účet R2 ani S3 klíče zatím nejsou. Ověřené je: syntaxe workflow (YAML
  parser) a skriptů (`bash -n`), řízení obou skriptů proti napodobeninám
  `rclone` a `psql` (cesta S3, REST, nanečisto, chybějící soubor v R2,
  chybějící secrets, obnova k datu, z koše, špatné potvrzení, chybějící
  bucket v cíli), porovnání a stahování přes REST proti lokálnímu HTTP
  serveru (mezery a diakritika v cestách, chybějící soubor, čas změny).
* Chování `rclone` proti S3 rozhraní Supabase (výpis `ListObjectsV2`,
  metadata `x-amz-meta-mtime` při nahrávání zpátky) – ověřit prvním během
  a první zkouškou obnovy do testovacího projektu.
