# Jobi – iOS / iPadOS aplikace

Cesta: **Capacitor** (web app obalená v nativní iOS shell).

## Hlavní body

- **Top moderní design** – čistý, současný vzhled
- **Maximálně intuitivní ovládání** – bez zbytečných kroků
- **Rychlost** – plynulé, okamžitá odezva

## Rozsah MVP

**Všechny funkce jako desktop verze – kromě tisku.**

### Zahrnuto
- Zakázky, zákazníci, tým
- Vytváření a úprava zakázek
- Fotky do diagnostiky
- Skenování čárových kódů (IMEI, SN)
- Offline fronta a sync
- Stavy zakázek, základní workflow

### Vynecháno (na začátku)
- Tisk dokumentů – odložit; případně později „Export/Share jako PDF“ nebo AirPrint

---

## Vývoj

Samostatný projekt – obsahuje **celou kopii** zdrojového kódu (`src/`, `logos/`). Úpravy pro iOS dělej přímo tady.

### Požadavky

- Node.js 18+
- macOS, Xcode (pro iOS build)
- `.env` v kořeni rodičovského projektu (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY) – nebo zkopíruj do této složky

### Příkazy

```bash
# Závislosti
npm install

# Dev server (prohlížeč)
npm run dev

# Build pro iOS
npm run build

# Sync do Xcode projektu
npm run cap:sync

# Otevřít v Xcode
npm run cap:open:ios
```

Poté v Xcode spusť na Simulator nebo připojené zařízení.
