# Co musí udělat majitel (stav 27. 9. 2026)

Seznam věcí, které nejde udělat z kódu: účty, klíče, rozhodnutí a release.
Seřazeno podle toho, co nejvíc chrání provoz. Odškrtávej a mazej hotové.

## A. Ochrana provozu (nejdřív)

### 1. Záloha fotek a podpisů do Cloudflare R2 – HOTOVO 6. 10. 2026
Secrets nastavené, první ostrý běh prošel (687 souborů, počty sedí s databází).
Jede denně ve 4:15 UTC, workflow „Záloha souborů (Storage)“. Starý nedělní
krok v záloze databáze je odebraný.

### 2. Staging projekt Supabase
Migrace dnes jdou rovnou do produkce. Skripty `scripts/staging/` jsou hotové.

1. Supabase Dashboard → **New project**: organizace stejná, název `jobi-staging`,
   region **EU West (Ireland)**, nejmenší výkon. Heslo k databázi ulož do správce hesel.
2. V novém projektu → Authentication → URL Configuration: Site URL
   `http://localhost:1432`, Redirect URLs `http://localhost:1432/**` a `http://localhost:1422/**`.
   SMTP nenastavovat.
3. V repu: `cp .env.staging.example .env.staging` a vyplň:
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (Settings → API nového projektu)
   - `STAGING_REF` (ref z URL projektu), `STAGING_DB_URL` (Connect → Session pooler, heslo v jednoduchých uvozovkách)
   - `STAGING_TEST_PASSWORD` (aspoň 12 znaků; dostanou ho všechny účty na stagingu)
   - `BACKUP_PASSPHRASE` (stejné jako v GitHub secrets)
   - volitelně `STAGING_PONECHAT_EMAILY=alex.papillier@icloud.com`, ať se přihlásíš pod sebou
4. Spusť nanečisto a pak naostro:

   ```bash
   npm run staging:obnov -- --nanecisto
   ```

   ```bash
   npm run staging:obnov
   ```

5. Na stagingu nastav jen `supabase secrets set --project-ref <ref> ROOT_OWNER_ID=<tvoje uuid>`.
   Resend, Twilio ani ostrý Stripe tam nedávej.
6. GitHub secrets pro workflow `staging-migrace.yml`: `STAGING_DB_URL`, `STAGING_REF`,
   `SUPABASE_ACCESS_TOKEN` (Supabase → Account → Access Tokens).
7. Aplikace proti stagingu: `npm run dev:staging` (desktop) nebo `npm run dev:web:staging`.

Cena: na plánu Pro zhruba 10 USD měsíčně, projekt jde pozastavit. Podrobně: `docs/STAGING.md`.

### 3. E-mail z hlídače dostupnosti
Uptime workflow běží každých 10 minut, ale e-mail posílá jen se secrets:
`RESEND_API_KEY` (stejný klíč, jaký mají edge funkce v Supabase) a `ALERT_EMAIL`
(kam poslat). Bez nich chodí jen e-mail od GitHubu o spadlém workflow.
GitHub → Settings → Notifications: zkontroluj, že máš zapnuté e-maily pro Actions.

### 4. DMARC
Na doméně appjobi.com je DMARC `p=none`. Až budou e-maily z Resendu chodit bez
problémů aspoň měsíc, přepni v DNS na `p=quarantine`. Postup je v
`docs/DOMENA_PRO_RESEND_CHATGPT.md`.

## B. Vydání pro uživatele

### 5. JobiDocs přebuild a vydání
V `jobidocs/core` přibyly proměnné `{{device.warranty}}`, `{{device.purchaseDate}}`,
`{{device.purchaseProof}}`, `{{device.findMy}}` a `{{ticket.warrantyUntil}}` a
volba velikosti názvu dokumentu. Desktopoví uživatelé je mají až po novém
JobiDocs. Postup: `docs/JOBIDOCS_OTA_A_RELEASE.md`.

### 6. Desktop Jobi 0.7.1
Web se nasazuje sám, desktop ne. Vydej 0.7.1 přes jobi-release-app
(`docs/RELEASE_NA_GITHUB.md`), ať desktop dostane vše z 26. a 27. 9.:
statistiky podle vydání, odměny, Dnes, inventuru, souhrnnou fakturu, záruku,
IMEI a Find My, migraci, zámek „upravuje kolega“.

### 6b. PDF ze serveru (volitelné, z cloudové větve 2. 10.)
Edge funkce `document-pdf` je v repu, ale **není nasazená** a bez klíčů
Cloudflare Browser Rendering stejně vrací 503 a aplikace jde do tiskového
dialogu jako dřív. Když to chceš: Cloudflare API token *Browser Rendering: Edit*,
`supabase secrets set CF_ACCOUNT_ID=… CF_BROWSER_RENDERING_TOKEN=…`, pak
Actions → „Nasazení edge funkcí na produkci“ → funkce `document-pdf`, potvrzení
`produkce`. Postup: `docs/PDF_NA_SERVERU.md`. Účtuje se podle času prohlížeče.

## C. Rozhodnutí, na která čekám

### 7. DPH u jednotlivé faktury z detailu zakázky
Souhrnná faktura při nastavení „ceny zadávám včetně DPH“ daň z ceny vyjme,
takže zní na stejnou částku jako zakázka. Jednotlivá faktura z detailu zakázky
dnes DPH přidává navrch, takže je o 21 % vyšší než cena na zakázce.
**Doporučuji sjednotit na chování souhrnné faktury.** Řekni ano nebo ne.

### 8. Jména zákazníků ve veřejném žebříčku odměn
Když je zapnuté „Kolegové vidí celý žebříček“, každý člen vidí u řádků kolegů
i jména zákazníků a čísla zakázek. **Doporučuji jména u cizích řádků skrýt.**

### 9. Záruční list a datum záruky
Záruční list počítá `{{warranty.until}}` z délky záruky v nastavení dokumentů.
Nová `{{ticket.warrantyUntil}}` je datum na zakázce (z nastavení Reklamace a
ceníku). Chceš do výchozí šablony záručního listu tu novou?

## D. Data a zákazníci

### 10. Migrace ze Zakázkového listu naostro
Skript `scripts/migrace-zl/` ještě neběžel proti skutečnému účtu.

```bash
cd scripts/migrace-zl && npx playwright install chromium && node migrace.ts zkouska
```

Pak `node migrace.ts --pobocka "iSwap"` (zeptá se na e-mail a heslo do ZL,
nikam se neukládají). Výstup nahraj v Nastavení → Firma → Migrace z jiného
systému **nejdřív do testovacího servisu** (TEST2). Postup: `scripts/migrace-zl/README.md`.

### 11. Anonymizace zákazníků
Nastavení → Firma → Ochrana údajů: zapni pravidlo (výchozí 5 let), klikni
„Zobrazit náhled“ a potvrď slovem ANONYMIZOVAT. První běh spusť mimo provozní
dobu. Noční běh se zapne až po tvém ručním potvrzení. Co se maže a co ne:
`docs/GDPR_ANONYMIZACE.md`.

### 12. Právní texty
Obchodní podmínky, zpracovatelská smlouva a identita provozovatele na webu.
Právník. Texty dokumentů (LEGAL_TEXTS) taky chtějí kontrolu.

### 13. Pilot
Dva až tři cizí servisy. Onboarding, průvodci, ukázková data a migrace jsou
hotové. Bez pilotu se nedozvíme, co je nesrozumitelné.

## E. Stripe (až budeš prodávat)
Postup v `docs/STRIPE.md` a `docs/PLATBY_DEN_D.md`: založit účet, testovací
klíče do Supabase secrets, ceny namapovat na moduly. Napojení je předpřipravené.
