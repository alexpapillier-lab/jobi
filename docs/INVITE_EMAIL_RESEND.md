# E-mail pozvánky (Resend)

Pozvánky do servisu se ukládají do DB vždy; e-mail s kódem se odešle jen pokud je nakonfigurovaný Resend.

## Deploy

Používá se funkce **invite_create** (s podtržítkem). Původní `invite-create` (s pomlčkou) u části projektů způsoboval BOOT_ERROR při startu workera; `invite_create` má stejnou logiku a styl jako `team-list`.

```bash
npx supabase functions deploy invite_create --use-api --no-verify-jwt
```

## Nastavení

1. **Účet Resend**  
   [resend.com](https://resend.com) – založ účet (free tier stačí).

2. **API klíč**  
   V Resend: API Keys → Create API Key. Zkopíruj klíč (začíná `re_`).

3. **Supabase – Edge Function Secrets**  
   V Supabase Dashboard: tvůj projekt → **Edge Functions** → **Secrets** (nebo Settings → Edge Functions).  
   Přidej secret:
   - **Name:** `RESEND_API_KEY`
   - **Value:** tvůj Resend API klíč

4. **Volitelně – odesílatel (důležité pro pozvánky ostatním)**  
   Secret `RESEND_FROM_EMAIL` (např. `Jobi <noreply@tvoje-domena.cz>`).  
   Bez něj se použije `Jobi <onboarding@resend.dev>` – Resend pak vrací **403** a píše: *"You can only send testing emails to your own email address. To send emails to other recipients, please verify a domain."*  
   **Co udělat:** V [Resend](https://resend.com) → Domains přidej a ověř svou doménu (DNS záznamy). Pak v Supabase Secrets nastav `RESEND_FROM_EMAIL` na adresu z této domény (např. `Jobi <noreply@tvoje-domena.cz>`). Pozvánky pak půjdou na libovolné e-maily.

### Jakou doménu tam mám dát?

**Doména** = ta část za zavináčem v e-mailu, ze kterého chceš posílat. Např. pro `noreply@mojesluzby.cz` je doména **mojesluzby.cz**.

- **Máš web nebo firmu na vlastní doméně?** (např. `papillier.cz`, `mojesluzby.cz`)  
  → Tu doménu zadej do Resend. Resend ti ukáže DNS záznamy (SPF, DKIM) – ty přidáš u svého poskytovatele domény (registrátor, hosting, Cloudflare atd.). Po ověření nastavíš `RESEND_FROM_EMAIL` např. na `Jobi <noreply@tvoje-domena.cz>`.

- **Žádnou vlastní doménu nemáš?**  
  → Pro posílání *ostatním* ji potřebuješ. Můžeš si koupit levnou doménu (řádově stovky Kč/rok u registrátorů typu Forpsi, Wedos, OVH atd.) nebo využít subdoménu u služby, která to umí. Po přidání domény u registrátora stejně v Resend zadáš tu doménu a doplníš DNS podle návodu.  
  Do té doby můžeš posílat pozvánky jen na svůj vlastní e-mail (ten, pod kterým máš účet v Resend) – pozvánka se v DB vytvoří, jen mail nedorazí ostatním.

## Ověření

Po přidání `RESEND_API_KEY` a nasazení Edge Function `invite-create` zkus znovu poslat pozvánku (Nastavení → Tým → Pozvat člena).  
Pokud klíč chybí nebo je špatný, aplikace po vytvoření pozvánky zobrazí hlášku, že e-mail nebyl odeslán (včetně důvodu).

## Lokální vývoj

Při `supabase functions serve` načteš secrets z `.env` v `supabase/functions/` nebo je předáš přes `--env-file`. Pro lokální test Resend stačí mít v tom souboru `RESEND_API_KEY=re_...`.

---

## Diagnostika: mail nechodí / v Resend nic není

### 1. Logy Edge Function v Supabase

V **Supabase Dashboard** jdi do **Edge Functions** → vyber funkci **invite-create** → záložka **Logs**. Po odeslání pozvánky z Jobi uvidíš řádky jako:

- `[invite-create] Resend check: { hasKey: true/false, keyPrefix: "re_xxx…", … }` – jestli se načetl `RESEND_API_KEY`
- `[invite-create] Calling Resend API POST https://api.resend.com/emails` – že se volá Resend
- `[invite-create] Resend response: { status: 200, ok: true, … }` nebo chybu

**Z příkazové řádky** (potřebuješ mít přihlášený Supabase CLI a project ref):

```bash
# Přihlásit se a vybrat projekt (jednorázově)
npx supabase login
npx supabase link --project-ref TVŮJ_PROJECT_REF

# Stream logů jen pro invite-create
npx supabase functions logs invite-create
```

Po spuštění `functions logs` zkus znovu poslat pozvánku v Jobi a sleduj výstup.

### 2. Otestovat Resend API přímo (curl)

Tím ověříš, že klíč je platný a že se request vůbec dostane do Resend (v Resend dashboardu by se měl objevit záznam).

```bash
# Nahraď RE_TVOJ_KLIC svým API klíčem z Resend (začíná re_)
# Nahraď email@example.com e-mailem, na který smí Resend posílat (u onboarding@resend.dev jen tvůj účet)
curl -s -w "\nHTTP_STATUS:%{http_code}\n" -X POST "https://api.resend.com/emails" \
  -H "Authorization: Bearer RE_TVOJ_KLIC" \
  -H "Content-Type: application/json" \
  -d '{"from":"Jobi <onboarding@resend.dev>","to":["email@example.com"],"subject":"Test Jobi","text":"Test"}'
```

- Když je klíč v pořádku: výstup obsahuje `"id": "…"` a `HTTP_STATUS:200` (nebo 201).
- Když je klíč špatný: typicky `HTTP_STATUS:401` nebo 403 a v těle chyba od Resend.

Pokud curl vrátí 200 a v Resend dashboardu (Emails / Logs) ten mail vidíš, problém je na straně Supabase (třeba secret se nenačetl do funkce). Pokud curl vrátí chybu, je problém klíč nebo účet Resend.
