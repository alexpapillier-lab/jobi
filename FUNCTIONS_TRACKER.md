# FUNCTIONS TRACKER - Seznam všech funkcí/komponent/migrací z cursor_perzistence.md

Tento dokument slouží k trackingu všech funkcí, komponent, migrací a RPC funkcí, které jsou zmíněny v cursor_perzistence.md a měly by být implementovány v aplikaci.

## Status legend
- ✅ Implementováno a ověřeno
- ⚠️ Implementováno, ale potřebuje ověření
- ❌ Chybí implementace
- 🔍 Potřebuje zkontrolovat

---

## 1. UTILITY FUNKCE

### 1.1 normalizePhone
**Soubor:** `src/lib/phone.ts`  
**Status:** ✅  
**Popis:** Normalizuje telefonní číslo pro deduplikaci zákazníků  
**Funkce:**
- Odstranění mezer, pomlček, závorek
- `00...` → `+...`
- Bez prefixu → default `+420`
- Krátká/nevalidní čísla → `null`

---

### 1.2 normalizeError
**Soubor:** `src/utils/errorNormalizer.ts`  
**Status:** ✅  
**Popis:** Normalizuje chybové zprávy na user-friendly české texty

---

### 1.3 isAnonymousCustomerName
**Soubor:** `src/pages/Orders.tsx`  
**Status:** ✅  
**Popis:** Detekuje, zda je jméno zákazníka anonymní ("anonymní zákazník")

---

### 1.4 ensureCustomerIdForTicketSnapshot
**Soubor:** `src/pages/Orders.tsx`  
**Status:** ✅  
**Popis:** Zajistí, že zákazník existuje v databázi a vrátí jeho ID (find-or-create logika)  
**Funkce:**
- Normalizace telefonu přes normalizePhone
- Hledání existujícího zákazníka podle phone_norm
- Vytvoření nového zákazníka, pokud neexistuje
- Ošetření konfliktu 23505 (duplicate key)

---

### 1.5 safeLoadCompanyData
**Soubor:** `src/pages/Orders.tsx`  
**Status:** ✅  
**Popis:** Načte data o společnosti z localStorage  
**Implementováno:** ✅ Exportovaná funkce

---

### 1.6 safeLoadDocumentsConfig
**Soubor:** `src/pages/Orders.tsx`  
**Status:** ✅  
**Popis:** Načte konfiguraci dokumentů z localStorage  
**Implementováno:** ✅ Exportovaná funkce

---

## 2. REACT KOMPONENTY

### 2.1 ConfirmDialog
**Soubor:** `src/components/ConfirmDialog.tsx`  
**Status:** ✅  
**Popis:** Reusable komponenta pro potvrzení akcí (náhrada window.confirm)  
**Vlastnosti:**
- Pending state
- Error handling
- Double-click prevention
- Podpora variant="default" | "danger"

---

### 2.2 AuthProvider / useAuth
**Soubor:** `src/auth/AuthProvider.tsx`  
**Status:** ✅  
**Popis:** Centralizovaný authentication context a hook

---

## 3. DATABASE MIGRACE A RPC FUNKCE

### 3.1 set_member_role RPC
**Soubor:** `supabase/migrations/20250104000000_create_set_member_role_rpc.sql`  
**Status:** ✅  
**Popis:** RPC funkce pro změnu role člena týmu  
**Autorizace:**
- Pouze owner může měnit role
- Nelze změnit roli ownera
- Nelze odstranit posledního ownera
- REVOKE EXECUTE FROM public, anon
- GRANT EXECUTE TO authenticated

---

### 3.2 change_ticket_status RPC
**Soubor:** `supabase/migrations/20250105000002_add_change_ticket_status_rpc.sql`  
**Status:** ✅  
**Popis:** RPC funkce pro změnu statusu zakázky s capability check  
**Autorizace:**
- Owner/admin vždy
- Member potřebuje can_change_ticket_status capability
- Trigger enforce_ticket_status_change_permissions

---

### 3.3 set_member_capabilities RPC
**Soubor:** `supabase/migrations/20250105000004_add_set_member_capabilities_rpc.sql`  
**Status:** ✅  
**Popis:** RPC funkce pro nastavení capabilities člena  
**Autorizace:**
- Owner může měnit capabilities kohokoliv
- Admin může měnit capabilities pouze pro members (ne pro adminy/ownery)
- Nelze měnit capabilities ownera
- Whitelist capability keys

---

### 3.4 soft_delete_ticket RPC
**Soubor:** Migrace pravděpodobně chybí, potřeba vytvořit  
**Status:** ⚠️ Voláno v kódu, ale migrace neexistuje  
**Popis:** RPC funkce pro soft delete zakázky  
**Použití:** `src/pages/Orders.tsx` - handleDeleteTicket  
**Poznámka:** Potřebuje vytvořit migraci

---

### 3.5 restore_ticket RPC
**Soubor:** Migrace pravděpodobně chybí, potřeba vytvořit  
**Status:** ⚠️ Voláno v kódu, ale migrace neexistuje  
**Popis:** RPC funkce pro obnovení smazané zakázky  
**Použití:** `src/pages/Settings.tsx` - handleRestoreTicket  
**Poznámka:** Potřebuje vytvořit migraci

---

### 3.6 update_service_settings RPC
**Soubor:** `supabase/migrations/20250105000001_add_update_service_settings_rpc.sql`  
**Status:** 🔍  
**Popis:** RPC funkce pro aktualizaci service settings  
**Poznámka:** Potřebuje ověřit implementaci

---

## 4. FRONTEND FUNKCE V KOMPONENTÁCH

### 4.1 mapSupabaseTicketToTicketEx
**Soubor:** `src/pages/Orders.tsx`  
**Status:** ✅  
**Popis:** Mapuje Supabase ticket na TicketEx formát, včetně customerId z customer_id  
**Implementováno:** ✅ Funkce přidána do Orders.tsx

---

### 4.2 Orders.tsx - handleDeleteTicket / ConfirmDialog pro delete
**Status:** ✅  
**Popis:** Soft delete zakázky přes ConfirmDialog a RPC soft_delete_ticket

---

### 4.3 Settings.tsx - handleRestoreTicket / ConfirmDialog pro restore
**Status:** ✅  
**Popis:** Obnova zakázky přes ConfirmDialog a RPC restore_ticket

---

### 4.4 Orders.tsx - setTicketStatus → change_ticket_status RPC
**Status:** ✅  
**Popis:** Změna statusu zakázky přes RPC change_ticket_status  
**Implementováno:** ✅ Používá RPC change_ticket_status s error handling

---

### 4.5 Settings.tsx - updateRole → set_member_role RPC
**Status:** ✅  
**Popis:** Změna role člena přes RPC set_member_role

---

### 4.6 Settings.tsx - updateCapabilities → set_member_capabilities RPC
**Status:** ✅  
**Popis:** Nastavení capabilities člena přes RPC set_member_capabilities

---

## 5. DALŠÍ IMPLEMENTACE K OVĚŘENÍ

### 5.1 phone_norm sloupec v customers tabulce
**Status:** 🔍  
**Popis:** Databázový sloupec pro normalizované telefonní číslo  
**Poznámka:** Potřebuje ověřit existenci migrace

---

### 5.2 UNIQUE constraint na (service_id, phone_norm)
**Status:** 🔍  
**Popis:** Unique constraint pro deduplikaci zákazníků  
**Poznámka:** Potřebuje ověřit existenci

---

### 5.3 customer_id FK v tickets tabulce
**Status:** 🔍  
**Popis:** Foreign key vazba mezi tickets a customers  
**Poznámka:** Potřebuje ověřit existenci

---

### 5.4 useActiveRole hook
**Soubor:** `src/hooks/useActiveRole.ts`  
**Status:** 🔍  
**Popis:** Hook pro získání aktivní role uživatele  
**Poznámka:** Potřebuje ověřit existenci

---

### 5.5 pendingInvite helper
**Soubor:** `src/lib/pendingInvite.ts`  
**Status:** ✅  
**Popis:** Helper funkce pro práci s pending invite tokeny v localStorage

---

## 6. EDGE FUNCTIONS

### 6.1 team-list
**Soubor:** `supabase/functions/team-list/index.ts`  
**Status:** 🔍  
**Popis:** Edge Function pro získání seznamu členů týmu

---

### 6.2 team-remove-member
**Soubor:** `supabase/functions/team-remove-member/index.ts`  
**Status:** 🔍  
**Popis:** Edge Function pro odstranění člena z týmu

---

### 6.3 invite-create
**Soubor:** `supabase/functions/invite-create/index.ts`  
**Status:** 🔍  
**Popis:** Edge Function pro vytvoření pozvánky

---

### 6.4 invite-accept
**Soubor:** `supabase/functions/invite-accept/index.ts`  
**Status:** 🔍  
**Popis:** Edge Function pro přijetí pozvánky

---

### 6.5 services-list
**Soubor:** `supabase/functions/services-list/index.ts`  
**Status:** 🔍  
**Popis:** Edge Function pro získání seznamu služeb

---

### 6.6 statuses-init-defaults
**Soubor:** `supabase/functions/statuses-init-defaults/index.ts`  
**Status:** 🔍  
**Popis:** Edge Function pro inicializaci výchozích statusů

---

## 7. DOCUMENT GENERATION FUNCTIONS

### 7.1 generateTicketHTML
**Soubor:** `src/pages/Orders.tsx`  
**Status:** ✅  
**Popis:** Generuje HTML pro zakázkový list  
**Implementováno:** ✅ Exportovaná funkce s parametry (config?, includeActions?)

---

### 7.2 generateDiagnosticProtocolHTML
**Soubor:** `src/pages/Orders.tsx`  
**Status:** ✅  
**Popis:** Generuje HTML pro diagnostický protokol  
**Implementováno:** ✅ Exportovaná funkce s parametry (config?, includeActions?)

---

### 7.3 generateWarrantyHTML
**Soubor:** `src/pages/Orders.tsx`  
**Status:** ✅  
**Popis:** Generuje HTML pro záruční list  
**Implementováno:** ✅ Exportovaná funkce s parametry (config?, includeActions?)

---

## 8. DATABASE TRIGGERS

### 7.1 enforce_ticket_status_change_permissions
**Status:** 🔍  
**Popis:** Trigger pro vynucení oprávnění při změně statusu zakázky

---

### 7.2 prevent_root_owner_change
**Status:** 🔍  
**Popis:** Trigger pro zabránění změny role root ownera

---

### 7.3 prevent_last_owner_removal
**Status:** 🔍  
**Popis:** Trigger pro zabránění odstranění posledního ownera

---

## Poznámky

- Tento dokument bude průběžně aktualizován při implementaci a testování
- Statusy budou aktualizovány na základě skutečného stavu v kódu
- Při testování funkčnosti projdeme všechny položky a označíme je jako ✅ nebo ❌

