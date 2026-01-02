# Audit aplikace Jobsheet Online

Datum: 2025-01-10
Verze: Po migraci activeServiceId z window globálu na React state

---

## 🔴 KRITICKÉ PROBLÉMY

### 1. activeServiceId se nikdy nenastavuje v App.tsx

**Problém:**
- `activeServiceId` v `App.tsx` je inicializován jako `null` (řádek 86)
- **Není žádný `useEffect`, který by načetl seznam služeb a nastavil první jako aktivní**
- Výsledek: `activeServiceId` je vždy `null`, takže vytváření zakázek nefunguje
- Settings.tsx má logiku pro načítání služeb, ale ta nastavuje pouze lokální state v TeamManagement, ne App.tsx state

**Kde:**
- `src/App.tsx:86` - `const [activeServiceId, setActiveServiceId] = useState<string | null>(null);`
- Chybí: `useEffect` pro načítání služeb z `services-list` Edge Function

**Řešení:**
Přidat do `App.tsx` `useEffect`, který:
1. Načte seznam služeb z Edge Function `services-list`
2. Pokud existuje alespoň jedna služba a `activeServiceId === null`, nastaví první jako aktivní

```typescript
useEffect(() => {
  if (!session || !supabase || activeServiceId !== null) return;
  
  (async () => {
    try {
      const { data, error } = await supabase.functions.invoke("services-list");
      if (!error && data?.services && data.services.length > 0) {
        setActiveServiceId(data.services[0].service_id);
      }
    } catch (err) {
      console.error("[App] Error loading services:", err);
    }
  })();
}, [session, activeServiceId]);
```

---

### 1b. Použití neexistující proměnné `supabaseClient` v Orders.tsx a Customers.tsx

**Problém:**
- V `Orders.tsx` a `Customers.tsx` se používá `supabaseClient`, která není definována
- Správně by mělo být `supabase` (import z `../lib/supabaseClient`)

**Kde:**
- `src/pages/Orders.tsx:3785` - `await (supabaseClient` (měl by být `supabase`)
- `src/pages/Orders.tsx:4580` - další výskyt
- `src/pages/Customers.tsx:186` - `await (supabaseClient` (měl by být `supabase`)

**Dopad:**
- Build bude mít TypeScript chyby: `Cannot find name 'supabaseClient'`
- Aplikace nebude fungovat

**Řešení:**
Nahradit všechny výskyty `supabaseClient` za `supabase` v těchto souborech.

---

### 2. StatusesStore stále používá window.__activeServiceId

**Problém:**
- `StatusesStore.tsx:96` stále čte `(window as any).__activeServiceId`
- Po refaktoringu už tento globál neexistuje
- Výsledek: Statusy se pravděpodobně nenačítají správně

**Kde:**
- `src/state/StatusesStore.tsx:96` - `const activeServiceId = (window as any).__activeServiceId || null;`

**Řešení:**
StatusesStore by měl dostat `activeServiceId` jako prop nebo přes Context, ne číst z window globálu.

---

## 🟠 VÁŽNÉ PROBLÉMY

### 3. Duplicitní načítání služeb v Settings.tsx

**Problém:**
- `TeamManagement` a `DeletedTicketsManagement` obě načítají seznam služeb pomocí `services-list`
- Oba se pokoušejí nastavit `activeServiceId`, pokud je `null`
- Může dojít k race condition - oba komponenty mohou najednou volat `setActiveServiceId`

**Kde:**
- `src/pages/Settings.tsx:2198-2230` (TeamManagement)
- `src/pages/Settings.tsx:3155-3179` (DeletedTicketsManagement)

**Problém:**
- Obě komponenty mají stejnou logiku pro načítání služeb
- Pokud jsou obě sekce renderované současně (což není, ale principiálně), dělají duplicitní API volání

**Řešení:**
- Centralizovat načítání služeb do `App.tsx` (viz bod 1)
- Nebo vytvořit shared hook `useServices()`

---

### 4. Chybějící dependency v useEffect (Settings.tsx)

**Problém:**
- `Settings.tsx:2231` - `useEffect` závisí pouze na `[session]`, ale používá `activeServiceId` a `setActiveServiceId`
- Mělo by být: `[session, activeServiceId, setActiveServiceId]`
- Ale `setActiveServiceId` by neměl být v dependencies (je stabilní)

**Kde:**
- `src/pages/Settings.tsx:2198-2231` - useEffect pro načítání služeb v TeamManagement

**Poznámka:** Aktuálně je to `[session]`, což může být správně, pokud chceme načíst služby jen při změně session. Ale použití `activeServiceId` uvnitř bez dependency je problematické.

---

### 5. Příliš mnoho `any` typů

**Problém:**
- V kódu je **132 výskytů `any` typu** (převážně v Orders.tsx - 64x, Settings.tsx - 41x)
- Ztrácí se type safety
- Chyby se neodhalí v compile-time

**Kde:**
- `src/pages/Orders.tsx`: 64 výskytů
- `src/pages/Settings.tsx`: 41 výskytů
- `src/pages/Customers.tsx`: 11 výskytů
- `src/pages/Inventory.tsx`: 13 výskytů
- `src/pages/Preview.tsx`: 1 výskyt
- `src/pages/Devices.tsx`: 2 výskyty

**Dopad:**
- Chyby se projeví až za běhu
- IDE nemůže poskytovat dobré autocompletion
- Refaktoring je riskantnější

**Řešení:**
- Postupně definovat správné typy pro Supabase responses
- Vytvořit type helpers pro mapování Supabase dat na frontend typy
- Použít Supabase TypeGen pro generování typů z DB schématu

---

### 6. Duplicitní realtime subscriptions

**Problém:**
- V `Orders.tsx` může být více realtime subscriptions na stejné tabulky
- Pokud se komponenta re-renderuje, může dojít k duplicitním subscriptions (pokud není správně cleanup)

**Kde:**
- `src/pages/Orders.tsx:3737-3769` - service_document_settings subscription
- `src/pages/Orders.tsx:3822-3910` - tickets subscription
- `src/pages/Customers.tsx:244-296` - customers subscription

**Problém:**
- Každý `useEffect` by měl v cleanup funkci unsubscribe, což se dělá
- Ale pokud se `activeServiceId` změní rychle, může dojít k překryvajícím se subscriptions

**Dopad:**
- Potenciální memory leaks
- Duplicitní event handling
- Zbytečná síťová komunikace

**Řešení:**
- Ověřit, že všechny subscriptions mají správný cleanup
- Zvážit použití custom hooku pro realtime subscriptions s built-in cleanup logic

---

### 7. localStorage jako fallback může způsobit desync

**Problém:**
- Některé části aplikace ukládají data do `localStorage` jako fallback (např. documentsConfig)
- Pokud se DB a localStorage rozpojí, mohou být nekonzistentní
- Synchronizace mezi localStorage a DB není atomická

**Kde:**
- `src/pages/Orders.tsx:3758` - `localStorage.setItem("jobsheet_documents_config_v1", ...)`
- `src/pages/Settings.tsx` - documents config synchronizace

**Problém:**
- Pokud selže DB zápis, ale localStorage se uloží, nebo naopak
- Při reload může být aplikace v nekonzistentním stavu

**Řešení:**
- Zvážit, zda localStorage fallback je skutečně potřeba
- Pokud ano, použít transaction-like pattern nebo optimistic updates s rollback

---

## 🟡 PROSTŘEDNÍ PROBLÉMY

### 8. StatusesStore závisí na window globálu

**Problém:**
- `StatusesStore.tsx:96` stále čte `window.__activeServiceId`
- Po refaktoringu už tento globál neexistuje, takže statusy se nenačítají

**Kde:**
- `src/state/StatusesStore.tsx:95-96`

**Řešení:**
- StatusesProvider by měl dostat `activeServiceId` jako prop
- Nebo použít Context API pro sdílení activeServiceId

---

### 9. Nepoužité proměnné

**Problém:**
- Několik proměnných je deklarováno, ale nikdy se nepoužívá
- TypeScript hlásí warnings (TS6133)

**Kde:**
- `src/pages/Settings.tsx:556` - `serviceSettingsLoading` (prefixed s `_`, ale stále deklarované)
- `src/pages/Settings.tsx:557` - `serviceSettingsError` (prefixed s `_`)
- `src/pages/Orders.tsx:10` - `useAuth` import (odstraněn, ale možná zbyl import)
- `src/pages/Orders.tsx:200` - `CUSTOMERS_STORAGE_KEY`
- `src/pages/Orders.tsx:203` - `CustomerRecord` type (možná nepoužitý)

**Dopad:**
- Zbytečné proměnné zatěžují kód
- Může způsobit confusion při čtení kódu

**Řešení:**
- Odstranit nepoužité importy a proměnné
- Nebo je skutečně použít, pokud byly zamýšleny k použití

---

### 10. Chybějící error boundaries

**Problém:**
- Aplikace nemá React Error Boundaries
- Pokud dojde k chybě v komponentě, celá aplikace se zhroutí
- Uživatel vidí bílou obrazovku místo error message

**Kde:**
- Celá aplikace - chybí Error Boundary komponenty

**Řešení:**
- Přidat Error Boundary komponentu, která zachytí chyby a zobrazí user-friendly error message
- Možná i logování chyb do externí služby (Sentry, atd.)

---

### 11. Race conditions v useEffect

**Problém:**
- Některé `useEffect` hooky mohou mít race conditions, pokud se props změní rychle
- Např. pokud se `activeServiceId` změní vícekrát rychle za sebou

**Kde:**
- `src/pages/Orders.tsx:3720-3735` - loadDocumentsConfigFromDB
- `src/pages/Orders.tsx:3822-3910` - tickets subscription
- `src/pages/Customers.tsx:173-242` - loadCustomers

**Příklad problému:**
```typescript
useEffect(() => {
  if (!activeServiceId) return;
  loadData(activeServiceId); // async funkce
}, [activeServiceId]);
```

Pokud se `activeServiceId` změní z "A" na "B" a pak na "C" rychle, může dojít k:
1. loadData("A") startuje
2. loadData("B") startuje (A ještě není hotové)
3. loadData("C") startuje (A a B ještě nejsou hotové)
4. C dokončí první, ale pak přijde výsledek z A nebo B a přepíše správný výsledek

**Řešení:**
- Použít cleanup flag nebo AbortController pro zrušení starých requestů
- Nebo použít request deduplication library

---

### 12. Hardcoded strings pro localStorage keys

**Problém:**
- `localStorage` klíče jsou hardcoded strings na více místech
- Pokud se klíč změní, musí se změnit na více místech
- Riziko typo nebo nekonzistence

**Kde:**
- `src/App.tsx:33` - `UI_STORAGE_KEY = "jobsheet_ui_settings_v1"`
- `src/pages/Orders.tsx` - různé storage keys
- `src/pages/Settings.tsx` - storage keys

**Řešení:**
- Centralizovat všechny storage keys do jednoho constants souboru
- Použít konstanty místo string literals

---

## 🟢 DROBNÉ PROBLÉMY / VYLEPŠENÍ

### 13. Inventory.tsx používá polling místo realtime

**Problém:**
- `Inventory.tsx:461-469` používá `setInterval` pro kontrolu změn v localStorage každou sekundu
- To je neefektivní a může způsobit performance problémy
- Navíc se data ukládají pouze do localStorage, ne do DB

**Kde:**
- `src/pages/Inventory.tsx:461-469`

**Poznámka:** Možná je to záměrné, pokud Inventory není cloud-first (ještě). Ale je to podivné řešení.

---

### 14. Custom event listeners bez cleanup

**Problém:**
- Některé custom event listeners možná nemají cleanup
- Např. `jobsheet:draft-count`, `jobsheet:ui-updated`, `jobsheet:request-new-order`

**Kde:**
- `src/App.tsx:125-129` - draft-count listener (má cleanup ✓)
- `src/App.tsx:108-122` - ui-updated listener (má cleanup ✓)
- `src/App.tsx:132-144` - request-new-order listener (má cleanup ✓)

**Status:** Vypadá to, že většina má cleanup, ale je dobré to pravidelně kontrolovat.

---

### 15. Nepoužité mock soubory

**Problém:**
- V `src/mock/` jsou soubory `tickets.ts` a `statuses.ts`
- Pravděpodobně se už nepoužívají (aplikace je cloud-first)
- Může způsobit confusion

**Kde:**
- `src/mock/tickets.ts`
- `src/mock/statuses.ts`

**Řešení:**
- Pokud se nepoužívají, smazat je
- Nebo je přesunout do `RECOVER/` složky pro backup

---

### 16. Nejasná role `authenticated` state v App.tsx

**Problém:**
- V `App.tsx` jsou dva mechanismy pro kontrolu auth:
  1. `authenticated` state (z `isAuthenticated()` helperu)
  2. `session` z `useAuth()` hooku
- `authenticated` state se používá pouze na jednom místě (řádek 238), ale pak se používá `session` guard (řádek 239)
- Možná redundantní

**Kde:**
- `src/App.tsx:84` - `const [authenticated, setAuthenticatedState] = useState(() => isAuthenticated());`
- `src/App.tsx:238` - `if (!authenticated)` (ale pak se nepoužívá)
- `src/App.tsx:239` - `if (!session)` (toto je skutečný guard)

**Poznámka:** Možná je `authenticated` state legacy kód, který už není potřeba.

---

### 17. TypeScript strict mode možná není zapnutý

**Problém:**
- Hodně `any` typů naznačuje, že strict mode možná není zapnutý
- Nebo je zapnutý, ale jsou použity type assertions místo správných typů

**Kde:**
- `tsconfig.json` - je třeba zkontrolovat

**Řešení:**
- Zkontrolovat `tsconfig.json` a zjistit, jestli je strict mode zapnutý
- Pokud ne, zapnout ho postupně a opravit typy

---

### 18. Chybějící loading states

**Problém:**
- Některé operace možná nemají loading states
- Uživatel neví, jestli aplikace pracuje nebo zamrzla

**Kde:**
- Některé API volání možná nemají loading indicators

**Poznámka:** Je třeba provést review všech async operací a ověřit, že mají loading states.

---

### 19. Error messages nejsou lokalizované

**Problém:**
- Všechny error messages jsou v češtině
- Aplikace není připravená na internacionalizaci

**Kde:**
- Celá aplikace - všechny stringy jsou hardcoded v češtině

**Poznámka:** Pokud se neplánuje internacionalizace, je to v pořádku. Ale je dobré to vědět.

---

### 20. Chybějící unit testy

**Problém:**
- Nevidím žádné test soubory
- Aplikace nemá unit testy

**Kde:**
- Celá aplikace

**Dopad:**
- Refaktoring je riskantnější
- Chyby se objeví až při manuálním testování
- Regrese jsou častější

**Řešení:**
- Přidat unit testy pro kritické funkce (např. phone normalization, code generation)
- Přidat integration testy pro hlavní user flows

---

## ❓ CO NEVÍM / CO JE NEJASNÉ

### 21. Jak se inicializuje window.__activeServiceId v Tauri?

**Otázka:**
- Původně aplikace četla `window.__activeServiceId` z Tauri backendu
- Jak se tato hodnota nastavovala?
- Je to stále potřeba, nebo to můžeme smazat?

**Kde:**
- `src-tauri/src/` - Tauri backend kód
- Může být v Rust kódu nebo v JS inicializaci

---

### 22. Co dělá RECOVER/ složka?

**Otázka:**
- V projektu je složka `RECOVER/` s několika soubory
- Jsou to backup soubory?
- Můžou se smazat?

**Kde:**
- `RECOVER/Settings.tsx`
- `RECOVER/supabaseClient.ts`
- `RECOVER/team-list_index.ts`
- `RECOVER/team-remove-member_index.ts`

---

### 23. Jak funguje Preview.tsx s Tauri?

**Otázka:**
- Preview.tsx otevírá nové Tauri webview okno
- Jak se to synchronizuje s hlavní aplikací?
- Co se stane, když uživatel zavře preview okno jinak než přes "Close" tlačítko?

**Kde:**
- `src/pages/Preview.tsx`
- `src/pages/Orders.tsx:778-853` - previewDocument funkce

---

### 24. Jak funguje offline fallback?

**Otázka:**
- Některé části aplikace ukládají do localStorage jako fallback
- Jak funguje offline režim?
- Kdy se data synchronizují zpět na server?

**Kde:**
- Různé části aplikace používají localStorage
- OnlineGate komponenta kontroluje připojení

**Poznámka:** Možná offline režim není implementovaný a localStorage je jen legacy kód.

---

### 25. Jak funguje synchronizace mezi více otevřenými okny aplikace?

**Otázka:**
- Pokud má uživatel otevřeno více oken aplikace současně
- Jak se synchronizují změny mezi okny?
- Používá se realtime subscriptions v každém okně zvlášť?

**Kde:**
- Realtime subscriptions v Orders.tsx, Customers.tsx, Settings.tsx

---

## 📋 SHRNUTÍ PRIORIT

### P1 (KRITICKÉ - opravit okamžitě):
1. **activeServiceId se nikdy nenastavuje** - aplikace nefunguje bez tohoto
2. **StatusesStore používá window.__activeServiceId** - statusy se nenačítají

### P2 (VÁŽNÉ - opravit brzy):
3. Duplicitní načítání služeb v Settings.tsx
4. Příliš mnoho `any` typů (postupně opravovat)
5. Race conditions v useEffect (přidat cleanup flags)

### P3 (PROSTŘEDNÍ - zvážit opravu):
6. Chybějící error boundaries
7. Hardcoded localStorage keys (centralizovat)
8. Nepoužité proměnné (uklidit)

### P4 (DROBNÉ - nice to have):
9. Unit testy
10. Internacionalizace (pokud je potřeba)
11. Performance optimalizace (useMemo, useCallback review)

---

## 📝 DOPORUČENÍ

1. **Okamžitě opravit activeServiceId inicializaci** - aplikace bez tohoto nefunguje
2. **Refaktorovat StatusesStore** - odstranit závislost na window globálu
3. **Postupně přidávat typy** - nahradit `any` správnými typy
4. **Přidat Error Boundaries** - zlepšit UX při chybách
5. **Centralizovat storage keys** - zlepšit maintainability
6. **Přidat unit testy** - zlepšit code quality a confidence při refaktoringu
7. **Dokumentovat offline režim** - nebo ho odstranit, pokud není používaný

