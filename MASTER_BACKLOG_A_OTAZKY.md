# Master Backlog a Otázky pro Cursor

## 1. Master Backlog (sloučený)

### Export / tisk / náhled zakázek
- Velikost UI nefunguje (zoom/scale)
- Uživatelský profil: foto + nick + audit (kdo co upravil/komentoval)
- Sidebar: přepínání servisů (membership) + "remember last active service"
- Customers: v profilu zákazníka zobrazit jeho zakázky
- Mazání zakázek (soft delete + kdo smazal)
- Přesun "modely, značky…" + sklad do DB
- Customers → vytvořit zakázku: předvyplnit údaje zákazníka
- Diagnostika zatížení Supabase + optimalizace / výkon
- Statistiky
- Offline / ztráta připojení (UX a spolehlivost)
- Owner nemůže měnit role členů
- Supabase Overview: "issues need attention"
- Orders: stránkování / virtualizace (ne jen scroll)
- Audit: LocalStorage jen minimum, vše ostatní cloud
- Detail zakázky: tlačítko Historie (kdo vytvořil/upravil/status)
- Ve smazaných zakázkách ukázat, kdo smazal

---

## 2. Otázky pro Cursor

### A) Export / tisk / náhled

**Kde je implementovaný "preview/print" flow dnes (soubor/y)?**

**Jsou podporované typy: zakázkový list / diagnostika / záruka?**

**Pro Mac: otevírá se systémové print dialog okno spolehlivě?**

**Co přesně je "missing": UI tlačítka, template, PDF export, nebo stabilita?**

---

### B) Velikost UI nefunguje

**Co znamená "velikost UI": zoom slider, font size, layout scale, window scale?**

**Kde to je v kódu (nastavení)? Ukládá se to?**

**Je to Tauri issue (dpi/scale) nebo CSS?**

---

### C) User foto + nick + audit trail

**Existuje profiles tabulka (user_id, nick, avatar_url)? Pokud ne, navrhni schema.**

**Existuje už audit log tabulka pro ticket events? Pokud ne, navrhni: ticket_events (ticket_id, user_id, action, payload, created_at).**

**Kde se dnes ukládají komentáře a kdo je autor? (DB vs localStorage)**

**Jak budeme mapovat membership user → display name v UI?**

---

### D) Sidebar service switch + remember last service

**Je UI pro přepínání service už někde?**

**Kde se drží activeServiceId a jak se persistuje?**

**Po sign-in: jak se volí default service (první membership / poslední uložený)?**

**Je persistence už hotová, nebo jen invalidace localStorage?**

---

### E) Customers → zakázky v profilu + předvyplnění

**Je tickets.customer_id už napojené na customers?**

**Má Customers detail view query na tickets? Pokud ne, kde to ideálně napojit?**

**"Create ticket from customer" – kde se tvoří ticket a jak předat customer data do draftu?**

---

### F) Mazání zakázek + kdo smazal

**Má tickets deleted_at? Má deleted_by (user_id)? Pokud ne, navrhni.**

**UI: kde je delete button (detail / list)? Je confirm dialog?**

**Realtime: máme subscription i na DELETE/UPDATE s deleted_at?**

---

### G) Modely/znacky + sklad do DB

**Jak je to dnes: lokální data / hardcode / mock?**

**Jaké entity potřebujeme: brands, models, parts_inventory, stock_moves?**

**Kde to bude používat Orders (autocomplete)?**

**Jaké minimální MVP: jen seznam modelů+brand, nebo i skladové pohyby?**

---

### H) Supabase výkon, "issues need attention"

**Co přesně ukazuje Supabase Overview (jaké issues)? (poslat screenshot nebo popis)**

**Máme indexy na klíčových polích (service_id, customer_id, deleted_at, updated_at)?**

**Velikost storage (fotky): bucket, transformace, cache, limity?**

---

### I) Statistiky

**Je Statistics.tsx jen placeholder? Co má být MVP metrik?**

**Jsou data zdroje v DB (RPC/Views), nebo se to má počítat v klientu?**

**Pokud je tam mock fallback, je to plánované odstranit až po dodělání?**

---

### J) Offline / ztráta připojení

**Existuje detekce offline stavu a UX banner?**

**Co se má stát při save bez připojení: blokovat, queue, nebo local draft?**

**Jaký je minimální "safe" MVP: jen warning + disable save?**

---

### K) Role management (owner nemůže měnit role)

**Je to UI problém nebo RLS/policy?**

**Která Edge Function/RPC to dělá? Jaký je error?**

**Jaké role existují (owner/admin/member) a jaká jsou pravidla změn?**

---

### L) Orders stránkování / virtualizace

**Kolik zakázek typicky v seznamu?**

**Používáme query limit/offset, nebo taháme vše?**

**Má být stránkování nebo virtuální list (react-window)? Co je rychlejší MVP?**

---

### M) LocalStorage audit

**Seznam klíčů v localStorage, které app používá (grep "localStorage.").**

**U každého: proč existuje, je to nutné, a jaký je plán migrace do cloudu?**

---

### N) Historie zakázky + kdo smazal

**Existuje audit log nebo aspoň created_by, updated_by, deleted_by?**

**Kde vytvořit "History modal" a odkud brát data?**

**Minimální verze: jen status changes + performed repairs + diagnostic text changes.**

