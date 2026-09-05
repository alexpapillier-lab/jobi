# E2E testy

Projdou hlavní cestu servisu v prohlížeči: přihlásit se, založit zakázku,
najít ji v seznamu a přidat provedenou opravu. Doplňují unit testy, které
hlídají výpočty, ale o rozbité obrazovce nic nevědí.

## Spuštění

```bash
E2E_PASSWORD='…' E2E_PASSWORD_TECHNIK='…' npm run test:e2e
```

Vývojový server si Playwright spustí sám (`npm run dev:web` na portu 5190).
Pro krokování a prohlížení snímků slouží `npm run test:e2e:ui`.

## Testovací účet

Testy jezdí proti ostrému Supabase pod účtem `e2e@jobi.test` ve **vlastním
servisu** „E2E testovaci servis“. RLS ho odděluje stejně jako kterékoli dva
zákaznické servisy, takže se test nemůže dotknout cizích dat. Účet nemá
potvrzený e-mail na skutečné doméně a nikam se s ním nedá přihlásit jinam.

Testy souběžné práce potřebují druhý účet ve **stejném** servisu:
`e2e-technik@jobi.test`, role člen s právy na zakázky, stavy, zákazníky a tisk.
Bez něj by nešlo ověřit, že se změny mezi lidmi propisují a že práva platí
i v rozhraní.

Hesla jsou v GitHub secrets jako `E2E_PASSWORD` a `E2E_PASSWORD_TECHNIK`. Bez něj testy nejedou –
schválně nemají tichý fallback: test, který se bez přihlášení tváří, že
prošel, je horší než žádný.

Heslo nikde jinde není. Pro místní spuštění si ho nastavte nové:

```sql
update auth.users
   set encrypted_password = crypt('<nové heslo>', gen_salt('bf'))
 where email = 'e2e@jobi.test';
```

a pak `gh secret set E2E_PASSWORD --repo alexpapillier-lab/jobi` (u technika
`E2E_PASSWORD_TECHNIK` a e-mail `e2e-technik@jobi.test`).

Servis má nároky nastavené jako **trvalé**, ne zkušební, aby testy nepřestaly
fungovat po třiceti dnech. Zkratka `E2E` je v `service_settings.config`
na dvou místech (`abbreviation` i `companyData.abbreviation`), protože
generátor čísel čte to první a nastavení aplikace píše obě.

## Data po testech

Zakázky se po sobě nemažou – jsou v testovacím servisu, kam nikdo nekouká,
a nová zakázka v každém běhu je zároveň důkaz, že zakládání funguje.
Kdyby jich bylo moc, smazat je jde jedním dotazem:

```sql
delete from tickets where service_id = '882beee7-4564-4d10-8ac6-16dc19240b57';
delete from warranty_claims where service_id = '882beee7-4564-4d10-8ac6-16dc19240b57';
```

## Na co si dát pozor

- **Testy nejsou paralelní.** Pracují se stejnou zakázkou a společným servisem.
- **Napovídač zařízení leží přes tlačítko Vytvořit zakázku.** Zavře se
  vyplněním dalšího pole; Escape zavře celé okno, ne jen napovídač.
- **Okno je široké 1440×1000.** V menším se spodní lišta překrývá s obsahem.
- **Osobní předvolby se ukládají k účtu** (`user_preferences`), ne jen do
  prohlížeče. Test, který předvolbu přepne a spadne, ji nechá přepnutou pro
  všechny další běhy – proto si `zakazka.spec.ts` asistenta postupu na začátku
  vždy zapne. Hledání v Nastavení jde přes klíčová slova podsekcí v
  `Settings.tsx`, nový přepínač tam musí mít slovo, jinak ho hledání nenajde.
- **Escape zavře celý detail zakázky.** Rozbalenou nabídku (např. hledání
  produktu) skryjte smazáním textu, ne Escapem.
- **Testovací servis potřebuje produkty ve skladu** („Displej AUDIT“) – test
  výběru dílů u opravy je hledá. Kdyby zmizely, založte libovolný produkt se
  slovem AUDIT v názvu.

## Ukázkový servis pro snímky na web

Kromě testovacího servisu má účet `e2e@jobi.test` ještě „Servis Novák"
(`72de5c11-6c2d-486a-9a44-dd0a9060cf97`) s vymyšlenými, ale věrohodnými
daty. Slouží jen k fotografování obrazovek pro appjobi.com:

```bash
E2E_PASSWORD='…' node scripts/snimky-pro-web.mjs
```

Skript se přihlásí, podstrčí aktivní servis přes `localStorage` a uloží
sedm snímků do `web/img/`. Pak je zmenšete (`sips -Z 1600`, `pngquant`).
Nároky servisu jsou trvalé – zkušební období by jinak po měsíci skončilo
a snímky by ukazovaly zamykací obrazovku.

Hesla testovacích účtů jsou jen v GitHub secrets. Když je potřeba spustit
něco místně a heslo není k dispozici, nastaví se nové podle postupu výš
a secret se přepíše – nic jiného na starém hesle nezávisí.
