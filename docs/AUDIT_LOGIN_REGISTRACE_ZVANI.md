# Audit: Login, registrace a zvání členů

**Datum:** 16. 2. 2026  
**Účel:** Zkontrolovat bezpečnost a správné chování přihlášení, registrace a pozvánkového flow.

---

## 1. Přihlášení (Login)

### Flow
- **AuthProvider** (`src/auth/AuthProvider.tsx`): `signInWithPassword({ email, password })` přes Supabase Auth. Session se sleduje přes `onAuthStateChange` a `getSession()`.
- **Login.tsx**: formulář email + heslo. Volá `signIn()` z kontextu. Při úspěchu může uložit „remember me“ (email do localStorage).
- **Ověření:** JWT je ověřován Supabase; Edge Functions, které vyžadují auth, volají `getUser()` a vracejí 401 při neplatném/chybějícím tokenu.

### Bezpečnost
- Heslo se nikde neloguje ani neukládá v aplikaci.
- Token se posílá v hlavičce `Authorization: Bearer <access_token>` tam, kde je potřeba (services-list, invite-create, invite-accept, atd.).
- **Poznámka:** V `supabase/config.toml` je `enable_confirmations = false` – uživatel nemusí potvrdit email před přihlášením. Pokud chceš povinnou emailovou konfirmaci, zapni to v Dashboardu (Authentication → Providers → Email → Confirm email).

### Doporučení
- Zvážit zapnutí emailové konfirmace pro produkci (Supabase Dashboard → Authentication → Settings).
- „Remember me“ ukládá jen email, ne heslo – v pořádku.

---

## 2. Registrace

### Flow
- **Registrace je možná jen s registračním tokenem** (pozvánkou). V Login.tsx při režimu „Registrace“ je pole „Registrační token“ povinné; bez tokenu se zobrazí chyba.
- **AuthProvider**: `signUp({ email, password })` – Supabase Auth vytvoří účet. Aplikace token při samotném `signUp` neposílá; token slouží jen k tomu, aby se uživatel vůbec mohl zaregistrovat (UI ho vyžaduje).
- **Důležité:** Supabase neví o tokenu – token se nekontroluje při registraci. Kontrola tokenu probíhá až při **invite-accept** (po přihlášení). Takže teoreticky může někdo zaregistrovat účet s libovolným emailem, pokud má jakýkoli platný token (nebo pokud přepne na „Mám už účet“ a jen se přihlásí). Token tedy v praxi omezuje „kdo se může zaregistrovat“ jen tím, že bez tokenu UI registraci neumožní; skutečné propojení s konkrétním emailem a servisem je až v invite-accept.

### Správné chování
- **invite-accept** (viz níže) kontroluje, že email přihlášeného uživatele odpovídá emailu v pozvánce. Takže i když by někdo zaregistroval účet s cizím emailem, při použití tokenu pozvánky by invite-accept selhal („Email does not match invite“).
- Shrnutí: Registrace bez tokenu je v UI zablokovaná. Po registraci s tokenem je nutné token použít v invite-accept; tam se ověří email a přidá membership. Bez znalosti tokenu a bez odpovídajícího emailu se nikdo do servisu nedostane.

### Doporučení
- Ponechat povinnost tokenu při registraci.
- Volitelně: při signUp posílat do Supabase nějaký metadata (např. invite token) jen pro audit – ne pro autorizaci; autorizace zůstává v invite-accept.

---

## 3. Zvání členů (pozvánky)

### 3.1 Vytvoření pozvánky (invite-create)

- **Kdo může:** Owner nebo admin daného servisu (ověřeno přes `service_memberships`). V režimu `mode=stock` jen root owner nebo běžný owner (vytvoření nového servisu).
- **Vstup:** `serviceId` (v current), `email`, `role`; v stock režimu volitelně `email`, `role`, `serviceName`.
- **Výstup:** Do tabulky `service_invites` se uloží záznam (service_id, email, role, token, expires_at 14 dní, invited_by). Token je 32 znaků URL-safe.
- **Odkaz:** Vrací se `inviteLink`: `jobsheet://invite?token=${token}`. Tento odkaz se **neposílá e-mailem** – admin/owner ho musí uživateli předat jinak (zkopírovat, říct).

### 3.2 Přijetí pozvánky (invite-accept)

- **Kdy:** Volá se z App.tsx po přihlášení, pokud v localStorage existuje pending invite token (`getPendingInviteToken()`).
- **Auth:** Vyžaduje platný JWT (Authorization header). `getUser()` ověří přihlášeného uživatele.
- **Kontrola tokenu:** V DB se najde záznam v `service_invites` podle `token`. Kontroluje se: pozvánka existuje, není již přijata (`accepted_at`), neexpirovala (`expires_at`).
- **Kontrola emailu:** Pokud má pozvánka vyplněný `email`, musí se shodovat s emailem přihlášeného uživatele (case-insensitive). Neshoda → 403 „Email does not match invite“.
- **Výsledek:** Vloží se záznam do `service_memberships` (service_id, user_id, role, u membera default capabilities vše true). Pozvánka se označí jako přijata (`accepted_at`, `accepted_by`).
- **Bezpečnost:** Jedno použití tokenu (po přijetí je pozvánka „used“). Platnost 14 dní. Email match brání přidání cizího účtu na cizí email.

### 3.3 Zrušení pozvánky (invite-delete)

- **Kdo může:** Jen owner nebo admin daného servisu (ověřeno přes `service_memberships`).
- **Vstup:** `inviteId`, `serviceId`. Ověří se, že pozvánka patří do daného servisu a že volající je admin/owner.
- **Bezpečnost:** V pořádku; nelze mazat cizí pozvánky.

### 3.4 Jak se token dostane k uživateli

- **Aktuálně:** Odkaz `jobsheet://invite?token=...` se vrací v odpovědi invite-create a zobrazuje se v UI (TeamSettings / OwnerSettings). Uživatel si ho musí zkopírovat nebo ho zadat ručně do pole „Registrační token“ na přihlašovací stránce.
- **Poznámka:** V Tauri aplikaci nebyl nalezen handler pro deep link `jobsheet://invite?token=...`. Pokud by měl klik na odkaz otevřít aplikaci a předat token, je potřeba v Tauri nakonfigurovat custom URL scheme a v aplikaci parsovat `token` z URL a uložit ho (např. `setPendingInviteToken`) před zobrazením Login.
- **TODO (z hlavního seznamu):** „Přidat posílání tokenu v pozvance mailem“ – zatím se e-mail s odkazem/tokenem neposílá; pouze vrácený odkaz v UI.

---

## 4. Otázky pro rozhodnutí (jak to udělat)

Níže jsou otázky, na které je potřeba si odpovědět, aby šlo doplnit posílání pozvánky mailem a případně zjednodušit UX (bez ručního tokenu).

---

### 4.1 Token – chceme ho vůbec, nebo stačí „jen poslat mail“?

**Současný stav:** Pozvánka v DB má „token“ (náhodný řetězec). Ten se teď zobrazuje v aplikaci a uživatel ho musí zkopírovat / předat ručně. Tobě se token jako UX nelíbí.

**Možnosti:**

- **A) Nechat token v pozadí, ale uživateli ho neukazovat – jen poslat mail s odkazem**  
  - Admin zadá email a klikne „Pozvat“.  
  - Na pozvaný email přijde zpráva s odkazem (např. `https://tvoje-app.cz/join?token=...` nebo `jobsheet://invite?token=...`).  
  - Token zůstává v DB a v URL odkazu – slouží jen k identifikaci pozvánky při kliknutí. Uživatel token nikde nekopíruje, jen klikne na odkaz.  
  - **Shrnutí:** Token je pořád tam (kvůli bezpečnosti a jednoznačné identifikaci), ale UX je „přišel mi mail, kliknu a jsem v“.

- **B) Úplně bez našeho tokenu – použít jen Supabase „Invite user by email“**  
  - Supabase Auth umí poslat pozvánku mailem (magic link / set password).  
  - Po dokončení registrace by naše aplikace musela podle emailu najít „čekající pozvánku“ a přidat uživatele do servisu.  
  - **Nevýhoda:** Musíme sladit Supabase Auth flow s naší tabulkou `service_invites` (např. pozvánka „čeká“ na ten email a po prvním přihlášení ji automaticky přijmeme).  
  - **Výhoda:** Jedna zpráva od Supabase, žádný vlastní token v mailu.

- **C) Mail jen s textem typu „Pozvánka do servisu X. Kód: 123456“**  
  - Stále používáme náš token (nebo zkrácený kód), ale uživatel ho zadá ručně do aplikace.  
  - Jednodušší implementace (jen přidat odeslání mailu), ale UX pořád „něco kopírovat / psát“.

**Doporučení (původní):** Varianta A – token v odkazu, uživatel jen klikne.

**Rozhodnuto:** **Varianta C** – mail s textem typu „Pozvánka do servisu X. Kód: …“. Uživatel kód z mailu zadá do aplikace. Žádný web ani deep link potřeba; implementace = přidat odeslání mailu z Edge Function po vytvoření pozvánky. Token (nebo zkrácený kód) zůstane v DB a v textu mailu.

---

### 4.2 Jak má vypadat odkaz v mailu?

- **Odkaz na web** (např. `https://app.jobi.cz/join?token=...`)  
  - Webová stránka zobrazí „Pozvánka do servisu X. Otevřít v aplikaci?“ a předá token do desktopové aplikace (pokud je nainstalovaná), nebo zobrazí návod „Spusť Jobi a zadej kód …“.  
  - Vyžaduje mít webovou stránku (nebo jednoduchou landing page) a případně deep link do Tauri appky.

- **Přímý deep link do aplikace** (`jobsheet://invite?token=...`)  
  - Klik v mailu otevře přímo Jobi (pokud je nainstalovaná) a předá token.  
  - Vyžaduje v Tauri nastavení URL scheme a ošetření startu aplikace z tohoto odkazu (načtení tokenu z URL a uložení / zpracování).

- **Obojí**  
  - V mailu jsou dva odkazy: „Otevřít v aplikaci“ (deep link) a „Otevřít v prohlížeči“ (web).  
  - Maximální flexibilita, víc implementační práce.

**Otázka pro tebe:** Budeš mít webovou verzi / landing page, nebo jen desktopovou aplikaci?

**Rozhodnuto:** Pro variantu C (kód v mailu) odkaz v mailu nepotřebujeme – stačí text s kódem. Web ani deep link se zatím neřeší.

---

### 4.3 Kdo a jak bude posílat mail?

Možnosti:

- **Edge Function po invite-create**  
  - Po úspěšném vytvoření záznamu v `service_invites` zavoláme z Edge Function nějaký e-mailový servis (Resend, SendGrid, nebo Supabase např. přes Resend integraci) a pošleme mail s odkazem.  
  - Výhoda: vše na backendu, admin jen klikne „Pozvat“.

- **Supabase Auth „Invite user“**  
  - Použít vestavěné pozvání Supabase (pokud existuje pro tvůj plán).  
  - Musí se zkombinovat s naší logikou (přidání do servisu po přihlášení).

- **Externí skript / cron**  
  - Méně vhodné pro „okamžité“ poslání po kliknutí na Pozvat.

**Otázka pro tebe:** Máš už nějaký e-mailový účet / službu (Resend, SendGrid, SMTP), nebo to chceš řešit až při nasazení?

**Rozhodnuto:** Zatím nic – e-mailovou službu vybereme při implementaci (např. Resend má free tier a jednoduché API z Edge Function).

---

### 4.4 Registrace „jen s emailem“ bez tokenu v UI?

V TODO máš: *„udelat registraci bez tokenu? pouze kdyz admin/owner nekoho v aplikaci pozve, zada tam email toho cloveka a ten clovek se bude moct registrovat pouze diky svemu emailu“.*

Interpretace:

- **Scénář 1:** Admin pozve `novak@firma.cz`. Tomu přijde mail s odkazem. Klikne na odkaz → otevře se (web nebo app) → **bez ručního zadávání tokenu** se buď rovnou vytvoří účet (magic link), nebo se zobrazí formulář „Nastav si heslo“ a v pozadí se použije token z URL.  
  → Uživatel token nevidí a nezadává; odpovídá to variantě **A** výše.

- **Scénář 2:** Úplně bez tokenu v DB – pozvaný se registruje „jen svým emailem“ (zadá email + heslo). Systém musí nějak poznat, že tento email byl pozvaný (např. že v `service_invites` existuje záznam s tímto emailem a ještě není accepted).  
  → Při registraci bychom po `signUp` (Supabase) zkontrolovali: existuje pozvánka na tento email? Pokud ano, automaticky zavoláme invite-accept (s interním tokenem z té pozvánky). Token tedy může zůstat v DB, ale uživatel ho nikdy nevidí.

**Otázka pro tebe:** Stačí ti, že uživatel nikdy neuvidí token (klikne na odkaz), nebo chceš registraci jen podle emailu?

**Rozhodnuto:** U varianty C uživatel kód z mailu **zadá** do aplikace (pole „Registrační token“ / „Kód z pozvánky“). Token zůstává v DB; žádná změna oproti současnému chování – jen přidáme odeslání mailu s kódem, takže ho nemusí nikdo kopírovat z aplikace a posílat ručně.

---

### 4.5 Shrnutí rozhodnutí

| Otázka | Rozhodnuto |
|--------|------------|
| **Token** | Varianta **C** – token/kód zůstane v DB; v mailu pošleme text s kódem, uživatel ho zadá do aplikace. Žádný web. |
| **Odkaz v mailu** | Nepotřeba – jen text s kódem. |
| **Odeslání mailu** | E-mailovou službu vybereme při implementaci (např. Resend). |
| **Registrace** | Beze změny – uživatel zadá kód z mailu do pole v Login; invite-accept a zbytek logiky zůstává. |

**Implementace (provedeno):**
- **invite-info** – nová Edge Function: POST `{ token }`, vrací `{ email, serviceName }` pro platnou pozvánku. Volá se bez JWT (token je secret). Deploy: `supabase functions deploy invite-info --no-verify-jwt`.
- **invite-create** – po vytvoření pozvánky odesílá mail přes Resend (pokud je nastaveno `RESEND_API_KEY`). Text: „Pozvánka do servisu [název]. Kód: [token]. Kód platí 14 dní.“ Volitelně: `RESEND_FROM_EMAIL` (výchozí `Jobi <onboarding@resend.dev>`).
- **Login** – při registraci: nejdřív „Kód z pozvánky“ + tlačítko „Načíst pozvánku“ (volá invite-info a doplní email), pak „Email (doplněn z pozvánky)“, „Heslo“, „Heslo znovu“. Kontrola shody hesel a min. 6 znaků.

---

## 5. Shrnutí zjištění (audit)

| Oblast              | Stav | Poznámka |
|---------------------|------|----------|
| Login               | OK   | JWT, session, žádné ukládání hesel. |
| Registrace          | OK   | Token povinný v UI; skutečné ověření až v invite-accept (email match). |
| invite-create       | OK   | Oprávnění owner/admin; token 32 znaků; expirace 14 dní. |
| invite-accept       | OK   | Auth required; email match; jedno použití; default capabilities. |
| invite-delete       | OK   | Jen owner/admin daného servisu. |
| Předání tokenu      | Mezera | Token se neposílá e-mailem; deep link `jobsheet://invite` v Tauri není implementován. |
| Email konfirmace    | Volitelné | V config je `enable_confirmations = false`; pro produkci zvážit zapnutí. |

---

## 6. Doporučené další kroky

1. **Supabase Dashboard – Authentication**
   - Zkontrolovat, zda je zapnutá email confirmation, pokud ji chceš (Authentication → Providers → Email).
   - Zkontrolovat Redirect URLs a případně Site URL pro webovou verzi.

2. **Předání pozvánky**
   - Implementovat odeslání e-mailu s odkazem/tokenem (např. přes Resend, SendGrid nebo Supabase Edge Function, která pošle mail s `inviteLink`).
   - Volitelně: v Tauri přidat obsluhu URL scheme `jobsheet://invite?token=...` a nastavit `setPendingInviteToken(token)` při startu aplikace z odkazu.

3. **Bezpečnost**
   - Edge Functions (invite-create, invite-accept, invite-delete) jsou nasazeny s `--no-verify-jwt`; uvnitř samy volají `getUser()`. Ověřit, že všechny volání z frontendu posílají aktuální JWT v hlavičce.
   - Nepoužívat token v URL na veřejné stránce (např. web) dlouhodobě – raději jednorázový odkaz nebo krátká platnost; v desktopové aplikaci s custom scheme je riziko nižší.

4. **Testování**
   - Scénář: vytvořit pozvánku → zkopírovat token → odhlásit se → registrace s emailem z pozvánky + token → přihlásit se → ověřit, že invite-accept proběhne a uživatel uvidí servis.
   - Scénář: stejný token s jiným emailem → po přihlášení by invite-accept měl vrátit „Email does not match invite“.

---

Tento audit pokrývá stav kódu a konfigurace k datu 16. 2. 2026. Změny v Supabase Dashboardu (Auth, RLS, Edge Functions) je potřeba zkontrolovat přímo v projektu.
