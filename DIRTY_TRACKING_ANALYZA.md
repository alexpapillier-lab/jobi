# Dirty Tracking Analýza - Detail View

## 1. Kde vznikají změny (editované hodnoty)

### Diagnostický text
- **Location:** `src/pages/Orders.tsx:6403-6417`
- **State:** Mutuje se přímo `cloudTickets` přes `setCloudTickets`
- **Pattern:** `setCloudTickets(prev => prev.map(t => t.id === detailedTicket.id ? { ...t, diagnosticText: e.target.value } : t))`
- **Draft vs Original:** ❌ Není draft state - mutuje se přímo `detailedTicket` (který je computed z `cloudTickets`)

### Diagnostické fotky
- **Location:** `src/pages/Orders.tsx:6420-6492`
- **State:** Mutuje se přímo `cloudTickets` přes `setCloudTickets`
- **Patterns:**
  - Přidání: `setCloudTickets(prev => prev.map(t => t.id === detailedTicket.id ? { ...t, diagnosticPhotos: [...(t.diagnosticPhotos || []), result] } : t))` (řádek 6479-6485)
  - Odstranění: `setCloudTickets(prev => prev.map(t => t.id === detailedTicket.id ? { ...t, diagnosticPhotos: (t.diagnosticPhotos || []).filter((_, i) => i !== idx) } : t))` (řádek 6438-6444)
- **Draft vs Original:** ❌ Není draft state - mutuje se přímo `detailedTicket`

### Provedené opravy
- **Location:** `src/pages/Orders.tsx:4176-4312`
- **State:** Mutuje se přímo `cloudTickets` přes `setCloudTickets`
- **Functions:**
  - `addPerformedRepair` (řádek 4176) - přidá opravu
  - `removePerformedRepair` (řádek 4303) - odstraní opravu
  - `updatePerformedRepairPrice` (řádek 4246) - upraví cenu
  - `updatePerformedRepairCosts` (řádek 4260) - upraví náklady
  - `updatePerformedRepairTime` (řádek 4274) - upraví čas
  - `updatePerformedRepairProducts` (řádek 4288) - upraví produkty
- **Draft vs Original:** ❌ Není draft state - mutuje se přímo `detailedTicket`

### Co dalšího se edituje v detail view?
- **Komentáře** (řádek 6499+) - localStorage, ne DB, takže nepotřebuje save
- **Status** (řádek 6149) - má vlastní save flow přes `setTicketStatus`
- **Edit mode fields** (customerName, deviceLabel, etc.) - jsou v `editedTicket` state a mají vlastní save flow přes `saveTicketChanges` v edit módu

## 2. Existuje už dnes "dirty flag"?

**✅ ANO** - Implementováno event-based dirty tracking.

**Dirty flags state:**
- `dirtyFlags.diagnosticText` - true když se změní diagnostický text
- `dirtyFlags.diagnosticPhotos` - true když se přidá/odstraní diagnostická fotka
- `dirtyFlags.performedRepairs` - true když se přidá/odstraní/upraví provedená oprava

**Chování:**
- **Nastavení:** Event-based - nastaví se na `true` při každé editaci (onChange, onClick handlers)
- **Reset:** 
  - Po úspěšném save (všechny flags na `false`)
  - Při otevření nového ticketu (všechny flags na `false`)
- **Použití:** V `handleCloseDetail` pro rozhodnutí:
  - Pokud `hasUnsavedChanges = true` → volá `saveTicketChanges()` a zobrazí toast "Změny uloženy"
  - Pokud `hasUnsavedChanges = false` → jen zavře detail (žádný save, žádný toast)

## 3. Jak spolehlivě poznat "reálně se něco změnilo"

**Doporučení: Event-based dirty tracking (A)**

Výhody:
- Žádný deep compare
- Minimální riziko false positive/negative
- Snadno se debugguje
- Jednoduchá implementace

## 4. Jak udělat stabilní porovnání pro "performed repairs"

**Není potřeba** - používáme event-based dirty tracking, takže compare není nutný.

Pokud by bylo potřeba v budoucnu:
- Helper `normalizePerformedRepairs(repairs)` - setřídit podle `id`, odstranit transient fields
- JSON.stringify a porovnat stringy

## 5. Chování Close: kdy ukládat a kdy toastovat

**Pravidla:**
- `handleCloseDetail`:
  - Pokud není dirty → jen zavřít (žádný save, žádný toast)
  - Pokud je dirty → `await saveTicketChanges()`
- Toast:
  - Zobrazit jen když: dirty bylo true a save uspěl
  - Text: "Změny uloženy" (explicitní)

## 6. Reset dirty po save / po změně ticketu

- Po úspěšném save: `setDirtyFlags({ diagnosticText: false, diagnosticPhotos: false, performedRepairs: false })`
- Při otevření nového ticketu: reset dirty flags
- Při příchodu realtime update: nechat dirty být (aby nepřebilo rozeditovaný stav)

## 7. Místa, kde se edituje v detail view

1. **Diagnostický text** - textarea (řádek 6403)
2. **Diagnostické fotky** - přidání/odstranění (řádek 6420-6492)
3. **Provedené opravy** - přidání/odstranění/úprava (řádek 6270-6394)
4. **Status** - StatusPicker (řádek 6145) - má vlastní save
5. **Edit mode fields** - v edit módu (řádek 5845+) - mají vlastní save přes `saveTicketChanges`

**Pro dirty tracking potřebujeme pokrýt:**
- ✅ Diagnostický text
- ✅ Diagnostické fotky  
- ✅ Provedené opravy

**Nepotřebujeme:**
- ❌ Status (má vlastní save)
- ❌ Edit mode fields (mají vlastní save)
- ❌ Komentáře (localStorage)

## 8. Test scénáře (musí projít všechny)

### Scénář 1: Otevřít detail → nic nezměnit → Zavřít
**Očekávání:**
- ❌ Žádný save call
- ❌ Žádný toast
- ✅ Detail se zavře

**Implementace:** ✅ `hasUnsavedChanges = false` → skip save, jen zavřít

### Scénář 2: Změnit diagnostický text → Zavřít
**Očekávání:**
- ✅ 1× save call
- ✅ Toast "Změny uloženy"
- ✅ Po refresh změna v DB

**Implementace:** ✅ `dirtyFlags.diagnosticText = true` → save → toast → reset flags

### Scénář 3: Přidat fotku (pending upload) → Zavřít
**Očekávání:**
- ✅ save call
- ✅ Toast "Změny uloženy"
- ✅ Po refresh fotka v DB

**Implementace:** ✅ `dirtyFlags.diagnosticPhotos = true` → save → toast → reset flags

### Scénář 4: Změnit performed repairs → Zavřít
**Očekávání:**
- ✅ save call
- ✅ Toast "Změny uloženy"
- ✅ Po refresh změna v DB

**Implementace:** ✅ `dirtyFlags.performedRepairs = true` → save → toast → reset flags

### Scénář 5: Změnit něco → pak vrátit zpět na původní hodnotu → Zavřít
**Očekávání:**
- ⚠️ **Event-based dirty tracking:** Stále dirty (save se zavolá)
- **Alternativa (není implementováno):** Resetovat dirty když user vrátí zpět

**Implementace:** ✅ Event-based = stále dirty, save se zavolá (to je OK, protože compare by bylo složitější)

**Poznámka:** Pokud by bylo potřeba optimalizovat (neukládat když se vrátilo zpět), museli bychom implementovat compare logiku, což je složitější a má vyšší riziko false positives.

