# Analýza kódu: Tickets & Service Statuses

## 1. Typ tickets.status v kódu

### Mapování z Supabase (`Orders.tsx:3419-3447`):
```typescript
function mapSupabaseTicketToTicketEx(supabaseTicket: any): TicketEx {
  return {
    id: supabaseTicket.id || "",
    status: (supabaseTicket.status || "received") as any,  // ← TEXT, ne FK
    // ...
  };
}
```

### Vytváření ticketu (`Orders.tsx:4250-4254`):
```typescript
await supabase
  .from("tickets")
  .insert({
    service_id: activeServiceId,
    title: newDraft.deviceLabel.trim() || "Nová zakázka",
    status: statusKey,  // ← statusKey je string z normalizeStatus("received")
    notes: issueShort || "",
  })
```

### Změna statusu (`Orders.tsx:4103`):
```typescript
await supabase
  .from("tickets")
  .update({ status: normalized })  // ← normalized je string
  .eq("id", ticketId);
```

**ZÁVĚR:** `tickets.status` je **TEXT** obsahující `service_statuses.key`

---

## 2. Service_statuses scoping

### Načítání statusů (`StatusesStore.tsx:106-110`):
```typescript
const { data, error } = await supabase
  .from("service_statuses")
  .select("key, label, bg, fg, is_final, order_index")
  .eq("service_id", activeServiceId)  // ← Filtruje podle service_id
  .order("order_index", { ascending: true });
```

### Ukládání statusu (`StatusesStore.tsx:187-198`):
```typescript
await supabase.from("service_statuses").upsert(
  {
    service_id: activeServiceId,  // ← Ukládá se service_id
    key,
    label,
    bg: s.bg?.trim() || null,
    fg: s.fg?.trim() || null,
    is_final: !!s.isFinal,
    order_index: orderIndex,
  },
  { onConflict: "service_id,key" }  // ← UNIQUE na (service_id, key)
);
```

**ZÁVĚR:** Statusy jsou **scoped per service_id**, stejný `key` může existovat v různých servisech

---

## 3. ActiveServiceId výběr

### Načítání memberships (`App.tsx:193-197`):
```typescript
const { data: memberships, error } = await supabase
  .from("service_memberships")
  .select("service_id, role, created_at")
  .eq("user_id", user.id)
  .order("created_at", { ascending: false });
```

### Fallback na localStorage (`App.tsx:219-227`):
```typescript
try {
  const lastServiceId = localStorage.getItem(LAST_SERVICE_KEY);
  if (lastServiceId) {
    const hasMembership = typedMemberships.some((m) => m.service_id === lastServiceId);
    if (hasMembership) {
      selectedServiceId = lastServiceId;
    }
  }
} catch {
  // Ignore localStorage errors
}
```

### Deterministický výběr (`App.tsx:232-253`):
```typescript
// Preferuje owner role
const ownerServices = typedMemberships.filter((m) => m.role === "owner");
if (ownerServices.length > 0) {
  // Sort by created_at descending, then by service_id
  ownerServices.sort((a, b) => {
    const dateDiff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    if (dateDiff !== 0) return dateDiff;
    return a.service_id.localeCompare(b.service_id);
  });
  selectedServiceId = ownerServices[0].service_id;
} else {
  // No owner services, use any service
  typedMemberships.sort((a, b) => {
    const dateDiff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    if (dateDiff !== 0) return dateDiff;
    return a.service_id.localeCompare(b.service_id);
  });
  selectedServiceId = typedMemberships[0].service_id;
}
```

**ZÁVĚR:** 
1. Z membershipu (`service_memberships`)
2. Fallback na localStorage (`jobsheet_last_active_service_id`)
3. Deterministický výběr: preferuje `owner`, pak nejnovější

---

## 4. Načítání tickets

### Dotaz (`Orders.tsx:3524-3528`):
```typescript
const { data, error } = await supabase
  .from("tickets")
  .select("id, title, status, notes, created_at, updated_at, service_id")
  .eq("service_id", activeServiceId)  // ← VŽDY filtruje podle service_id
  .order("created_at", { ascending: false });
```

### Fallback když activeServiceId chybí (`Orders.tsx:3513-3517`):
```typescript
if (!activeServiceId || !supabase) {
  setCloudTickets([]);  // ← Prázdný seznam
  setTicketsError(null);
  return;
}
```

**ZÁVĚR:** Tickets se **VŽDY** filtrují podle `service_id`, pokud `activeServiceId` chybí, vrací se prázdný seznam

---

## 5. Mapování statusu

### Normalizace (`Orders.tsx:3723-3730`):
```typescript
const statusKeysSet = useMemo(() => new Set(statuses.map((s) => s.key)), [statuses]);

const normalizeStatus = useCallback(
  (key: string) => {
    return statusKeysSet.has(key) ? key : fallbackKey;  // ← Fallback na "received"
  },
  [statusKeysSet, fallbackKey]
);
```

### Použití v renderu (`Orders.tsx:4500-4504`):
```typescript
const raw = statusById[t.id] ?? (t.status as any);
const currentStatus = normalizeStatus(raw);  // ← Normalizuje proti statusKeysSet
const meta = getByKey(currentStatus);  // ← Hledá podle key, ne label
```

### StatusPicker (`Orders.tsx:3164`):
```typescript
const current = getByKey(value);  // ← getByKey hledá podle key
// current.label se pak zobrazí v UI
```

**ZÁVĚR:** 
- Mapuje podle **`key`**, ne `label`
- Neexistující status → fallback na `"received"`
- UI se nerozbije

---

## 6. Ukázka kódu pro vytvoření ticketu

### Vytváření cloud ticketu (`Orders.tsx:4244-4266`):
```typescript
if (activeServiceId && supabase) {
  const statusKey = normalizeStatus("received");  // ← Normalizuje status
  
  const { data, error } = await supabase
    .from("tickets")
    .insert({
      service_id: activeServiceId,  // ← Ukládá service_id
      title: newDraft.deviceLabel.trim() || "Nová zakázka",
      status: statusKey,  // ← Ukládá text key (např. "received")
      notes: issueShort || "",
    })
    .select()
    .single();
}
```

**ZÁVĚR:** 
- `service_id` se bere z `activeServiceId`
- `status` se ukládá jako text key (např. "received")
- Status se normalizuje před uložením

---

## 7. Ukázka kódu pro změnu statusu

### Změna statusu (`Orders.tsx:4086-4118`):
```typescript
const setTicketStatus = async (ticketId: string, next: string) => {
  const normalized = normalizeStatus(next);  // ← Normalizuje proti statusKeysSet
  const ticket = tickets.find((t) => t.id === ticketId);
  const isCloud = ticket?.source === "cloud";

  // Optimistic update
  setStatusById((prev) => ({ ...prev, [ticketId]: normalized }));
  
  if (isCloud && supabase && activeServiceId) {
    const { error } = await supabase
      .from("tickets")
      .update({ status: normalized })  // ← Ukládá text key
      .eq("id", ticketId);
  }
};
```

**ZÁVĚR:**
- Status se normalizuje před uložením
- Ukládá se jako text key
- Optimistic update s rollback při chybě

---

## 8. Realtime subscription

### Subscription (`Orders.tsx:3556-3594`):
```typescript
const channel = supabase
  .channel(`tickets:${activeServiceId}`)
  .on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "tickets",
      filter: `service_id=eq.${activeServiceId}`,  // ← Filtruje podle service_id
    },
    (payload) => {
      // Handle INSERT, UPDATE, DELETE
    }
  )
  .subscribe();
```

**ZÁVĚR:** Realtime subscription také filtruje podle `service_id`

---

## Shrnutí:

### ✅ CO JE SPRÁVNĚ:
1. `tickets.status` je TEXT obsahující `service_statuses.key`
2. Statusy jsou scoped per `service_id`
3. `activeServiceId` se bere z membershipu + localStorage
4. Tickets se VŽDY filtrují podle `service_id`
5. Status se mapuje podle `key`, ne `label`
6. Neexistující status → fallback na "received"
7. Realtime subscription filtruje podle `service_id`

### ⚠️ CO POTŘEBUJE OVĚŘIT V DB:
1. Typ sloupce `tickets.status` (mělo by být `text`)
2. UNIQUE constraint na `(service_id, key)` v `service_statuses`
3. Seedování default statusů při vytvoření service
4. RLS policies (WITH CHECK)
5. Konzistence dat (všechny `tickets.status` existují v `service_statuses`)






