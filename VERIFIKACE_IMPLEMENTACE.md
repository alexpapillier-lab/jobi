# Verifikace implementace

## 1. Export/importy kolem Preview

### Import v src/pages/Preview.tsx

```typescript
import {
  generateTicketHTML,
  generateDiagnosticProtocolHTML,
  generateWarrantyHTML,
  mapSupabaseTicketToTicketEx,
  safeLoadCompanyData,
  safeLoadDocumentsConfig,
  type TicketEx,
} from "./Orders";
```

### Exporty v src/pages/Orders.tsx

Konkrétní exporty nalezené v Orders.tsx:

```
✅ export type TicketEx = Ticket & { customerId?: string; customerEmail?: string; ... }
✅ export function safeLoadCompanyData(): CompanyData (řádek 49)
✅ export function mapSupabaseTicketToTicketEx(supabaseTicket: any): TicketEx (řádek 731)
✅ export function generateTicketHTML(ticket: TicketEx, forPrint: boolean = true, config?: any, _includeActions: boolean = false): string (řádek 1141)
✅ export function generateDiagnosticProtocolHTML(ticket: TicketEx, companyData: any, forPrint: boolean = true, config?: any, _includeActions: boolean = false): string (řádek 1333)
✅ export function generateWarrantyHTML(ticket: TicketEx, companyData: any, forPrint: boolean = true, config?: any, _includeActions: boolean = false): string (řádek 1539)
✅ export function safeLoadDocumentsConfig(): any (řádek 1055)
```

**Status:** ✅ Všechny potřebné exporty existují a jsou správně importovány v Preview.tsx.

---

## 2. Route /preview

### Router v src/App.tsx

```typescript
export default function App() {
  // ... other code ...

  // Detect if we're on /preview route (for Tauri preview window)
  const isPreviewRoute = typeof window !== "undefined" && window.location.pathname === "/preview";

  if (isPreviewRoute) {
    return (
      <ThemeProvider>
        <Preview />
      </ThemeProvider>
    );
  }

  // ... rest of app with AppLayout ...
```

**Status:** ✅ Route `/preview` existuje a rendruje `Preview` bez `AppLayout`.

---

## 3. Tauri permissions

### src-tauri/capabilities/default.json

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default capability for main window",
  "windows": ["main", "preview", "print"],
  "permissions": [
    "core:default",
    "core:webview:allow-create-webview-window",
    "core:webview:allow-create-webview",
    "core:webview:allow-print",
    "core:webview:allow-webview-close",
    "core:window:allow-close",
    "core:window:allow-show",
    "core:window:allow-set-focus",
    "core:window:allow-center",
    "opener:default",
    "opener:allow-open-path",
    "dialog:default",
    "dialog:allow-save",
    "dialog:allow-message",
    "fs:default",
    "fs:allow-write-text-file",
    "fs:scope-temp"
  ],
  "scope": {
    "opener": {
      "allow": [
        {
          "path": "$TEMP/*"
        }
      ]
    }
  }
}
```

**Klíčová oprávnění pro preview:**
- ✅ `"core:webview:allow-create-webview-window"` (řádek 8) - vytvoření nového webview okna
- ✅ `"core:webview:allow-print"` (řádek 10) - tisk
- ✅ `"core:window:allow-set-focus"` (řádek 14) - focus okna
- ✅ `"core:window:allow-show"` (řádek 13) - zobrazení okna
- ✅ `"core:window:allow-center"` (řádek 15) - centrování okna
- ✅ `"windows": ["main", "preview", "print"]` (řádek 5) - definice preview okna

**Status:** ✅ Všechna potřebná oprávnění existují.

---

## 4. Supabase client + auth wrapper

### src/lib/supabaseClient.ts

```typescript
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

let supabase: ReturnType<typeof createClient> | null = null;

if (supabaseUrl && supabaseAnonKey) {
  supabase = createClient(supabaseUrl, supabaseAnonKey);
} else {
  console.error(
    "[supabaseClient] Missing environment variables: VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY"
  );
}

export { supabase };
export function getSupabaseClient() {
  return supabase;
}
```

**Status:** ✅ Žádné custom headers, čistý createClient bez globálních headers.

### src/main.tsx

```typescript
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./auth/AuthProvider";

import "./styles/theme.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);
```

**Status:** ✅ AuthProvider wrapperuje App komponentu v React.StrictMode.

---

## Shrnutí

| Komponenta | Status | Poznámka |
|------------|--------|----------|
| Preview imports | ✅ | Všechny exporty existují a jsou správně importovány |
| /preview route | ✅ | Route existuje, rendruje Preview bez layoutu |
| Tauri permissions | ✅ | Všechna potřebná oprávnění jsou přítomna |
| Supabase client | ✅ | Žádné custom headers |
| AuthProvider wrapper | ✅ | Správně wrapperuje App |

**Celkový status:** ✅ Všechny komponenty jsou správně implementovány.

