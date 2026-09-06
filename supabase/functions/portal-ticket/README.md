# portal-ticket – zákaznický portál

Veřejná edge funkce pro stránku `web/z/?t=<token>`. Zákazník na ní bez přihlášení
vidí stav zakázky, fotky, provedené opravy a cenu (s QR platbou), schvaluje cenovou
nabídku, podepisuje převzetí a potvrzuje vyzvednutí. Jediné oprávnění je token
`tickets.portal_token` (zakládá RPC `ensure_portal_token` z Jobi).

## Nasazení

```sh
npx supabase db push                                        # migrace 20260904120000_customer_portal.sql
npx supabase functions deploy portal-ticket --no-verify-jwt # funkce běží bez JWT
```

Do `supabase/config.toml` patří (stejně jako u capture-upload):

```toml
[functions.portal-ticket]
verify_jwt = false
```

## Migrace `20260904120000_customer_portal.sql`

- `tickets` – nové sloupce: `portal_token text UNIQUE`, `quote_amount numeric(10,2)`, `quote_note`,
  `quote_status` (`none|sent|approved|rejected`, NOT NULL DEFAULT `none`), `quote_sent_at`,
  `quote_decided_at`, `quote_decision_meta jsonb`, `intake_signature_url`, `intake_signed_at`,
  `portal_last_opened_at`. Partial index `idx_tickets_portal_token`.
- `ticket_portal_events` (`id`, `ticket_id`, `service_id`, `type`, `meta jsonb`, `created_at`),
  `type` ∈ `opened | quote_approved | quote_rejected | signed | pickup_confirmed | link_sent | quote_sent`.
  RLS: členové servisu SELECT + INSERT, nic víc. Přidáno do `supabase_realtime`.
- RPC `ensure_portal_token(p_ticket_id uuid) RETURNS text` – SECURITY DEFINER, jen členové servisu
  (authenticated); token vygeneruje jednou (32 znaků, URL-safe base64) a dál vrací stejný.
- `ticket_history_log` – neloguje „updated“, když se hnul jen `portal_last_opened_at`.
- Portál nevyžaduje `has_entitlement`.

## API

Všechny odpovědi jsou JSON, CORS `*`. Neznámý/chybějící token → `404 { "error": "Odkaz není platný." }`.
Best-effort limit 60 požadavků/min na token → `429`.

### `GET /portal-ticket?t=<token>`

```jsonc
{
  "ok": true,
  "ticket": {
    "code": "SRV-0042",
    "createdAt": "…", "expectedCompletionAt": "…|null",
    "deviceLabel": "iPhone 13",              // device_label, jinak brand + model
    "requestedRepair": "…",                  // tickets.notes
    "status": { "key": "received", "label": "Přijato", "color": "#…|null", "isFinal": false },
    "photosBefore": ["url"], "photos": ["url"],
    "performedRepairs": [{ "name": "Displej", "price": 2490 }],
    "discount": { "type": "percentage|amount", "value": 10 } | null,
    "totalPrice": 2241,                      // stejné pravidlo jako computeFinalPrice v src/components/tickets/types.ts
    "estimatedPrice": 2500 | null,
    "quote": { "amount": 2490 | null, "note": "…|null", "status": "none|sent|approved|rejected", "sentAt": "…|null", "decidedAt": "…|null" },
    "intakeSignedAt": "…|null", "intakeSignatureUrl": "url|null",
    "handoffMethod": "…|null", "handbackMethod": "…|null"
  },
  "service": { "name": "…", "phone": null, "email": null, "website": null,
               "addressStreet": null, "addressCity": null, "addressZip": null,
               "bankAccount": null, "iban": null },
  "payment": { "amount": 2490, "vs": "0042", "spayd": "SPD*1.0*ACC:CZ…*AM:2490.00*CC:CZK*X-VS:0042*MSG:Zakazka SRV-0042" } | null
}
```

- `payment.amount` = `quote.amount` když je nabídka schválená, jinak `totalPrice` (> 0); `null` bez částky nebo bez účtu.
- `payment.vs` = číslice z `code` (posledních max 10). `spayd` z IBAN, případně z čísla účtu převedeného na CZ IBAN
  (`_shared/spayd.ts`); `null`, když účet nejde použít.
- Každý GET nastaví `portal_last_opened_at = now()`; událost `opened` se zapisuje nejvýš jednou za 30 minut.

### `POST /portal-ticket` – tělo `{ "t": "<token>", "action": "...", "note"?: "...", "signature"?: "data:image/png;base64,..." }`

| action    | podmínka                     | efekt |
|-----------|------------------------------|-------|
| `approve` | `quote_status = 'sent'`, jinak 409 | `quote_status = 'approved'`, `quote_decided_at`, `quote_decision_meta = { ip, userAgent, note }`, událost `quote_approved` |
| `reject`  | dtto                         | `quote_status = 'rejected'`, …, událost `quote_rejected` |
| `sign`    | ještě nepodepsáno, jinak 409; PNG data URL do 300 kB, jinak 400 | rezervace `intake_signed_at`, pak upload do `diagnostic-photos/signatures/<ticketId>-<ts>.png` a `intake_signature_url`, událost `signed` |
| `pickup`  | ještě nepotvrzeno, jinak 409 | jen událost `pickup_confirmed` |
| jiné      | –                            | 400 |

Každá úspěšná akce vrací stejný payload jako GET.

### 409 znamená „neuloženo“, ne „uloženo jinak“

Podmíněný `UPDATE`, který nechytil žádný řádek, vrací v supabase-js `error === null`.
Proto má každý zápis `.select("id")` a při nule řádků odpovídá 409 – jinak by portál
zákazníkovi odpověděl „ok“, přestože se nic neuložilo, a v `ticket_portal_events` by
zůstala událost o rozhodnutí, které v zakázce není (i obě naráz).

Podpis proto zabírá `intake_signed_at` **před** nahráním souboru. Kdyby se nahrávalo
první, souběžný druhý pokus by v úložišti nechal podpis zákazníka bez vazby na zakázku.
Když nahrání nebo dopsání URL selže, funkce rezervaci uvolní a nahraný soubor smaže.

## Co se ven neposílá

Telefon, e-mail ani adresa zákazníka, kód/heslo zařízení, IMEI, sériové číslo, interní
poznámky a diagnostika, nákupní ceny. Servis: jen kontaktní údaje a účet (kvůli QR platbě).
