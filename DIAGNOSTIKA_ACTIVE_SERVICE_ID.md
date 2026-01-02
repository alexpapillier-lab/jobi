# Diagnostika activeServiceId

## 1. Kde přesně v aplikaci vzniká activeServiceId (soubor + řádky)?

**src/App.tsx, řádky 270, 291, 316:**
```typescript
activeServiceId={(window as any).__activeServiceId || null}
```

ActiveServiceId se vytváří jako prop předávaný do komponent Orders, Customers a Settings. Hodnota se čte přímo z `window.__activeServiceId` pomocí globální proměnné window objektu. Pokud `window.__activeServiceId` není nastaveno, vrací se `null`.

## 2. Kde se nastavuje (setActiveServiceId) a na základě čeho?

**V App.tsx NENÍ žádné setActiveServiceId** - hodnota se pouze čte z `window.__activeServiceId` a předává jako prop.

**Lokální state s setActiveServiceId existuje v:**
- **src/pages/Settings.tsx, řádek 2158:** `const [activeServiceId, setActiveServiceId] = useState<string | null>(null);` (v komponentě TeamManagement)
- **src/pages/Settings.tsx, řádek 3148:** `const [activeServiceId, setActiveServiceId] = useState<string | null>(null);` (v komponentě DeletedTicketsManagement)

**Nastavení hodnoty:**
- **src/pages/Settings.tsx, řádek 2221:** `setActiveServiceId(data.services[0].service_id);` - nastavuje se automaticky na první službu ze seznamu, pokud `activeServiceId` je `null` a `data.services.length > 0`
- **src/pages/Settings.tsx, řádek 2590:** `onChange={(e) => setActiveServiceId(e.target.value)}` - uživatel může vybrat službu ze selectu
- **src/pages/Settings.tsx, řádek 3173:** `setActiveServiceId(services[0].service_id);` - v DeletedTicketsManagement, podobně automaticky na první službu

**Ale:** Tyto lokální stavy v Settings.tsx NEOVLIVŇUJÍ hodnotu `activeServiceId` prop předávanou do Orders.tsx z App.tsx.

## 3. Kde se používá při vytváření zakázky (podmínka, která hlásí „Vytváření zakázek vyžaduje přihlášení a aktivní službu")?

**src/pages/Orders.tsx, řádek 4673-4779:**

Funkce `createTicket()`:
- Řádek 4686: `if (activeServiceId && supabase) {` - podmínka, která umožní vytvoření zakázky
- Řádek 4779: `showToast("Vytváření zakázek vyžaduje přihlášení a aktivní službu", "error");` - chybová zpráva, která se zobrazí, pokud podmínka na řádku 4686 není splněna (tj. pokud `activeServiceId` je `null` nebo `supabase` je `null`)

**Logika:**
```typescript
const createTicket = () => {
  // ... validace ...
  
  // Create cloud ticket if activeServiceId exists
  if (activeServiceId && supabase) {
    // vytvoření zakázky
    return;
  }

  // Cloud mode required - should not reach here due to early return check
  showToast("Vytváření zakázek vyžaduje přihlášení a aktivní službu", "error");
};
```

## 4. Co je aktuální hodnota activeServiceId v momentě kliknutí na „Vytvořit zakázku" (podle kódu / logů)?

**Aktuální hodnota:** `(window as any).__activeServiceId || null`

**To znamená:**
- Pokud je `window.__activeServiceId` nastaveno na nějakou hodnotu (string), použije se tato hodnota
- Pokud `window.__activeServiceId` není nastaveno (undefined/null), použije se `null`
- **V kódu není žádná logika, která by nastavovala `window.__activeServiceId`** - tato hodnota musí být nastavena externě (pravděpodobně Tauri backend nebo jiný kód mimo React aplikaci)

## 5. Odkud se načítá seznam služeb (services) a kdy (useEffect závislosti)?

**src/pages/Settings.tsx, řádky 2198-2230:**

```typescript
// Load services on mount
useEffect(() => {
  if (!supabase || !session) return;
  
  (async () => {
    try {
      setServicesLoading(true);
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) {
        setServicesLoading(false);
        return;
      }

      // Standardní volání - Supabase JS automaticky přidá session JWT
      const { data, error } = await supabaseClient.functions.invoke("services-list", {
        // žádné headers - Supabase JS automaticky přidá session JWT
      });

      if (error || !data?.services) {
        setServices([]);
      } else {
        setServices((data.services as Array<{ service_id: string; service_name: string; role: string }>) || []);
        if (data.services.length > 0 && !activeServiceId) {
          setActiveServiceId(data.services[0].service_id);
        }
      }
      setServicesLoading(false);
    } catch (err) {
      setServices([]);
      setServicesLoading(false);
    }
  })();
}, [session]);
```

**Klíčové informace:**
- **Edge Function:** `services-list` (řádek 2212)
- **Závislosti useEffect:** `[session]` (řádek 2230) - načítá se při změně session
- **Podmínky:** Načítá se pouze pokud `supabase` a `session` existují
- **Automatické nastavení:** Pokud se načte alespoň jedna služba a lokální `activeServiceId` je `null`, nastaví se automaticky na první službu (řádek 2221)

**Poznámka:** Tento seznam služeb a lokální `activeServiceId` state v Settings.tsx jsou **pouze pro komponentu TeamManagement** a **neovlivňují** hodnotu `activeServiceId` prop předávanou do Orders.tsx z App.tsx.

