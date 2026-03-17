# Audit: Auth, Role, Invite, DB Connections

Datum: 2026-02-23

## Nejdulezitejsi nalezy

1. **High: Capabilities u membera nejsou vynucene v DB pro Sklad/Zarizeni**
   - V DB politikach pro `device_*`, `repairs`, `inventory_*` se kontroluje clenstvi v servisu, ale ne capability klice (`can_edit_devices`, `can_edit_inventory`, `can_adjust_inventory_quantity`).
   - Doporuceni: doplnit RLS/trigger enforcement stejne jako u tickets/customers/documents.

2. **High: `team-update-role` muze prijmout roli `owner`**
   - UI nabizi jen `member/admin`, ale endpoint prijima i `owner`.
   - Doporuceni: backendove zablokovat `owner` pro admina; povyseni na owner jen owner/root owner.

3. **Medium: Tokeny (invite/password reset) pouzivaji `Math.random()`**
   - Pro security tokeny je vhodne CSPRNG.
   - Doporuceni: prejit na `crypto.getRandomValues` (Deno runtime).

4. **Medium: `statuses-init-defaults` obchazi bezna prava**
   - Clen muze inicializovat statusy v prazdnem servisu, protoze function pouziva `service_role` insert po kontrole clenstvi.
   - Doporuceni: omezit na owner/admin (nebo explicitni capability).

5. **Low: Legacy auth state v App**
   - `isAuthenticated()/setAuthenticated()` je legacy/no-op a muze mast debug.
   - Doporuceni: odstranit a sjednotit na `AuthProvider`.

6. **Low: Root owner je v triggeru natvrdo UUID**
   - Edge funkce pouzivaji `ROOT_OWNER_ID` z env, trigger ma hardcoded ID.
   - Doporuceni: sjednotit model root-owner identifikace.

## Tok auth/session

- `AuthProvider` drzi session pres `getSession` + `onAuthStateChange`.
- Pri null session mimo `SIGNED_OUT` zkousi `refreshSession`.
- Sitovy wrapper `supabaseFetch` resi Tauri specifika.

## Tok registrace + invite token

- Signup v `Login` vyzaduje invite code na UI.
- Invite code se uklada do `localStorage` (`jobsheet_pending_invite_token`).
- `App` po loginu zpracuje token pres `invite-accept`.
- Jsou pridane guardy proti opakovanemu zpracovani stejneho tokenu.

## Rozdil admin/member

- Frontend role model: `owner/admin` = full, `member` podle `capabilities`.
- Backend enforcement je konzistentni jen casticne.
- Silne vynuceni je hlavne u tickets/customers/documents/settings.
- Slabe misto: devices/inventory (viz High nalez #1).

## Mapa DB pristupu

### Frontend -> Supabase (RLS)
- Priame volani `supabase.from(...)`, `supabase.rpc(...)`.
- Pouzito v: `Orders`, `Settings`, `Inventory`, `Devices`, `Customers`, `StatusesStore`.

### Frontend -> Edge Functions
- Team/invite/service-manage, capture flow, password reset, statuses init.
- Vetsina ma `verify_jwt = false`; auth je overovana uvnitr funkce pres Authorization header.

### Edge Functions -> DB
- Kombinace user-context klienta (RLS) a `service_role` klienta (bypass RLS).
- Kriticke je mit pevnou autorizaci pred kazdym `service_role` write.

## Otevrene rozhodnuti k potvrzeni

1. Ma byt capability model tvrde bezpecnostni i na DB vrstve?
2. Ma admin mit pravo povysit na owner, nebo jen owner/root owner?
3. Ma root owner zustat 1 pevny UUID, nebo se sjednotit na env model?

## Akcni checklist (implementace)

### P0 - Security hotfix (doporučeno hned)

1. **Zablokovat `owner` v `team-update-role` pro admina**
   - Soubor: `supabase/functions/team-update-role/index.ts`
   - Pravidlo:
     - admin muze menit jen mezi `member <-> admin`
     - pouze owner/root owner muze povysit na `owner`
   - Test:
     - admin API call s role=`owner` => `403`
     - owner API call s role=`owner` => `200`

2. **Dovynutit capabilities v DB pro devices/inventory**
   - Soubor: nova migrace v `supabase/migrations/`
   - Zmena:
     - `device_brands`, `device_categories`, `device_models`, `repairs`:
       - INSERT/UPDATE/DELETE jen pri `has_capability(..., 'can_edit_devices')`
     - `inventory_product_categories`, `inventory_products`:
       - INSERT/UPDATE/DELETE jen pri `has_capability(..., 'can_edit_inventory')`
   - Poznamka:
     - SELECT muze zustat pro vsechny cleny servisu.
   - Test:
     - member bez capability nemuze upravovat tabulky ani pres SQL/SDK.

### P1 - Security hardening

3. **Nahradit `Math.random()` za CSPRNG tokeny**
   - Soubory:
     - `supabase/functions/invite_create/index.ts`
     - `supabase/functions/password-reset-request/index.ts`
   - Zmena:
     - `crypto.getRandomValues` + base64url/hex generator.
   - Test:
     - stejne delky tokenu, funkcni invite i reset hesla.

4. **Omezit `statuses-init-defaults` na owner/admin (nebo capability)**
   - Soubor: `supabase/functions/statuses-init-defaults/index.ts`
   - Zmena:
     - pred `service_role` insertem explicitne overit roli volajiciho.
   - Test:
     - member bez prava dostane `403`
     - owner/admin funkce funguje.

### P2 - Konsolidace a provoz

5. **Sjednotit root-owner model**
   - Soubory:
     - trigger migration (`prevent_root_owner_change`)
     - edge functions s `ROOT_OWNER_ID`
   - Varianta A:
     - root owner jen pres env + central helper.
   - Varianta B:
     - root owner jako DB role/flag (bez hardcoded UUID).
   - Test:
     - shodne chovani v edge funkcich i triggerech.

6. **Odstranit legacy auth no-op**
   - Soubory:
     - `src/App.tsx`
     - `src/components/Login.tsx`
   - Zmena:
     - odstranit `isAuthenticated()/setAuthenticated()` vrstvu, nechat pouze `AuthProvider`.
   - Test:
     - login/logout flow beze zmeny UX.

## Test plan (kratky)

1. Vytvorit uzivatele `member` a vypnout mu vsechny capabilities.
2. Overit, ze member:
   - neprovede update/insert/delete na devices/inventory ani pres API.
3. Overit role endpointy:
   - admin nemuze povysit na owner.
4. Overit invite/reset:
   - tokeny se generuji, flow funguje end-to-end.
5. Overit statuses init:
   - member bez prava dostane 403.

