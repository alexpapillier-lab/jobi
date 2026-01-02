# Seznam polí z local tickets, která se neposílají do cloudu

## Pole, která se v současnosti neposílají do Supabase při vytváření/úpravě ticketu:

### 1. `diagnosticText` (string | undefined)
- **Popis**: Text diagnostiky
- **Typ v DB**: Není v tabulce `tickets`
- **Použití**: Používá se v UI pro zobrazení diagnostického protokolu
- **Doporučení**: Přidat sloupec `diagnostic_text` (TEXT) do tabulky `tickets`

### 2. `diagnosticPhotos` (string[] | undefined)
- **Popis**: URL diagnostických fotografií
- **Typ v DB**: Není v tabulce `tickets`
- **Použití**: Používá se v UI pro zobrazení diagnostických fotek
- **Doporučení**: Přidat sloupec `diagnostic_photos` (JSONB nebo TEXT[]) do tabulky `tickets`

### 3. `discountType` ("percentage" | "amount" | null | undefined)
- **Popis**: Typ slevy (procenta, částka, nebo žádná)
- **Typ v DB**: Není v tabulce `tickets`
- **Použití**: Používá se pro výpočet finální ceny
- **Doporučení**: Přidat sloupec `discount_type` (VARCHAR) do tabulky `tickets`

### 4. `discountValue` (number | undefined)
- **Popis**: Hodnota slevy (% nebo Kč)
- **Typ v DB**: Není v tabulce `tickets`
- **Použití**: Používá se pro výpočet finální ceny
- **Doporučení**: Přidat sloupec `discount_value` (NUMERIC) do tabulky `tickets`

### 5. `performedRepairs` (PerformedRepair[] | undefined)
- **Popis**: Seznam provedených oprav s detaily (název, cena, náklady, čas, produkty)
- **Typ v DB**: V tabulce `tickets` je sloupec `performed_repairs` (JSONB), ale v `createTicket` se neposílá
- **Použití**: Používá se v UI pro zobrazení provedených oprav
- **Doporučení**: ✅ Sloupec existuje, ale v `createTicket` se neposílá - **OPRAVIT**

## Pole, která se posílají, ale nejsou v `createTicket`:

V `createTicket` se posílají tyto pole:
- ✅ service_id
- ✅ title
- ✅ status
- ✅ notes
- ✅ customer_name, customer_phone, customer_email
- ✅ customer_address_street, customer_address_city, customer_address_zip
- ✅ customer_company, customer_ico, customer_info
- ✅ device_serial, device_passcode, device_condition, device_note
- ✅ external_id, handoff_method, estimated_price

**Chybí:**
- ❌ performed_repairs (sloupec existuje, ale neposílá se)

## Shrnutí:

### Pole, která potřebují nový sloupec v DB:
1. `diagnostic_text` (TEXT)
2. `diagnostic_photos` (JSONB nebo TEXT[])
3. `discount_type` (VARCHAR)
4. `discount_value` (NUMERIC)

### Pole, která potřebují opravu v kódu:
1. `performed_repairs` - sloupec existuje, ale neposílá se v `createTicket` a `saveTicketChanges`

## SQL migrace pro chybějící sloupce:

```sql
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS diagnostic_text TEXT,
  ADD COLUMN IF NOT EXISTS diagnostic_photos JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS discount_type VARCHAR(20),
  ADD COLUMN IF NOT EXISTS discount_value NUMERIC(10,2);
```

## Opravy v kódu:

1. V `createTicket` přidat `performed_repairs` do payload
2. V `saveTicketChanges` přidat `performed_repairs`, `diagnostic_text`, `diagnostic_photos`, `discount_type`, `discount_value` do payload
3. V `mapSupabaseTicketToTicketEx` přidat mapování těchto polí z DB






