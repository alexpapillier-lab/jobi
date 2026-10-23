# Přeprava DPD přímo ze Zásilek (Praha ↔ Brno) – návrh

Stav k 23. 10. 2026. **Postaveno podle cesty B** (rozhodnutí majitele): migrace `20261023150000_zasilky_dpd.sql`, edge funkce `zasilka-dpd`, logika `supabase/functions/_shared/dpd.ts` (testy `src/lib/dpd.test.ts`), UI `src/components/PrepravaDpd.tsx` v Zásilkách a `Owner → Přeprava DPD`. Zapíná se jen servisu, kterému to majitel aplikace zapne a zadá účet DPD (klíč jde do Vaultu). Audit servis.iswap: `docs/dpd-preprava-audit.md` v repu servis.iswap.

## Co už existuje

**Jobi – Zásilky** (`ticket_shipments`, `src/pages/Zasilky.tsx`, `src/lib/zasilky.ts`)
- Zásilka má číslo, pobočku odkud a kam, stav (koncept → odeslaná → převzatá, případně stornovaná) a zakázky v krabici.
- Má i volná pole `carrier` a `tracking_number`. Dnes se vyplňují ručně a DPD se objednává mimo Jobi.
- Obě pobočky mají v Jobi adresu i telefon:
  - Hlavní: U Vokovické školy 299/4, Praha;
  - Brno: VortexWorks s.r.o., Krkoškova 739/19.

**servis.iswap – Admin v2 → Přeprava Praha ↔ Brno** (commity e5dc44a, 3dc2b7b, 8298c64 z 23. 10.)
- Endpoint `functions/api/admin/internal-shipments.js`, tabulka `internal_shipments`. DPD GeoAPI v1 (`geoapi.dpd.cz/v1`), proměnné `DPD_API_KEY` a `DPD_CUSTOMER_DSW`.
- Dva režimy:
  - **štítek**: typ `Return` se službou `dpdReturn`, podání na výdejním místě, PDF A6;
  - **kurýr**: typ `Collection` a objednání svozu na den nebo „co nejdřív“, kdy se zkoušejí další pracovní dny.
- Plátce je registrovaná adresa DPD účtu. Bez ní DPD vrací `ShipmentSpecificationError`.
- Sledování zásilky přes `/parcels/{n}/tracking` a zrušení svozu.

## Návrh

U zásilky v Jobi přibude tlačítko **„Objednat DPD“**. Ukáže se, jen když má servis přepravu zapnutou a obě pobočky mají adresu.

1. Volby, jak je zná servis.iswap: **štítek** (podám sám na výdejním místě) nebo **kurýr** (den svozu, výchozí „co nejdřív“) a počet balíků.
2. Jobi zásilku u DPD založí a vrátí:
   - číslo balíku, které se zapíše do `tracking_number` a `carrier = DPD`;
   - PDF štítek s tiskem jedním klikem;
   - u kurýra objednaný den svozu.
3. Do reference DPD jde číslo zásilky z Jobi (`Z-0016`), aby se dala dohledat v MojeDPD.
4. Stav z DPD trackingu se ukazuje u zásilky („na cestě“, „doručeno“). Doručení **nepřevezme zakázky samo**. Převzetí zůstává ruční kontrolou v cílové pobočce, protože krabice může dorazit neúplná. Cílová pobočka jen dostane upozornění, že balík je doručený.
5. Storno zásilky v Jobi zruší i objednaný svoz u DPD. Štítek bez svozu nic nestojí, dokud se nepodá.

### Kde má volání DPD běžet – dvě cesty

| | A) Jobi volá servis.iswap | B) DPD přímo v Jobi (doporučuji) |
|---|---|---|
| Jak | Nové API na servis.iswap pro Jobi (sdílený tajný klíč jako u webhooků objednávek), Jobi pošle odkud/kam/balíky/režim | Edge funkce `zasilka-dpd` v Jobi, logika převzatá z `internal-shipments.js`, adresy z poboček v Jobi |
| Klíč DPD | Zůstane jen na servis.iswap | Druhá kopie jako secret v Supabase (nastaví majitel) |
| Závislost | Výpadek webu = nejde objednat přepravu | Žádná |
| Pro další servisy v Jobi | Nejde (účet DPD je iSwapu) | Jde: každý servis si zadá svůj DPD klíč a DSW (Nastavení → Zásilky) |
| Práce | API + webhook na obou stranách | Jedna edge funkce + migrace + UI, převzít ověřené chování |

U obou cest platí: **objednávat přepravu jen z jednoho místa**. Přeprava v Admin v2 a Zásilky v Jobi nesmí objednávat totéž dvakrát. Po spuštění v Jobi bych Přepravu v Admin v2 nechal jen pro čtení (historie) nebo ji schoval.

### Co přibude v Jobi (cesta B)
- **Migrace:**
  - v `ticket_shipments` sloupce `dpd_mode`, `dpd_shipment_id`, `parcel_numbers text[]`, `pickup_order_id`, `pickup_date`, `dpd_status`, `dpd_status_text`, `dpd_delivered_at`, `dpd_tracking_at`;
  - štítek v úložišti (bucket se zásilkami), ne v base64 v řádku.
- **Nastavení servisu:** přeprava zapnuta/vypnuta, DSW, testovací/ostré prostředí. Klíč jako secret, nikdy v tabulce čitelné klientem.
- **Edge funkce:**
  - `zasilka-dpd` s akcemi `create`, `label`, `track`, `cancel`, kontrola oprávnění stejná jako u `zasilka_*` RPC;
  - cron na tracking odeslaných zásilek, např. každou hodinu v pracovní době.
- **UI v Zásilkách:**
  - tlačítko, volby, tisk štítku;
  - stav DPD v řádku zásilky;
  - storno, které zruší i svoz.
- **Testy** proti DPD testovacímu prostředí (`geoapi-test.dpd.cz`) a sondy oprávnění.

## Otevřené otázky pro majitele
1. Cesta A, nebo B?
2. Má přepravu objednávat jen admin, nebo každý v pobočce, která zásilku posílá?
3. Má se po doručení podle DPD posílat upozornění do chatu pobočky, nebo stačí stav u zásilky?
