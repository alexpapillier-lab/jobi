# Root owner – nastavení

Aby **root owner** v aplikaci viděl všechny servisy (a záložka „Owner“ v Nastavení fungovala), musí Edge Function `services-list` v runtime znát jeho **Auth User ID** (UUID).

## Důležité: musí to být UUID, ne hash

**ROOT_OWNER_ID** musí být **Supabase Auth User UID** – tedy UUID ve tvaru  
`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` (např. `f3b27eb3-7059-48e0-839f-de1eb988fe70`).  
Nepoužívej hash ani jiný identifikátor – funkce porovnává `userId === ROOT_OWNER_ID`, takže hodnoty musí být přesně stejné.

Kde UUID zjistit: **Dashboard → Authentication → Users** → u uživatele sloupec **User UID**.

## 1. Secret v Supabase

Nastav secret **ROOT_OWNER_ID** na toto UUID. Z kořene projektu:

```bash
supabase secrets set ROOT_OWNER_ID=<uuid-root-ownera>
```

Stejné UUID nastav v **.env** pro frontend jako **VITE_ROOT_OWNER_ID** (už máš v `.env.example`).

## 2. Znovu nasadit Edge Function

Po změně secretů nasaď znovu funkci, která secret čte.

**Důležité:** Nasazuj s `--no-verify-jwt`. Gateway Supabase jinak může vracet 401 Invalid JWT (např. po rotaci JWT klíčů nebo u ES256). Funkce si JWT ověří sama pomocí `getUser()`.

```bash
supabase functions deploy services-list --no-verify-jwt
```

**Všechny funkce volané s uživatelským JWT** by měly být nasazené stejným způsobem, jinak u nich může gateway vracet 401 Invalid JWT. Nasadit všechny najednou (z kořene projektu):

```bash
for f in services-list team-list team-invite-list team-update-role team-remove-member invite-create invite-accept invite-info invite-delete service-manage team-set-capabilities statuses-init-defaults; do
  supabase functions deploy "$f" --no-verify-jwt
done
```

(V každé z nich se uživatel ověřuje uvnitř funkce přes `getUser()`.)

## 3. Ověření

- V prohlížeči (jako root owner): v sidebaru by se měl zobrazit výběr servisů (ne „Zatím žádné servisy“).
- V Nastavení → Servis by se měla zobrazit záložka **Owner** (pouze pro root ownera).

Pokud secret v runtime chybí, `services-list` vrací jen servisy z `service_memberships`; root owner tedy uvidí prázdný seznam.

## 4. Vypsat servisy v DB (kontrola, že data existují)

V **Dashboard → SQL Editor** spusť (nebo použij soubor `scripts/list-services.sql`):

```sql
SELECT id, name, created_at FROM public.services ORDER BY name;
```

Vyhledat konkrétní název (např. jabko):

```sql
SELECT id, name, created_at FROM public.services WHERE name ILIKE '%jabko%';
```

V **Network** tabu: volání na Edge Function jde na doménu Supabase (ne localhost). Filtruj podle `functions` nebo `supabase` nebo zkus obnovit stránku s otevřeným Network a podívej se na fetch/XHR.
