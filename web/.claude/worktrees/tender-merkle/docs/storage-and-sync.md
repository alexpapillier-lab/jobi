# Storage and Sync Strategy

## Princip: Cloud-first

**Databáze (Supabase) = source of truth.** localStorage slouží pouze jako cache a pro UX.

## Co nesmí být jen v localStorage

Tyto entity musí být vždy v databázi a localStorage je pouze cache:

- **Tickets** (zakázky)
- **Statuses** (stavy zakázek)
- **Permissions** (oprávnění)
- **Memberships** (členství v servisech)
- **Services** (servisy)
- **Customers** (zákazníci)

## Co může být v localStorage

### UI preference (není citlivé, uživatelské nastavení)
- `UI_SETTINGS` – UI konfigurace (scale, display mode, atd.)
- `THEME` – vzhled aplikace
- `INVENTORY_DISPLAY_MODE` – zobrazení inventáře

### Convenience hodnoty
- `ACTIVE_SERVICE_ID` – aktivní servis (convenience pro rychlý přístup)

### Drafts (dočasná data)
- `NEW_ORDER_DRAFT` – draft nové zakázky
- `COMMENTS` – draft komentářů

### Cache (DB wins rule)
- `INVENTORY` – inventář (cache)
- `DEVICES` – katalog zařízení (cache)
- `STATUSES` – stavy (cache)
- `COMPANY` – údaje o společnosti (cache)
- `DOCUMENTS_CONFIG` – konfigurace dokumentů (cache)

## Pravidlo "DB wins"

**Pokud se data podaří načíst z DB, vždy přepíší localStorage.**

Fallback: localStorage se použije **jen když DB není dostupná / error**.

## Verzování

Všechny klíče mají suffix `_v1`, `_v2`, atd.

**Při změně struktury dat:**
1. Bump verzi (např. `_v1` → `_v2`)
2. Implementovat migraci nebo smazat stará data

## Invalidace cache

### Při logoutu (`clearOnSignOut()`)

Smazat všechno, co obsahuje citlivá/business data nebo drafty:

- `COMPANY`
- `DOCUMENTS_CONFIG`
- `INVENTORY`
- `DEVICES`
- `CUSTOMERS`
- `TICKETS`
- `COMMENTS`
- `NEW_ORDER_DRAFT`
- `STATUSES`
- `PENDING_INVITE_TOKEN`
- `ACTIVE_SERVICE_ID`

**Nechat (čistě UI preference):**
- `UI_SETTINGS`
- `THEME`
- `INVENTORY_DISPLAY_MODE`

### Při změně activeServiceId (`clearOnServiceChange()`)

Smazat všechno, co je **service-scoped** (vázané na konkrétní servis):

- `COMPANY`
- `DOCUMENTS_CONFIG`
- `INVENTORY`
- `DEVICES`
- `CUSTOMERS`
- `TICKETS`
- `COMMENTS`
- `NEW_ORDER_DRAFT`
- `STATUSES`

**Nechat:**
- `UI_SETTINGS`
- `THEME`
- `ACTIVE_SERVICE_ID` (ten se aktualizuje, nesmaže)

