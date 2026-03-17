# Integrace document_profiles se Supabase

## Aktuální stav

Profily dokumentů se ukládají **lokálně** v `~/.jobidocs-data/profiles.json` (nebo v userData Electronu). JobiDocs API `GET/PUT /v1/profiles` čte/zapisuje tento soubor.

## Cíl: Supabase

Tabulka `document_profiles` v Supabase existuje (migrace `20260208100000_create_document_profiles.sql`). Profily by měly být sdílené mezi všemi zařízeními a uživateli servisu.

## Co je potřeba udělat

### 1. Jobi: předání JWT do JobiDocs

Jobi má přístup k Supabase session (JWT). Při `pushContextToJobiDocs` přidat volitelný parametr:

```ts
// src/lib/jobidocs.ts
await fetch(`${JOBIDOCS_API}/v1/context`, {
  method: "PUT",
  body: JSON.stringify({
    services,
    activeServiceId,
    supabaseUrl: import.meta.env.VITE_SUPABASE_URL,  // nebo z env
    supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    accessToken: session?.access_token,  // z supabase.auth.getSession()
  }),
});
```

JobiDocs kontext pak bude obsahovat `supabaseUrl`, `supabaseAnonKey`, `accessToken`.

### 2. JobiDocs: Supabase client

- Přidat `@supabase/supabase-js` do `jobidocs/package.json`
- V `api/profiles.ts`: když je v kontextu `accessToken`, volat Supabase REST API místo lokálního souboru:

```ts
// Příklad: fetch s JWT
const { data, error } = await supabase
  .from('document_profiles')
  .select('profile_json, version')
  .eq('service_id', serviceId)
  .eq('doc_type', docType)
  .single();

// Supabase client s custom access token:
const supabase = createClient(url, anonKey, {
  global: { headers: { Authorization: `Bearer ${accessToken}` } }
});
```

### 3. Kontext v JobiDocs

JobiDocs API server má `jobiContext`. Rozšířit o:

- `supabaseUrl?: string`
- `supabaseAnonKey?: string`
- `accessToken?: string`

Jobi při každém `PUT /v1/context` posílá aktuální session. Token je platný cca 1 hodinu – Jobi ho pravidelně obnovuje.

### 4. Fallback

Když `accessToken` chybí (Jobi neběží, nebo uživatel není přihlášen), JobiDocs dál používá lokální `profiles.json`.

### 5. Bezpečnost

- JWT nikdy nelogovat
- Supabase RLS zajišťuje, že uživatel vidí jen profily servisů, kde je člen
- JobiDocs nemá vlastní auth – spoléhá na JWT z Jobi

## Kontrolní seznam implementace

- [ ] Jobi: přidat `accessToken`, `supabaseUrl`, `supabaseAnonKey` do `pushContextToJobiDocs`
- [ ] JobiDocs: rozšířit `PUT /v1/context` o přijetí těchto polí
- [ ] JobiDocs: `api/profiles.ts` – při `accessToken` volat Supabase místo lokálního souboru
- [ ] JobiDocs: `npm install @supabase/supabase-js`
- [ ] Migrace `document_profiles` nasazená (`supabase db push`)
