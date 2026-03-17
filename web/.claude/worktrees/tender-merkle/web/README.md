# Jobi – webovky (landing)

Statická landing stránka pro Jobi. Vizuálně v souladu s aplikací (design tokeny z `src/styles/theme.css`).

## Náhled lokálně

Otevři `index.html` v prohlížeči nebo použij jednoduchý server:

```bash
cd web
npx serve .
# nebo: python3 -m http.server 8080
```

---

## Nasazení na Cloudflare Pages (GitHub)

Důležité: potřebuješ **Cloudflare Pages** (statický web), ne **Workers**. V dashboardu jdi na **Workers & Pages** → **Create** → **Pages** → **Connect to Git**. (Pokud vidíš pole „Deploy command“ a `npx wrangler deploy`, jsi u Workers – u Pages takové pole není.)

Repo: **https://github.com/alexpapillier-lab/jobi**. Nejdřív pushni složku `web/` do repo (`git add web && git commit -m "Webovky" && git push`), ať ji Cloudflare vidí.

Máte **dva weby**: hlavní landing (složka `web/`) a **Capture** (složka `capture/`). Každý = jeden Pages projekt napojený na tentýž repo.

### 1. Hlavní webovky (appjobi.com) – co nastavit v Cloudflare

V kroku **Create and deploy** (nebo po vytvoření v **Settings** → **Builds & deployments**):

| Pole | Hodnota |
|------|--------|
| **Repository** | `alexpapillier-lab/jobi` |
| **Project name** | např. `jobi-web` nebo `appjobi` |
| **Production branch** | `main` |
| **Root directory** | `web` |
| **Build command** | *prázdné* (nepiš `npm run build` – to je pro hlavní appku) |
| **Build output directory** | `.` nebo `/` (výstup = obsah složky `web`) |

**Deploy command** u Pages nepoužívej a nemáš – to je u Workers. Ulož a Deploy; pak nastav Custom domain (např. `appjobi.com`).

### 2. Capture (focení) – už máte ručně nahrané

Capture máte zatím **nahrané ručně** na Cloudflare Pages. Chcete ho převést na **Git** (stejný repo), aby se při každém push automaticky nasadilo.

**Možnost A – Nahradit ruční projekt projektem z Gitu (doporučeno)**

1. V Cloudflare vytvoř **nový** Pages projekt: **Connect to Git** → stejný repozitář (`jobi`).
2. U tohoto projektu nastav:
   - **Root directory:** `capture`
   - **Build command:** prázdné
   - **Build output directory:** `/` nebo `.`
3. Po prvním deployi nastav **Custom domain** na `capture.appjobi.com` (stejně jako u současného ručního projektu).
4. Až ověříš, že nový deploy z Gitu funguje (Capture se otevře, fotky jdou nahrát), můžeš **starý ruční projekt** smazat nebo mu zrušit doménu `capture.appjobi.com` (aby ji měl jen ten z Gitu).

**Možnost B – Nechat ruční a přidat jen landing z Gitu**

- Ruční projekt pro Capture necháš jak je (doména `capture.appjobi.com`).
- Přidáš druhý projekt z Gitu jen pro složku `web/` (hlavní webovky na `appjobi.com`).

### Shrnutí dvou projektů

| Projekt   | Root directory | Doména              | Poznámka                    |
|----------|----------------|---------------------|-----------------------------|
| Jobi web | `web`          | appjobi.com         | Nový projekt, Connect to Git |
| Capture  | `capture`      | capture.appjobi.com | Převést z ručního na Git    |

Oba projekty = jeden GitHub repo, dvě různé složky. Žádný build krok není potřeba (čistý HTML/CSS/JS).

---

## Soubory

- `index.html` – hlavní stránka (hero, výhody, Capture CTA, stáhnout, footer)
- `style.css` – styly (Jobi tokeny, layout, responzivita)
- `logo.svg` – logo Jobi pro světlé pozadí
- `README.md` – tento soubor

Odkazy na Capture: `https://capture.appjobi.com`. Odkaz na stažení aplikace: GitHub Releases (`alexpapillier-lab/jobi`).
