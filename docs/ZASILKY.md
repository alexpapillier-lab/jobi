# Zásilky mezi pobočkami

Zapínací modul pro servis, který přijímá zakázky na jedné pobočce, opravuje
na druhé a vydává zase na první (Brno → Praha → Brno).

## Princip

Stav opravy a místo, kde zařízení fyzicky je, jsou dvě nezávislé osy:

| Sloupec `tickets`      | Význam                                                          |
| ---------------------- | --------------------------------------------------------------- |
| `branch_id`            | pobočka přijetí a výdeje – nemění se (zákazník, faktura, tržby)  |
| `location_branch_id`   | kde zařízení fyzicky je; `NULL` = na své pobočce                |
| `transit_shipment_id`  | zásilka, ve které právě cestuje; `NULL` = necestuje             |

Zásilka (`ticket_shipments` + `ticket_shipment_items`) je krabice s několika
zakázkami: **koncept → odesláno → převzato**. Položky se převezmou po jedné;
co v krabici chybí, zůstane „na cestě“ a zásilka ve stavu `sent`.

Stavové přechody dělá databáze: `zasilka_odeslat(id)` a
`zasilka_prevzit(id, ticket_ids[])` (security definer), takže se zakázky
z druhé pobočky přehodí i bez práva na ně zapisovat.

## Přístup podle poboček

Člen omezený na pobočku vidí i zakázky, které na jeho pobočce fyzicky leží
nebo do ní cestují (`zakazka_viditelna_podle_mista`). Bez toho by technik
v Praze brněnskou zakázku neviděl. Filtr poboček v aplikaci
(`filterByBranch`) bere umístění v úvahu stejně.

## Zapnutí

Nastavení → Zakázky → Přesuny mezi pobočkami (jen správce, jen s modulem
poboček). Zapnutí přidá stránku **Zásilky**, kartu **Kde je zakázka**
v detailu a štítek místa v seznamu („Praha“, „→ Praha“).

## Nasazení

1. Spustit migraci `supabase/migrations/20260916120000_zasilky_mezi_pobockami.sql`
   (SQL editor v Supabase nebo `supabase db push`).
2. Nasadit web (automaticky z `main`).
3. Zapnout modul v Nastavení.

Bez migrace se stránka Zásilky po zapnutí modulu nenačte (tabulky chybí)
a seznam zakázek hlásí chybějící sloupce – proto migrace jde první.

## Volby modulu (Nastavení → Zakázky → Přesuny mezi pobočkami)

| Klíč v `config`           | Výchozí | Co dělá                                                                 |
| ------------------------- | ------- | ----------------------------------------------------------------------- |
| `zasilky_postup`          | true    | kroky „Odesláno → Převzato → Zpět“ v Postupu zakázky (`krokyPresunu`)   |
| `zasilky_filtr`           | true    | rychlý filtr „Přesuny“ v seznamu zakázek                                |
| `zasilky_upozorneni_dni`  | 0       | po tolika dnech bez uložení mimo pobočku červený štítek (`dniBezZmenyJinde`) |
| `zasilky_portal`          | true    | portál řekne „Zařízení je v opravně“ (edge funkce `portal-ticket`, `locationNote`) |

Volba portálu vyžaduje nasazení edge funkce `portal-ticket` (čte
`location_branch_id` a `transit_shipment_id`; bez migrace se sama vrátí
k základním sloupcům).
