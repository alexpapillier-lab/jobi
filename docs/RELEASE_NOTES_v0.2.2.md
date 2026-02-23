# Release Notes v0.2.2

Změny od v0.2.1. Fotky při příjmu, více zařízení při zakládání zakázky, watermark na diagnostických fotkách, sjednocení karet reklamací a jejich chování podle statusu, kalendář (Gantt), systém achievementů. Opravy: PGRST116 u service_settings, Ukončit JobiDocs v trayi.

---

## Opravy (od v0.2.1)

### service_settings – PGRST116
- Dotazy na `service_settings` (config pro servis) používají `.maybeSingle()` místo `.single()`
- Když řádek pro servis ještě neexistuje, vrací se `{ data: null }` místo chyby PGRST116
- Změněno v: Settings.tsx, ServiceSettings.tsx, Orders.tsx, useOrderActions.ts

### AuthProvider – TypeScript
- Kontrola `if (!supabase) return;` před `refreshSession()` v onAuthStateChange (oprava TS18047)

### JobiDocs – Ukončit z traye
- Na macOS: tlačítko „Ukončit JobiDocs“ v tray menu nyní skutečně ukončí aplikaci
- Příčina: close handler vždy volal `preventDefault()` a skrýval okno, takže `app.quit()` nemohl dokončit
- Řešení: příznak `isQuitting` – při Ukončit se nechá okno zavřít

---

## Nová zakázka

### Fotky při příjmu (fotky před)

- **Sekce „Fotky při příjmu“** při vytváření nové zakázky – náhledy, nahrávání souborů, mazání
- **Tlačítko „Udělat přijímací fotky“** – vytvoří zakázku a zobrazí QR pro focení z telefonu
- **Watermark** na všech diagnostických fotkách – datum, čas a „jobi“ vpravo dole (před uložením do DB)
- **Sekce „Fotky před“** v náhledu zakázky – vedle diagnostických fotografií, možnost vyfotit z telefonu, nahrát soubory

### Více zařízení při zakládání zakázky

- **„+ Přidat další zařízení“** – formulář nové zakázky umožňuje přidat více zařízení
- Pro každé zařízení se vytvoří samostatná zakázka (stejný zákazník, různé kódy)
- Fotky při příjmu se ukládají jen k první zakázce
- **QR pro více zařízení** – „Udělat přijímací fotky“ vytvoří všechny zakázky a zobrazí QR kódy s popisky pro každé zařízení

---

## Reklamace – sjednocení s zakázkami

### Stejné rozložení a velikost jako u zakázek

- Karty reklamací mají stejnou strukturu jako karty zakázek ve všech režimech zobrazení (list, grid, compact, compact-extra)
- **Levý barevný pruh** místo horního
- **borderRadius** 8 (compact-extra), 16 (list/grid)
- **Padding** 6px 10px (compact-extra), 14 (grid), 16 (list)
- **Režimy:** compact-extra (jeden řádek), compact (sloupec s ikonou zařízení), list/grid (hlavička + blok s detaily)

### Bílé pozadí a rámeček podle statusu

- **Pozadí** – bílé (`#fff`), neprůhledné
- **Rámeček a levý pruh** – barva podle statusu reklamace (stejně jako u zakázek)
- U reklamací bez platného statusu se použije neutrální barva (`var(--border)`)

### Chování finálního stavu

- Reklamace s finálním statusem se už neobjevují mezi „Aktivní“, ale jdou do „Final“
- Ve skupině **Final** se zobrazují i reklamace (pokud je zapnuté „Zobrazit reklamace v seznamu zakázek“)

### Podfiltr v záložce Reklamace

- V záložce **Reklamace** nový podfiltr: **Vše**, **Aktivní**, **Final**
- **Vše** – všechny reklamace
- **Aktivní** – jen reklamace s nefinálním stavem
- **Final** – jen reklamace s finálním stavem

---

## Kalendář

### Stránka Kalendář – Gantt přehled zakázek a reklamací

- **Nový přehled Kalendář** – položka v postranním panelu mezi Zakázky a Sklad
- **Zobrazení** – den, týden, měsíc; pruhy zakázek a reklamací na časové ose (Gantt)
- **Kliknutí** na pruh otevře detail zakázky nebo reklamace

### Sloupce `expected_completion_at` a `completed_at`

- **Migrace** `20260230000000_add_expected_completion_and_calendar.sql` – přidává:
  - `expected_completion_at` (volitelné) – předpokládané datum dokončení
  - `completed_at` (automaticky při finálním stavu) – datum uzavření
- **Migrace** `20260230000001_change_ticket_status_set_completed_at.sql` – RPC `change_ticket_status` při přepnutí na finální status nastaví `completed_at`
- **Tabulky:** `tickets`, `warranty_claims` – obě mají oba sloupce
- **Indexy** pro rychlejší dotazy při načítání kalendáře

### Filtrování podle statusů

- Filtr na vybrané stavy – výchozí jen nefinální (aktivní) zakázky a reklamace

---

## Achievementy

### Systém achievementů – osobní a servisní

- **Stránka Achievementy** – nová položka v postranním panelu (vedle Zakázky, Sklad, …)
- **Taby Osobní / Servisní** – osobní achievementy jsou vázané na činy uživatele, servisní na výkony celého servisu
- **Trofeje** – bronz, stříbro, zlato, diamant, platina (ikonka trofeje s barevným designem)
- **Žádná migrace** – achievementy se ukládají do localStorage (`jobi_achievements_earned_v2`), ne do databáze

### Toast a zvuk

- Při odemknutí achievementu se zobrazí toast s názvem, popisem a ikonou trofeje
- **Fanfára** – krátký zvuk při zisku achievementu (nahrazuje běžný „uloženo“)
- **Fronta** – při splnění více achievementů najednou se zobrazují s odstupem 2,5 s (ne všechny naráz)

### Zamčené achievementy skryté

- Nezískané achievementy se zobrazují jako **???** – název, popis a podmínky zůstávají skryté
- Získané achievementy zobrazují název, popis, datum zisku a (pokud mají cíl) progress „Zbývá X/Y“

### Nastavení – Vzhled a chování – tab Achievementy

- Přepínač **„Zobrazovat achievementy“** – při vypnutí se nezobrazují achievement toasty a položka Achievementy v postranním panelu zmizí

### Nastavení – Owner – ukázkový achievement

- Tlačítko **„Poslat ukázkový achievement“** – pro root ownera, zobrazí demo toast (vždy, i když jsou achievementy vypnuté)

### Příklady achievementů (implementované)

- **Zakázky:** První zakázka, 10/50/100/500/1000 zakázek
- **Zákazníci:** První zákazník, 10 zákazníků
- **Reklamace:** První reklamace
- **Dokumenty:** První tisk, Bez papíru (první dokument z JobiDocs), Diagnostika má oči (první fotka z mobilu)
- **Navigace:** Kalendářník, Statistikář
- **JobiDocs:** JobiDocs připojen
- **Tým:** Týmový hráč (3+ členové), Multiservis (2+ pobočky)
- **Zkratky:** Rychlé prsty (20× klávesové zkratky)
- **Servisní:** 10/100/500 zakázek v servisu

### Technické – achievementy

- **Ukládání:** `localStorage` (`jobi_achievements_earned_v2`), migrace z v1 při prvním načtení
- **Soubory:** `src/lib/achievements.ts`, `src/components/TrophyIcon.tsx`, `src/components/Toast.tsx`, `src/pages/Achievements.tsx`, `src/hooks/useAchievementProgress.ts`
- **Zvuk:** `playAchievementUnlock()` v `src/lib/sounds.ts`
- **Propojení:** `useOrderActions`, `useWarrantyClaims`, `Calendar`, `Statistics`, `JobiDocsStatus`, `TeamSettings`, `App` (multiservice)

---

## Technické

- **Opravy:** `src/pages/Settings.tsx`, `src/pages/Settings/ServiceSettings.tsx`, `src/pages/Orders.tsx`, `src/pages/Orders/hooks/useOrderActions.ts` – maybeSingle pro service_settings; `src/auth/AuthProvider.tsx` – supabase null check; `jobidocs/electron/main.ts` – isQuitting pro quit z traye
- **Fotky před:** `diagnostic_photos_before` (JSONB) v tabulce `tickets`, `src/lib/diagnosticPhotoWatermark.ts`, `src/lib/diagnosticPhotosStorage.ts`, `capture/capture.js`, Edge Functions `capture-create-token`, `capture-upload`
- **Více zařízení:** `DeviceRow` typ, `devices: DeviceRow[]` v `NewOrderDraft`, `useOrderActions.createTicket` – smyčka přes zařízení, `captureQRItems` pro více QR
- **Reklamace:** `src/pages/Orders.tsx` – jednotný layout karet reklamací, bílé pozadí, status-based border/left bar, filtrování claims podle `isFinal`, `filteredClaimsForTab`, podfiltr `claimsSubGroup`
- **Kalendář:** migrace `20260230000000_add_expected_completion_and_calendar.sql`, `20260230000001_change_ticket_status_set_completed_at.sql`, `src/pages/Calendar.tsx` – Gantt view (den/týden/měsíc), `expected_completion_at`, `completed_at` v tickets a warranty_claims
- **Achievementy:** `src/lib/achievements.ts` (definice, grantAchievement, fronta toastů), `src/components/TrophyIcon.tsx`, `src/components/Toast.tsx` (showAchievementToast, showDemoAchievementToast), `src/pages/Achievements.tsx`, `src/hooks/useAchievementProgress.ts`, `src/lib/sounds.ts` (playAchievementUnlock), `src/pages/Settings/OwnerSettings.tsx` (tlačítko ukázkový achievement)
