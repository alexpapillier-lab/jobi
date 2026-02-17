# Audit: owner / admin / member, přihlášení, registrace, pozvánky

Datum: 2026-02-17. Projití logiky rolí, auth a pozvánek (backend + frontend).

---

## 1. Přehled rolí a ROOT_OWNER

- **owner** – vlastník servisu (v `service_memberships`). Může měnit role, mazat členy, vytvářet pozvánky, spravovat servis.
- **admin** – administrátor servisu. Vidí Tým/Přístupy, Kontaktní údaje, nemůže mazat/přidávat servisy (Owner záložka jen pro root ownera).
- **member** – člen s oprávněními dle `capabilities` (např. can_manage_documents).
- **ROOT_OWNER_ID** – speciální uživatel (env). Vidí všechny servisy v `services-list`, má záložku Owner v Nastavení, může volat `service-manage` (deactivate/activate/hardDelete/rename). Měl by být v každém servisu, který vytvoří, přidaný jako owner (opraveno v `invite_create` a doplněno v `statuses-init-defaults` pro staré servisy).

**Konzistence ROOT_OWNER:** Backend všude používá `userId.toLowerCase() === rootOwnerId.toLowerCase()`. Frontend v `useIsRootOwner` nyní také porovnává case-insensitive (opraveno), aby seděl s backendem.

---

## 2. Edge Functions – kdo co smí

| Funkce | Kdo může volat | Poznámka |
|-------|----------------|----------|
| **services-list** | Všichni přihlášení | Root owner: všechny servisy + member_count. Ostatní: jen servisy, kde jsou v service_memberships (aktivní). |
| **invite-accept** | Kdokoli s platným tokenem pozvánky | Ověří email, vytvoří membership, vrátí serviceId. |
| **invite_create** | Pro mode=stock: **pouze root owner** (majitel aplikace). Pro mode=current: owner/admin daného servisu (nebo root). | Vytvářet nový servis může jen majitel aplikace. Tvůrce servisu se vždy přidá do service_memberships (včetně root). |
| **invite-delete** | Owner/admin servisu NEBO root owner | Root owner může mazat pozvánky i bez členství v servisu (opraveno). |
| **invite-get-token** | Owner/admin servisu NEBO root owner | Root používá service role pro čtení tokenu pozvánky. |
| **invite-info** | (pro zobrazení info o pozvánce) | – |
| **team-list** | Owner/admin servisu NEBO root owner | Root používá service role pro members + invites. |
| **team-invite-list** | Owner/admin servisu NEBO root owner | Root může listovat pozvánky pro libovolný servis (opraveno). |
| **team-update-role** | Owner/admin servisu NEBO root owner | Jen owner může měnit role (admin ne); root bypass. |
| **team-remove-member** | Owner/admin servisu NEBO root owner | **Ownera nelze nikdy odebrat** – vrací 403 „Ownera nelze odebrat z týmu“. Odebrat lze jen admina nebo člena. UI u ownera tlačítko Odebrat nezobrazuje. |
| **team-set-capabilities** | Owner nebo admin servisu NEBO root owner | Změna oprávnění (capabilities) membera – smí owner i admin servisu. U ownera se capabilities měnit nesmí (vrací 400). |
| **service-manage** | **Pouze root owner** | deactivate, activate, hardDelete, rename. |
| **statuses-init-defaults** | Člen servisu NEBO root owner | Root bez členství (starý servis): povoleno a po init se root doplní do service_memberships (opraveno). |

---

## 3. Frontend

- **useActiveRole(activeServiceId)** – čte pouze `service_memberships` pro daný servis. Žádný fallback na root ownera. Root owner tedy musí být v service_memberships, aby viděl Tým/Kontakt (to nyní zajišťují opravy).
- **useIsRootOwner()** – porovnává `session.user.id` s `VITE_ROOT_OWNER_ID` case-insensitive (opraveno).
- **App.tsx – invite flow:** Po přihlášení se zkontroluje `getPendingInviteToken()`, zavolá se `invite-accept`, pak `clearPendingInviteToken()`, toast „Pozvánka přijata“, `refreshServices()`, `setActiveServiceId(data.serviceId)`. Pořadí je v pořádku.
- **Settings – záložky:** Tým a Kontaktní údaje jsou zobrazeny, když `isAdmin` (owner nebo admin z useActiveRole). Owner záložka jen když `isRootOwner`. Přesměrování při výběru service_owner bez root a při service_team bez admin.
- **Tým / Přístupy – zobrazení ownera:** V seznamu členů se root owner (a kdokoli s rolí owner) **nezobrazuje** adminům a memberům: filtruje se podle `rootOwnerId` a pro ne-root navíc `role !== "owner"`. Záložka „Owner“ v Nastavení je jen pro root ownera.
- **OwnerSettings:** Po vytvoření nového servisu se volá `refreshServices()` a `setActiveServiceId(data.service_id)` (předáváno z Settings).

---

## 4. Duplicita invite-create vs invite_create

- V projektu existují **dvě** složky: `supabase/functions/invite-create` (pomlčka) a `supabase/functions/invite_create` (podtržítko).
- **Frontend** (OwnerSettings, TeamSettings) volá **`invite_create`** (podtržítko).
- Opravy „přidat tvůrce do service_memberships“ jsou provedeny v **obou** (invite-create i invite_create), aby při případném přepnutí volání vše fungovalo. Doporučení: dlouhodobě nechat jen jednu funkci (např. `invite_create`) a druhou odstranit nebo nepoužívat.

---

## 5. Provedené opravy v rámci auditu

1. **useIsRootOwner** – porovnávání `session.user.id` s `ROOT_OWNER_ID` case-insensitive (shoda s backendem).
2. **team-remove-member** – ownera nelze nikdy odebrat (403 „Ownera nelze odebrat z týmu“). Odebrat lze jen admina nebo membera. UI u ownera tlačítko Odebrat stejně nezobrazuje.
3. **invite-delete** – root owner může smazat pozvánku i bez členství v servisu (bypass kontroly membership).
4. **team-invite-list** – root owner může listovat pozvánky pro libovolný servis (použit service role client když je root owner).
5. **team-set-capabilities** – změna oprávnění membera smí nejen root owner, ale i **owner a admin servisu** (kontroly členství a role). U cílového ownera se capabilities měnit nesmí (beze změny).

---

## 6. Doporučení do budoucna

- **services-list:** U ne-root uživatelů se nevrací `member_count`; UI ho používá jen v OwnerSettings, které je jen pro root, takže OK.
- **Jedna funkce pro vytváření pozvánky/servisu:** Sjednotit na `invite_create` a odstranit nebo ignorovat `invite-create`.
