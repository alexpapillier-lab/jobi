# Kolik Jobi unese a co to bude stát

Spočítáno 5. 9. 2026 na skutečných datech, ne odhadem. Měřeno na produkční
databázi: 5 servisů, 3 724 zakázek, 2 216 zákazníků, 183 souborů.

## Naměřené jednotky

| Co | Hodnota | Odkud |
|---|---:|---|
| Databáze na jednu zakázku | 12,4 kB | velikost databáze / počet zakázek, včetně indexů, historie a komentářů |
| Fotek na zakázku | 1,9 | servis, který fotky opravdu používá (156 fotek / 80 zakázek) |
| Velikost fotky | 412 kB | průměr v bucketu `diagnostic-photos` |
| Zakázek na servis za rok | 937 | největší servis, 3 590 zakázek za 46 měsíců |

Číslo „12,4 kB na zakázku“ je záměrně hrubé: bere celou databázi včetně
zákazníků, ceníku a nastavení. Pro odhad je to bezpečnější než sčítat sloupce.

## Projekce

Předpoklad: průměrný servis jede jako ten největší dnešní, a fotky používá
polovina servisů.

| Scénář | Zakázek celkem | Databáze | Fotky |
|---|---:|---:|---:|
| 10 servisů, 1 rok | 9 400 | 0,11 GB | 3,6 GB |
| 10 servisů, 3 roky | 28 100 | 0,32 GB | 10,8 GB |
| 50 servisů, 1 rok | 46 800 | 0,54 GB | 18,0 GB |
| 50 servisů, 3 roky | 140 500 | 1,62 GB | 53,9 GB |

## Co se do plánu Pro vejde

Plán Pro stojí 25 USD měsíčně a zahrnuje 8 GB databáze, 100 GB úložiště,
250 GB přenesených dat, 100 000 aktivních uživatelů a 2 miliony volání
edge funkcí.

**Padesát servisů se do toho vejde i po třech letech.** Databáze skončí na
zhruba pětině zahrnutého místa, fotky na polovině. Přenesená data vycházejí
i při třiceti zobrazeních každé fotky na 45 GB měsíčně, tedy pětinu limitu.

První plný účet nad 25 USD by přišel někde kolem **pátého roku provozu
padesáti servisů**, a i tehdy je to jednotky dolarů měsíčně. Při ceně
590 Kč za nejlevnější tarif to znamená, že infrastruktura je proti tržbám
zanedbatelná.

Volání edge funkcí: pravidelné úlohy (automatizace každých 15 minut, hlídač
provozu každou hodinu, úklidy) dělají zhruba 3 600 volání měsíčně. Zbytek
jsou uživatelské akce – k dvěma milionům je daleko.

## Kde to praskne dřív než na ceně

1. **Statistiky se počítají v prohlížeči.** Načtou se všechny zakázky servisu.
   U 3 590 to jde, u 10 000 to bude znát. Agregaci je potřeba přesunout na
   server dřív, než tam první servis dojde – při 937 zakázkách ročně to je
   zhruba desátý rok, u rušnějšího servisu dřív.
2. **Fotky jsou celý objem úložiště.** Databáze je proti nim zaokrouhlovací
   chyba. Kdyby bylo potřeba šetřit, je to jediné místo, kde to má smysl řešit
   – zmenšováním při nahrávání, ne mazáním.
3. **Souběžná realtime spojení.** Každý otevřený klient drží jedno. Padesát
   servisů po třech lidech je 150 spojení; limit plánu Pro je vyšší, ale je to
   jediné číslo, které roste s počtem lidí, ne s počtem zakázek.

## Jak to přeměřit

```sql
select pg_size_pretty(pg_database_size(current_database())),
       (select count(*) from tickets),
       (select sum((metadata->>'size')::bigint) from storage.objects);
```

Vydělit velikost databáze počtem zakázek a porovnat s 12,4 kB. Když číslo
výrazně naroste, přibylo něco, co roste rychleji než zakázky.
