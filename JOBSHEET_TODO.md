# ✅ JOBSHEET – KONKRÉTNÍ TODO LIST (založený na realitě kódu)

Rozděleno do 5 logických bloků:
Core funkčnost → UX → Data & Cloud → Audit & Bezpečnost → Výkon & škálování

---

## 🟥 1) CORE FUNKČNOST (kritické pro produkci)

### 1. Mazání zakázek (soft delete + kdo smazal)

**Stav:** ❌ chybí část

**Problém:**
- ✅ existuje `deleted_at`
- ❌ neexistuje `deleted_by`
- ❌ není UI pro mazání

**TODO:**
- **DB:**
  - přidat `tickets.deleted_by UUID`
  - upravit RPC `soft_delete_ticket()` → ukládat `auth.uid()`
- **UI:**
  - Delete button v detailu zakázky
  - ConfirmDialog
- **Realtime:**
  - ověřit UPDATE handler na `deleted_at`

**Priorita:** 🔴 vysoká  
**Riziko:** střední (datová integrita)

---

### 2. Customers → vytvořit zakázku s předvyplněním

**Stav:** ⚠️ částečně

**Problém:**
- ✅ `newOrderPrefill` existuje
- ❌ není použit pro předvyplnění formuláře

**TODO:**
- **Customers detail:**
  - tlačítko „Vytvořit zakázku"
- **Orders:**
  - použít `newOrderPrefill.customerId`
  - předvyplnit jméno, telefon, e-mail

**Priorita:** 🔴 vysoká  
**Riziko:** nízké

---

### 3. Export / tisk / náhled zakázek (dokončení)

**Stav:** ⚠️ téměř hotovo

**Chybí:**
- PDF export v browseru (jen Tauri)
- ověřit stabilitu print dialogu na macOS
- možnost exportu bez print dialogu

**TODO:**
- Browser PDF export (html → blob → download)
- otestovat Tauri `window.print()` na macOS
- případně fallback PDF

**Priorita:** 🔴 vysoká  
**Riziko:** nízké–střední

---

## 🟧 2) UX / PRODUKTIVITA

### 4. Sidebar – přepínání servisů + paměť posledního servisu

**Stav:** ⚠️ logika existuje, UI ne

**TODO:**
- Sidebar dropdown: seznam servisů z memberships
- Přepnutí `activeServiceId`
- Použít existující localStorage persist

**Priorita:** 🟧 střední  
**Riziko:** nízké

---

### 5. Orders – stránkování (ne scroll)

**Stav:** ❌ chybí

**Problém:**
- tahá se všechny zakázky najednou

**TODO (MVP):**
- přidat `limit`/`offset`
- stránkování po 50
- UI pager

**Priorita:** 🟧 střední  
**Riziko:** nízké  
**Poznámka:** virtualizace až později

---

### 6. Velikost UI (scale nefunguje správně)

**Stav:** ⚠️ částečně

**Problém:**
- mění se jen `font-size`
- paddingy, fixed size prvky nereagují

**TODO (MVP):**
- rozhodnout:
  - CSS variables
  - nebo `transform: scale()` na root
- sjednotit sizing

**Priorita:** 🟧 střední  
**Riziko:** UX-only

---

## 🟨 3) DATA & CLOUD (technický dluh)

### 7. Komentáře → z localStorage do DB

**Stav:** ❌ špatně

**Problém:**
- komentáře jsou jen v localStorage
- bez autora, bez historie

**TODO:**
- tabulka `ticket_comments` (`id`, `ticket_id`, `user_id`, `text`, `created_at`)
- migrace UI
- realtime update

**Priorita:** 🟨 střední  
**Riziko:** střední

---

### 8. Modely, značky, opravy, sklad → DB

**Stav:** ❌ vše v localStorage

**Doporučený postup:**
- **Fáze 1 (MVP):** brands + device_models
- **Fáze 2:** products + stock
- **Fáze 3:** stock_moves (audit)

**Priorita:** 🟨 střední  
**Riziko:** vyšší (více entit)

---

### 9. Statistiky – odstranit mock fallback

**Stav:** ⚠️ fungují, ale…

**Problém:**
- fallback na `MOCK_TICKETS`
- výpočty jen v klientu

**TODO (MVP):**
- odstranit mock fallback
- používat jen cloud tickets
- později RPC / views

**Priorita:** 🟨 střední  
**Riziko:** nízké

---

## 🟦 4) AUDIT, BEZPEČNOST, HISTORIE

### 10. User profil: foto + nick

**Stav:** ❌ neexistuje

**TODO:**
- tabulka `profiles`
- editace nicku + avatar v Settings
- UI fallback: email

**Priorita:** 🟦 nižší  
**Riziko:** nízké

---

### 11. Historie zakázky (kdo co změnil)

**Stav:** ❌ chybí

**TODO (MVP):**
- tabulka `ticket_events`
- logovat:
  - status change
  - diagnostic text
  - repairs
- History modal v detailu

**Priorita:** 🟦 nižší  
**Riziko:** střední

---

### 12. Ve smazaných zakázkách zobrazit „kdo smazal"

**Stav:** ❌ navázané na bod 1

**TODO:**
- využít `deleted_by`
- zobrazit v UI

**Priorita:** 🟦 nižší  
**Riziko:** nízké

---

## 🟪 5) VÝKON, STABILITA, SCALE

### 13. Supabase "issues need attention" + výkon

**Stav:** ❓ neanalyzováno

**TODO:**
- projít Supabase Overview
- doplnit indexy:
  - `(service_id, deleted_at)`
  - `updated_at DESC`
- **kritické: fotky → storage bucket**
  - neukládat base64 do DB

**Priorita:** 🟪 strategická  
**Riziko:** vysoké (náklady, výkon)

---

### 14. Offline režim

**Stav:** ⚠️ OnlineGate blokuje app

**TODO (MVP):**
- místo blocku → warning banner
- disable save tlačítek
- (později queue + sync)

**Priorita:** 🟪 strategická  
**Riziko:** střední

---

### 15. Role management – owner nemůže měnit role

**Stav:** ⚠️ pravděpodobně UI bug

**TODO:**
- ověřit UI vs Edge Function
- test downgrade jiného ownera
- případně upravit UI validaci

**Priorita:** 🟪 strategická  
**Riziko:** nízké

