# Release Notes v0.2.0

Změny od v0.1.9. 

---

## ✅ Hotovo (od v0.1.9)

### Unit testy

- **Vitest** – přidán testovací framework
- Testované moduly: `errorNormalizer`, `statusColors`, `phone` (22 testů)
- Skripty: `npm run test`, `npm run test:run`

### Zakázky – diagnostické fotografie

- **Rozkliknutí fotek** – kliknutím na miniaturu se otevře lightbox s velkou fotkou
- **Stáhnout** – tlačítko v lightboxu pro stažení fotky pod názvem `{kód_zakázky}_pic1.jpg` atd.
- Zavření lightboxu: klik na pozadí, ×, Escape

### Tým a přístupy

- **Fotka a nick uživatelů** – v Nastavení → Tým a přístupy se u členů zobrazuje avatar a přezdívka (nikoliv jen email)
- Načítání profilů z tabulky `profiles` (nickname, avatar_url)

### Capture stránka (focení z telefonu)

- **`capture/`** – mobilní HTML/JS stránka pro vyfocení diagnostiky
- Dark UI, loading animace
- Připraveno pro Cloudflare Pages; URL `?ticket=XXX&token=YYY`
- **Edge Functions** `capture-upload` a `capture-create-token`
- Migrace `capture_tokens` pro tokeny platné 15 min
- **Tlačítko „Vyfotit z telefonu“** – v sekci Diagnostické fotografie (detail zakázky i reklamace)
- **QR kód + kopírování odkazu** – modal s QR pro scan mobilem
- **Kamera na celou obrazovku** – náhled vyplňuje celou obrazovku, shutter tlačítko přímo na obraze
- **Zoom 1×, 2×** – tlačítka zoomu (jen podporované, bez 3×, 5×)
- **Nahrát z galerie** – výběr fotky z telefonu místo focení
- **Více fotek na session** – token se nemaže po uploadu, lze přidat více fotek až do expirace; fix tlačítka „Odeslat“ po „Vyfotit další“
- **Migrace** `20260228100000_allow_service_role_ticket_update` – trigger povoluje update z Edge Function (auth.uid IS NULL)

### Výkon a UX

- **Keep-mounted stránky** – po první návštěvě zůstávají stránky namountované, jen skryté při přepnutí
- Instant přepnutí mezi Zakázky / Zákazníci / Sklad / Zařízení / Statistiky / Nastavení bez znovunačítání dat
- Realtime subscription zůstává připojená i na pozadí
- Zachování scroll pozice a stavu při přepnutí

### Zařízení a Sklad – per-service storage

- **Per-service klíče** – zařízení a sklad se ukládají per servis (`jobsheet_devices_v1_<serviceId>`, `jobsheet_inventory_v1_<serviceId>`)
- Při změně servisu se data nemazají – každý servis má vlastní data
- Migrace z legacy globálního klíče při prvním načtení
- `clearOnServiceChange` už nemazání DEVICES/INVENTORY (každý servis má vlastní bucket)

### Zařízení a Sklad – cloud (Supabase)

- **Načítání a ukládání do DB** – zařízení (značky, kategorie, modely, opravy) a sklad se načítají z databáze a ukládají při změnách
- `loadDevicesFromDb`, `saveDevicesToDb`, `loadInventoryFromDb`, `saveInventoryToDb`
- Ochrana před přepsáním DB: save se nespouští před dokončením load; prázdná data z loadu se neukládají zpět
- **Import** – po importu se data okamžitě ukládají do DB (nečeká se na debounce)
- **Loading indikátor** – točící se ukazatel „Načítání zařízení…“ při načítání
- **Paralelní load** – zařízení i sklad se načítají paralelně (rychlejší start)
- **Chyba načítání** – místo toasty se zobrazí blok s tlačítkem „Načíst znovu“

### Kontrola připojení (OnlineGate)

- **Timeout 12 s** – kontrola připojení k cloudu má timeout; při zpoždění se zobrazí chyba místo nekonečného čekání
- **„Zkusit znovu“** – tlačítko před opětovným pokusem resetuje Tauri HTTP modul

### Tauri / síťový modul

- **Zastavení retry stormu** – při selhání jednoho requestu se další už nerestartují automaticky (předtím vznikala záplava chyb)
- **Reset na vyžádání** – `resetTauriFetchState()` se volá při visibility change nebo při explicitním „Zkusit znovu“
- **Méně logů** – verbose logy jen s `VITE_SUPABASE_FETCH_VERBOSE=1`

### Sessions a načítání po nečinnosti

- **refreshSession()** – před načítáním statusů a zakázek se volá `refreshSession()` (v Tauri často `getSession()` vrací prošlý token → 401)
- **Visibility refetch** – při návratu do aplikace (záložka / okno) se znovu načítají statusy a zakázky

---


## Technické

- `supabase/migrations/20260228100000_allow_service_role_ticket_update.sql` – enforce_ticket_basic_update_permissions: `IF auth.uid() IS NULL THEN RETURN NEW`
- `supabase/functions/capture-upload/index.ts` – token se nemaže po uploadu
- `capture/` – full-screen layout, zoom přes MediaTrackConstraints, galerie, shutter overlay
- `src/pages/Orders.tsx` – `photoLightbox` state, download s `{code}_pic{n}.jpg`
- `src/App.tsx` – `visitedPages` state, stránky se neskrývají unmountem ale `display: none` + `aria-hidden`
- `src/pages/Settings/TeamSettings.tsx` – načítání profilů, zobrazení avatara a nicku
- `src/utils/*.test.ts`, `src/lib/phone.test.ts` – unit testy
- `src/constants/storageKeys.ts` – `getDevicesKey(serviceId)`, `getInventoryKey(serviceId)`
- `src/lib/devicesDb.ts` – `loadDevicesFromDb` (vrací `{ data, error }`), `saveDevicesToDb`
- `src/lib/inventoryDb.ts` – load/save skladu
- `src/lib/storageInvalidation.ts` – DEVICES/INVENTORY per-service; `clearKeysByPrefix` pro odhlášení
- `src/lib/supabaseClient.ts` – `resetTauriFetchState()`, timeout retry storm
- `src/state/StatusesStore.tsx` – `refreshSession` před load, visibility refetch
- `src/pages/Orders.tsx` – `refreshSession` před load ticketů/claims, visibility refetch
- `src/pages/Devices.tsx` – per-service storage, DB load/save, loading spinner, error + „Načíst znovu“, okamžitý save po importu
- `src/pages/Inventory.tsx` – per-service storage, DB load/save
- `src/components/OnlineGate.tsx` – timeout 12 s, `resetTauriFetchState` při „Zkusit znovu“
