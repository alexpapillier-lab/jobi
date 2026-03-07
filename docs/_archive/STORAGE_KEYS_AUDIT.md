# Audit localStorage – klíče a použití

Většina dat jde z cloudu (Supabase). V localStorage zůstávají jen nutné věci: preference UI, cache pro offline/rychlost, drafty a identifikátory.

## STORAGE_KEYS (src/constants/storageKeys.ts)

| Klíč | Účel | Kde se používá |
|------|------|----------------|
| UI_SETTINGS | Rozložení, velikost UI, preference | App.tsx, Orders.tsx, Settings.tsx |
| ACTIVE_SERVICE_ID | Poslední vybraný servis | App.tsx |
| COMPANY | Cache údajů firmy (fallback) | Orders.tsx, Settings, storageInvalidation |
| DOCUMENTS_CONFIG | Cache konfigurace dokumentů | Orders.tsx, storageInvalidation |
| INVENTORY | Cache skladu | Orders, Inventory, Devices, storageInvalidation |
| DEVICES | Cache zařízení (modely, značky) | Orders, Inventory, Devices, storageInvalidation |
| KEYBOARD_SHORTCUTS | Přepsané klávesové zkratky | keyboardShortcuts.ts |
| DEVICE_OPTIONS | Možnosti zařízení (handoff atd.) | deviceOptions.ts |
| HANDOFF_OPTIONS | Způsob předání/převzetí | handoffOptions.ts |
| LOGO_PRESET | Vybraná barva loga | App, Settings, AppLogo |
| LOGO_MINIMAL | Minimalistické logo | AppLogo |
| JOBIDOCS_LOGO_MINIMAL | JobiDocs logo minimal | (nastavení v JobiDocs) |
| JOBIDOCS_DOWNLOAD_PROMPT_SEEN | Jednorázový prompt „Stáhnout JobiDocs“ | App.tsx |
| JOBIDOCS_FIRST_CONNECT_GUIDE_SEEN | Návod po prvním připojení JobiDocs (tiskárna, logo, razítko) | AppLayout, JobiDocsStatus |

## Další klíče (storageInvalidation ADDITIONAL_KEYS + jiné)

| Klíč | Účel | Kde |
|------|------|-----|
| jobsheet_new_order_draft_v1 | Koncept nové zakázky | Orders.tsx |
| jobsheet_ticket_comments_v1 | Komentáře k zakázkám (cache) | Orders.tsx |
| jobsheet_customers_v1, jobsheet_tickets_v1, jobsheet_statuses_v1 | Cache (clear on sign out) | storageInvalidation |
| jobsheet_pending_invite_token | Token pozvánky před přihlášením | pendingInvite.ts |
| jobsheet_theme | Téma (light/dark) | App.tsx, ThemeProvider.tsx |
| jobsheet_inventory_display_mode | Režim zobrazení skladu | Inventory.tsx |
| jobsheet_remember_me, jobsheet_last_email | Zapamatovat e-mail v přihlášení | Login.tsx |
| (dynamický) getLocalProfileKey(userId) | Lokální profil uživatele (avatar, nickname) | useUserProfile.ts |
| (sounds) | Zvuky zapnuto/vypnuto | sounds.ts |

## Závěr

- Všechny klíče mají jasný účel (preference, cache, draft, identifikátor).
- Při odhlášení se maže obchodní data a drafty; zůstávají UI preference (téma, zkratky, logo).
- Při změně servisu se maže cache vázaná na servis (company, documents, inventory, devices, tickets, …).
- Žádné citlivé údaje (hesla, tokeny relace) neukládáme do localStorage; auth je přes Supabase.
