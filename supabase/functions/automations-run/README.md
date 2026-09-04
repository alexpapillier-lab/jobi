# automations-run

Vykonavatel stavebnice automatizací (tabulky `automation_rules` a
`automation_runs`, typy v `src/lib/automations.ts`).

## Nasazení

```bash
# 1) migrace: tabulky, převod sms_automations, tajemství ve Vaultu, pg_cron + pg_net
npx supabase db push

# 2) edge funkce – bez ověření JWT (plánovaný běh žádné JWT nemá)
npx supabase functions deploy automations-run --no-verify-jwt
```

Migrace `20260904150000_automations.sql` je idempotentní – jde pustit
opakovaně. Když projekt nemá zapnuté `pg_cron` nebo `pg_net`, jen to
ohlásí (`RAISE NOTICE`) a naplánování je potřeba doplnit po zapnutí
rozšíření (Supabase → Database → Extensions) opětovným spuštěním migrace.

Potřebná tajemství edge funkcí (stejná jako u `sms-send` a
`invoice-send-email`): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
`RESEND_API_KEY`, `RESEND_FROM_EMAIL`. `SUPABASE_URL`,
`SUPABASE_ANON_KEY` a `SUPABASE_SERVICE_ROLE_KEY` dodává platforma.

Ruční tik (kontrola, že plánovač funguje):

```sql
select public.automations_tick();          -- pošle požadavek přes pg_net
select * from cron.job where jobname = 'jobi-automations';
select * from public.automation_runs order by ran_at desc limit 20;
```

## Vstupy

Vždy `POST` s JSON tělem.

### Plánovaný běh (pg_cron → pg_net)

```json
{ "mode": "scheduled", "secret": "<automations_cron_secret z Vaultu>" }
```

Bez hlavičky Authorization. Tajemství se porovná s RPC
`automations_cron_secret()` (jen `service_role`); jinak `403`.
Každých 15 minut projde všechny servisy s aktivními pravidly a vyhodnotí:

- **status_age** – zakázky ve stavu `status_key` (nesmazané, max. 200 na
  pravidlo a tik). Čas ve stavu = poslední řádek `ticket_history`, kde
  `details.changes.status.new = status_key`; bez něj `updated_at`, pak
  `created_at`. Spustí se, když je ve stavu ≥ `after_hours`. Proměnná
  `days` = celé dny ve stavu. Opakování: s `repeat_hours` znovu až po
  uplynutí odstupu od posledního úspěšného běhu, bez něj jednou na
  zakázku. Přeskočené / chybné běhy se zkusí znovu nejdřív za 24 h (nebo
  po `repeat_hours`, když je kratší), aby log nerostl každý tik.
- **event** – `ticket_portal_events` za posledních 20 minut, mapování
  `opened → portal_opened`, `quote_approved`, `quote_rejected`, `signed`.
  Dedupe přes `automation_runs.detail` začínající `event:<id události>`.

### Okamžité spuštění z Jobi

```json
{ "service_id": "…", "ticket_id": "…", "event": "status_change", "status_key": "ready" }
{ "service_id": "…", "ticket_id": "…", "event": "ticket_created" }
```

S hlavičkou `Authorization: Bearer <JWT uživatele>`. Funkce ověří, že
uživatel je členem `service_id` (přes `service_memberships` pod jeho
RLS) a že zakázka do servisu patří. `status_change` vyhodnotí pravidla
„zakázka se přepne do stavu“ pro `status_key` (bez něj aktuální stav
zakázky); `ticket_created` jen pravidla „založí se nová zakázka“.

### Odpověď

```json
{ "ok": true, "ran": 2, "skipped": 1, "errors": 0 }
```

`ran` = počet úspěšných spuštění. Chyby jednotlivých pravidel se
nevyhazují – končí řádkem `error` v `automation_runs` a v počítadle.

## Podmínky

- `skip_final` (výchozí zapnuto) – zakázka v koncovém stavu se přeskočí.
  Netýká se stavu, na který pravidlo samo míří (`status_change` /
  `status_age` se `status_key` = aktuální stav) – jinak by „při přepnutí
  do Vyzvednuto → SMS“ nikdy neproběhlo.
- `once_per_ticket` (výchozí zapnuto) – když existuje úspěšný běh
  pravidla na zakázce, přeskočí se. U `status_age` s `repeat_hours` se
  nepoužije (rozhoduje odstup opakování).
- `require_phone` / `require_email` – přeskočit bez telefonu / e-mailu.

## Akce

| Akce | Co udělá | Kdy `skipped` / `error` |
|---|---|---|
| `sms` | Dosadí proměnné, pošle přes Twilio ze čísla servisu (`service_phone_numbers`), zapíše do `sms_conversations` / `sms_messages` – zpráva se ukáže v chatu | bez telefonu, bez nároku `sms`, bez aktivního čísla → `skipped`; chyba Twilia → `error` s hláškou |
| `email` | Resend z `RESEND_FROM_EMAIL`, reply-to = e-mail servisu z `service_settings.config.companyData.email`; text → jednoduché HTML s `<br>` | bez e-mailu → `skipped`; chyba Resendu → `error` |
| `set_status` | `tickets.status = status_key` (historie se zapíše triggerem, `changed_by` NULL), pak jednou vyhodnotí pravidla `status_change` pro nový stav (bez další rekurze) | neznámý stav → `error`; stejný stav → `skipped` |
| `add_fee` | Připíše `{ id, name, type: "manual", price }` do `performed_repairs`; `per_day` = `amount × days`. Vždy jen jednou na zakázku | už připsáno / nulová částka → `skipped` |
| `notify` | Vloží řádek do `ticket_comments` (`author = "Automatizace"`, `author_id` NULL) | prázdný text → `skipped` |

## Proměnné šablon

Stejný seznam jako `TEMPLATE_VARIABLES` v `src/lib/automations.ts`:
`{{code}}`, `{{customer_name}}`, `{{device_label}}`, `{{status}}`
(popisek stavu), `{{total_price}}` (opravy minus sleva, „2 490“),
`{{notes}}`, `{{expected_date}}` (`expected_completion_at`, „8. 9. 2026“),
`{{days}}`, `{{portal_url}}` (`https://appjobi.com/z/?t=…`; token se
založí jen když ho šablona používá), `{{service_name}}`,
`{{service_phone}}` (z `companyData`).

## Kontrola typů

```bash
cd supabase/functions/automations-run && deno check index.ts
```
