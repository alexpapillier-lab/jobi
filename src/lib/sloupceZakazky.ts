/**
 * Které sloupce tabulky `tickets` se kdy čtou.
 *
 * Seznam zakázek ukazuje osm údajů, ale dřív si tahal všech sedmatřicet
 * sloupců – včetně diagnostiky, fotek, kontrolních seznamů a zápůjček.
 * U servisu s 4 800 zakázkami to bylo 6,6 MB JSONu při každém otevření
 * stránky (docs/ZATEZ.md, oddíl 5). Na mobilním připojení v dílně je to
 * ta nejdelší část čekání.
 *
 * Proto jsou sady dvě:
 *   - `SLOUPCE_SEZNAMU` – co potřebují karty, hledání, filtry, počty
 *     u záložek a pobočkový filtr. Nic víc.
 *   - `SLOUPCE_DETAILU` – celý řádek. Dotahuje se **po jedné zakázce**
 *     při otevření detailu a používá se všude, kde se ze zakázky tiskne,
 *     fakturuje, zakládá reklamace nebo ukládá.
 *
 * Sady se nesmí rozejít: uložení zakázky posílá do databáze *celý* řádek
 * složený z toho, co má aplikace v paměti. Kdyby se detail otevřel nad
 * neúplným řádkem, zápis by přepsal chybějící sloupce prázdnem. Proto se
 * detail vykreslí až nad plným řádkem – a `jePlnyRadekZakazky` je to
 * jediné místo, kde se pozná, který je který.
 */

/**
 * Sloupce pro seznam zakázek.
 *
 * `service_id` v sadě schválně není: seznam se načítá vždy pro jeden servis,
 * takže se doplní z proměnné (uuid dokola v každém řádku dělal 5 % přenosu).
 * `notes` slouží jako popis závady i jako text na kartě, `performed_repairs`
 * se sleva­mi je tam kvůli ceně na kartě, `external_id` kvůli hledání a
 * `branch_id` kvůli filtru poboček.
 */
export const SLOUPCE_SEZNAMU = [
  "id",
  "code",
  "title",
  "status",
  "notes",
  "customer_name",
  "customer_phone",
  "device_serial",
  "external_id",
  "performed_repairs",
  "discount_type",
  "discount_value",
  "created_at",
  "version",
  "branch_id",
].join(",");

/**
 * Všechny sloupce, které umí detail zobrazit, vytisknout a uložit.
 *
 * Používá ji dotažení otevřené zakázky, znovunačtení po konfliktu i `select`
 * za uložením. Dřív to byly tři různé seznamy a každý o něco kratší: po
 * uložení detailu tak z paměti mizela kontrola po opravě, zápůjčka a pobočka.
 */
export const SLOUPCE_DETAILU = [
  "id",
  "service_id",
  "code",
  "title",
  "status",
  "notes",
  "customer_id",
  "customer_name",
  "customer_phone",
  "customer_email",
  "customer_address_street",
  "customer_address_city",
  "customer_address_zip",
  "customer_company",
  "customer_ico",
  "customer_info",
  "device_serial",
  "device_passcode",
  "device_condition",
  "device_accessories",
  "device_note",
  "external_id",
  "handoff_method",
  "handback_method",
  "estimated_price",
  "performed_repairs",
  "test_checklist",
  "loaner",
  "diagnostic_text",
  "diagnostic_photos",
  "diagnostic_photos_before",
  "discount_type",
  "discount_value",
  "expected_completion_at",
  "created_at",
  "updated_at",
  "version",
  "branch_id",
].join(",");

/**
 * Sloupce, které jsou jen v detailní sadě – podle nich se pozná, odkud řádek
 * přišel.
 *
 * Ptáme se na přítomnost klíče, ne na jeho hodnotu: prázdná diagnostika je
 * u většiny zakázek normální stav, kdežto **chybějící klíč** znamená, že se
 * ten sloupec vůbec nečetl. Kontrolují se dva pro případ, že by někdo do
 * seznamu jeden z nich přidal.
 */
const ZNAKY_PLNEHO_RADKU = ["diagnostic_text", "device_condition"] as const;

/** Má řádek z databáze všechny sloupce detailu, nebo je to jen řádek seznamu? */
export function jePlnyRadekZakazky(radek: unknown): boolean {
  if (!radek || typeof radek !== "object") return false;
  return ZNAKY_PLNEHO_RADKU.every((k) => Object.prototype.hasOwnProperty.call(radek, k));
}
