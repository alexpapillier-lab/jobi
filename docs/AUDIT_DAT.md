# Audit skutečných dat (7. 9. 2026)

Průchod produkční databází Supabase (`ijtvcgolsdsrquqbvjrz`), **jen čtení**. Nic se
neopravovalo, nic nemazalo. Opravné dotazy, které jsou v dokumentu uvedené, se
**nespouštěly** – jsou tu k ručnímu odsouhlasení.

Rozsah: všech 7 servisů. Ostré jsou dva:

| servis | id | zakázky | reklamace | faktury | zákazníci | členové |
|---|---|---:|---:|---:|---:|---:|
| iSwap Repair Point Praha | `d9762a27-6c8d-43c4-9207-5c837e2713a0` | 3 590 | 120 | 1 (smazaná) | 2 149 | 2 |
| MajkaPajka | `9a34c559-2af7-4537-9d0e-ce87e5936c4b` | 81 | 4 | 0 | 58 | 2 |
| E2E testovaci servis | `882beee7-4564-4d10-8ac6-16dc19240b57` | 2 222 | 397 | 205 | 2 010 | 3 |
| TEST2 | `bbc926bd-25ba-4da1-b528-92b6f1dee24d` | 54 | 3 | 5 | 9 | 7 |
| Servis Novák (ukázkový) | `72de5c11-6c2d-486a-9a44-dd0a9060cf97` | 17 | 0 | 4 | 17 | 2 |
| Zkušební servis Novák | `6a84e88f-a4ba-4b2b-b8e4-00c5c86b9f23` | 1 | 0 | 0 | 0 | 2 |
| Druhý zkušební servis | `f4ac187a-1cc7-4e30-86ee-f88c3c4c0ef7` | 0 | 0 | 0 | 0 | 2 |

**Dobrá zpráva na úvod.** Většina toho, co se hledalo, v datech vůbec není:
žádný osiřelý řádek (cizí klíče drží), žádné křížení mezi servisy (zakázka
s pobočkou nebo zákazníkem jiného servisu = 0), žádná faktura bez položek,
žádný dobropis bez originálu, žádná záporná zásoba, žádný stav zakázky, který
by v `service_statuses` neexistoval, žádné duplicitní číslo faktury ani
reklamace, žádné členství bez účtu. **A duplicitní čísla zakázek, kvůli kterým
audit vznikl, už v živých datech nejsou** – viz B1.

---

## A. Je potřeba srovnat ručně

### A1. iSwap: příští zakázka dostane číslo v úplně jiné řadě  🔴 nejzávažnější

Všech 3 590 historických zakázek má tvar `IRPAZ` + rok + **5 číslic**
(`IRPAZ2601547`). Zkratka servisu v nastavení je ale `IRP`, a generátor skládá
číslo jako *zkratka + kód pobočky + rok +* **6 číslic**. Pobočka „Hlavní“ nemá
kód, takže **první zakázka založená v aplikaci dostane `IRP26000001`** – nová
řada od jedničky, jiný počet číslic, a v seznamu se seřadí vedle importovaných
`IRPAZ26…`.

Že se to ještě nestalo, potvrzuje chybějící čítač: `ticket_code_counters` pro
iSwap neexistuje, tzn. přes aplikaci se tam zatím nezaložila jediná zakázka
(poslední `created_at` = 3. 9. 2026, což je import; po importu 0 nových).

Stejné u reklamací, jen hůř: 120 historických má `IRPAR` + rok + 5 číslic, ale
generátor reklamací (`useWarrantyClaims.ts`, `makeWarrantyClaimCode`) zkratku
servisu **vůbec nečte** – skládá natvrdo `R` + rok. Příští reklamace bude
`R26000001`.

```sql
-- předpony, které servis skutečně používá, proti zkratce v nastavení
select s.name, ss.config->>'abbreviation' as zkratka_v_nastaveni,
       substring(t.code from '^[^0-9]*[0-9]{2}') as predpona_v_datech, count(*)
from tickets t join services s on s.id = t.service_id
left join service_settings ss on ss.service_id = s.id
where t.code is not null group by 1,2,3 order by 1,3;

-- servisy, které mají zakázky, ale nemají čítač (přes appku ještě nezaložily nic)
select s.name from services s
where exists (select 1 from tickets t where t.service_id = s.id)
  and not exists (select 1 from ticket_code_counters c where c.service_id = s.id);
```

**Co s tím:** v Nastavení iSwapu přepsat zkratku z `IRP` na `IRPAZ`, **než tam
založí první zakázku**. Pak `dalsi_cislo_zakazky` sama navazuje na nejvyšší
existující číslo (funkce se při prvním volání usadí podle `max()`), takže
z `IRPAZ2601547` plynule pokračuje `IRPAZ26001548`. Zbude jen rozdíl v počtu
číslic (5 → 6) – to už zpětně srovnat nejde a je to kosmetika.
Reklamace bez zásahu do kódu srovnat nejdou (viz C4).

### A2. iSwap: pořadová čísla faktur 1–5 jsou spálená, ale nikdy nevznikly

`invoice_series` má pro iSwap `next_value = 6`, přitom v databázi je jediná
faktura `FV2026-0002` a ta je smazaná (`deleted_at`). Čísla `FV2026-0001`,
`0003`, `0004`, `0005` neexistují a nikdy existovat nebudou. MajkaPajka má
`next_value = 2` při nule faktur, tedy `FV2026-0001` spálené také.
Číslo se totiž přiděluje už při **založení konceptu** a čítač se nikdy nevrací
(`next_invoice_number`, na rozdíl od zakázek se nedosazuje z `max()`).

```sql
select s.name, v.prefix, v.year, v.next_value,
  (select count(*) from invoices i where i.service_id = s.id and i.deleted_at is null) as skutecnych_faktur,
  (select max(substring(i.number from '[0-9]+$')::int) from invoices i where i.service_id = s.id) as nejvyssi_pouzite
from invoice_series v join services s on s.id = v.service_id order by 1;
```

**Co s tím:** dokud servis nevystavil jedinou fakturu, je čistší čítač vrátit na
1, aby první ostrá faktura byla `FV2026-0001`. Účetně se hodnotí souvislost
**vydaných** dokladů, a žádný vydaný zatím není. Dotaz (**nespouštět bez
rozmyslu, mění ostrá data**):

```sql
-- POUZE pokud servis opravdu nemá jedinou nesmazanou fakturu
update invoice_series v set next_value = 1
where v.service_id = 'd9762a27-6c8d-43c4-9207-5c837e2713a0'
  and not exists (select 1 from invoices i where i.service_id = v.service_id and i.deleted_at is null);
```

Jakmile iSwap vystaví první ostrou fakturu, tahle možnost mizí a díry v řadě
už se musí vysvětlovat účetní.

### A3. iSwap: fakturační modul zapnutý, ale doklad nemá kam poslat peníze

`service_entitlements.invoices = true`, firemní údaje vyplněné (IČO, adresa,
e-mail, telefon, web) – **kromě bankovního účtu, IBANu a SWIFTu, které jsou
prázdné**. První vystavená faktura vyjde bez čísla účtu i bez QR platby.
Totéž MajkaPajka (tam je ale modul faktur vypnutý, takže to nehoří).

```sql
select s.name,
  nullif(ss.config->'companyData'->>'bankAccount','') is not null as ma_ucet,
  nullif(ss.config->'companyData'->>'iban','') is not null as ma_iban,
  (select bool_or(e.active) from service_entitlements e where e.service_id=s.id and e.module='invoices') as modul_faktur
from service_settings ss join services s on s.id = ss.service_id order by 1;
```

**Co s tím:** doplnit v Nastavení → Fakturace. Ruční zásah zákazníka.

### A4. iSwap: 37 z 37 produktů má prodejní cenu 0 Kč – a jsou veřejné

Import naplnil nákupní ceny, prodejní ne. Všech 37 skladových položek má
`price = 0` a zároveň `public_visible = true`, takže **veřejný ceník servisu
ukazuje každý díl za 0 Kč** a přidání dílu na zakázku nic nepřipočte.
15 z nich navíc nemá vůbec řádek v `inventory_stock`, takže se u nich
nezobrazuje skladová dostupnost.

```sql
select s.name, count(*) as produktu,
  count(*) filter (where coalesce(p.price,0)=0) as cena_nula,
  count(*) filter (where p.public_visible and coalesce(p.price,0)=0) as verejne_za_nulu,
  count(*) filter (where not exists (select 1 from inventory_stock st where st.product_id=p.id)) as bez_radku_skladu
from inventory_products p join services s on s.id=p.service_id group by 1 order by 1;
```

MajkaPajka má obdobně 15 z 294 veřejných oprav za 0 Kč (jinak ceník v pořádku).

**Co s tím:** doplnit ceny ručně, nebo produkty do doladění schovat
(`public_visible = false`). Nedá se dopočítat.

### A5. iSwap: „Přesunuto do nevyzvednutých“ není koncový stav

13 zakázek v tomhle stavu (12 z nich starších než půl roku, nejstarší 417 dní)
se počítá jako **rozdělaná práce**: figurují v otevřených zakázkách, kazí
průměrnou dobu opravy i vytížení. Přitom stav `not_picked_up` („Nevyzvednuto“)
koncový je – dva stavy pro totéž, každý jinak nastavený.

```sql
select st.label, st.is_final, count(t.id) as zakazek,
       max(now()::date - t.created_at::date) as nejstarsi_dni
from service_statuses st
left join tickets t on t.service_id=st.service_id and t.status=st.key and t.deleted_at is null
where st.service_id='d9762a27-6c8d-43c4-9207-5c837e2713a0'
group by 1,2 having count(t.id) > 0 order by st.order_index;
```

**Co s tím:** v Nastavení → Stavy zaškrtnout „koncový“ u `moved_to_unclaimed`.
Jeden klik zákazníka. Při té příležitosti: **16 z 30 stavů iSwapu nepoužívá ani
jedna zakázka** (`board_repair_pistek`, `thai_camera`, `send_display_refurb`, …)
a zbytečně natahují rozbalovací seznam.

### A6. MajkaPajka platí za telefonní číslo, které nemá k čemu používat

`service_phone_numbers` má aktivní české Twilio číslo zřízené 25. 3. 2026, ale
`service_entitlements.sms` je `active = false`. Číslo běží (měsíční poplatek
u Twilia) a příchozí SMS na něj nikdo v aplikaci nevidí. V servisu leží
5 starých zpráv.

```sql
select s.name, p.active, p.provisioned_at::date,
  (select coalesce(bool_and(e.active),false) from service_entitlements e
     where e.service_id=s.id and e.module='sms') as modul_sms
from service_phone_numbers p join services s on s.id=p.service_id order by 1;
```

**Co s tím:** buď modul zapnout, nebo číslo u Twilia uvolnit. Rozhodnutí
majitele, ne data.

### A7. iSwap: dvě nepřijaté pozvánky s rolí *admin* stále platí

Pozvánky z 2. a 3. 9. 2026, platné do 16. a 17. 9., role `admin`. Kdokoli, kdo
má ten e-mail (přeposlaný, sdílená schránka), si může do ostrého servisu
udělat administrátorský přístup.

```sql
select s.name, i.role, i.created_at::date as pozvano, i.expires_at::date as plati_do
from service_invites i join services s on s.id=i.service_id
where i.accepted_at is null and i.expires_at > now() order by 1;
```

**Co s tím:** pokud ty dva lidi nemají nastoupit, pozvánky zrušit v Nastavení →
Tým. (Ostatní nepřijaté pozvánky – MajkaPajka 0, TEST2 7 – už propadly.)

### A8. Majitel aplikace je viditelný *owner* obou ostrých servisů

Účet `root_owner_id` (`f3b27eb3-…`) je v `service_memberships` veden jako
`owner` u iSwapu i MajkaPajky, a **není skrytý** (`skryty = false`). Skutečný
provozovatel je jen `admin` (MajkaPajka), resp. `member` (iSwap). Zákazník tedy
ve svém týmu vidí cizí účet a sám není majitelem vlastních dat.

```sql
select s.name, m.role, m.skryty,
  m.user_id = (select hodnota::uuid from app_nastaveni where klic='root_owner_id') as je_to_majitel_aplikace
from service_memberships m join services s on s.id=m.service_id
where s.id in ('d9762a27-6c8d-43c4-9207-5c837e2713a0','9a34c559-2af7-4537-9d0e-ce87e5936c4b')
order by 1,2;
```

**Co s tím:** rozhodnutí, ne chyba – ale před prodejem to chce srovnat: role
`owner` má patřit zákazníkovi, účet podpory má být `skryty = true`
(mechanismus z migrace `20260910150000_root_owner_skryty_clen.sql` existuje,
jen se na tyhle dva servisy nepoužil). Do té doby je iSwap v postavení, kdy
jeho jediný vlastní účet má nejnižší roli.

### A9. Fotky zařízení a podpisy zákazníků leží ve veřejném bucketu

`storage.buckets.diagnostic-photos.public = true`. RLS politiky
(`diagnostic_photos_select` – jen členové servisu) se přes veřejné URL
`/storage/v1/object/public/…` **neuplatní**; aplikace i edge funkce si adresy
skládají přes `getPublicUrl()`. V bucketu je 182 souborů (73 MB), z toho
2 podpisy zákazníka při převzetí (`signatures/…png`). Adresy jsou v zakázkách,
v zákaznickém portálu a v tištěných dokladech; platí navždy a bez přihlášení.

```sql
select id, public, (select count(*) from storage.objects o where o.bucket_id=b.id) as souboru
from storage.buckets b;
```

**Co s tím:** ~~buď bucket přepnout na neveřejný a přejít na podepsané odkazy,
nebo to vědomě nechat a napsat to do zásad zpracování údajů~~ — **vyřešeno
v kódu, čeká na nasazení.** Aplikace, portál i export si odkazy nechávají
podepsat (`createSignedUrl`, platnost hodina; export týden), do dokumentů se
obrázek vkládá dovnitř. Uložené URL v databázi se nemění – je z nich jen
identifikátor souboru, takže nebylo nutné sahat na data ostrých servisů.

Zbývá **poslední krok**: přepnout `storage.buckets.public` na `false`. Musí
přijít až po nasazení edge funkcí, portálu, aplikace a migrací, jinak fotky
zmizí dřív, než je bude kdo umět podepsat. Postup, kontroly i co dělat, kdyby
se něco neukázalo: **[BEZPECNOST_FOTKY.md](BEZPECNOST_FOTKY.md)**.

`product-images` zůstává veřejný schválně (veřejný ceník, API skladu).

---

## B. Vyřeší se samo / neškodí

### B1. Duplicitní čísla zakázek jsou vyřešená

`BC26000038` (3×) a `BC26000005` (2×) v MajkaPajce a `IRP26000042` (2×) v TEST2
v databázi pořád jsou, ale **v každé skupině je živá právě jedna zakázka a
ostatní jsou v koši** (`deleted_at`). Duplicita mezi živými zakázkami je 0.
Navíc už existují unikátní částečné indexy `uq_tickets_service_code`,
`invoices_service_number_unikatni`, `warranty_claims_service_code_unikatni`,
takže se to nemůže opakovat, a od 6. 9. přiděluje čísla databáze
(`dalsi_cislo_zakazky`) místo klienta.

```sql
-- musí vrátit nula řádků
select s.name, t.code, count(*) from tickets t join services s on s.id=t.service_id
where t.code is not null and t.deleted_at is null group by 1,2 having count(*)>1;
```

**Nedělat nic.** Zakázky v koši smazat neradno – zákazník je může chtít obnovit.

### B2. Chybějící číslo `IRPAZ26000119` v iSwapu

Jediná díra v celé řadě 3 590 zakázek napříč pěti roky. Vznikla ve starém
systému před importem. Ostatní roky (`IRPAZ22`–`IRPAZ25`) jsou souvislé bez
jediné mezery.

```sql
with k as (select regexp_replace(code,'^IRPAZ26','')::int as n from tickets
           where service_id='d9762a27-6c8d-43c4-9207-5c837e2713a0' and code like 'IRPAZ26%')
select g from generate_series(1,(select max(n) from k)) g where g not in (select n from k);
```

### B3. iSwap: 81 uzavřených zakázek bez data dokončení

Vypadá to jako chyba, ale **všech 81 je ve stavu „Stornováno“** – u storna
datum dokončení dávat nemá smysl. Ostatní uzavřené (3 452 z 3 533) datum mají.

```sql
select st.label, count(*) from tickets t
join service_statuses st on st.service_id=t.service_id and st.key=t.status
where t.deleted_at is null and st.is_final and t.completed_at is null
  and t.service_id='d9762a27-6c8d-43c4-9207-5c837e2713a0' group by 1;
```

### B4. Trvale platné odkazy do zákaznického portálu

7 zakázek iSwapu a 1 MajkaPajky má `portal_token` bez `portal_token_expires_at`,
tedy odkaz bez konce platnosti. Je to **vědomé rozhodnutí** popsané v migraci
`20260912160000_portal_platnost_odkazu.sql`: odkazy vydané před zavedením
platnosti se zákazníkům zpětně nezavírají. Nové odkazy už platnost dostávají.

```sql
select s.name, count(*) from tickets t join services s on s.id=t.service_id
where t.portal_token is not null and t.portal_token_expires_at is null
group by 1 order by 2 desc;
```

Kdyby se to mělo přesto uzavřít, stačí jeden dotaz (**nespouštět bez souhlasu
majitele – zákazníkům přestanou fungovat odkazy, které dostali SMS**):

```sql
update tickets set portal_token_expires_at = now() + interval '30 days'
where portal_token is not null and portal_token_expires_at is null;
```

### B5. Historie u zakázek v koši, 233 + 26 + 7 záznamů

Záměr, ne chyba: soft delete nechává historii, aby šlo zakázku obnovit
i s minulostí. Totéž komentáře (23), portálové události (49) a pracovní úseky
(16) u smazaných zakázek.

### B6. Drobnosti, které nikoho nebolí

| co | kde | počet | proč to nevadí |
|---|---|---:|---|
| účty bez jediného servisu | globálně | 20 | zbytky registrací z prosince 2025 – únoru 2026, přihlásit se nemají kam |
| účty bez řádku v `profiles` | globálně | 26 | profil vzniká až s přezdívkou/avatarem |
| zákazníci bez telefonu i e-mailu | iSwap | 42 | historické karty z importu |
| zákazníci bez jediné zakázky | iSwap 38, E2E 169 | – | karty založené a nepoužité |
| propadlé capture tokeny s fotkami | MajkaPajka 1, TEST2 2 | 3 | fotky mají odkaz ze zakázky, token je jen jednorázový klíč |
| soubor v úložišti, na který nic neodkazuje | TEST2 | 1 (479 kB) | úklid po testu |
| rezervace termínu bez zakázky | iSwap 1 (stornovaná), Novák 3, E2E 10 | – | objednávka z webu, kterou servis nevzal |
| reklamace bez `received_at` | MajkaPajka | 4 | pole nebylo při zakládání povinné |
| konverzace SMS bez zakázky | iSwap | 1 | má telefon, jen není spárovaná se zakázkou |
| neověřená omezení (`NOT VALID`) | `invoice_items` 2, `tickets` 2 | 4 | **žádný existující řádek je neporušuje**, dají se kdykoli `VALIDATE CONSTRAINT` |

Kontrola, že poslední řádek platí:

```sql
select
 (select count(*) from invoice_items where not (qty > 0)) as qty_nekladne,
 (select count(*) from invoice_items where not (vat_rate between 0 and 100)) as sazba_mimo,
 (select count(*) from tickets where discount_type is not null
    and discount_type not in ('percentage','amount')) as sleva_typ_mimo,
 (select count(*) from tickets where discount_value is not null and not (
    (discount_type='percentage' and discount_value between 0 and 100)
    or (discount_type='amount' and discount_value >= 0))) as sleva_mimo;
```

---

## C. Chyba v aplikaci, která to způsobila

### C1. Migrace poboček přepsala „naposledy změněno“ u všech zakázek a zapsala 3 900 prázdných záznamů do historie  🔴

`supabase/migrations/20260905120000_branches.sql`, řádek 80:

```sql
update public.tickets t set branch_id = b.id
  from public.branches b
 where b.service_id = t.service_id and b.is_default and t.branch_id is null;
```

Doplnění pobočky se počítá jako běžná změna: spustil se `tickets_set_updated_at`,
`bump_tickets_version` i `trg_ticket_history_log`. Následek v ostrých datech:

* `updated_at` **3 583 zakázek iSwapu, 80 MajkaPajky a 46 TEST2** má stejnou
  hodnotu `2026-09-05 06:20:36.582803+00`. Řazení „naposledy upravené“ je
  v iSwapu k ničemu a přírůstková synchronizace stáhne pokaždé všechno.
* Do historie přibyl u **každé** zakázky záznam „Upravena“ bez autora
  a s prázdným výčtem změn. Zákazník ho v detailu vidí i s větou
  *„Podrobnosti u tohoto záznamu nejsou – zaznamenávají se až u novějších
  změn.“* (`src/pages/Orders.tsx:8169`).

| servis | prázdných záznamů celkem | z toho bez autora |
|---|---:|---:|
| iSwap | 3 590 | 3 590 |
| MajkaPajka | 135 | 121 |
| E2E | 103 | 0 |
| TEST2 | 99 | 89 |
| Servis Novák | 3 | 3 |

```sql
select s.name, count(*) from ticket_history h join services s on s.id=h.service_id
where h.action='updated' and h.details = '{"changes": {}}'::jsonb
group by 1 order by 2 desc;
```

**Zastavené?** Zápis prázdných záznamů **ano** – nasazená verze
`ticket_history_log()` má dnes pojistku `IF v_changes = '{}' THEN RETURN NEW`,
takže nové prázdné záznamy nevznikají. `updated_at` se zpětně obnovit nedá
(původní hodnota nikde není).

**Bezpečná oprava jedním dotazem (NESPOUŠTĚT bez souhlasu, mění ostrá data):**

```sql
delete from ticket_history
where action = 'updated' and details = '{"changes": {}}'::jsonb;
```

Maže jen záznamy, které nenesou žádnou informaci a v UI se zobrazují jako
„nevíme co se změnilo“. Doporučení do budoucna: hromadné doplňování sloupců
v migracích obalit `set session_replication_role = replica` nebo triggery na
dobu migrace vypnout.

### C2. Klíč stavu zakázky se generuje z prvního písmene názvu

`src/pages/Settings.tsx:1604`:

```js
if (!draft.key) {
  const generatedKey = generateKeyFromLabel(newLabel, existingKeys);
  setDraft((p) => ({ ...p, label: newLabel, key: generatedKey }));
}
```

Klíč se spočítá při **prvním stisku klávesy** a pak už se neaktualizuje. Kdo
napsal „Reklamace“, má klíč `r`. V ostrých datech:

| servis | klíč | název |
|---|---|---|
| MajkaPajka | `r` | Reklamace |
| MajkaPajka | `c_1` | Čekám na díly |
| MajkaPajka | `c` | Čeká na opravu |
| MajkaPajka | `i` | iPady |
| TEST2 | `u`, `e`, `a`, `r` | u joh, ERROR, ajajajaj, ryba |

```sql
select s.name, st.key, st.label from service_statuses st join services s on s.id=st.service_id
where length(st.key) <= 2 order by 1,2;
```

**Zastavené?** Ne, chyba je v kódu dosud. Data samotná fungují (klíč je jen
identifikátor, `jeStornoStav` se jednopísmenným klíčem zmást nedá), ale klíč se
objevuje v automatizacích a v API, kde je „`r`“ nečitelné. Přejmenovat zpětně
nejde bezpečně – klíč je v `tickets.status`, `sms_automations.trigger_status_key`
a `automation_rules`. Oprava patří do kódu: přepočítat klíč při každé změně
názvu, dokud se stav neuloží poprvé.

### C3. Zaokrouhlení faktury se ukládalo mimo součet

Čtyři faktury ukázkového „Servis Novák“ mají vyplněné `rounding`, ale `total`
je jen `subtotal + vat_amount`. Doklad tvrdí „zaokrouhleno na 4 780“ a zároveň
„celkem 4 779,50“.

| doklad | subtotal | DPH | rounding | total | má být |
|---|---:|---:|---:|---:|---:|
| FV2026-0001 | 3 950,00 | 829,50 | 0,50 | 4 779,50 | 4 780,00 |
| FV2026-0002 | 2 876,00 | 603,96 | 0,04 | 3 479,96 | 3 480,00 |
| FV2026-0003 | 3 207,00 | 673,47 | −0,47 | 3 880,47 | 3 880,00 |
| FV2026-0004 | 1 272,00 | 267,12 | −0,12 | 1 539,12 | 1 539,00 |

```sql
select s.name, i.number, i.subtotal, i.vat_amount, i.rounding, i.total
from invoices i join services s on s.id=i.service_id
where abs(i.subtotal + i.vat_amount + coalesce(i.rounding,0) - i.total) > 0.005
order by 1, i.number;
```

**Zastavené?** Ano. Dnešní `src/pages/Invoices.tsx` ukládá
`total: totals.total_rounded` (řádky 563 a 823) a `invoiceMath.ts` počítá
`rounding = total_rounded − total`. **V ostrých servisech to není** – iSwap má
jedinou (smazanou) fakturu se správnými součty, MajkaPajka žádnou. Postižená
jsou jen ukázková data.

Oprava (jen ukázkový servis, **nespouštět bez souhlasu**):

```sql
update invoices set total = round(subtotal + vat_amount + coalesce(rounding,0), 2)
where service_id = '72de5c11-6c2d-486a-9a44-dd0a9060cf97'
  and abs(subtotal + vat_amount + coalesce(rounding,0) - total) > 0.005;
```

### C4. Generátor čísla reklamace ignoruje zkratku servisu

`src/pages/Orders/hooks/useWarrantyClaims.ts:18` – `const prefix = \`R${year}\``.
Zatímco zakázky mají předponu podle servisu a pobočky, reklamace mají všude
`R26`. Pro iSwap to znamená nesouvislost s historickými `IRPAR26…` (A1), obecně
to znamená, že reklamační číslo neprozradí, od koho je. **Zastavené? Ne.**

```sql
select s.name, substring(w.code from '^[^0-9]*[0-9]{2}') as predpona, count(*)
from warranty_claims w join services s on s.id=w.service_id group by 1,2 order by 1,2;
```

### C5. Zkratka servisu se dřív nedostala do configu → čísla „SRV…“

MajkaPajka má 6 zakázek `SRV26000001`–`SRV26000006` z 22.–24. 2. 2026, tedy
z prvních tří dnů provozu, než se do `service_settings.config` zapsala zkratka
`BC`. „Zkušební servis Novák“ má z téhož důvodu `SRV26000001` a v nastavení
zkratku dodnes nemá. `SRV` je nouzová hodnota z `zkratkaZConfigu()`.

```sql
select s.name, count(*) from tickets t join services s on s.id=t.service_id
where t.code like 'SRV%' group by 1;

select s.name from services s
left join service_settings ss on ss.service_id = s.id
where coalesce(ss.config->>'abbreviation','') = '';
```

**Zastavené?** Z velké části ano: `zalozServis()` dnes zkratku odvozuje z názvu
hned při založení a zapisuje ji na obě místa v configu, `zkratkaZConfigu()`
hledá v obou a jako poslední pokus ji odvodí z názvu firmy. Zůstávají dva
zkušební servisy bez zkratky, které vznikly dřív. Přečíslovat zpětně nejde –
čísla jsou na dokladech, které zákazník drží v ruce.

### C6. Číslo faktury se přiděluje konceptu a nikdy se nevrací

`next_invoice_number()` (viz A2) zvyšuje `next_value` při každém volání a nikdy
se nedosazuje ze skutečných faktur – na rozdíl od `dalsi_cislo_zakazky()`, kde
se čítač usadí podle `max()`. Každý založený a zahozený koncept spálí jedno
číslo. Vedlejší nález ze stejné oblasti: TEST2 má fakturu `FV2026-UW0V`, jejíž
číslo tenhle generátor vyrobit nemůže (zbytek po starší klientské cestě).

```sql
select s.name, i.number from invoices i join services s on s.id=i.service_id
where i.number !~ '^[A-Z]*[0-9]{4}-[0-9]+$';
```

**Zastavené? Ne.** Doporučení: číslo přidělovat až při vystavení dokladu, ne při
založení konceptu.

### C7. `phone_norm` plní jen klient, ne databáze

Neexistuje trigger; normalizované číslo zapisuje `useCustomerActions.ts` a
`ImportZakazniku.tsx`. Cokoli, co obejde tuhle cestu (hromadný import přes
service_role), nechá `phone_norm` prázdné. Unikátní index
`customers_service_phone_norm_uniq` je přes `WHERE phone_norm IS NOT NULL`, takže
tyhle karty **nechrání před duplicitou** a nenajde je vyhledávání podle telefonu
ani párování příchozí SMS (`SmsChatsPage.tsx`).

Postiženo: **iSwap 5 karet**, Servis Novák 17 (ukázkový). Čísla vypadají
normálně (`+420 xxx xxx xxx`), takže dopočítat je lze:

```sql
select s.name, count(*) from customers c join services s on s.id=c.service_id
where coalesce(c.phone,'') <> '' and c.phone_norm is null group by 1;
```

Oprava jedním dotazem (**nespouštět bez souhlasu**) – pozor, u konfliktu
s existující kartou index zápis odmítne, což je správně:

```sql
update customers set phone_norm = '+' || regexp_replace(phone, '\D', '', 'g')
where phone_norm is null and coalesce(phone,'') <> ''
  and regexp_replace(phone, '\D', '', 'g') ~ '^[1-9][0-9]{6,14}$';
```

Systémová oprava patří do databáze: trigger `before insert or update` na
`customers`, ať se na klienta nespoléhá.

### C8. Smazání modelu zařízení nechá odkaz v ceníku

TEST2 má **298 oprav**, které v `repairs.model_ids` odkazují na model, který
už v `device_models` není. V ostrých servisech to zatím nenastalo, ale mechanika
je stejná – `model_ids` je pole v JSONB, cizí klíč ho nehlídá a mazání modelu
ho neuklízí.

```sql
select s.name, count(*) from repairs r join services s on s.id=r.service_id
where exists (
  select 1 from jsonb_array_elements_text(
    case when jsonb_typeof(r.model_ids)='array' then r.model_ids else '[]'::jsonb end) m
  where not exists (select 1 from device_models dm where dm.id::text = m))
group by 1;
```

Totéž se týká `inventory_products.model_ids` / `.repair_ids` a
`inventory_product_categories.model_ids` (tam zatím 0 nálezů).

### C9. Hlášení chyby neposílá verzi aplikace

Všech 189 řádků v `error_logs` má `app_version` prázdné, `platform` vyplněné.
U hlášení z formuláře „Nahlásit chybu“ tak nejde poznat, na jaké verzi to
spadlo.

```sql
select count(*) as chyb, count(*) filter (where coalesce(app_version,'')='') as bez_verze
from error_logs;
```

Živých chyb od skutečných zákazníků je mimochodem minimum – jediná je
`portal.ensure_token_failed` z iSwapu ze 4. 9. 2026. Zbytek (`inventory.save_failed`
74×, `invoices.save_failed` 62×, `react.render_crash: useTheme must be used within
ThemeProvider` 42×) pochází z testovacího účtu a z účtu majitele.

---

## D. Jak audit zopakovat

Skripty jsou v `/private/tmp/.../scratchpad/q*.sql`; níž je zkrácená sada, která
projde všechny „musí být nula“ kontroly najednou.

```sql
with x as (
  select 'zivé duplicitní číslo zakázky' k, count(*) n from (
    select service_id, code from tickets where deleted_at is null and coalesce(code,'')<>''
    group by 1,2 having count(*)>1) q
  union all select 'zakázka bez čísla', count(*) from tickets where coalesce(code,'')='' and deleted_at is null
  union all select 'faktura bez položek', count(*) from invoices i
    where not exists (select 1 from invoice_items it where it.invoice_id=i.id)
  union all select 'součet faktury nesedí', count(*) from invoices
    where abs(subtotal + vat_amount + coalesce(rounding,0) - total) > 0.005
  union all select 'dobropis bez originálu', count(*) from invoices where kind='credit_note' and related_invoice_id is null
  union all select 'záporná zásoba', count(*) from inventory_stock where quantity < 0
  union all select 'zakázka s pobočkou jiného servisu', count(*) from tickets t
    join branches b on b.id=t.branch_id where b.service_id <> t.service_id
  union all select 'zakázka se zákazníkem jiného servisu', count(*) from tickets t
    join customers c on c.id=t.customer_id where c.service_id <> t.service_id
  union all select 'zásoba na skladu jiného servisu', count(*) from inventory_stock st
    join inventory_warehouses w on w.id=st.warehouse_id where w.service_id <> st.service_id
  union all select 'stav zakázky, který neexistuje', count(*) from tickets t
    where not exists (select 1 from service_statuses s where s.service_id=t.service_id and s.key=t.status)
  union all select 'členství bez účtu', count(*) from service_memberships m
    where not exists (select 1 from auth.users u where u.id=m.user_id)
  union all select 'telefon bez normalizace', count(*) from customers
    where coalesce(phone,'')<>'' and phone_norm is null
  union all select 'prázdný záznam historie', count(*) from ticket_history
    where action='updated' and details='{"changes": {}}'::jsonb
  union all select 'servis bez zkratky', count(*) from services s
    left join service_settings ss on ss.service_id=s.id
    where coalesce(ss.config->>'abbreviation','')=''
  union all select 'jednopísmenný klíč stavu', count(*) from service_statuses where length(key) <= 2
)
select * from x where n > 0 order by n desc;
```

Stav k 7. 9. 2026 – nenulové jsou tyhle:

| kontrola | počet | kde |
|---|---:|---|
| prázdný záznam historie | 3 930 | C1 |
| telefon bez normalizace | 22 | C7 (z toho iSwap 5) |
| zakázka bez čísla | 15 | jen E2E testovaci servis, vzniklé 7. 9. při běhu testů |
| jednopísmenný klíč stavu | 7 | C2 |
| součet faktury nesedí | 4 | C3, jen ukázkový Servis Novák |
| servis bez zkratky | 2 | C5, oba zkušební |

Všechny ostatní kontroly z dotazu výš vracejí nulu: žádná živá duplicita čísla
zakázky, žádná faktura bez položek, žádný dobropis bez originálu, žádná záporná
zásoba, žádné křížení mezi servisy, žádný neznámý stav zakázky, žádné členství
bez účtu.
