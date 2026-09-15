# Report statistik e-mailem

Od 15. 9. 2026 si majitel nebo správce servisu může v **Nastavení → Komunikace
→ Report statistik** zapnout, že mu jednou za měsíc (1. den v měsíci) nebo
jednou za týden (pondělí) přijde e-mailem PDF se statistikami servisu za
právě skončené období.

## Co je v reportu

- **Obrat, zisk, zakázky** – velké dlaždice se změnou proti předchozímu období.
- **Náklady, slevy, dokončenost, podíl reklamací, průměrná doba zakázky.**
- **Vývoj obratu** za posledních 6 měsíců (sloupce; zisk tmavší barvou).
- **Stavy zakázek** a **nejčastější opravy**.
- **Typy zařízení** a **technici** (přijal / dokončil / hodiny).
- **Hodnotní zákazníci** (podle obratu) a **pravidelní zákazníci**
  (≥ 2 zakázky v období nebo ≥ 3 za posledních 12 měsíců).
- **Pobočky** – jen u servisu s více pobočkami.
- Poznámka, jak se čísla počítají.

Čísla jsou z týchž databázových funkcí jako stránka Statistiky
(`statistiky_prehled`, `statistiky_technici`), takže sedí s aplikací.
Žebříčky zákazníků počítá edge funkce sama ze zakázek (obrat = konečná cena
po slevě, storno = 0 Kč).

## Kde co je

| Část | Soubor |
|---|---|
| Nastavení v aplikaci | `src/pages/Settings/StatistikyReportSection.tsx` |
| Uložené nastavení | `service_settings.config.statistiky_report` (`zapnuto`, `frekvence`, `emaily`, `hodina`) |
| Období, termíny, žebříčky | `supabase/functions/_shared/statistikyReport.ts` (testy `src/lib/statistikyReport.test.ts`) |
| Edge funkce | `supabase/functions/statistics-report-send/index.ts` |
| Kreslení PDF | `supabase/functions/statistics-report-send/pdf.ts` (pdf-lib, písmo Liberation Sans přibalené k funkci) |
| Záznamy o odeslání | tabulka `statistiky_report_odeslani` |
| Cron | `public.statistiky_report_tick()` každou hodinu (`jobi-statistiky-report`, minuta 20) |

Migrace: `20260915100000_opravneni_statistiky.sql` (právo „vidět statistiky“
a otevření funkcí pro `service_role`) a `20260915110000_statistiky_report_email.sql`
(tabulka, tajemství ve Vaultu, tik, cron).

## Jak to běží

1. `pg_cron` každou hodinu zavolá `statistiky_report_tick()`, ten přes
   `pg_net` edge funkci `statistics-report-send` s tajemstvím
   `statistiky_report_cron_secret` z Vaultu (migrace ho založí sama).
2. Funkce projde servisy se `zapnuto = true`. U každého se podívá, jestli je
   1. v měsíci (resp. pondělí) a hodina v Praze ≥ nastavená hodina, a jestli
   za to období (`klic` „2026-08“ / „2026-W36“) ještě nic neodešlo.
3. Sestaví PDF, pošle přes Resend všem příjemcům a zapíše řádek do
   `statistiky_report_odeslani`. Neúspěch se zapíše taky (`ok = false`) a
   další hodina to zkusí znovu; úspěšné odeslání se podle klíče už neopakuje.

Ruční volání z aplikace (token majitele/správce):

```json
{ "service_id": "…", "mode": "preview" | "test" | "now", "obdobi": "predchozi" | "aktualni" }
```

- `preview` vrátí `{ pdf_base64, filename }` – v Nastavení „Stáhnout ukázku PDF“,
- `test` pošle report jen na e-mail volajícího,
- `now` pošle nastaveným příjemcům hned (mimo plán).

## Nasazení

```bash
npm run db:migrate
npx supabase functions deploy statistics-report-send
```

Funkce potřebuje `RESEND_API_KEY` (a volitelně `RESEND_FROM_EMAIL`) – stejné
secrets jako faktury a hlídač. `verify_jwt = false` je v `config.toml`
schválně: cron JWT nemá, přístup ověřuje funkce sama (tajemství, nebo token
a role owner/admin).

Zkouška plánovaného běhu bez odeslání (s tajemstvím z Vaultu):

```bash
SECRET=$(npx supabase db query --linked -c "select decrypted_secret from vault.decrypted_secrets where name='statistiky_report_cron_secret'" | tail -1)
curl -s -X POST "$VITE_SUPABASE_URL/functions/v1/statistics-report-send" \
  -H "Content-Type: application/json" \
  -d "{\"secret\":\"$SECRET\",\"mode\":\"scheduled\",\"dryRun\":true}"
```

Odpověď vypíše, kterým servisům by report odešel (`sent`), které se
přeskočily a proč (`skipped`) a případné chyby.

## Právo „vidět statistiky“

Zároveň přibylo právo člena `can_view_statistics` (Nastavení → Tým →
Povolení). Bez něj člen stránku Statistiky v navigaci nevidí a databázové
funkce mu čísla nevydají. Stávající členové ho migrací dostali (dosud
statistiky viděli všichni), noví ho dostávají výchozím nastavením pozvánky;
majitel ho může kdykoli odebrat.
