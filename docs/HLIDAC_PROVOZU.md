# Hlídač provozu (upozornění na chyby)

Chyby z aplikace padají do tabulky `error_logs`, ale sama od sebe se do ní
nikdo nedívá. Od 5. 9. 2026 se na ni jednou za hodinu podívá edge funkce
`alerts-check` a při něčem nezdravém pošle e-mail.

## Kdy přijde e-mail

| Druh | Podmínka |
|------|----------|
| `pady_aplikace` | 2 a víc pádů vykreslení (`react.render_crash`) za hodinu |
| `hodne_chyb` | 5 a víc ostatních chyb za hodinu |
| `opakovana_chyba:<kód>` | jedna chyba 10× v jednom servisu |

Stejné upozornění nepřijde znovu dřív než za 6 hodin – jinak by při delším
výpadku chodil e-mail každou hodinu a člověk si ho odfiltruje do koše.
Odeslaná upozornění drží tabulka `alert_events` (přístup má jen service_role).

Chyby z vývojového serveru se přeskakují: `logError` je označí `context.dev`,
protože hot reload běžně vyrábí „Should have a queue“ a zákazníka se to netýká.

## Kam e-mail chodí

Na adresu ze secretu `ALERT_EMAIL`. Když není nastavený, použije se e-mail
root ownera z `auth.users`. Odesílá se přes Resend (`RESEND_API_KEY`,
`RESEND_FROM_EMAIL` – stejné klíče jako pozvánky a faktury).

```bash
npx supabase secrets set ALERT_EMAIL=alex@example.cz
```

## Jak to běží

`pg_cron` úloha `jobi-alerts` (`5 * * * *`) volá `public.alerts_tick()`, ta
přes `pg_net` zavolá funkci se sdíleným tajemstvím z Vaultu
(`alerts_cron_secret`). Stejný postup jako u automatizací.

Funkce má `verify_jwt = false`, dovnitř se dostane jen s tím tajemstvím nebo
s tokenem root ownera.

## Ruční zkouška

Nanečisto, bez odeslání e-mailu (token root ownera):

```bash
curl -s -X POST https://ijtvcgolsdsrquqbvjrz.supabase.co/functions/v1/alerts-check \
  -H "Content-Type: application/json" -H "Authorization: Bearer <token>" \
  -d '{"windowMinutes":1440,"dryRun":true}'
```

Odpověď řekne, co by odešlo (`would_send`) a co je utlumené (`suppressed`).
Bez `dryRun` se e-mail opravdu pošle.

## Co tu zatím není

Stavová stránka pro zákazníky (status page) a upozornění na to, že aplikace
neběží vůbec – na to by musel hlídat někdo zvenčí, ne stejná infrastruktura.
