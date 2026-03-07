# Release v0.1.9

Zařízení (značky, kategorie, modely, opravy) a sklad (kategorie produktů, produkty) se nyní ukládají do databáze Supabase. Data jsou trvalá a sdílená mezi prohlížeči i zařízeními.

---

## Novinky a vylepšení

### Zařízení – ukládání do databáze

- **Značky, kategorie, modely a opravy** – veškerá data ze stránky Zařízení se ukládají do Supabase místo prohlížečového localStorage. Importovaná data (značky, kategorie, modely, opravy z TXT souboru) se po importu automaticky zapisují do databáze.
- **Trvalá data** – po zavření prohlížeče, přepnutí zařízení nebo vyčištění cache data zůstávají zachována.

### Sklad – ukládání do databáze

- **Kategorie produktů a produkty** – data ze stránky Sklad se ukládají do Supabase. Produkty, skladové zásoby, ceny, SKU a propojení s modely/opravami jsou uložena v databázi.
- **Sdílená data** – více uživatelů nebo záložek stejného servisu pracuje se stejnými daty.

### Migrace stávajících dat

- **Automatická migrace** – při prvním otevření stránky Zařízení nebo Sklad po aktualizaci na v0.1.9 se existující data z localStorage automaticky přenesou do databáze (jednorázově). Pokud databáze již obsahuje data, localStorage se nepřepisuje.

---

## Opravy

- Import zařízení a oprav dříve ukládal data pouze do localStorage – data mizela při jiném prohlížeči nebo po vyčištění dat. Nyní se ukládají do databáze.

---

## Technické

- Nová Supabase migrace: `device_brands`, `device_categories`, `device_models`, `repairs`, `inventory_product_categories`, `inventory_products` – včetně RLS (Row Level Security) pro členy servisu.
- Nové moduly: `src/lib/devicesDb.ts` (loadDevicesFromDb, saveDevicesToDb), `src/lib/inventoryDb.ts` (loadInventoryFromDb, saveInventoryToDb).
- Devices.tsx a Inventory.tsx přepnuty z localStorage na Supabase.

---

## Požadavky na nasazení

Před použitím v0.1.9 je nutné spustit migraci databáze:

```bash
cd /cesta/k/jobi
supabase link --project-ref <VAS_PROJECT_REF>
npx supabase db push
```

Nebo v Supabase Dashboard (SQL Editor) spustit obsah souboru `supabase/migrations/20260226100000_create_devices_and_inventory.sql`.

---

## Stažení

- **Jobi** – `jobi-0.1.9.dmg` (universal, notarizovaný)
- **JobiDocs** – beze změn oproti v0.1.8 (není nutná aktualizace)

Uživatelé s v0.1.8 mohou aktualizovat přes OTA (Nastavení → O aplikaci → Aktualizace) nebo stáhnout nové DMG.
