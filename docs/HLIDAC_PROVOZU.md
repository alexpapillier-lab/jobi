# Hlídač provozu

Hlídači jsou dva a dělají opačnou práci:

| | **Hlídač chyb** (od 5. 9. 2026) | **Syntetický hlídač** (od 12. 9. 2026) |
|---|---|---|
| Odkud ví o poruše | z chyb, které nahlásili uživatelé (`error_logs`) | sám zkusí hlavní cestu zvenčí |
| Jak často | jednou za hodinu (pg_cron) | každých 15 minut (GitHub Actions) |
| Kde je | `supabase/functions/alerts-check` | `scripts/hlidac/`, workflow `hlidac.yml` |
| Pozná poruchu, když nikdo nepracuje | ne | ano |

Oba posílají e-mail **stejnou cestou** – přes `alerts-check`, na adresu ze
secretu `ALERT_EMAIL` a se stejným tlumením v `alert_events`.

---

# Část 1: hlídač chyb

Chyby z aplikace padají do tabulky `error_logs`, ale sama od sebe se do ní
nikdo nedívá. Od 5. 9. 2026 se na ni jednou za hodinu podívá edge funkce
`alerts-check` a při něčem nezdravém pošle e-mail.

## Kdy přijde e-mail

| Druh | Podmínka |
|------|----------|
| `pady_aplikace` | 2 a víc pádů vykreslení (`react.render_crash`) za hodinu |
| `hodne_chyb` | 5 a víc ostatních chyb za hodinu |
| `opakovana_chyba:<kód>` | jedna chyba 10× v jednom servisu |

Stejné upozornění nepřijde znovu dřív než za 6 hodin – jinak by při delším
výpadku chodil e-mail každou hodinu a člověk si ho odfiltruje do koše.
Odeslaná upozornění drží tabulka `alert_events` (přístup má jen service_role).

Chyby z vývojového serveru se přeskakují: `logError` je označí `context.dev`,
protože hot reload běžně vyrábí „Should have a queue“ a zákazníka se to netýká.

## Kam e-mail chodí

Na adresu ze secretu `ALERT_EMAIL`. Když není nastavený, použije se e-mail
root ownera z `auth.users`. Odesílá se přes Resend (`RESEND_API_KEY`,
`RESEND_FROM_EMAIL` – stejné klíče jako pozvánky a faktury).

```bash
npx supabase secrets set ALERT_EMAIL=alex@example.cz
```

## Jak to běží

`pg_cron` úloha `jobi-alerts` (`5 * * * *`) volá `public.alerts_tick()`, ta
přes `pg_net` zavolá funkci se sdíleným tajemstvím z Vaultu
(`alerts_cron_secret`). Stejný postup jako u automatizací.

Funkce má `verify_jwt = false`, dovnitř se dostane jen s tím tajemstvím nebo
s tokenem root ownera.

## Ruční zkouška

Nanečisto, bez odeslání e-mailu (token root ownera):

```bash
curl -s -X POST https://ijtvcgolsdsrquqbvjrz.supabase.co/functions/v1/alerts-check \
  -H "Content-Type: application/json" -H "Authorization: Bearer <token>" \
  -d '{"windowMinutes":1440,"dryRun":true}'
```

Odpověď řekne, co by odešlo (`would_send`) a co je utlumené (`suppressed`).
Bez `dryRun` se e-mail opravdu pošle.

## Co tu zatím není

Stavová stránka pro zákazníky (status page). Upozornění na to, že aplikace
neběží vůbec, řeší od 12. 9. 2026 syntetický hlídač níž – ale i ten jede na
cizí infrastruktuře (GitHub Actions), ne na té naší.

---

# Část 2: syntetický hlídač

**Proč vznikl.** 12. 9. 2026 nasazení rozbilo zákaznický portál: čtení
fungovalo, ale každá akce zákazníka (schválení nabídky, podpis převzetí,
potvrzení vyzvednutí) vracela 500. Přesun pomocných funkcí do `_shared`
nechal v `portal-ticket` volání `clientIp`, které už neexistovalo. Hlídač
chyb o tom nevěděl – chyba byla na serveru, ne v prohlížeči, takže se do
`error_logs` nic nezapsalo. Přišlo se na to náhodou při testech. Až Jobi
používají zákazníci, tohle nesmí čekat na stížnost.

Syntetický hlídač proto **sám zkouší, jestli aplikace funguje**, a nečeká,
až se někdo ozve. Jede každých 15 minut v GitHub Actions (workflow
`Hlídač provozu`, `.github/workflows/hlidac.yml`) a jeden běh trvá **kolem
čtyř sekund**; s druhým pokusem po poruše necelých třicet.

## Co kontroluje

Pracuje výhradně v **E2E testovacím servisu** (`882beee7-…`) pod účtem
`e2e@jobi.test` – tím samým, který používají E2E testy. Do ostrých servisů se
nedostane: id iSwapu a MajkaPajky jsou v `ZAKAZANE_SERVISY` a `overAdresu()`
odmítne odeslat požadavek, ve kterém by se objevila.

| Kontrola | Co udělá | Co poplach znamená |
|---|---|---|
| `prihlaseni` | přihlásí se heslem jako člověk | **Nikdo se do aplikace nedostane.** Nejzávažnější, obvykle Auth nebo celý projekt. |
| `databaze` | jeden dotaz přes PostgREST, měří čas | Databáze neodpovídá, nebo trvá přes 5 s. |
| `seznam` | načte 20 posledních zakázek | Servis po přihlášení uvidí prázdno. Bývá to RLS, ne síť. |
| `zalozeni` | založí zakázku `HLIDAC-…` bez telefonu a e-mailu | **U pultu nejde přijmout zařízení.** |
| `portal_cteni` | vydá odkaz (`ensure_portal_token`) a otevře ho bez přihlášení | Odkaz, který zákazník dostal, se neotevře. |
| `portal_akce` | rozešle nabídku a **schválí ji z portálu** | Zákazník nemůže schválit nabídku ani podepsat převzetí. **Tohle je ta kontrola, kvůli které hlídač vznikl.** |
| `smazani` | smaže zakázku (`soft_delete_ticket`) a ověří to dotazem | Zakázku nejde odstranit ze seznamu. |
| `cenik` | veřejný ceník `public-catalog?service=e2e-servis` | Ceník vložený na webu servisu se nenačte. Kontroluje se tvar odpovědi, ne kolik je v ní oprav (viz níž), a to, že ven nejdou nákupní ceny. |
| `rezervace` | nastavení formuláře `public-booking` (**jen GET**) | Zákazník se z webu servisu neobjedná. |
| `edge_funkce` | OPTIONS na `api-write`, `capture-upload`, `sms-send`, `invoice-export`, `public-inventory` | Funkce není nasazená – brána na ni vrací 404. |
| `web` | `appjobi.com/z/`, `appjobi.com/servis/` a balíček aplikace | Stránka nebo balíček se nenačte, zákazník uvidí bílou obrazovku. |
| `uklid` | pojistka: zakázka hlídače nezůstala v seznamu | V testovacím servisu leží zakázka z kontroly. |

Kontroly na sobě závisí (`zavisiNa`). Když spadne přihlášení, ty navazující
se **přeskočí**, ne nahlásí – jinak by z jedné poruchy vzniklo šest hlášek.
Přeskočení se dědí dál.

### Proč `portal_akce` musí být skutečná akce

Kontrola, která odkaz jen otevře, poruchu z 12. 9. nepozná – čtení fungovalo.
A poslat `action: "neco"` taky nestačí: neznámá akce se odmítne dřív, než se
kód vůbec dostane k té části, kde chyba byla. Musí to být opravdové schválení
nabídky. Ze čtyř akcí portálu je nejneškodnější: nic nenahrává do úložiště,
nikomu nic neposílá a celá zakázka za pár sekund zmizí.

### Proč zakázka hlídače nemá telefon ani e-mail

Je to jediná tvrdá pojistka proti tomu, aby hlídač poslal SMS nebo e-mail
zákazníkovi. Kdyby si v testovacím servisu někdo zapnul automatizaci na
událost „nabídka schválena“, akce `sms` i `email` se bez kontaktu **přeskočí**
(`actionSms`: „Zákazník nemá telefon“). Jediný e-mail, který smí z hlídače
vzniknout, je hlášení o poruše majiteli aplikace.

## Porucha vs. výpadek sítě běhu

**Jeden neúspěch není porucha.** Runner GitHubu občas na pár sekund ztratí síť
a Supabase má vlastní krátká zaškobrtnutí. Kdyby se hlásil první neúspěch,
chodily by e-maily, které při ručním ověření vypadají v pořádku – a to je
nejrychlejší způsob, jak si hlídače člověk odfiltruje do koše.

Hlídač proto po neúspěchu **počká 20 sekund a zopakuje celý běh od začátku**:
nové přihlášení, nová zakázka, nový odkaz do portálu. Hlásí se jen to, co
spadlo v **obou** pokusech. Co spadlo jen napoprvé, se vypíše jako `Kolísání`
a e-mail z toho není.

Druhý pokus je schválně **ve stejném běhu**, ne až za dalších 15 minut:

* porucha se má ohlásit do pár minut, ne za půl hodiny;
* mezi běhy by si hlídač musel někde držet stav. Cache GitHub Actions se
  čistí a maže po sedmi dnech nepoužití, tabulka na to v databázi není a
  `alert_events` je na něco jiného. Stav, na kterém závisí poplach, ale
  nesmí být na místě, které tiše zmizí.

Dvě zaškobrtnutí 20 sekund po sobě jsou už samy o sobě zpráva.

## Tlumení: proč nechodí 96 e-mailů denně

Hlásí se do `alerts-check` (`{ source: "hlidac", selhani: […] }`), který
použije **úplně stejné tlumení** jako u chyb: podle `kind` se v `alert_events`
podívá, jestli už to samé neodešlo za posledních 6 hodin. Při probíhajícím
výpadku tak jde ven **jedna zpráva za šest hodin**, ne 96 za den.

Aby to fungovalo, musí být `kind` **stabilní**. Odvozuje se proto jen z té
**nejzávažnější** spadlé kontroly (`hlidac:prihlaseni`, `hlidac:portal_akce`,
…), ostatní jsou vypsané v těle e-mailu. Kdyby se `kind` skládal ze seznamu
selhání, stačilo by, aby při dalším běhu spadla o jednu kontrolu víc, a
`alert_events` by ten poplach považovalo za nový. Hlídá to test
`src/lib/hlidac.test.ts` („kind se nemění, když k téže poruše přibude další
spadlá kontrola“).

Adresa majitele, klíč k Resendu ani text e-mailu se v hlídači neopakují –
je to na jednom místě, v `alerts-check`. Druhé místo, kde se posílají
e-maily, je druhé místo, kde může chybět klíč.

**Když se poplach nepodaří odeslat**, hlídač skončí s návratovým kódem 2 a
job spadne. Aspoň GitHub pak pošle upozornění o neúspěšném běhu – hlídač,
který mlčí, je horší než porucha sama.

## Co je potřeba nastavit

1. **Secrets v repozitáři** (Settings → Secrets and variables → Actions):
   `E2E_PASSWORD`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (stejné jako
   u E2E testů) a `HLIDAC_SECRET`.

   `HLIDAC_SECRET` je totéž tajemství, kterým volá `alerts-check` pg_cron –
   `alerts_cron_secret` z Vaultu. Sdílí se schválně: kdo ho má, může nanejvýš
   spustit kontrolu a poslat majiteli e-mail, který je stejně utlumený na
   jeden za šest hodin.

   ```bash
   npx supabase db query --linked -c \
     "select decrypted_secret from vault.decrypted_secrets where name='alerts_cron_secret'"
   gh secret set HLIDAC_SECRET --repo alexpapillier-lab/jobi
   ```

2. **Nasadit `alerts-check`** – bez toho neumí hlášení hlídače přijmout a
   odpoví, jako by se nic nedělo (`alerts: 0`):

   ```bash
   npx supabase functions deploy alerts-check
   ```

3. **Nasadit migraci** `20260912180000_hlidac_uklid.sql` (`npm run db:migrate`).
   Zakázku nejde smazat natvrdo – DELETE politika na `tickets` je
   restriktivní a povolující žádná není, takže `authenticated` řádek
   neodstraní (a nemá: zakázku v koši musí jít vrátit). Hlídač ji tedy dává
   do koše a denní úloha `jobi-uklid-hlidace` odtud po dvou dnech maže
   zakázky `HLIDAC-%` **jen v E2E servisu**. Bez toho by v koši přibývalo
   96 zakázek denně, tedy asi 35 000 za rok.

## Ruční spuštění a místní zkouška

```bash
# jen zkontroluj a vypiš, nic neposílej
E2E_PASSWORD='…' npm run hlidac

# heslo ze souboru, ať se neobjeví v historii shellu
HLIDAC_HESLO_SOUBOR=~/.jobi-e2e-heslo npm run hlidac

# kratší pauza mezi pokusy (výchozí 20 s)
E2E_PASSWORD='…' node scripts/hlidac/hlidac.mjs --pauza=3000
```

V GitHubu: Actions → Hlídač provozu → Run workflow. Zaškrtnutím **nanecisto**
se poplach spočítá, ale e-mail neodejde (`alerts-check` vrátí `would_send`).

Návratové kódy: `0` v pořádku (i kolísání), `1` porucha, `2` porucha, kterou
se nepodařilo ohlásit, `3` spadl sám hlídač.

## Limity: hlídač do nich nesmí narazit ani je vyčerpat ostatním

Spočítáno na skutečném běhu (`docs/LIMITY.md` má stropy).

Jeden běh udělá **9 volání edge funkcí** (portál 2×, ceník, rezervace,
5× OPTIONS), 8 dotazů přes PostgREST a GoTrue a 4 požadavky na
appjobi.com (Cloudflare Pages).

| Limit | Strop | Hlídač za minutu | Využití |
|---|---:|---:|---:|
| `portal-ticket` čtení, otisk volajícího | 120/min | 1 (2 s druhým pokusem) | 1,7 % |
| `portal-ticket` akce, otisk volajícího | 30/min | 1 (2 s druhým pokusem) | 6,7 % |
| `portal-ticket`, token | 60/min | 2 (každý běh má nový token) | 3,3 % |
| `public-catalog`, otisk IP | 60/min | 1 | 1,7 % |
| `public-catalog`, servis | 600/min | 1 | 0,2 % |
| `public-booking` GET | nepočítá se | 1 | – |
| OPTIONS na edge funkce | nepočítá se | 5 | – |

**Nikomu nic neubere.** Limity se počítají na otisk volajícího (runner
GitHubu, ne zákazník) a na `service_id` (e2e-servis, ne zákaznický servis).
Rezervace se schválně **nezakládá**: POST má strop 10 za hodinu z adresy a
každých 15 minut by v Kalendáři testovacího servisu přibyl řádek.

**Kolik po sobě nechá v tabulkách limitů.** `rate_hits` dostane 1–2 řádky za
běh (kanál `portal-ticket`, klíč = otisk IP runneru solený dnem, řádek na
minutu), tedy nejvýš 192 denně; `rate_hits_uklid` maže starší než dva dny,
takže se to ustálí pod 400 řádky. `api_read_hits` dostane 1 řádek za běh
a drží se 30 dní → necelé 3 000 řádků. Obojí je zaokrouhlovací chyba.

**Kolik to stojí.** 96 běhů denně × 9 volání = 864 denně, zhruba
**26 000 volání edge funkcí měsíčně** (s občasným druhým pokusem do 30 000).
Plán Pro jich zahrnuje 2 miliony – hlídač spotřebuje **1,5 %**. Viz
`docs/KAPACITA.md`. GitHub Actions jsou u veřejného repozitáře zdarma; kdyby
se repozitář zavřel, 96 běhů denně po jedné účtované minutě dělá asi
2 900 minut měsíčně a interval by se musel prodloužit.

## Jak ho vypnout

* **Na chvíli:** Actions → Hlídač provozu → `…` → **Disable workflow**.
* **Jen e-maily:** smazat secret `HLIDAC_SECRET`. Kontroly poběží dál a je
  vidět v záznamech, ale poplach neodejde (a job spadne, ať je to poznat).
* **Nadobro:** smazat `.github/workflows/hlidac.yml`. `scripts/hlidac/`
  zůstane použitelný ručně.
* Pozor: GitHub sám vypíná plánované workflow v repozitáři, kde se 60 dní nic
  neděje. Pošle o tom e-mail; obnoví se tlačítkem **Enable workflow**.

## Jak přidat další kontrolu

1. Do `scripts/hlidac/kontroly.mjs` přidat objekt s `id`, volitelným
   `zavisiNa` a `spust(stav)`. Funkce buď vrátí větu do výpisu, nebo zavolá
   `selhani("proč")`. Závislost musí být v poli **dřív**.
2. Do `KONTROLY` v `supabase/functions/_shared/hlidac.ts` přidat stejné `id`,
   název a **dopad na zákazníka** – tenhle text je to, co se objeví v e-mailu.
   Pořadí v poli je závažnost; nová kontrola patří tam, kde odpovídá tomu,
   jak moc zákazníkovi vadí.
3. Pustit `npx vitest run src/lib/hlidac.test.ts`. Test hlídá, že oba seznamy
   sedí, že závislosti ukazují dozadu a že se hlídač nedotýká ostrých servisů.
4. Pustit `npm run hlidac` a pak ho **zkusit i rozbitý** – kontrola, která
   nikdy nespadla, nic nehlídá.

Co do hlídače **nepatří**: cokoli, co něco pošle zákazníkovi (SMS, e-mail,
rezervace), cokoli v ostrém servisu a cokoli, co po sobě neumí uklidit.

## Co hlídač neuhlídá

* **Rozbité vykreslení v prohlížeči.** Hlídač nespouští React. Bílou
  obrazovku pozná hlídač chyb z `react.render_crash`, ale až podle toho, že
  do ní někdo narazil. Hlídač zkontroluje jen to, že se balíček aplikace
  z appjobi.com vůbec stáhne a není prázdný.
* **Chyby, které se projeví jen na zákaznických datech.** Hlídač má jednu
  čerstvou zakázku bez historie. Rozbité počítání marže na tisícovce zakázek
  nebo pomalá stránka statistik z něj nevypadnou.
* **Věci, které se nezkoušejí, protože by něco poslaly.** SMS, e-maily
  z automatizací, odeslání faktury, založení rezervace. U nich se kontroluje
  jen to, že je funkce nasazená (OPTIONS), ne že opravdu doručí.
* **Desktopová aplikace a JobiDocs.** Hlídač zná jen webovou větev a API.
* **Pomalost pod zátěží.** Měří jednu odpověď, ne chování při provozu; na to
  je `npm run zatez` (`docs/ZATEZ.md`).
* **Poruchy kratší než 15 minut.** Mezi běhy je slepé místo.
* **Vlastní výpadek GitHub Actions.** Když neběží runner, neběží hlídač a
  nikdo to neohlásí – hlídač hlídače tu není. Proto je i hlídač chyb, který
  jede na pg_cronu v databázi: obě cesty mají spadnout naráz jen tehdy, když
  je opravdu zle.
