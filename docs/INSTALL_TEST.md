# Instalace testovací verze (Jobi + JobiDocs)

## Jobi (hlavní aplikace)

1. Stáhni instalační balíček (např. `jobi-universal.zip` nebo .dmg z release).
2. Rozbal / nainstaluj **jobi.app** (na Macu ho přetáhni do Aplikací, nebo nech v Downloads).
3. **První spuštění na Macu (nepodepsaná aplikace):**
   - Klikni na **jobi.app pravým tlačítkem** → **Otevřít**  
     **nebo**
   - **Předvolby systému → Zabezpečení a soukromí** → u zprávy o „jobi“ zvol **Otevřít**.
4. Po tomto jednom potvrzení půjde aplikace spouštět normálně (dvojklik).

## JobiDocs (tisk / PDF)

1. Stáhni a nainstaluj JobiDocs dle návodu v `jobidocs/` (typicky installer z buildu).
2. Na Macu bez podpisu: stejný postup – první spuštění přes **pravý klik → Otevřít** nebo Předvolby → Zabezpečení.

## Po instalaci

- Do Jobi zadej přihlašovací údaje (Stejný Supabase projekt jako zbytek týmu – žádné speciální „test“ údaje, pokud nepoužíváte zvláštní test projekt.)
- Všechny funkce (zakázky, dokumenty, tisk, …) fungují jako v běžné verzi; testovací verze = stejná aplikace, jen označení/verze pro testování.

Více: `docs/TEST_VERSION_PLAN.md`.
