# Supabase Database Types

Tento adresář obsahuje TypeScript typy pro Supabase databázové schéma.

## Aktuální stav

Soubor `supabase.ts` obsahuje **placeholder typy** vytvořené manuálně z migrací. 
Tyto typy pokrývají základní tabulky (`customers`, `tickets`, `services`, `service_statuses`),
ale **nejsou kompletní** a nemusí odpovídat aktuálnímu stavu databáze.

## Jak vygenerovat správné typy

### Možnost 1: Pomocí Supabase CLI (doporučeno)

1. **Přihlaste se do Supabase CLI:**
   ```bash
   supabase login
   ```

2. **Linkněte projekt** (pokud ještě není linknutý):
   ```bash
   supabase link --project-ref <YOUR_PROJECT_REF>
   ```
   
   PROJECT_REF najdete v URL vašeho Supabase projektu:
   `https://<PROJECT_REF>.supabase.co`

3. **Vygenerujte typy:**
   ```bash
   npx supabase gen types typescript --linked > src/types/supabase.ts
   ```

### Možnost 2: Z remote projektu přímo

Pokud nemůžete použít link, použijte project-ref přímo:

```bash
npx supabase gen types typescript --project-id <YOUR_PROJECT_REF> > src/types/supabase.ts
```

### Možnost 3: Z lokální databáze

Pokud máte běžící lokální Supabase:

```bash
npx supabase gen types typescript --local > src/types/supabase.ts
```

## Použití typovaného clientu

Po vygenerování typů můžete používat `typedSupabase` client místo `supabase`:

```typescript
import { typedSupabase } from '../lib/typedSupabase';

// ✅ Plně typované - žádné 'as any'!
const { data, error } = await typedSupabase
  .from("customers")
  .select("id,name,phone,email")
  .eq("service_id", serviceId);

// TypeScript zná typy všech sloupců
data?.forEach(customer => {
  console.log(customer.name); // ✅ Typované!
  console.log(customer.phone); // ✅ Typované!
});
```

## Migrace na typovaný client

1. **Nahradit import:**
   ```typescript
   // Před:
   import { supabase } from "../lib/supabaseClient";
   
   // Po:
   import { typedSupabase } from "../lib/typedSupabase";
   ```

2. **Odstranit `as any` casts:**
   ```typescript
   // Před:
   const { data } = await (supabase.from("customers") as any).select("...");
   
   // Po:
   const { data } = await typedSupabase.from("customers").select("...");
   ```

3. **Ověřit typy:**
   ```bash
   npm run typecheck
   ```

## Poznámky

- Typy se generují z aktuálního stavu databáze
- Při změnách v databázi (migrace) je potřeba znovu vygenerovat typy
- Zvažte automatizaci generování typů v CI/CD pipeline
- Typy mohou být velké (několik tisíc řádků) - to je normální

