# Limity veřejných rozhraní

Přehled toho, co je čím omezené. Funkce dostupné bez přihlášení jsou jediné
místo, kde cizí člověk může servisu dělat náklady, takže každá z nich má strop.

| Funkce | Co se počítá | Strop | Kde se počítá |
|---|---|---:|---|
| `public-catalog`, `public-inventory` | otisk IP | 60/min | `api_read_hits` |
| `public-catalog`, `public-inventory` | servis | 600/min | `api_read_hits` |
| `api-write` | token | 30/min | `api_write_hits` |
| `portal-ticket` (čtení) | otisk volajícího | 120/min | `rate_hits` |
| `portal-ticket` (akce) | otisk volajícího | 30/min | `rate_hits` |
| `portal-ticket` | token | 60/min | paměť instance |
| `capture-upload` | capture token | 20/min | `rate_hits` |
| `capture-upload` | capture token | 40 fotek za 7 dní | `rate_hits` |
| `capture-upload` | velikost souboru | 8 MB | — |
| `support-report` | uživatel | 5/hod | `rate_hits` |
| `sms-send` | servis | měsíční balíček | `service_entitlements.quota` |
| `password-reset-request` | e-mail | vlastní tabulka | `password_reset_rate_limit` |

## Proč limit na volajícího, ne jen na token

U portálu je token jediné oprávnění. Limit počítaný jen na token nechrání
před hádáním: každý pokus má jiný token, takže se strop nikdy nespustí.
Proto se u akcí počítá i otisk volajícího – ten je při hádání pořád stejný.

IP se nikde neukládá v čitelné podobě. `otiskKlienta` z `_shared/limity.ts`
z ní udělá otisk solený dnem, takže se z tabulky nedá poskládat historie
návštěv jedné adresy.

## Nahrávání fotek

`capture-upload` běží bez přihlášení, stačí odkaz z QR kódu. Kromě počtu a
rychlosti se kontroluje i **obsah souboru podle prvních bajtů** – přijímají se
jen JPEG, PNG, WebP a HEIC. Bucket `diagnostic-photos` je veřejný, takže se do
něj nemá dostat nic jiného než obrázek, a to ani když si někdo v požadavku
napíše libovolný typ.

## Kde se to mění

Tabulka `rate_hits` a funkce `zapocitej_udalost(kanal, klic)` a
`pocet_udalosti(kanal, klic, minut)` (migrace 20260906130000). Počítá se i pro
požadavky, které skončí chybou – jinak by šlo limit obejít posíláním nesmyslů.
Staré řádky maže denně `rate_hits_uklid` (pg_cron `jobi-uklid-limitu`).

Stropy jsou konstanty na začátku jednotlivých funkcí.
