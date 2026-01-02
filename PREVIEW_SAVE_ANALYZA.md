# Preview.tsx Save Handler Analýza

## Shrnutí

**Preview.tsx NEMÁ žádný save handler** - je to read-only preview komponenta.

---

## Co Preview.tsx dělá

### 1. Načítání ticketu
- **Location:** `src/pages/Preview.tsx:33-73`
- **Metoda:** `useEffect` s `loadTicket()`
- **Query:**
  ```typescript
  const { data, error: fetchError } = await (supabase
    .from("tickets") as any)
    .select("*")
    .eq("id", ticketId)
    .is("deleted_at", null)
    .single();
  ```
- **Return payload:** Vrací celý ticket row z DB
- **Co se děje:** Ticket se načte a mapuje na `TicketEx` pomocí `mapSupabaseTicketToTicketEx(data)`

### 2. Generování HTML
- **Location:** `src/pages/Preview.tsx:76-109`
- **Metoda:** `useEffect` generuje HTML z ticketu
- **Typy dokumentů:** ticket, diagnostic, warranty
- **Co se děje:** Generuje HTML a zobrazuje v iframe

### 3. Handlers
- **Location:** `src/pages/Preview.tsx:133-161`
- **Metody:**
  - `handlePrint()` - tisk dokumentu
  - `handleClose()` - zavření okna (Tauri API nebo window.close())

---

## Odpovědi na otázky

### 1. Kde Preview ukládá změny (save handler)?
**❌ NEJSOU** - Preview.tsx nemá žádný save handler. Je to pouze read-only preview komponenta.

### 2. Jaký "return payload" dostane zpět?
**N/A** - Preview.tsx neukládá změny, takže nedostává žádný return payload z save operace.

Při načítání ticketu dostává:
- **Return payload:** Celý ticket row z DB (všech sloupců)
- **Formát:** Supabase row (raw data), pak se mapuje na `TicketEx`

### 3. Co se stane po uložení?
**N/A** - Preview.tsx neukládá změny, takže se nic nestane po "uložení".

Pokud by se ptali na **editaci v Orders.tsx (detail view)**, pak:
- Editace probíhá v `Orders.tsx` detail view
- Po uložení se volá `setCloudTickets()` nebo se spoléhá na Realtime UPDATE event
- Preview.tsx není součástí editace

---

## Závěr

Preview.tsx je **pouze preview/print komponenta**:
- ✅ Načítá ticket z DB
- ✅ Generuje HTML dokument
- ✅ Umožňuje tisk
- ✅ Umožňuje zavření okna
- ❌ **NEMÁ** save handler
- ❌ **NEMÁ** editaci
- ❌ **NEMÁ** update store

Pokud potřebujete editaci tickets, probíhá to v `Orders.tsx` detail view, ne v Preview.tsx.

