# E2E testy

Projdou hlavní cestu servisu v prohlížeči: přihlásit se, založit zakázku,
najít ji v seznamu a přidat provedenou opravu. Doplňují unit testy, které
hlídají výpočty, ale o rozbité obrazovce nic nevědí.

## Spuštění

```bash
E2E_PASSWORD='…' npm run test:e2e
```

Vývojový server si Playwright spustí sám (`npm run dev:web` na portu 5190).
Pro krokování a prohlížení snímků slouží `npm run test:e2e:ui`.

## Testovací účet

Testy jezdí proti ostrému Supabase pod účtem `e2e@jobi.test` ve **vlastním
servisu** „E2E testovaci servis“. RLS ho odděluje stejně jako kterékoli dva
zákaznické servisy, takže se test nemůže dotknout cizích dat. Účet nemá
potvrzený e-mail na skutečné doméně a nikam se s ním nedá přihlásit jinam.

Heslo je v GitHub secrets jako `E2E_PASSWORD`. Bez něj testy nejedou –
schválně nemají tichý fallback: test, který se bez přihlášení tváří, že
prošel, je horší než žádný.

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
```

## Na co si dát pozor

- **Testy nejsou paralelní.** Pracují se stejnou zakázkou a společným servisem.
- **Napovídač zařízení leží přes tlačítko Vytvořit zakázku.** Zavře se
  vyplněním dalšího pole; Escape zavře celé okno, ne jen napovídač.
- **Okno je široké 1440×1000.** V menším se spodní lišta překrývá s obsahem.
