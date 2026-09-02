# Webová verze – nasazení

Stav: **hotová k nasazení, zatím nenasazená.**

---

## Co je hotové

| | |
|---|---|
| Web build | `npm run build:web` → `dist-web/` |
| Vývoj | `npm run dev:web` → `http://localhost:1430` |
| Tisk | Přímo z prohlížeče, bez JobiDocs |
| Dokumenty | Zakázkový list, diagnostický protokol, záruční list, přijetí reklamace, faktura |
| Vzhled dokumentů | Stejný jako na desktopu – bere se ze Supabase |
| Hlavičky pro Cloudflare | Generují se do `dist-web/_headers` při buildu |

Desktopový build se nezměnil: `vite.config.ts` je nedotčený a
`npm run build` i testy procházejí dál.

## Nasazení na Cloudflare Pages

Marketingový web (`web/`) tam už běží, tohle je **druhý projekt**.

1. Cloudflare Dashboard → Workers & Pages → **Create** → Pages →
   Connect to Git → repozitář `alexpapillier-lab/jobi`.
2. Nastavení buildu:

   | Pole | Hodnota |
   |---|---|
   | Build command | `npm ci && npm run build:web` |
   | Build output directory | `dist-web` |
   | Root directory | (prázdné – kořen repa) |

3. **Proměnné prostředí** (Settings → Environment variables). Bez nich se
   aplikace nepřipojí k Supabase:

   ```
   VITE_SUPABASE_URL
   VITE_SUPABASE_ANON_KEY
   VITE_ROOT_OWNER_ID
   ```

   Hodnoty jsou stejné jako v `.env`. Anon klíč je veřejný z principu –
   je zabudovaný i v desktopové aplikaci.

4. Doména: vlastní, oddělená od marketingového webu – např.
   `servis.appjobi.com`. Z `appjobi.com` na ni **nedávat odkaz**.

## Neveřejný přístup

Rozhodnuto: web je **záložní nástroj pro servisy, ne veřejný produkt**.

### Co je hotové v buildu

- `robots.txt` s `Disallow: /`
- hlavička `X-Robots-Tag: noindex, nofollow, noarchive`

Obojí se generuje automaticky při `npm run build:web`.

### Čemu to ale NEZABRÁNÍ

**Tohle jsou opatření proti indexaci, ne proti přístupu.** Kdo adresu zná,
otevře si přihlašovací stránku. Skutečnou ochranou zůstává přihlášení
do Supabase a RLS – stejně jako u desktopové aplikace, kde je anon klíč
zabudovaný v binárce.

Když chceš skutečnou závoru **před** přihlašovací obrazovkou, je na to
**Cloudflare Access** (Zero Trust), který je pro malý počet uživatelů
zdarma:

1. Zero Trust → Access → Applications → **Add an application** → Self-hosted
2. Doména: `servis.appjobi.com`
3. Policy: **Allow**, podmínka např. *Emails ending in* `@tvojedomena.cz`,
   nebo výčet konkrétních e-mailů servisů
4. Metoda přihlášení: One-time PIN na e-mail (nepotřebuje žádný účet navíc)

Uživatel pak nejdřív projde Access a teprve potom uvidí přihlášení do Jobi.
Nevýhoda: dvojí přihlašování. Pro záložní nástroj, který se používá
výjimečně, to dává smysl; kdyby to mělo být hlavní cesta, spíš ne.

**Sám jsem to nenastavoval** – zasahovalo by to do tvého Cloudflare účtu.

## Než to pustíš k zákazníkům

- [ ] **Projít RLS.** Anon klíč bude veřejný a bezpečnost stojí a padá
      na RLS. Metoda ověření (dotaz curlem s anon klíčem) je popsaná
      v `docs/AUDIT_2026-09.md`, kapitola 6b.
- [ ] Ověřit přihlášení, založení zakázky a tisk na nasazené verzi.
- [ ] Zkusit i na tabletu – sidebar se na úzké obrazovce rozbaluje
      klepnutím, ne najetím myší.
- [x] ~~Rozhodnout o veřejnosti~~ – neveřejná adresa, viz výš.
- [ ] Zvážit Cloudflare Access, pokud má být závora i před přihlášením.

## Co ve webu není

| Funkce | Proč |
|---|---|
| Automatické aktualizace | Web je vždy aktuální; sekce v Nastavení se skryje |
| Spuštění JobiDocs | Není co spouštět, tiskne se z prohlížeče |
| „Zobrazit ve složce“ | Soubor spadne do Stažených |
| Tichý tisk | Prohlížeč vždy ukáže dialog |
| Hlavičkový papír jako PDF | JobiDocs ho slučuje přes pdf-lib nad hotovým PDF, což z prohlížeče nejde |

„Uložit PDF“ = v tiskovém dialogu zvolit cíl **Uložit jako PDF**.
Aplikace na to sama upozorní toastem.
