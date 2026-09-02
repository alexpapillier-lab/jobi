# Windows verze – co udělat krok za krokem

> **Stav k 2. 9. 2026: build FUNGUJE.** Části A–C jsou hotové, secrets nastavené,
> workflow doběhl zeleně a vyrobil oba installery. Zbývá **část D – test ve Windows**.

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

### Hotovo – co build vyrobil

Běh [33611869906](https://github.com/alexpapillier-lab/jobi/actions/runs/33611869906)
skončil zeleně v obou jobech:

| Artefakt | Obsah |
|---|---|
| `jobi-windows` (5,4 MB) | `jobi_0.2.3_x64-setup.exe` + `.sig` |
| `jobidocs-windows` (166 MB) | NSIS installer a portable verze JobiDocs |

Installer ověřen: `PE32 executable (GUI) Intel 80386, for MS Windows,
Nullsoft Installer self-extracting archive`, NSIS 3.11.

**Podpisový klíč funguje.** Vygeneroval se `.sig` a jeho key ID
`4e35598888cfd69b` souhlasí s `pubkey` v `tauri.conf.json` – OTA klienti
takový podpis přijmou.

### Cesta k tomu (kdyby se to opakovalo)

Build napoprvé neprošel; tři pády a jejich příčiny:

1. **`npm ci`** – `package.json` měl sharp 0.33.5, lock 0.35.4. `npm install`
   si nesoulad tiše srovná, `npm ci` ho odmítne.
2. **typecheck** – chyběl `@types/node`. Kód používá `process.env`
   a `NodeJS.Timeout`, balíček se ale jen náhodou vyskytoval jako tranzitivní
   závislost. Doplněn natvrdo do devDependencies.
3. **JobiDocs `The syntax of the command is incorrect`** – hláška cmd.exe.
   `shell: bash` v kroku nestačí, protože **npm si package skripty spouští
   vlastním shellem**, a tím je na Windows cmd. Skripty `copy-app-icon`
   a `copy-tray-icon` používají `mkdir -p` a `cp`. Řešeno
   `npm config set script-shell` na Git Bash, takže skripty zůstaly beze změny
   a odladěný macOS build se jich nedotkl.

---

## ČÁST D – Parallels

### Důležité: tvůj Mac je M4, tedy ARM

Parallels na Apple Silicon umí **jen Windows 11 ARM64**. GitHub Actions staví
**x64**. Naštěstí Windows 11 ARM umí x64 aplikace emulovat (Prism), takže
**installer z CI se v Parallels nainstaluje a poběží.**

Na funkční test (zadávání zakázek, tisk, JobiDocs) to stačí. Emulace ale není
totéž co nativní x64 – **než to pošleš zákazníkovi, ať to někdo zkusí na
opravdovém x64 PC.**

### Nejdřív: stávající VM je zaseklá v iCloudu

V Parallels je zaregistrovaná VM „Windows 11“ ve stavu **invalid**. Není smazaná –
leží v `~/Documents/Dokumenty – MacBook Pro/VŠECHNO/Windows 11.pvm`, jenže
`~/Documents` je synchronizovaný přes iCloud (Desktop & Documents) a ten balíček
se nedá zpřístupnit.

Změřeno:

| Cesta | Chování |
|---|---|
| `Dokumenty – MacBook Pro/` | vylistuje se normálně |
| `VŠECHNO/` | vylistuje se normálně |
| `VŠECHNO/Windows 11.pvm` | `stat` projde (Directory, 480 B), ale **čtení i přesun vyprší** |

Konkrétně `ls: fts_read: Operation timed out` a
`mv: rename ...: Operation timed out`. Okolní složky jsou v pořádku, zaseklá je
**přesně jedna položka**. `bird` i `fileproviderd` běží, iCloud má ~985 GB volných,
takže to není nedostatkem místa.

**Co zkusit v tomhle pořadí:**

1. **Finder** – otevřít tu složku a podívat se na ikonu `.pvm`. Mráček se šipkou
   znamená nestažené. Pravým → *Stáhnout hned* a sledovat průběh.
2. Když i Finder stojí, restartovat iCloud démona: `killall bird`
   (spustí se sám znovu). Standardní postup u zaseklé položky.
3. System Settings → Apple Account → iCloud – jestli sync nehlásí chybu.

**Počítej i s tím, že data nemusí být kompletní.** Balíček VM může přesáhnout
limit iCloudu na jeden soubor; pokud se upload nikdy nedokončil a lokální kopie
byla mezitím uvolněna, část disku VM může chybět. Vzhledem k tomu, že tu VM
potřebuješ jen na testování, může být rychlejší **nainstalovat Windows 11
v Parallels znovu** než tohle rozplétat.

**Do budoucna:** VM nikdy nedávat do iCloudu. Složka `~/Parallels` (kterou
Parallels očekává) synchronizovaná není – už jsem ji vytvořil.

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

## Diagnostika: nativní ARM64 build

Parallels na Apple Silicon běží Windows na ARM, ale běžný build je **x64**,
takže jede přes emulaci Prism. Část případného sekání jde tedy za emulací,
ne za aplikací.

Rozlišit to jde nativním ARM64 buildem:

```bash
gh workflow run "Build Windows" -f include_arm64=true
```

Artefakt `jobi-windows-arm64` pak v Parallels poběží nativně. Srovnání:

| Co vidíš | Co to znamená |
|---|---|
| ARM64 běží plynule, x64 sekal | Za sekání mohla emulace, aplikace je v pořádku |
| Sekají obě | Problém je v aplikaci – zkusit Nastavení → Vzhled → Rozhraní → **Omezit efekty** |
| Obě plynulé po vypnutí efektů | Brzdilo rozostření (backdrop-filter), viz commit „perf: vypínač efektů" |

**ARM64 je zatím jen diagnostika, ne produkt.** Zákazníkům stačí x64, ten
na Windows ARM funguje přes emulaci. Povýšit na plnohodnotný build má smysl,
až se objeví zákazník s ARM notebookem – pak přibude i `windows-aarch64`
do `latest.json`.

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
