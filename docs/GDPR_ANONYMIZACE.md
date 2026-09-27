# Anonymizace starých zákazníků (GDPR)

Servis je správce osobních údajů svých zákazníků a nesmí je držet déle, než
potřebuje (čl. 5 odst. 1 písm. e) GDPR – omezení uložení). Export a výmaz
celého servisu už Jobi umí (Owner panel), chybělo pravidlo pro běžný provoz:
**zákazník, který nemá žádnou zakázku mladší než N let, se anonymizuje.**

Kde: **Nastavení → Firma → Ochrana údajů** (jen majitel a správce servisu).

| Soubor | Co dělá |
|---|---|
| `supabase/migrations/20260927120000_anonymizace_zakazniku.sql` | výběr kandidátů, náhled, provedení, protokol, denní cron |
| `supabase/functions/gdpr-anonymizace/index.ts` | spuštění pod service_role a mazání souborů přes Storage API |
| `src/lib/anonymizace.ts` (+ test) | stejné pravidlo v čisté podobě, nastavení, potvrzovací slovo |
| `src/pages/Settings/GdprAnonymizaceSection.tsx` | přepínač, počet let, náhled, dialog, protokol |

---

## 1. Kdo je kandidát

- **Poslední aktivita** = nejpozdější datum z jeho zakázek (přijetí
  `created_at` i vydání `completed_at`), reklamací (založení, přijetí, vydání,
  dokončení) a faktur (datum vystavení).
- **Ne podle karty zákazníka.** Kartu může kdokoli upravit a import ze
  starého systému ji založí dnes, i když poslední zakázka je z roku 2018.
  Jen zákazník bez jediné zakázky, reklamace i faktury se řídí datem
  založení karty (jinak by se čerstvě založená karta anonymizovala hned).
- **Nikdy**, když má otevřenou zakázku nebo reklamaci (ne v koncovém stavu
  a nesmazaná; neznámý stav se bere jako otevřený).
- **Nikdy**, když má nezaplacenou fakturu (vystavená / odeslaná / po
  splatnosti bez data úhrady) – pohledávku je potřeba vymáhat. Koncept
  faktury není doklad a nechrání.
- Počet let: 3–10, výchozí 5. Hranice je kalendářní (`now() - N let`).
- **Zakázky bez karty zákazníka** (jméno a telefon jen na zakázce, typicky
  staré importy) se posuzují každá sama za sebe stejnými pravidly.

## 2. Co se smaže a co zůstane

### Smaže se (nebo nahradí)

| Kde | Co |
|---|---|
| karta zákazníka | jméno → „Anonymizovaný zákazník #1a2b3c4d“ (začátek id, ať jdou karty od sebe rozeznat), telefon, normalizovaný telefon, e-mail, adresa, info, poznámka; `anonymized_at` = teď |
| historie karty (`customer_history`) | celá – jsou v ní jen staré kontakty a adresy |
| zakázky zákazníka | stejné jméno, telefon, e-mail, adresa, info; **kód k zařízení**; podpis převzetí; fotky před i po opravě; odkaz do portálu (token a platnost); otisk schválení nabídky (IP adresa, prohlížeč, poznámka zákazníka) |
| historie zakázky (`ticket_history`) | z každého záznamu klíče s osobními údaji (jméno, kontakty, adresa, kód, podpis, fotky, portál); záznam „upraveno“, ve kterém nic nezbylo, zmizí |
| reklamace zákazníka | jméno, kontakty, adresa, info, kód k zařízení |
| úložiště `diagnostic-photos` | fotky ve složce zakázky, fotky podle odkazů u zakázky a podpisy `signatures/<zakázka>-…` |
| SMS | konverzace k dotčeným zakázkám nebo na telefon zákazníka, **ve kterých se od hranice nic nedělo**, i se zprávami |
| portál (`ticket_portal_events`) | `meta` (IP, prohlížeč, odkaz na podpis); událost a čas zůstávají |
| log automatizací (`automation_runs`) | detail („SMS na +420…“, „E-mail na …“); předpona `event:<id>` zůstává kvůli odfiltrování zpracovaných událostí |
| online rezervace, ze které vznikla zakázka | jméno, telefon, e-mail, poznámka |

### Zůstane – a proč

- **Faktury a jejich položky beze změny.** Účetní doklad se archivuje 10 let
  (§ 31–32 zákona o účetnictví, § 35 zákona o DPH) a musí obsahovat
  odběratele. To je zákonná povinnost podle čl. 6 odst. 1 písm. c) GDPR –
  na faktury se výmaz nevztahuje. Karta zákazníka zůstává na fakturu
  navázaná (`customer_id`), jen už bez kontaktů.
- **Zakázka jako záznam**: číslo, zařízení včetně IMEI a sériového čísla,
  popis závady, opravy, ceny, stavy, data. Potřebují je statistiky, provize,
  odměny a historie zařízení (stejné IMEI přijde znovu s jiným majitelem).
  Samotné IMEI bez jména a telefonu už na konkrétního člověka neukazuje.
- **IČO, DIČ a název firmy** na kartě i na zakázce. Identifikují právnickou
  osobu nebo podnikatele, jsou veřejně v obchodním a živnostenském rejstříku
  (ARES) a stejně zůstávají na fakturách, které se mazat nesmí. Smazáním
  z karty by se nic neochránilo, jen by se přetrhla vazba karty na
  doklady. **Pozor na OSVČ:** tam je v názvu firmy obvykle jméno člověka –
  pořád jde o údaj z veřejného rejstříku vázaný na doklady, ale kdyby to
  servis chtěl přísněji, stačí v `anonymizace_provest` přidat
  `company = null`/`customer_company = null` u karet bez faktury.
- **Volný text, který Jobi neumí rozebrat**: poznámky zakázky, diagnostika,
  interní komentáře (`ticket_comments`), poznámka k důvodu storna. Pokud do
  nich technik píše jméno nebo telefon zákazníka, zůstanou. V UI je na to
  upozornění.
- **Živé SMS konverzace** (poslední zpráva po hranici) – s tím číslem se
  zjevně pořád komunikuje, i když na kartě je stará zakázka.
- **Chat týmu, nápověda, logy chyb** – interní, zákazník v nich není
  evidovaný. Logy chyb mají vlastní dobu uchování.
- **Zálohy.** Denní záloha (`docs/ZALOHY_DATABAZE.md`) drží data 90 dní
  a Supabase má vlastní zálohy. Anonymizovaný údaj tak v záloze dožije do
  její expirace – to je v pořádku, dokud se ze zálohy neobnovuje do provozu.
  Po obnově ze zálohy se pravidlo příští noc samo uplatní znovu (ruční
  potvrzení je v obnovené tabulce protokolu taky).

## 3. Pojistky

Anonymizace je **nevratná** (ani ze zálohy aplikace se jednotlivý zákazník
zpátky nedostane). Proto:

1. **Náhled** („Zobrazit náhled“) nic nemění – ukáže počet zákazníků,
   zakázek bez karty, dotčených zakázek a souborů a seznam (nejstarší
   napřed, nejvýš 300 řádků).
2. **Potvrzení napsáním slova `ANONYMIZOVAT`** – kontroluje dialog, edge
   funkce i databáze.
3. **Jen majitel nebo správce** servisu (`is_owner_or_admin`). Počet let se
   ukládá přes `anonymizace_nastavit` (jen správce), ne obecným
   `update_service_settings`, které by pustilo i člena s právem nastavení.
4. **První běh nikdy automaticky.** Denní úloha servis zpracuje, jen když
   v protokolu je ruční běh se **stejným nebo přísnějším** počtem let. Když
   správce pravidlo zpřísní (5 → 3 roky), noc ho nepoužije, dokud ho znovu
   ručně nepotvrdí. Zmírnění (5 → 7) běží hned. Kdyby nastavení přepsal
   někdo jiný (přímo v configu), cron pořád nepoužije nic nepotvrzeného.
5. **Soubory jen vlastního servisu.** Odkaz u zakázky je zapisovatelný, takže
   se maže jen cesta ve složce servisu nebo podpis dotčené zakázky – a ne
   soubor, na který se ještě odkazuje jiná zakázka (sloučené zakázky sdílejí
   fotky).
6. **Zámek** (`pg_advisory_xact_lock`) – ruční běh a cron téhož servisu
   nepoběží naráz.
7. **Protokol** `gdpr_anonymizace_log`: kdy, kdo (ručně/cron), pravidlo,
   počty a id anonymizovaných karet a zakázek (po anonymizaci nic
   neprozradí, ale dá se podle nich doložit, že a kdy se karta
   anonymizovala). Denní úloha bez práce nic nezapisuje.

## 4. Jak to běží

```
Aplikace ──► edge funkce gdpr-anonymizace ──► RPC anonymizace_provest (service_role)
   (token správce, slovo)                         │  databáze v jedné transakci
                                                  └► fronta souborů v protokolu
             ◄── smaže soubory přes Storage API, odškrtne je (anonymizace_soubory_hotovo)

pg_cron 2:40 UTC ─► gdpr_anonymizace_tick() ─► pg_net ─► edge funkce { secret }
   1. dočistí frontu souborů po dřívějších bězích
   2. anonymizace_cron_servisy() → pro každý potvrzený servis anonymizace_provest('cron')
```

- Ruční běh jde přes edge funkci, protože přímé RPC z aplikace má časový
  limit dotazu 8 s a první běh u velkého servisu ho může přetáhnout (pak se
  jen celý vrátí zpět – nic se nepoškodí). Když funkce ještě není nasazená
  (404), aplikace zavolá `anonymizace_spustit` napřímo; databáze se
  anonymizuje stejně a soubory počkají ve frontě.
- Soubory se z SQL mazat nedají (Supabase přímé mazání ze `storage.objects`
  zakazuje), proto fronta. Nesmazané soubory ukazuje protokol v Nastavení.
- První běh u servisu s tisíci zakázek pošle přes realtime tisíce změn –
  spusťte ho mimo provozní dobu.

## 5. Nasazení

Pořadí je jedno, ale bez funkce se nemažou soubory a bez migrace nefunguje nic.

1. **Migrace**

   ```
   npx supabase db push
   ```

   Pozor, `db push` pustí všechny dosud nenasazené migrace, ne jen tuhle.
   Migrace sama založí tajemství `gdpr_anonymizace_cron_secret` ve Vaultu
   a naplánuje úlohu `jobi-gdpr-anonymizace`.

2. **Edge funkce**

   ```
   npx supabase functions deploy gdpr-anonymizace --no-verify-jwt
   ```

3. **Kontrola v SQL editoru**

   ```sql
   select name from vault.secrets where name = 'gdpr_anonymizace_cron_secret';
   select jobname, schedule, active from cron.job where jobname = 'jobi-gdpr-anonymizace';
   ```

   Kdyby tajemství chybělo (Vault se při migraci nepodařilo použít):

   ```sql
   select vault.create_secret(
     encode(extensions.gen_random_bytes(32), 'hex'),
     'gdpr_anonymizace_cron_secret',
     'Sdílené tajemství pro plánované volání edge funkce gdpr-anonymizace (pg_cron → pg_net).'
   );
   ```

4. **Zkouška tiku** (nic neanonymizuje, dokud žádný servis nemá ruční
   potvrzení – jen dočistí frontu):

   ```sql
   select public.gdpr_anonymizace_tick();
   select status_code, content from net._http_response order by created desc limit 1;
   -- čeká se 200 a {"ok":true,"fronta":{…},"servisu":0,"vysledky":[]}
   ```

5. **Sondy oprávnění** – `scripts/rls-probe.sql`, série 950–960.

6. **Vyzkoušet na TEST2**, ne na ostrém servisu: zapnout pravidlo, náhled,
   spustit, zkontrolovat kartu, zakázku, historii, SMS a že fotka v úložišti
   zmizela; fakturu, že se nezměnila.

## 6. Co zůstává otevřené

- **Detail zakázky** zatím anonymizaci nijak neoznačuje (jen jménem
  „Anonymizovaný zákazník“) a historie zakázky o ní nemá záznam – záznam je
  v protokolu servisu. `Orders.tsx` se v tomhle kroku neměnil.
- **Online rezervace, ze které nikdy nevznikla zakázka,** se nepočítá – nemá
  vazbu na zákazníka. Rezervace mají krátký život, ale pravidlo pro ně chybí.
- **Reklamace bez karty i bez zdrojové zakázky** se neanonymizují.
- **`ticket_documents`** (uložené PDF) aplikace dnes nepoužívá; kdyby se
  začala používat, patří do mazání souborů.
- Nic z toho není vyzkoušené proti skutečnému Supabase: SQL je ověřené na
  čistém Postgresu 17 s napodobeným schématem (výběr, anonymizace, historie,
  SMS, soubory, oprávnění, cron pojistka), edge funkce a UI jen typovou
  kontrolou.
