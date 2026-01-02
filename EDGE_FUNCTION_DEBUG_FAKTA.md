# Edge Function Debug - Fakta z kódu

## 1. Která Edge Function padá?

**team-list** (pravděpodobně i team-remove-member)

Přesné názvy ve složce:
- `supabase/functions/team-list/index.ts`
- `supabase/functions/team-remove-member/index.ts`

---

## 2. Nastavení verify_jwt v config.toml

**V `supabase/config.toml` (řádky 387-391):**

```toml
[functions.team-list]
verify_jwt = true

[functions.team-remove-member]
verify_jwt = true
```

**Odpověď:** `verify_jwt = true` pro obě funkce.

---

## 3. Jak se volá z klienta (Settings.tsx TeamManagement)

### Kód volání team-list (řádek 2221):

```typescript
const { data, error: fetchError } = await supabase.functions.invoke("team-list", {
  body: { serviceId: activeServiceId },
});
```

### Kód volání team-remove-member (řádek 2504):

```typescript
const { error } = await supabase.functions.invoke("team-remove-member", {
  body: { serviceId: removeServiceId, userId: removeUserId },
  // žádné headers - Supabase JS automaticky přidá session JWT
});
```

### Detaily:

1. **Body:**
   - `team-list`: `{ serviceId: activeServiceId }`
   - `team-remove-member`: `{ serviceId: removeServiceId, userId: removeUserId }`

2. **Headers:**
   - **ŽÁDNÉ explicitní headers** - spoléhá se na Supabase JS client, že automaticky přidá Authorization header

3. **Odkud bere token:**
   - `supabase` client je importován z `../lib/supabaseClient` (řádek 7)
   - `session` je získán z `useAuth()` hooku (řádek 2157): `const { session } = useAuth();`
   - Supabase JS client by měl automaticky použít session z interního stavu při volání `functions.invoke()`

4. **Kontrola session před voláním:**
   - V useEffect dependency array je `session` (řádek 2273): `}, [activeServiceId, session, supabase]);`
   - Kontrola před voláním (řádek 2201): `if (!activeServiceId || !session || !supabase) return;`

**⚠️ PROBLÉM:** V kódu **NENÍ** explicitní kontrola `session?.access_token` před voláním `invoke()`. Spoléhá se na to, že Supabase JS client automaticky přidá token.

---

## 4. Implementace Edge Functions

### team-list/index.ts (řádky 36-58):

```typescript
// Create Supabase client with ANON_KEY and Authorization header
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const supabase = createClient(supabaseUrl, anonKey, {
  global: { headers: { Authorization: `Bearer ${token}` } },
  auth: { persistSession: false },
});

// Verify user via Supabase client (getUser() without parameter - uses header)
const { data: { user }, error: userErr } = await supabase.auth.getUser();
```

### team-remove-member/index.ts (řádky 36-57):

```typescript
// Create Supabase client with ANON_KEY and Authorization header
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const supabase = createClient(supabaseUrl, anonKey, {
  global: { headers: { Authorization: `Bearer ${token}` } },
  auth: { persistSession: false },
});

// Verify user via Supabase client
const { data: { user }, error: userErr } = await supabase.auth.getUser();
```

**Odpověď:**
- ✅ Používá `createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } })`
- ✅ Pak volá `supabase.auth.getUser()` pro verifikaci
- ✅ Takže používá pattern: **verify_jwt=false + getUser()**

**⚠️ KONFLIKT:**
- V `config.toml` je **verify_jwt = true**
- Ale funkce implementují vlastní auth přes `getUser()`
- To znamená **dvojí verifikaci**: gateway verify_jwt + getUser() v kódu

---

## 5. Byl aplikován fix (verify_jwt=false + getUser)?

**NE - fix NEBYL aplikován v config.toml!**

- Config má stále `verify_jwt = true` (řádky 387-391)
- Funkce mají implementovaný `getUser()` pattern
- Ale config říká gateway, aby taky verifikoval JWT před spuštěním funkce

**Výsledek:** Potenciální konflikt - pokud gateway verifikace selže, funkce se ani nespustí, takže `getUser()` se nikdy neprovede.

---

## 6. Co by mělo být zkontrolováno (dotazy pro Cursor):

1. **Je access token opravdu přítomný v momentě volání?**
   - Přidat log těsně před `invoke()`:
   ```typescript
   const { data: { session } } = await supabase.auth.getSession();
   console.log('[TeamManagement] Before invoke:', {
     hasToken: !!session?.access_token,
     tokenPreview: session?.access_token 
       ? `${session.access_token.substring(0, 10)}...${session.access_token.substring(session.access_token.length - 10)}`
       : null
   });
   ```

2. **Co říká Supabase Dashboard → Edge Function logs/invocations?**
   - Je v invocations `execution_id` nebo je `null`?
   - Jaký je kompletní error z logu server-side?

3. **Proč to stále padá, když je verify_jwt=true a funkce používá getUser()?**
   - Možná gateway verifikace selže dřív, než se funkce spustí
   - Možná token není poslán správně z klienta
   - Možná token je expired nebo invalid

---

## Doporučení:

1. **Přidat logging před invoke()** - zkontrolovat přítomnost tokenu
2. **Zkontrolovat Supabase Dashboard logs** - zjistit přesný error
3. **Zvážit změnu verify_jwt na false** - pokud funkce už používají getUser()
4. **Nebo odstranit getUser() z funkce** - pokud má být verify_jwt=true na gateway level

