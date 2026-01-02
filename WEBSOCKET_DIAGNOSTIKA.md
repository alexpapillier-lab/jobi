# Diagnostika Websocket připojení

## KROK 1: Analýza websocket připojení

### A) ws://localhost:1420/?token=...

**Zjištění:**
- Port `1420` je **Tauri dev server port** (definovaný v `vite.config.ts:19` a `src-tauri/tauri.conf.json:8`)
- Websocket na `ws://localhost:1420` je **interní Tauri/Vite HMR bridge** pro Hot Module Replacement
- **Není to součást aplikace**, ale dev tools

**Výskyty v kódu:**
- `src/pages/Orders.tsx:761` - fallback origin pro window.location.origin
- `vite.config.ts:19` - dev server port
- `src-tauri/tauri.conf.json:8` - Tauri dev URL

**Závěr:**
✅ Websocket na portu 1420 je **očekávaný** a **normální** v dev módu. V produkčním buildu (`npm run tauri build`) se neobjeví, protože není dev server.

---

### B) wss://...supabase.co/realtime/v1/websocket?... Socket is not connected

**Zjištění:**
Našel jsem **4 realtime subscriptions** v aplikaci:

#### 1. Orders.tsx - service_document_settings
- **Řádek:** 3739-3774
- **Topic:** `service_document_settings:${activeServiceId}`
- **Cleanup:** ✅ Ano - `supabase.removeChannel(channel)` v return funkci
- **Dependencies:** `[activeServiceId, supabase]`
- **Problém:** `supabase` v dependencies může způsobit re-subscribe (i když je to singleton)

#### 2. Orders.tsx - tickets
- **Řádek:** 3835-3929
- **Topic:** `tickets:${activeServiceId}`
- **Cleanup:** ✅ Ano - `supabase.removeChannel(channel)` v return funkci
- **Dependencies:** `[activeServiceId, supabase]`
- **Problém:** `supabase` v dependencies může způsobit re-subscribe

#### 3. Settings.tsx - service_document_settings
- **Řádek:** 650-681
- **Topic:** `service_document_settings:${activeServiceId}`
- **Cleanup:** ✅ Ano - `supabase.removeChannel(channel)` v return funkci
- **Dependencies:** `[activeServiceId, supabase]`
- **Problém:** `supabase` v dependencies může způsobit re-subscribe

#### 4. Customers.tsx - customers
- **Řádek:** 256-308
- **Topic:** `customers:${activeServiceId}`
- **Cleanup:** ✅ Ano - `supabase.removeChannel(channel)` v return funkci
- **Dependencies:** `[activeServiceId, supabase]`
- **Problém:** `supabase` v dependencies může způsobit re-subscribe

#### 5. AuthProvider.tsx - auth state
- **Řádek:** 28-34
- **Subscription:** `supabase.auth.onAuthStateChange`
- **Cleanup:** ✅ Ano - `subscription.unsubscribe()` v return funkci
- **Dependencies:** `[]` (správně)

---

## Potenciální problémy

### 1. ⚠️ `supabase` v dependencies array

**Problém:**
Všechny realtime subscriptions mají `supabase` v dependencies array:
```typescript
}, [activeServiceId, supabase]);
```

**Důvod k obavám:**
- `supabase` je singleton vytvořený jednou při importu (`src/lib/supabaseClient.ts`)
- Teoreticky by se neměl měnit, ale React neví, že je to konstanta
- Pokud by se `supabase` objekt změnil (např. při re-inicializaci), způsobilo by to re-subscribe všech kanálů

**Řešení:**
- Odstranit `supabase` z dependencies (je to konstanta)
- Nebo použít `useRef` pro supabase klienta

### 2. ⚠️ Duplicitní subscriptions

**Potenciální problém:**
- Orders.tsx a Settings.tsx oba subscribe na `service_document_settings:${activeServiceId}`
- Pokud jsou obě komponenty mountnuté současně, vytvoří se **2 kanály se stejným topicem**
- To může způsobit duplicitní eventy a potenciální memory leaky

**Řešení:**
- Zvážit sdílený subscription přes context nebo custom hook
- Nebo zajistit, že se komponenty nemountují současně

### 3. ⚠️ Cleanup při service switch

**Zjištění:**
- Při změně `activeServiceId` se useEffect znovu spustí
- Cleanup funkce se zavolá **před** vytvořením nového kanálu
- To by mělo být OK, ale záleží na timing

**Potenciální race condition:**
- Starý kanál se odpojí
- Nový kanál se vytvoří
- Mezitím může dorazit event, který se ztratí

---

## Přidané diagnostické logy

Přidal jsem do všech realtime subscriptions diagnostické logy:

```typescript
const topic = `service_document_settings:${activeServiceId}`;
console.log("[RT] subscribe", topic, new Date().toISOString());

// ... subscription code ...

return () => {
  console.log("[RT] unsubscribe", topic, new Date().toISOString());
  if (supabase) {
    supabase.removeChannel(channel);
  }
};
```

**Co sledovat v konzoli:**
1. **Počet subscribe/unsubscribe volání** - mělo by odpovídat změnám `activeServiceId`
2. **Timing** - jestli se unsubscribe volá před subscribe (to je OK)
3. **Duplicitní subscribe** - jestli se stejný topic subscribe vícekrát bez unsubscribe
4. **Chybějící unsubscribe** - jestli se kanál nikdy neodpojí

---

## Doporučení pro další kroky

### KROK 2: Testování

1. **Otevřít DevTools Console** a sledovat logy `[RT] subscribe` a `[RT] unsubscribe`
2. **Přepínat mezi službami** a sledovat, jestli se kanály správně odpojují/připojují
3. **Přepínat mezi stránkami** (Orders ↔ Settings) a sledovat duplicitní subscriptions
4. **Sign out** a ověřit, že se všechny kanály odpojí

### KROK 3: Oprava (pokud bude potřeba)

1. **Odstranit `supabase` z dependencies** - je to konstanta, neměla by tam být
2. **Sdílený subscription** pro `service_document_settings` mezi Orders a Settings
3. **Explicitní cleanup** při sign out (volat `supabase.removeAllChannels()`)

---

## Závěr

✅ **Cleanup funkce jsou správně implementované** ve všech subscriptions
⚠️ **Potenciální problémy:**
- `supabase` v dependencies může způsobit zbytečné re-subscribe
- Duplicitní subscriptions pro `service_document_settings` (Orders + Settings)
- Race conditions při rychlém přepínání služeb

🔍 **Diagnostické logy jsou přidané** - nyní můžeme sledovat, kdy a jak často se kanály vytváří/odpojují.

