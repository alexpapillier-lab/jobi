# Windows verze – co udělat krok za krokem

Stav: kód je připravený, build ještě nikdy neproběhl.
Tenhle soubor je checklist, ne teorie. Postupuj shora dolů.

---

## Proč to nejde postavit tady na Macu

`cargo check --target x86_64-pc-windows-msvc` padá na knihovně `ring`
(krypto uvnitř Tauri updateru) – potřebuje Windows C hlavičky, které na macOS
nejsou. Není to chyba v kódu Jobi, je to toolchain. Windows binárku musí
postavit Windows.

Máš dvě možnosti a **doporučuju obě dohromady**:

| | K čemu |
|---|---|
| **GitHub Actions** | Build, který dostanou zákazníci (x64). Reprodukovatelný, zdarma (repo je veřejné). |
| **Parallels** | Testování a rychlé ladění tisku. |

---

## ČÁST A – sloučit a nahrát na GitHub

Práce je zatím na větvi `oprava-blokeru-2026-09`, jen lokálně.

```bash
cd /Volumes/backup/backup/jobi
git checkout main
git merge --ff-only oprava-blokeru-2026-09
git push origin main
```

Po pushnutí se sama spustí `CI` (typecheck, lint, testy, audit).
Zkontroluj, že je zelená: <https://github.com/alexpapillier-lab/jobi/actions>

---

## ČÁST B – nastavit secrets

Bez nich Windows build spadne. Pět kusů.

Klíč ani heslo nikam nevypisuj – následující příkazy je pošlou rovnou,
aniž by se objevily na obrazovce:

```bash
cd /Volumes/backup/backup/jobi
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/jobi.key
```

Heslo k tomu klíči najdeš v `docs/OTA_SIGNING_SECRETS.md` (lokální soubor,
není v gitu):

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

Zbylé tři vytáhni z `.env`:

```bash
grep '^VITE_SUPABASE_URL=' .env      | cut -d= -f2- | gh secret set VITE_SUPABASE_URL
grep '^VITE_SUPABASE_ANON_KEY=' .env | cut -d= -f2- | gh secret set VITE_SUPABASE_ANON_KEY
grep '^VITE_ROOT_OWNER_ID=' .env     | cut -d= -f2- | gh secret set VITE_ROOT_OWNER_ID
```

Kontrola:

```bash
gh secret list
```

> **Pozn.:** anon klíč je veřejný z principu – je zabudovaný v každé hotové
> aplikaci. Jako secret ho vedeme jen kvůli pohodlí, ne kvůli utajení.

---

## ČÁST C – spustit Windows build

```bash
gh workflow run "Build Windows"
gh run watch
```

Až doběhne, stáhni installery:

```bash
gh run download --name jobi-windows --dir ~/Downloads/jobi-win
gh run download --name jobidocs-windows --dir ~/Downloads/jobi-win
```

Čekej `.exe` (NSIS installer) pro Jobi a `.exe` pro JobiDocs.

**Až tenhle běh doběhne, budeme chytřejší.** Je to první build vůbec, takže
počítej s tím, že něco spadne – typicky chybějící secret nebo drobnost
v electron-builderu. Log z `gh run view --log-failed` mi můžeš poslat.

---

## ČÁST D – Parallels

### Důležité: tvůj Mac je M4, tedy ARM

Parallels na Apple Silicon umí **jen Windows 11 ARM64**. GitHub Actions staví
**x64**. Naštěstí Windows 11 ARM umí x64 aplikace emulovat (Prism), takže
**installer z CI se v Parallels nainstaluje a poběží.**

Na funkční test (zadávání zakázek, tisk, JobiDocs) to stačí. Emulace ale není
totéž co nativní x64 – **než to pošleš zákazníkovi, ať to někdo zkusí na
opravdovém x64 PC.**

### Postup

1. Parallels Desktop → **Install Windows 11** (nabídne stažení ARM verze sám).
2. Ve Windows nainstaluj **Jobi** i **JobiDocs** ze stažených `.exe`.
3. Při instalaci vyskočí **SmartScreen: „Neznámý vydavatel"** → *Další informace*
   → *Přesto spustit*. Je to očekávané, aplikace nemá Authenticode certifikát.
4. WebView2 (Tauri ho potřebuje) je ve Windows 11 předinstalovaný, nic neřeš.

### Co otestovat především

- [ ] Jobi nastartuje a přihlásí se
- [ ] Založení a úprava zakázky
- [ ] **JobiDocs se spustí z Jobi** (tlačítko volá `launch_jobidocs`, který na
      Windows hledá `JobiDocs.exe` v `%LOCALAPPDATA%\Programs` a v Program Files
      – jestli NSIS instaluje jinam, tady to praskne)
- [ ] **Seznam tiskáren** se načte (na Windows jde přes Electron, ne přes `lpstat`)
- [ ] **Tisk zakázkového listu** – tohle je nejrizikovější bod, viz níž

### Nejpravděpodobnější problém: prázdná stránka při tisku

Windows tiskne přes Chromium v Electronu: PDF se načte do skrytého okna
a zavolá se `webContents.print()`. Mezi načtením a tiskem je pevná pauza
**700 ms**, aby PDF viewer stihl vykreslit. Je to odhad, ne změřená hodnota.

Když vyjede prázdná stránka, zvedni ji v
`jobidocs/electron/main.ts` ve funkci `printPdfElectronWindows`:

```ts
await new Promise((r) => setTimeout(r, 700));   // zkus 1500
```

macOS tisk se tím nijak nedotkneš – ten jde pořád přes `/usr/bin/lp`
a soubory `api/print.ts` a `api/printers.ts` zůstaly záměrně nezměněné.

---

## ČÁST E – co zbývá potom

| Věc | Proč |
|---|---|
| **`latest.json` pro Windows** | Teď zná jen `darwin-aarch64` a `darwin-x86_64`. Dokud nepřibude `windows-x86_64` s URL a podpisem, OTA Windows klientům nic nenabídne. Doplnit podle prvního reálného buildu. |
| **Authenticode certifikát** | Bez něj SmartScreen straší u každé instalace. OV zhruba 200–400 USD ročně. EV bývá na HW tokenu, který v CI nefunguje bez cloudové podepisovací služby. |
| **Test na nativním x64** | Parallels na M4 běží přes emulaci. Před nasazením u zákazníka ověřit na skutečném x64 PC. |
| **Webová verze** | Zvlášť – aplikace už v prohlížeči běží, Tauri volání jsou pohlídaná. |

---

## Poznámka: chceš stavět rovnou v Parallels?

Jde to a na ladění tisku je to rychlejší než čekat na CI. Ve Windows VM budeš
potřebovat Node 20, Rust a **Visual Studio Build Tools** s C++ komponentou.

Pozor na architekturu: ve Windows na ARM by `npm run tauri:build` postavil
**ARM64** binárku, kterou zákazníci na běžných PC nepoužijí. Na x64 buildu
si vyžádej cílovou platformu explicitně:

```powershell
rustup target add x86_64-pc-windows-msvc
npm run tauri build -- --target x86_64-pc-windows-msvc
```

A u JobiDocs `npx electron-builder --win --x64`.
