# Fotky zařízení a podpisy zákazníků

Jak se zavřel veřejný přístup k bucketu `diagnostic-photos`, co je potřeba
nasadit a v jakém pořadí, a co dělat, kdyby se po přepnutí něco neukázalo.

Navazuje na [AUDIT_DAT.md → A9](AUDIT_DAT.md).

---

## 1. Co bylo špatně

Bucket `diagnostic-photos` byl od založení veřejný:

```sql
-- supabase/migrations/20260218000000_storage_diagnostic_photos_bucket.sql
INSERT INTO storage.buckets (id, name, public, …) VALUES ('diagnostic-photos', …, true, …);
```

Veřejná cesta `…/storage/v1/object/public/diagnostic-photos/<soubor>` se
vyřizuje **mimo RLS** – Storage se politik vůbec nezeptá. Zpřísnění čtení
z migrace `20260909140000_fotky_jen_svuj_servis.sql` proto bránilo jen tomu,
aby si někdo vypsal obsah bucketu. Kdo měl odkaz, stáhl si soubor bez
přihlášení a natrvalo.

V bucketu je **182 souborů (73 MB)**, z toho **2 podpisy převzetí**
(`signatures/…png`). Jsou to fotky zařízení zákazníků cizích dílen a jejich
vlastnoruční podpisy, tedy osobní údaje.

Odkazy se přitom dostávaly ven na čtyřech cestách:

| Kudy | Kdo to viděl |
|---|---|
| `tickets.diagnostic_photos`, `…_before`, `intake_signature_url` | kdokoli, kdo se dostal k odkazu |
| zákaznický portál `/z/?t=…` | zákazník – a kdokoli, komu odkaz přeposlal; **platilo i po vypršení portálového tokenu** |
| export dat servisu (JSON) | majitel a kdokoli, komu soubor pošle dál – **napořád** |
| tiskové HTML / náhled šablony v JobiDocs | kdo měl přístup k dočasnému souboru |

Odkaz na podpis byl navíc uložený **dvakrát**: ve sloupci
`intake_signature_url` a ještě v `ticket_portal_events.meta.url`.

Bucket `product-images` je veřejný taky, ale tam je to **záměr** – obrázky
produktů se ukazují ve veřejném ceníku a chodí v odkazech veřejného API
skladu. Ověřeno, **nemění se**.

---

## 2. Jak to funguje teď

**Uložená URL už není oprávnění, je to jen identifikátor souboru.** V databázi
zůstává ve veřejném tvaru (nese v sobě cestu v bucketu) a před každým
zobrazením se z ní cesta vytáhne a podepíše. Díky tomu nebylo potřeba sahat na
data ostrých servisů a nebyla nutná žádná migrace dat.

Podepisuje ten, kdo umí ověřit oprávnění:

| Kde | Kdo podepisuje | Platnost | Kdo tam má mít přístup |
|---|---|---|---|
| detail zakázky, náhledy, lightbox | přihlášený uživatel (platí RLS) | 1 h, obnovuje se | člen servisu |
| podpis převzetí v kartě Portál | přihlášený uživatel | 1 h | člen servisu |
| zákaznický portál `/z/` | edge funkce `portal-ticket` pod `service_role`, až po ověření tokenu zakázky | 1 h, portál si obnovuje sám | zákazník s platným odkazem |
| export dat servisu | edge funkce `service-manage` pod `service_role`, až po ověření členství | 7 dní | majitel servisu |
| náhled šablony v JobiDocs | přihlášený uživatel (platí RLS) | 1 h | člen servisu |
| tisk a export do PDF | obrázek se **vkládá dovnitř** dokumentu jako data | — | kdo drží papír |

### Proč se do dokumentu obrázek vkládá, a ne odkazuje

Dokument se nevykresluje v Jobi:

- na desktopu ho kreslí **JobiDocs**, samostatný program, který nemá naši
  relaci a na podepsaný odkaz by se nedostal,
- ve webové verzi ho kreslí tiskový dialog prohlížeče ze skrytého iframu,
- při „Uložit PDF“ se z HTML dělá PDF, a **PDF si obsah odkazu nedotáhne** –
  co v něm není v okamžiku uložení, tam nebude nikdy.

Proto se fotky ještě v Jobi stáhnou přes podepsaný odkaz, zmenší na 2000 px
delší strany (jedna fotka = jedna stránka A4, víc nemá smysl) a do dokumentu
jdou jako `data:` URL. Fotka, kterou se nepodaří stáhnout, se z dokumentu
**vypustí** – rozbitý odkaz by v tisku vypadal jako prázdné místo a nikdo by
nepoznal, že tam měla být.

### Klíčové soubory

| Soubor | Co dělá |
|---|---|
| `src/lib/podepsaneFotky.ts` | cesta z uložené URL, podepisování, společná cache, vkládání do dokumentu |
| `src/hooks/usePodepsaneFotky.ts` | podepisování při zobrazení + obnova (interval, návrat do okna, opakování při chybě) |
| `src/components/FotkaZakazky.tsx` | náhled fotky – podepíše si odkaz sám |
| `supabase/functions/_shared/podepsaneFotky.ts` | totéž pro edge funkce (Deno nevidí do `src/`) |
| `supabase/migrations/20260913100000_fotky_podepsane_odkazy.sql` | člen servisu smí číst i podpisy k zakázkám svého servisu |
| `scripts/fotky-neverejny-bucket.sql` | **poslední krok** – přepnutí bucketu |

### Co se schválně nemění

- **Uložené URL v databázi.** Zůstávají ve veřejném tvaru jako identifikátor.
  Po přepnutí bucketu samy o sobě nic nevydají.
- **`product-images`.** Zůstává veřejný.
- **Když se podepsat nepovede, vrací se původní odkaz.** Aplikace kvůli
  chybějícímu podpisu nespadne a portál pořád ukáže stav zakázky. Po přepnutí
  bucketu bude na tom místě prázdný obrázek, ne prázdná stránka.

---

## 3. Pořadí nasazení

Kroky **nejdou přehodit**. Bucket se přepíná až úplně nakonec, protože všechno
ostatní funguje i nad veřejným bucketem – ale ne naopak.

1. **Edge funkce**

   ```
   npx supabase functions deploy portal-ticket --no-verify-jwt
   npx supabase functions deploy service-manage
   ```

2. **Portál a webová verze** – nasadit `web/` (soubor `web/z/portal.js`) a build
   webové aplikace.

3. **Desktopová aplikace** – vydat novou verzi Jobi (a JobiDocs, kvůli náhledu
   šablony na reálných datech). Dokud technik běží na staré verzi, fotky se mu
   po kroku 5 nezobrazí.

4. **Migrace**

   ```
   npx supabase db push
   ```

   Přinese `20260913100000_fotky_podepsane_odkazy.sql`. **Bez ní by po přepnutí
   zmizel podpis převzetí z karty Portál** – podpisy leží v `signatures/…`,
   tedy mimo složku servisu, a dosavadní politika na ně nesedla. Ověřeno:
   dnes `createSignedUrl` na existující podpis vlastního servisu skončí
   „Object not found“, i když soubor existuje.

5. **Teprve pak přepnout bucket** – obsah `scripts/fotky-neverejny-bucket.sql`
   v SQL editoru Supabase:

   ```sql
   update storage.buckets set public = false where id = 'diagnostic-photos';
   ```

   Schválně to **není migrace**: `db push` pouští všechno naráz a tenhle příkaz
   musí přijít až po krocích 1–4.

### Kontrola po přepnutí

```sql
select id, public from storage.buckets order by id;
-- diagnostic-photos = false, product-images = true
```

Pak projít, pro každý případ na jedné zakázce s fotkou:

- [ ] detail zakázky – fotka se zobrazí
- [ ] zvětšený náhled a tlačítko Stáhnout
- [ ] karta Portál – podpis převzetí
- [ ] vytištěný zakázkový list – fotostránky
- [ ] uložené PDF – fotka je uvnitř souboru (otevřít bez internetu)
- [ ] zákaznický portál `/z/?t=…` – fotky i podpis
- [ ] export dat servisu – odkazy v `files[]` fungují
- [ ] holá adresa `…/object/public/diagnostic-photos/…` vrátí chybu

---

## 4. Kdyby se něco neukázalo

**Nouzový návrat** (fotky budou zase chvíli veřejné, ale nikomu nezmizí):

```sql
update storage.buckets set public = true where id = 'diagnostic-photos';
```

Pak podle příznaku:

| Co se děje | Nejpravděpodobnější příčina | Co s tím |
|---|---|---|
| Fotky chybí **jen jednomu člověku** | běží na staré verzi aplikace | aktualizovat Jobi (krok 3) |
| Chybí **podpis převzetí**, fotky jsou v pořádku | neproběhla migrace z kroku 4 | `npx supabase db push` |
| Fotky chybí **v portálu**, v aplikaci jsou | nenasazená `portal-ticket` | nasadit funkci (krok 1) |
| Fotky chybí **v tisku** | JobiDocs si odkaz nestáhne | zkontrolovat, že `data.photos` jdou jako `data:` URL – dělá to `pripravFotky` v `src/lib/tiskDokumentu.ts` |
| Odkazy v **exportu** nefungují | export je starší než 7 dní, nebo nenasazená `service-manage` | stáhnout export znovu |
| Fotka chybí **komukoli, všude** | podepisování padá | v konzoli prohlížeče hledat požadavek `POST /storage/v1/object/sign/diagnostic-photos`; `403` = RLS (uživatel není členem servisu, kterému fotka patří), `404` = soubor v úložišti není |
| Fotka **problikne a pak se ukáže** | normální stav | při prvním vykreslení je v `src` ještě uložená adresa, podpis dorazí hned potom |

### Na co se ptát dřív než na kód

- Je odkaz opravdu z našeho bucketu? Zakázky založené před přechodem na
  Storage mají fotky jako `data:` base64 přímo v datech – ty se nepodepisují
  a fungují dál.
- Nepatří fotka jinému servisu? RLS podpis nevydá a je to **správně**.
- Nevypršel portálový odkaz? Portál pak nevrátí ani fotky.

---

## 5. Co zůstává otevřené

- **Odkaz na podpis v `ticket_portal_events.meta.url`** se u nových podpisů už
  neukládá, ale u dvou starých událostí tam je. Po přepnutí bucketu je to
  mrtvý odkaz, ne únik. Uklidit se dá kdykoli:

  ```sql
  update public.ticket_portal_events
  set meta = meta - 'url'
  where type = 'signed' and meta ? 'url';
  ```

- **QR kód pro focení z telefonu** se kreslí přes `api.qrserver.com`
  (`src/pages/Orders.tsx`), takže se capture token i s adresou posílá na cizí
  server. S fotkami to nesouvisí, ale je to stejný druh problému – a lokální
  QR knihovna je v repozitáři už dvakrát (`web/z/qrcode.min.js`,
  `jobidocs/src/qr.ts`).

---

## 6. Testy

- `src/lib/podepsaneFotky.test.ts` – skládání cest (veřejný, podepsaný i holý
  tvar), dávkové podepisování, obnova před vypršením, chování při chybě,
  vkládání do dokumentu.
- `src/lib/podepsaneFotkyEdge.test.ts` – totéž pro edge funkce + pojistky ve
  zdrojácích (portál i export musí podepisovat, aplikace nesmí nikde
  vykreslovat veřejnou adresu, přepnutí bucketu nesmí být mezi migracemi,
  `product-images` zůstává veřejný).
- `src/lib/tiskDokumentu.test.ts` – tisk i export dostanou data s vloženými
  fotkami; když se fotky nepodaří připravit, netiskne se a uživatel to ví.
- `e2e/fotky-podepsane.spec.ts` – nahraje vlastní fotku do E2E servisu
  a ověří, že se vykreslí podepsaným odkazem, že se obrázek opravdu načte, že
  táž cesta bez podpisu (i s podvrženým podpisem) vrátí chybu a že po ustálení
  nezůstane veřejná adresa nikde na stránce.
