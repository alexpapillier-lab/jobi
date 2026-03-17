# Nastavení Twilio a Supabase Secrets pro SMS

Aby SMS v Jobi fungovaly (aktivace čísla, odesílání, příjem zpráv a hovorů), je potřeba v **Supabase** nastavit přístupové údaje k **Twilio** a povolit Realtime pro tabulky SMS.

---

## 1. Twilio účet a údaje

1. Založ účet na [twilio.com](https://www.twilio.com) (trial stačí na testování).
2. V [Twilio Console](https://console.twilio.com) najdi:
   - **Account SID** (začíná `AC...`) — Dashboard → Account Info
   - **Auth Token** — klikni na „Show“, případně „View“ u Auth Token

Poznámka: V trial módu můžeš posílat SMS jen na ověřená čísla; pro produkci je potřeba účet upgradovat.

### Důležité: Které číslo použít pro odesílání do ČR

**Pro odesílání na česká čísla (+420) musíš mít české (nebo evropské) Twilio číslo.**  
Twilio neumožňuje posílat z amerického čísla (From: +1…) na české číslo (To: +420…). Chyba pak vypadá např.:

> Message cannot be sent with the current combination of 'To' (+420…) and/or 'From' (+1…) parameters

- Při **aktivaci SMS v Jobi** (Nastavení → SMS komunikace) se automaticky hledá nejdřív **české** číslo, pokud není k dispozici, použije se americké.
- Pokud máš tedy **americké číslo** (From: +1…), na české zákazníky z něj SMS nepošleš. Možnosti:
  1. **Zkus znovu aktivovat SMS** později – občas jsou česká čísla v Twilio k dispozici.
  2. **Koupit české číslo ručně** v [Twilio Console](https://console.twilio.com) → Phone Numbers → Manage → Buy a number, zvolit zemi Czech Republic. Číslo pak v Jobi zatím nejde jen „doplňkově“ zadat; pokud to budeš potřebovat, napiš.
  3. Pro testování můžeš v Twilio trial ověřit české číslo (Verify → Phone Numbers) a posílat na něj z US čísla v rámci US→US/CZ omezení – ale na reálná zákaznická +420 čísla to nebude fungovat bez CZ „From“ čísla.

---

## 2. Secrets v Supabase (Edge Functions)

Edge Functions `sms-provision`, `sms-send`, `sms-incoming` a `sms-voice` čtou Twilio údaje ze **Supabase Secrets**. Nastav je takto:

### Možnost A: Supabase Dashboard (doporučeno)

1. Otevři [Supabase Dashboard](https://supabase.com/dashboard) a vyber svůj projekt.
2. V levém menu jdi na **Project Settings** (ikona ozubeného kola).
3. V levém podmenu zvol **Edge Functions**.
4. Sekce **Secrets** (nebo **Function Secrets**): přidej dva záznamy:

   | Name                  | Value              |
   |-----------------------|--------------------|
   | `TWILIO_ACCOUNT_SID`  | tvoje Account SID (např. `ACxxxxxxxx...`) |
   | `TWILIO_AUTH_TOKEN`   | tvůj Auth Token    |

5. Hodnoty zadej přes **Add new secret**: Name = přesně `TWILIO_ACCOUNT_SID`, Value = SID bez mezer. To samé pro `TWILIO_AUTH_TOKEN`.
6. Ulož (Save).

### Možnost B: Supabase CLI

V terminálu **v kořeni projektu Jobi** (kde je složka `supabase/`), např.:

```bash
cd /cesta/k/jobi   # přejdi do kořene projektu
```

```bash
# Nastavení secrets (nahraď hodnoty svými)
supabase secrets set TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
supabase secrets set TWILIO_AUTH_TOKEN=tvuj_auth_token
```

Po změně secrets je potřeba **znovu nasadit** Edge Functions, které je používají (nebo počkat na další deploy). Příkazy spouštěj **v kořeni projektu** (kde je `supabase/functions/`):

```bash
cd /cesta/k/jobi
supabase functions deploy sms-provision
supabase functions deploy sms-send
supabase functions deploy sms-incoming --no-verify-jwt
supabase functions deploy sms-voice --no-verify-jwt
```

---

## 3. Kontrola, že secrets jsou nastavené

- V Dashboardu: **Project Settings → Edge Functions → Secrets** — měly by být vidět názvy `TWILIO_ACCOUNT_SID` a `TWILIO_AUTH_TOKEN` (hodnoty se z bezpečnostních důvodů nezobrazují).
- Po aktivaci SMS v Jobi (Nastavení → SMS komunikace → Aktivovat SMS) by mělo dojít k volání Twilio API a při chybě „SMS provisioning not configured“ zkontroluj, že názvy secretů jsou **přesně** takto (včetně velkých písmen).

### Když aktivace vrátí „Edge Function returned a non-2xx status code“

1. **Nejčastěji chybí Twilio secrets** — funkce pak vrací 503 a v odpovědi může být text „SMS provisioning not configured“. Nastav oba secrets (viz krok 2) a zkus to znovu.
2. **Funkce `sms-provision` musí mít zapnuté ověření JWT** (výchozí nastavení). Nenasazuj ji s `--no-verify-jwt`, jinak by ji mohl volat kdokoli. Při nasazení ji nevolaj s tímto přepínačem.
3. **Jsi přihlášen?** Volání jde s tvým JWT; pokud session vypršela, odhlas se a přihlas znovu.
4. **Detail chyby:** V Supabase Dashboard → **Edge Functions** → **sms-provision** → **Logs** uvidíš přesný status a odpověď (např. 503 = chybí konfigurace, 502 = chyba Twilio API).

---

## 4. Realtime pro SMS (volitelně, pro živé notifikace a badge)

Aby se v aplikaci v reálném čase zobrazovaly nové zprávy a počty nepřečtených, musí být pro tabulky `sms_messages` a `sms_conversations` zapnutý **Supabase Realtime**:

1. V Supabase Dashboard: **Database → Replication** (nebo **Realtime**).
2. Ujisti se, že pro publikaci (Publication) používanou Realtime jsou zahrnuty tabulky `sms_messages` a `sms_conversations` (zaškrtnuté).

Pokud používáš výchozí publikaci `supabase_realtime`, můžeš přidat tabulky přes SQL:

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.sms_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.sms_conversations;
```

---

## 5. Shrnutí

| Krok | Kde | Co |
|------|-----|-----|
| 1 | Twilio Console | Získat Account SID a Auth Token |
| 2 | Supabase → Project Settings → Edge Functions → Secrets | Přidat `TWILIO_ACCOUNT_SID` a `TWILIO_AUTH_TOKEN` |
| 3 | (Volitelně) Supabase → Database → Replication | Zapnout Realtime pro `sms_messages`, `sms_conversations` |

Webhooky pro příchozí SMS a hovory (`sms-incoming`, `sms-voice`) jsou při provisioning čísla nastaveny automaticky na URL tvého projektu (např. `https://<project-ref>.supabase.co/functions/v1/sms-incoming`). Nic dalšího v Twilio konzoli pro ně nastavovat nemusíš.
