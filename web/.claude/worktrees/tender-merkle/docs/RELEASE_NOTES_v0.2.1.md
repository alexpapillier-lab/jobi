# Release Notes v0.2.1

Změny od v0.2.0. Opravy stability připojení k Supabase, odstranění chyb PGRST683 (connection pool timeout) na stránce Zařízení.

---

## Opravy a vylepšení

### Supabase připojení a connection pool (PGRST683)

- **Sekvenční načítání** – dotazy pro zařízení (značky, kategorie, modely, opravy) a sklad se volají postupně místo paralelně; méně tlak na connection pool Supabase
- **Přeskočení save po loadu** – po načtení dat ze serveru se neukládají zpět hned (data jsou už v DB). Save se spustí jen při skutečné změně uživatelem
- **Realtime debounce 2 s** – realtime eventy spouštějí reload až po 2 s od posledního eventu, místo okamžité záplavy požadavků

### Kontrola připojení (OnlineGate)

- **`/auth/v1/health`** – kontrola používá lehký health endpoint místo dotazu na tabulku services
- **Timeout 45 s, 2 pokusy** – delší timeout a retry před zobrazením chyby „Cloud není dostupný“
- **Reset před opakováním** – před „Zkusit znovu“ se volá `resetTauriFetchState()`

### Přihlášení a session

- **JWT expiry 7 dní** – prodloužení platnosti tokenu v Supabase config (604800 s)
- **Tauri HTTP timeout 60 s** – `connectTimeout: 60_000` ms pro stabilnější připojení
- **Lepší detekce auth chyb** – při JWT/auth chybách se zobrazí „Přihlášení vypršelo“ místo obecné chyby připojení
- **Omezené refreshSession()** – odstranění zbytečných volání, které způsobovala smyčku TOKEN_REFRESHED / SIGNED_OUT

### Zakázky a Tauri fetch

- **Reset před create/save ticket** – `resetTauriFetchState()` před vytvořením a ukládáním zakázky, aby se předešlo chybám po nečinnosti

### Logy

- **Méně červených chyb v konzoli** – load/upsert chyby v `devicesDb` se logují jako `console.warn` místo `console.error`

---

## Technické

- `src/lib/devicesDb.ts` – sekvenční load, warn místo error
- `src/lib/inventoryDb.ts` – sekvenční load
- `src/pages/Devices.tsx` – `justLoadedRef` pro přeskočení save po loadu, realtime debounce 2 s
- `src/components/OnlineGate.tsx` – auth/health endpoint, timeout 45 s, 2 pokusy, reset před retry
- `src/lib/supabaseClient.ts` – connectTimeout 60 s, JWT/auth detekce, reset před createTicket/saveTicketChanges
- `src/auth/AuthProvider.tsx` – omezení refreshSession, handling SIGNED_OUT
- `supabase/config.toml` – `jwt_expiry = 604800`
