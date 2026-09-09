# Jobi 0.6.3

Opravné vydání. Většina věcí se týká tisku z telefonu a dvou chyb, které se
do 0.6.2 dostaly spolu s chatem týmu.

## Text pro zákazníky

Tenhle blok se vkládá do `latest.json` jako „Co je nového“ v Nastavení →
Aktualizace. Předá se buildu přes `NOTES_FILE` (viz docs/RELEASE_NA_GITHUB.md):

```
- Tisk z telefonu: dokument se vytiskne celý, i když v dialogu přepnete formát papíru
- Tisk už nepřidává prázdný list na konec a podpisy nepadají na druhou stránku
- Fotky u zakázky se vejdou na stránku, každá už nezabírá dvě
- Kalendář se sám nepřenačítá dokola
- Ve fakturách šlo vpravo dole kliknout na Vystavit, teď to nepřekrývá bublina chatu
- Nastavení hlásí „Uloženo“ jen tehdy, když se opravdu uložilo
- Tarif Starter je nově pro jednoho člena týmu
```

## Co je uvnitř

### Tisk z prohlížeče a telefonu

- **Iframe se nemazal pod rukama.** Na iOS chodí `afterprint` už při otevření
  tiskového sheetu, ne po dotisku. Dokument tak zmizel dřív, než si člověk
  vybral tiskárnu, a Safari nemělo z čeho sázet. Iframe teď žije po celou
  dobu běhu aplikace.
- **Prázdný list na konci.** Reset zalomení mířil na `.page:last-child`, jenže
  za stránkami stojí ještě měřicí skript, takže poslední stránka posledním
  potomkem není. Opraveno na `:last-of-type`.
- **Podpisy na druhé stránce.** Rámec stránky byl napevno 296,6 mm vysoký,
  ale Safari na iOS nechá na obsah jen ~249 mm. Pod `browserPrint` je stránka
  vysoká podle obsahu.
- **Fotky na výšku.** Strop 230 mm dělal z fotostránky 282 mm, takže se každá
  rozpadla na dvě. Nově 190 mm. Řádky tabulky ani podpisový blok se navíc
  nedělí přes hranici stránky.

JobiDocs si papír řídí sám a zůstává beze změny.

### Kalendář

Hlídač kontroloval každé dvě vteřiny, jestli nejsou data starší než pět
vteřin. Razítko se ale po každém načtení posunulo, takže podmínka platila
pořád dokola: kalendář stahoval všechny zakázky a reklamace zhruba desetkrát
za minutu a každých šest vteřin zmizel za hlášku „Načítání kalendáře…“.
Načítá se teď při návratu ke kalendáři, na zprávu z realtime, a jinak nejvýš
jednou za pět minut jako pojistka.

### Bublina chatu

Kolečko chatu sedí napevno vpravo dole nad obsahem. V editoru faktury tím
překrývalo tlačítka „Vystavit“ a „Uložit koncept“, v Kalendáři tlačítko
„Změnit termín“ u posledního řádku. Ve Fakturách je teď schované, stejně jako
plovoucí „+“, a agenda má místo pod posledním řádkem.

### Nastavení

Sazba, stopky a zaokrouhlení ukazovaly zelené „Uloženo“ i po neúspěšném
zápisu, vedle červené hlášky o chybě. Nápis se teď ukáže jen po úspěchu.

### Předplatné

Tarif Starter je pro jednoho člena týmu. Hlídá to databáze (triggery na
členstvích i pozvánkách), edge funkce `invite_create` vrací srozumitelnou
hlášku a Tým ukazuje obsazenost. Web u Starteru dřív sliboval neomezený
počet uživatelů, což už neplatí.

### Provoz a testy

- Kontrola zálohy databáze hlásila falešný poplach kvůli řazení podle locale.
- Check „Typecheck, lint a testy“ byl červený u každého pull requestu, protože
  checkout stahoval jen slučovací commit.
- Šest E2E testů hledalo prvky, které nová pole zdvojila.

## Nasazení

Tohle vydání není jen aplikace. **Před vydáním** nebo současně s ním je
potřeba:

1. **Migrace** `20260913200000_members_quota.sql` na ostrou databázi
   (`supabase db push`). Bez ní limit členů neplatí a Tým si limit nenačte.
2. **Edge funkce** `billing-webhook`, `billing-prices` a `invite_create`.
   Bez nich Stripe nezapíše nárok `members` a pozvánka nad limit skončí
   holou chybou z databáze místo hlášky.
3. Web (ceník) se nasadí sám přes Cloudflare Pages z pushe na `main`.

Stávající zákazníci na Starteru dostanou nárok `members` až s další událostí
ze Stripe (obnova nebo změna předplatného). Do té doby jsou bez limitu,
takže slib na webu je přísnější než realita, ne naopak.

## Build

Postup je v `docs/RELEASE_NA_GITHUB.md`. Ve zkratce, na Macu:

```bash
npm run tauri:build:universal:signed
export NOTARY_APPLE_ID=… NOTARY_APPLE_PASSWORD=… NOTARY_TEAM_ID=…
./scripts/notarize-jobi.sh
./scripts/pack-notarized-ota.sh
./scripts/create-jobi-dmg.sh
```

Poznámky pro `latest.json` vezmi z bloku nahoře:

```bash
NOTES_FILE=docs/poznamky-0.6.3.txt bash scripts/generate-jobi-latest-json.sh universal
```

Pak release na GitHubu s tagem `v0.6.3` (a `jobi-v0.6.3`) a soubory
`latest.json`, `jobi.app.tar.gz`, `jobi.app.tar.gz.sig`, `jobi-0.6.3.dmg`.

JobiDocs se v tomhle vydání nemění, takže se znovu buildovat nemusí.
