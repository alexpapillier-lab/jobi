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

4. Doména: podle uvážení, např. `app.appjobi.com`. **Ne** stejná jako
   marketingový web, ať se to neplete.

## Než to pustíš k zákazníkům

- [ ] **Projít RLS.** Anon klíč bude veřejný a bezpečnost stojí a padá
      na RLS. Metoda ověření (dotaz curlem s anon klíčem) je popsaná
      v `docs/AUDIT_2026-09.md`, kapitola 6b.
- [ ] Ověřit přihlášení, založení zakázky a tisk na nasazené verzi.
- [ ] Zkusit i na tabletu – sidebar se na úzké obrazovce rozbaluje
      klepnutím, ne najetím myší.
- [ ] Rozhodnout, jestli web zveřejnit, nebo nechat na neveřejné adrese
      jako záložní cestu pro servisy.

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
