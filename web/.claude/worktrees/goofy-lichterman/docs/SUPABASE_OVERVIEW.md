# Supabase Overview – checklist při „Issues need attention“

Když v Supabase Dashboard uvidíš **„Issues need attention“** nebo varování, projdi podle tohoto přehledu. Dokument nevyžaduje přístup do Dashboardu – popisuje, **co kde kontrolovat**.

---

## 1. Kde se „issues“ zobrazují

- **Dashboard úvod** – žlutý/červený banner nebo číslo u „Project health“.
- **Project Settings → General** – stav projektu, pozastavení, region.
- **Konkrétní sekce** (Database, Auth, Edge Functions…) – vlastní varování v záhlaví nebo v logách.

---

## 2. Co zkontrolovat (po pořadí)

### Projekt a fakturace

| Kde | Co zkontrolovat |
|-----|------------------|
| **Project Settings → General** | Projekt není pozastaven (Paused). **Paused** = obnovení v Billing. |
| **Project Settings → Billing** | Účet má platnou metodu nebo je v rámci free tieru; nepřekročen limit. |
| **Project Settings → Infrastructure** | Region a stav služeb (zelené). |

### Databáze

| Kde | Co zkontrolovat |
|-----|------------------|
| **Database → Tables** | Tabulky `public` existují (např. `tickets`, `customers`, `service_memberships`, `profiles`…). |
| **Database → Migrations** | Žádná migrace „failed“; případně zkusit znovu spustit nebo opravit v SQL. |
| **SQL Editor** | Testovací dotaz (např. `SELECT 1`) pro ověření, že DB reaguje. |
| **Database → Roles** | Role `anon`, `authenticated`, `service_role` existují; RLS politiky neblokují očekávaný přístup. |

Pro detailní diagnostiku tabulek a řádků viz **docs/SUPABASE_DIAGNOSTIC.md**.

### Auth (přihlášení, pozvánky)

| Kde | Co zkontrolovat |
|-----|------------------|
| **Authentication → Providers** | Email (a případně jiné providery) jsou zapnuté; SMTP pro e-maily (Confirm email, Invite) je nastavený, pokud používáš vlastní odesílání. |
| **Authentication → URL Configuration** | **Site URL** a **Redirect URLs** odpovídají aplikaci (localhost pro vývoj, produkční URL pro build). |
| **Authentication → Users** | Uživatelé se zobrazují po registraci; žádný masivní nárůst „unconfirmed“. |
| **Authentication → Logs** | Chyby přihlášení / potvrzení e-mailu; 401/403 z aplikace. |

### Edge Functions (invite-create, team-list, …)

| Kde | Co zkontrolovat |
|-----|------------------|
| **Edge Functions** | Všechny potřebné funkce jsou nasazené a ve stavu **Active** (ne Error). |
| **Edge Functions → [název] → Logs** | Chyby 500, timeouty, chybějící env (RESEND_API_KEY atd.). Pro **invite-create** viz **docs/INVITE_EMAIL_RESEND.md**. |
| **Project Settings → Edge Functions** | Env proměnné (např. `RESEND_API_KEY`) jsou nastavené a bez překlepů. |

Funkce používané Jobi: `invite_create`, `invite-accept`, `team-list`, `team-update-role`, `team-remove-member`, `services-list`, `invite-delete`, `statuses-init-defaults`, `team-invite-list` (název může být s pomlčkou v Dashboardu).

### Storage

| Kde | Co zkontrolovat |
|-----|------------------|
| **Storage → Buckets** | Očekávané buckety existují a jsou přístupné podle RLS. |
| **Storage → Logs** | 403/404 při nahrávání nebo stahování. |

### Logy a metriky

| Kde | Co zkontrolovat |
|-----|------------------|
| **Logs → Postgres** | Pomalé dotazy, deadlocky, přetížení. |
| **Logs → API** | Velký počet 4xx/5xx; podezřelé IP nebo endpointy. |
| **Logs → Auth** | Opakované neúspěšné přihlášení; zablokované účty. |
| **Reports → Daily active users / API usage** | Náhlé změny oproti obvyklému provozu. |

---

## 3. Časté příčiny „issues“

- **Projekt pozastaven** – vyčerpání free tieru nebo problém s platbou → Billing, obnovit projekt.
- **Špatné Redirect URLs / Site URL** – po přihlášení 404 nebo redirect na jinou doménu → Auth → URL Configuration.
- **Edge Function padá** – chybí env (např. `RESEND_API_KEY`) nebo chyba v kódu → Logs dané funkce, Project Settings → Edge Functions.
- **RLS blokuje přístup** – aplikace dostává 403 u tabulek → Database → Tables → [tabulka] → RLS policies; otestovat v SQL Editoru pod rolemi `anon`/`authenticated`.
- **Migrace failed** – rozbitý stav schématu → Database → Migrations; oprava v SQL a případně nová migrace.

---

## 4. Rychlý postup při žlutém/červeném upozornění

1. Přečíst přesný text varování (klik na „Issues“ / banner).
2. Otevřít příslušnou sekci (Database / Auth / Edge Functions / Billing).
3. Prohlédnout **Logs** dané sekce za poslední hodiny.
4. Podle chybové hlášky sáhnout do konfigurace (URL, env, RLS, migrace) podle tabulek výše.
5. Pro hlubší diagnostiku použít **docs/SUPABASE_DIAGNOSTIC.md** (SQL dotazy, přehled tabulek a funkcí).

---

## 5. Database Linter (errors / warnings)

V **Database → Linter** (nebo v rámci „Issues“) Supabase zobrazuje **errors** a **warnings**. Následující byly vyřešeny migracemi:

- **rls_disabled_in_public** (ERROR) – tabulka `customer_history` měla RLS vypnuté → migrace `20260217100000_customer_history_rls.sql` znovu zapíná RLS a obnovuje politiky.
- **function_search_path_mutable** (WARN) – funkce bez nastaveného `search_path` → migrace `20260217110000_function_search_path.sql` nastavuje `SET search_path = public` u všech uvedených funkcí.
- **extension_in_public** (WARN) – rozšíření `citext` v `public` → migrace `20260217120000_citext_extension_schema.sql` přesouvá `citext` do schématu `extensions`.

### Záměrně neřešené (konfigurace / rozhodnutí)

- **rls_policy_always_true** – politika `services_insert_any_authenticated` na tabulce `services` má `WITH CHECK (true)`: každý přihlášený uživatel může vytvořit servis (registrace / self-service). Je to záměr; pokud chceš přístup omezit (např. jen na pozvané), uprav politiku v nové migraci.
- **auth_leaked_password_protection** – ochrana proti uniklým heslům (HaveIBeenPwned) je ve výchozím stavu vypnutá. Zapnutí: **Authentication → Settings** (nebo **Auth → Configuration**) → **Password Protection** / **Leaked password protection** → zapnout dle [dokumentace](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
