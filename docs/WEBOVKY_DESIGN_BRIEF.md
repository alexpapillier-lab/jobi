# Webovky Jobi – design brief (20/10, vizuálně jako Jobi)

Cíl: **Lepší než perfektní.** Webovky musí vypadat v **stejném vizuálním stylu jako Jobi aplikace** a působit prémiově.

---

## 1. Designové tokeny z Jobi (použít 1:1)

### Barvy (light – výchozí pro web)
- **Pozadí:** `linear-gradient(135deg, #f6f7f9 0%, #eef0f4 100%)`
- **Panel / karty:** `rgba(255, 255, 255, 0.92)` + `backdrop-filter: blur(24px)`, border `rgba(17, 24, 39, 0.12)`
- **Text:** `#111827` (hlavní), **muted:** `#6b7280`
- **Accent:** `#2563eb`, hover `#1d4ed8`
- **Accent soft:** `rgba(37, 99, 235, 0.15)` pro pozadí tlačítek/aktivní stavy
- **Accent glow:** `rgba(37, 99, 235, 0.4)` pro stíny u CTA

### Typografie
- **Font:** `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif` (jako v appce)
- **Nadpisy:** font-weight **700–950**, rozumná hierarchie (např. 28–32px hero, 18–22px sekce, 14–16px body)
- **Muted text:** 12–13px, color `var(--muted)`

### Rozměry a efekty
- **Radius:** `--radius-sm: 12px`, `--radius-md: 18px`, `--radius-lg: 24px`
- **Stíny:** `--shadow-soft: 0 15px 40px rgba(0,0,0,0.10)`, `--shadow: 0 25px 80px rgba(0,0,0,0.15)`, u CTA přidat `--glow`
- **Přechody:** `transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1)`

### Logo
- Použít stejné logo jako v aplikaci (J v zaobleném rámečku, vnitřek modrý `#2563eb` / `#2abbfe`). Soubor např. `logos/logopic.svg` nebo export pro web.

---

## 2. Co na webovkách musí být (obsah)

- **Hero:** Jedna jasná věta, co Jobi je (servisní evidence pro opravny), + primární CTA (Stáhnout / Zkusit).
- **Sekce výhody:** 3–5 bodů (zakázky, zákazníci, sklad, dokumenty, offline, …) – ikony + krátký text v kartách ve stylu Jobi (panel, radius-lg, jemný border).
- **Focení z mobilu:** Krátká zmínka + odkaz na `capture.appjobi.com` (QR / fotka z telefonu).
- **Stáhnout:** Odkaz na stažení aplikace (macOS), případně „Připravujeme pro další platformy“.
- **Footer:** Jednoduchý (kontakt, případně odkaz na dokumentaci / podporu).

---

## 3. Technické požadavky

- **Statický export** (HTML/CSS/JS nebo jeden Vite build), aby šlo nahrát na **Cloudflare Pages**.
- **Responzivní:** mobil first, na desktop velkorysé mezery a čitelnost.
- **Performance:** minimální závislosti, rychlé načtení (např. font z system nebo jeden webfont).
- **Přístupnost:** kontrast, focus stavy (outline jako v Jobi: `2px solid var(--accent)`), sémantické HTML.

---

## 4. „20/10“ checklist před launch

- [ ] Barvy a fonty jsou **identické** s Jobi (theme light).
- [ ] Karty a tlačítka vypadají jako v appce (panel, radius, accent-soft, glow na primárním CTA).
- [ ] Logo je oficiální Jobi logo, ne náhrada.
- [ ] Žádný „generic SaaS look“ – žádný Inter/Comfortaa, žádné fialové gradienty odnikud.
- [ ] Na mobilu je vše čitelné a CTA dostupné bez horizontálního scrollu.
- [ ] Jemná animace (např. fade-in sekcí, hover stavy) – ne přehlcené, v souladu s `--transition-smooth`.
- [ ] Dark mode: volitelně (Jobi ho má) – pokud ano, použít `[data-theme="dark"]` tokeny z `src/styles/theme.css`.

---

## 5. Hosting na Cloudflare

- **Webovky (landing):** jeden Cloudflare Pages projekt → např. `appjobi.com` (Root directory: `web`).
- **Capture (focení přes QR):** druhý projekt → `capture.appjobi.com` (Root directory: `capture`). Pokud je Capture zatím nahrané ručně, lze ho převést na deploy z Gitu – viz `web/README.md`.
- Oba projekty = jeden GitHub repo, dvě složky. Celý hosting na Cloudflare.

---

Implementace: složka `web/` (index.html, style.css, logo.svg) + `web/README.md` s návodem na Cloudflare Pages a migraci ručního Capture na Git.
