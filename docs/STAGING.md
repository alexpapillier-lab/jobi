# Staging – kde se migrace zkoušejí dřív než na produkci

Do září 2026 šla každá migrace po `supabase db push --dry-run` rovnou do
produkce (`ijtvcgolsdsrquqbvjrz`). `--dry-run` řekne, **které** soubory se
pustí, ne **co udělají** s daty, která v produkci jsou. Testovací cluster
z `npm run test:migrace` zase staví databázi od nuly, bez dat a bez
podivností, které produkce za rok nasbírala.

Staging je druhý projekt Supabase, který je **kopie produkce bez osobních
údajů**: stejné schéma, stejná historie migrací, stejné servisy, zakázky,
ceníky i sklad – jen zákazníci se jmenují „Zákazník 12“ a všichni uživatelé
mají heslo, které znáš. Na něm se zkouší migrace, edge funkce a agenti.

## Pravidlo

**Migrace → staging → kouřová zkouška → produkce.** Nic z `supabase/migrations`
ani `supabase/functions` nejde na produkci, dokud neprošlo stagingem.
Totéž pravidlo je v [MIGRATIONS_SAFETY.md](MIGRATIONS_SAFETY.md).

```bash
# 1) napiš migraci (pravidla v docs/MIGRATIONS_SAFETY.md)
npm run test:migrace                                  # projde od nuly?

# 2) na staging (link CLI se nepřepíná, produkce zůstává linknutá)
npm run staging:migrace -- --nanecisto                # co se pustí
npm run staging:migrace -- --funkce zmenene --sonda   # pustit + funkce + sonda oprávnění

# 3) kouřová zkouška proti stagingu
npm run dev:web:staging                               # http://localhost:1432, štítek STAGING
#    přihlas se jako e2e@jobi.test / STAGING_TEST_PASSWORD, projdi, čeho se změna týká

# 4) produkce
npx supabase db push --dry-run                        # musí ukázat TYTÉŽ migrace jako krok 2
npm run db:migrate
npx supabase functions deploy <jméno>                 # změněné edge funkce
```

Edge funkce jdou na produkci i bez terminálu: GitHub → Actions → **Nasazení
edge funkcí na produkci** → Run workflow, do pole funkce `jmeno1,jmeno2`
nebo `vse`, do potvrzení `produkce`. Bere stejný `SUPABASE_ACCESS_TOKEN`
jako staging. Migrace tudy nejdou – ty zůstávají na `npm run db:migrate`.

Kdy se staging obnovuje z produkce (`npm run staging:obnov`):

* **před každou rizikovější migrací** (mění data, typy, mazání, RLS) – ať se
  zkouší proti dnešním datům, ne proti měsíc starým,
* **po migraci, která se na stagingu zkusila a pak zahodila** – staging by
  jinak měl v historii migraci, kterou repozitář nezná, a `db push` odmítne
  pokračovat (skript na to upozorní),
* jinak **jednou týdně** stačí. Záloha je noční (`backup-db.yml`), takže
  staging je nejvýš den za produkcí.

Obnova trvá pár minut a je idempotentní: každý běh staging vyprázdní a naplní
znovu.

## Jak staging založit (jednou, ručně – majitel)

1. **Dashboard → New project.** Organizace stejná jako produkce, název
   `jobi-staging`, **region EU West (Ireland) `eu-west-1`** – stejný jako
   produkce (pooler `aws-1-eu-west-1`). Jiný region by zkreslil časy dotazů
   a v EU zůstávají i anonymizovaná data.
2. **Heslo k databázi** nech vygenerovat a ulož do správce hesel (položka
   „Jobi staging – DB“). Jinde než v `.env.staging` a v secrets GitHubu
   nebude.
3. **Compute:** nejmenší (Micro / Nano). Staging nemá provoz.
4. **Authentication → Sign In / Providers:** e-mail zapnutý, **SMTP
   nenastavovat** – staging nemá posílat e-maily nikomu (vestavěné SMTP
   Supabase pošle jen členům týmu projektu a jen pár za hodinu). **Site URL**
   `http://localhost:1432`, redirect URLs `http://localhost:1432/**`
   a `http://localhost:1422/**`.
5. **Project Settings → API:** opiš `Project URL` a `anon` klíč.
6. **Connect → Session pooler:** opiš connection string (port 5432).
7. Lokálně:
   ```bash
   cp .env.staging.example .env.staging
   # doplň VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, STAGING_REF,
   # STAGING_DB_URL, STAGING_TEST_PASSWORD (openssl rand -base64 18),
   # BACKUP_PASSPHRASE (stejné jako secret zálohy), případně STAGING_PONECHAT_EMAILY
   npm run staging:obnov -- --nanecisto     # nic nezapíše, jen zkontroluje
   npm run staging:obnov                    # první naplnění
   ```
   Na novém projektu skript sám nejdřív pustí všechny migrace (`db push`),
   aby vznikly buckety, politiky Storage a rozšíření, a pak nahraje zálohu.
8. **Secrets edge funkcí na stagingu** – jen to, co je potřeba ke zkoušení,
   a **nikdy ostré klíče služeb, které posílají ven**:
   ```bash
   supabase secrets set --project-ref <STAGING_REF> ROOT_OWNER_ID=<stejné UUID jako produkce>
   # RESEND_API_KEY: nenastavovat (nebo testovací klíč Resendu) – jinak by
   #   staging posílal pozvánky a statistiky; adresy jsou sice @staging.jobi.test,
   #   ale Resend by je zkoušel doručit.
   # TWILIO_*: nenastavovat – SMS by stály peníze a šly na vymyšlená čísla.
   # Stripe: jen testovací klíče (sk_test_…), nikdy ostré.
   ```
   `SUPABASE_URL`, `SUPABASE_ANON_KEY` a `SUPABASE_SERVICE_ROLE_KEY` dává
   platforma funkcím sama. Tajemství ve Vaultu (`alerts_cron_secret`,
   `automations_cron_secret`) na stagingu potřeba nejsou – naplánované úlohy
   jsou tam po obnově vypnuté.
9. **GitHub** (Settings → Secrets and variables → Actions), jen pro workflow
   *Migrace na staging*: `STAGING_DB_URL`, `STAGING_REF`
   a `SUPABASE_ACCESS_TOKEN` (Dashboard → Account → Access Tokens; jen pro
   nasazení funkcí).

## Co stojí

Ceny ověř v Dashboardu (Billing), tohle je stav, jak ho známe:

* **Organizace na plánu Pro:** každý další projekt platí vlastní compute.
  Nejmenší instance vyjde zhruba na **10 USD měsíčně** (kredit 10 USD, který
  Pro obsahuje, spotřebuje produkce). Staging se dá v Dashboardu
  **pozastavit** (Pause project), když se týdny nepoužívá – pak se neplatí compute.
* **Organizace na Free:** dva projekty zdarma. Free projekt se po týdnu bez
  provozu sám pozastaví a obnoví se v Dashboardu jedním kliknutím. Limit
  500 MB databáze staging s rezervou pojme (produkce má pod 0,1 GB, viz
  [KAPACITA.md](KAPACITA.md)).
* Levná varianta pro Pro: staging založit v **samostatné Free organizaci**.
  Skriptům je to jedno, jen `SUPABASE_ACCESS_TOKEN` musí mít přístup i do ní.

Úložiště (fotky) staging skoro nepotřebuje – fotky produkce se na něj
nekopírují.

## Co obnova dělá

`scripts/staging/obnov-do-stagingu.sh` (npm run staging:obnov):

1. vezme poslední zálohu: výchozí je artefakt posledního úspěšného běhu
   `backup-db.yml` (`gh run download` + `gpg` s `BACKUP_PASSPHRASE`),
   `--lokalni` nejnovější složku v `backup/` ze `scripts/backup-db.sh`,
   `--zaloha <složka>` konkrétní rozbalenou zálohu. Rozbalená záloha leží jen
   v soukromé dočasné složce a po skončení se smaže, i po chybě,
2. ze `data.sql` vyhodí to, co na staging nepatří, **ještě před nahráním**:
   relace, obnovovací tokeny, audit přihlášení (IP adresy), MFA a evidenci
   souborů ve Storage. Z auth zůstanou jen `users` a `identities`,
3. ověří, že cíl je staging (níž, Pojistky),
4. opíše politiky nad `storage.objects` (viz Politiky Storage),
5. vyprázdní `public` na stagingu – všechny naše tabulky, funkce, typy
   a pohledy. Schéma samo zůstává (na Supabase ho vlastní platforma a visí na
   něm práva pro `anon`/`authenticated`); `auth`, `storage`, `realtime`,
   `vault`, `cron` se nemažou,
6. nahraje `roles.sql` a `schema.sql` a vrátí politiky Storage,
7. v **jedné transakci** vymění uživatele, nahraje data, anonymizuje je,
   nastaví historii migrací podle produkce (`migrace.csv`) a zapíše značku.
   Když cokoli selže – i závěrečná kontrola, že nezůstal skutečný e-mail nebo
   telefon –, transakce se vrátí a ze zálohy na stagingu nezůstane nic,
8. zkontroluje počty řádků v každé tabulce proti záloze (jako
   `backup-db.yml` a `zkouska-obnovy.sh`),
9. vypne naplánované úlohy (`cron.job`), jinak by staging každou hodinu
   posílal hlídací e-maily a spouštěl automatizace. `STAGING_CRON=zapnuto`
   je nechá běžet.

### Co se anonymizuje a co zůstává

Pravidla jsou v `scripts/staging/anonymizace.sql`, jedna tabulka pravidel.

| Údaj | Na stagingu |
| --- | --- |
| jméno, telefon, e-mail, adresa, firma, IČO, DIČ zákazníka (karta, zakázka, reklamace, rezervace, faktura, SMS) | `Zákazník 12`, `+420 999 000 012`, `zakaznik-12@staging.jobi.test`, `Testovací 12, 110 00 Praha`; zakázka převezme údaje své karty, hledání funguje |
| poznámky, diagnostika, komentáře, chat, dotazy nápovědy | text zůstává, e-maily a telefonní čísla z něj zmizí |
| historie zakázek a reklamací | změny jména/telefonu/e-mailu `[anonymizováno]`, zbytek zůstává |
| historie karty zákazníka | celá `[anonymizováno]` |
| kód k odemčení zařízení, podpis, doklad o koupi, fotky | pryč (fotky a podpisy jsou soubory v úložišti produkce) |
| IMEI, sériové číslo, číslo zásilky | vymyšlené |
| token zákaznického portálu | nový náhodný (odkaz z produkce na stagingu nefunguje a naopak) |
| IP adresa a prohlížeč u schválení nabídky | `[anonymizováno]` |
| obsah SMS | pryč |
| tajemství integrací (iDoklad), webhook servisu, Stripe ID | pryč – staging nesmí nic poslat jménem skutečného servisu |
| API tokeny, PINy, tokeny pro focení a obnovu hesla, logy chyb, uložené odpovědi API | tabulky prázdné |
| e-mail uživatele | `uzivatel-N@staging.jobi.test`; `@jobi.test` (testovací účty) a `STAGING_PONECHAT_EMAILY` zůstávají |
| heslo uživatele | všem `STAGING_TEST_PASSWORD` – skutečné otisky hesel na staging nepatří |
| **zůstává beze změny** | servisy a jejich firemní údaje (jsou na každé faktuře), pobočky, ceník, sklad, statusy, přezdívky techniků, všechna ID, čísla zakázek, částky, termíny |

Protože se ID nemění, platí na stagingu i `scripts/rls-probe.sql`
(testovací identity TEST2 a E2E servisu) a `e2e/README.md` (e2e@jobi.test
v servisu „E2E testovaci servis“).

## Pojistky

Obnova je jediný skript v repozitáři, který maže celé schéma. Proto:

* **Ref.** `STAGING_REF` nesmí být `ijtvcgolsdsrquqbvjrz` a `STAGING_DB_URL`
  ho nesmí obsahovat; URL naopak musí obsahovat `STAGING_REF`. Lokální
  Postgres jen se `STAGING_LOKALNI=1` (zkouška skriptu). Kontroly jsou na
  jednom místě, `scripts/staging/spolecne.sh`.
* **Značka.** Vyprázdnit se smí jen databáze, která má schéma `jobi_staging`
  (naplnil ji tenhle skript), nebo databáze bez jediné zakázky (nový
  projekt). Produkce značku nemá a zakázky má – skončí tam vždycky. Migrační
  skript bez značky taky odmítne pokračovat.
* **Potvrzení.** Před zápisem se opisuje ref stagingu (`--ano` to přeskočí v CI).
* **Link CLI se nepřepíná.** `supabase link` zapisuje ref do
  `supabase/.temp/project-ref` – ten soubor je v gitu a míří na produkci.
  Skripty proto link vůbec nepoužívají: migrace jdou přes
  `supabase db push --db-url`, funkce přes
  `supabase functions deploy --project-ref`. Migrační skript si navíc
  `supabase/.temp` na začátku opíše a na konci (i po chybě nebo Ctrl+C)
  ověří, že je beze změny; kdyby ho CLI přepsalo, vrátí ho a řekne to.
* **Jiný port = jiné úložiště prohlížeče.** Proti stagingu běží aplikace na
  portech 1422 (desktop) a 1432 (web), produkce na 1420 a 1430. Fronta
  neuložených změn (`jobi_neulozene_zmeny_v1`) a další klíče v localStorage
  nejsou rozlišené podle projektu – a protože ID na stagingu jsou stejná jako
  v produkci, změna rozdělaná na stagingu by se po přepnutí `.env` mohla
  dopsat do produkce (a přepsat skutečného zákazníka „Zákazníkem 12“). Různé
  porty = různé originy = oddělené localStorage. **Proti stagingu proto
  nespouštěj `npm run dev` s upraveným `.env`**, vždycky `dev:staging` /
  `dev:web:staging` / `tauri:dev:staging`.
* **Štítek STAGING.** V režimu staging (`VITE_JOBI_PROSTREDI=staging`) má
  aplikace nahoře oranžový štítek a v titulku `[STAGING]`
  (`src/lib/prostredi.ts`).

## Aplikace proti stagingu

```bash
npm run dev:web:staging     # webová verze, http://localhost:1432
npm run tauri:dev:staging   # desktop (src-tauri/tauri.staging.conf.json)
npm run dev:staging         # jen frontend desktopu na 1422
```

Vite v režimu `staging` čte `.env.staging` přes `.env` (a přes
`.env.local`). Do aplikace jdou jen proměnné `VITE_*`; heslo k databázi
a ostatní proměnné skriptů v balíčku nikdy nejsou. `.env` se nemění.

Build ID (`__JOBI_BUILD__`) a `version.json` se tím nemění: vývojový server
kontrolu nové verze vypíná (`kontrolaMaSmysl()` v `src/lib/aktualizaceWebu.ts`)
a `build:web` / `build:prod` běží v režimu production s `.env`. **Build proti
stagingu (`vite build --mode staging`) se nikam nenasazuje** – měl by
zapečenou adresu stagingu.

## Politiky Storage

Politiky nad `storage.objects` (fotky diagnostiky, přílohy chatu, obrázky
produktů) odkazují na tabulky v `public`, takže je vyprázdnění `public`
smaže. Záloha je nevrátí – `supabase db dump` bere jen schéma `public`.
Skript si je proto před vyprázdněním opíše ze stagingu, uloží do
`jobi_staging.krizove` a po obnově schématu vrátí. Když obnova spadne mezi
vyprázdněním a vrácením, další běh vezme politiky z uložené kopie.

Kdyby politiky přesto chyběly (skript varuje „nejsou žádné politiky
Storage“), vrátí je příkazy `drop policy if exists … / create policy …
on storage.objects` z migrací, které je zakládají. Pouští se jen ty
příkazy, ne celé soubory – migrace kolem nich dělají i jiné věci:

```bash
grep -li 'policy.*on storage.objects' supabase/migrations/*.sql
# z nalezených souborů vezmi poslední verzi každé politiky a pusť ji:
# psql "$STAGING_DB_URL" -c 'drop policy if exists … ; create policy … ;'
```

Totéž platí pro obnovu produkce po havárii
([OBNOVA_ZE_ZALOHY.md](OBNOVA_ZE_ZALOHY.md)): politiky Storage v záloze nejsou.

## Workflow v GitHubu

`.github/workflows/staging-migrace.yml` (Actions → Migrace na staging → Run
workflow, ručně, vybraná větev). Pouští `scripts/staging/migrace-na-staging.sh`
se vstupy *nanečisto* (výchozí zapnuto), *funkce* a *sonda*. Bez
interaktivního přihlášení to jde: `db push --db-url` se připojuje přímo
k databázi a nepotřebuje login ani link, nasazení funkcí čte token
z `SUPABASE_ACCESS_TOKEN` a s `--use-api` nepotřebuje Docker. Obnova
z produkce ve workflow záměrně není – potřebuje heslo k zálohám a mění celý
staging.

## Co ověřené je a co ne (27. 9. 2026)

* **Ověřeno lokálně**, nad vlastním Postgresem 17 postaveným ze všech 175
  migrací (`STAGING_LOKALNI=1`) a zálohou s vymyšlenými „skutečnými“ daty:
  obnova projde, počty řádků sedí ve všech tabulkách, anonymizace přepíše
  všechno z tabulky pravidel a kontrola na konci projde; druhý běh za sebou
  dá stejný výsledek; vadný řádek v datech vrátí celou transakci (na stagingu
  nezůstane nic ze zálohy, uživatelé zůstanou původní anonymizovaní); vadné
  schéma skript zastaví a další běh vrátí politiky Storage z uložené kopie;
  pojistky odmítnou ref produkce v `STAGING_REF` i v URL (pooler i přímé
  připojení), URL bez refu stagingu a lokální Postgres bez `STAGING_LOKALNI`;
  migrační skript vrátí `supabase/.temp`, když ho něco přepíše.
* **Neověřeno proti skutečnému Supabase** – staging zatím neexistuje. Při
  prvním běhu sleduj hlavně: chyby v `schema.sql` (skript propustí jen
  známé chyby rozšíření a vlastnictví schémat, ostatní vypíše a zastaví se),
  `truncate auth.users cascade` pod rolí `postgres` a `session_replication_role`
  v `PGOPTIONS` (oficiální postup obnovy Supabase ho používá, takže by měl
  projít), a že se po obnově dá přihlásit jako `e2e@jobi.test`.
* **Stažení z GitHubu** (`gh run download` + `gpg`) se nezkoušelo nad
  skutečným artefaktem – heslo `BACKUP_PASSPHRASE` má jen majitel. Samotné
  rozšifrování stejnými přepínači jako ve workflow ověřené je.

## Soubory

* `scripts/staging/obnov-do-stagingu.sh` – obnova z produkční zálohy
* `scripts/staging/migrace-na-staging.sh` – migrace a funkce na staging, kouřová zkouška
* `scripts/staging/spolecne.sh` – pojistky (ref produkce, značka, potvrzení)
* `scripts/staging/vyprazdneni.sql`, `anonymizace.sql`, `priprav-data.py`
* `.env.staging.example`, `src-tauri/tauri.staging.conf.json`, `src/lib/prostredi.ts`
* `.github/workflows/staging-migrace.yml`
