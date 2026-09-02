# Veřejné API Jobi – zadání

Cíl: servis může svá data (ceník oprav, sklad) vystavit ven a použít je
na vlastním webu, případně do nich zapisovat z jiného systému.

Vzor: zakazkovylist.cz.

---

## 1. Dvě oddělená API, ne jedno

Zařízení a sklad jsou **samostatné moduly i samostatné endpointy**. Servis
může chtít zveřejnit ceník, ale sklad ne – a nemá důvod kvůli tomu vydávat
token, kterým se dá číst obojí.

| modul (entitlement) | endpoint | obsah |
|---|---|---|
| `api_catalog` | `/v1/catalog` | značky, kategorie, modely, opravy |
| `api_inventory` | `/v1/inventory` | produkty, ceny, dostupnost |

Oba **výchozí vypnuté**. Zapínají se v Nastavení → Owner, stejně jako
`sms` a `invoices` – tabulka `service_entitlements` na to už je připravená
(volný `module`, `valid_until`, `note`).

---

## 2. Co se posílá ven

### Ceník (`/v1/catalog`)

```
brands[]      id, name
categories[]  id, brand_id, name
models[]      id, category_id, name
repairs[]     id, name, price, estimated_time, details, model_ids
```

`details` je součástí – u opravy bývá popis, který zákazníka zajímá.

### Sklad (`/v1/inventory`)

```
categories[]  id, name
products[]    id, name, price, sku, description, image_url,
              category_id, model_ids, availability
```

### Co se ven NEDOSTANE nikdy

- **`repairs.costs`** – náklady servisu, tedy marže
- **`inventory_products.stock`** jako číslo, pokud si to servis nezvolí
- interní `service_id`, `order_index`, `created_at`

Funkce bude mít **pevný seznam sloupců**. Žádné `select *` – přesně tahle
chyba stála za dírou v RLS u capture tokenů (viz AUDIT kap. 1.1).

---

## 3. Viditelnost po položkách

Když má servis API zapnuté, u **každé kategorie, modelu, opravy i produktu**
jde zvlášť určit, zda se posílá ven.

Nový sloupec na `device_categories`, `device_models`, `repairs`,
`inventory_products`, `inventory_product_categories`:

```sql
public_visible boolean NOT NULL DEFAULT true
```

**Výchozí `true`, ne `false`.** Zapnutí API je vědomý krok; nutit pak
uživatele ručně odklikat stovku oprav by znamenalo, že to nikdo nepoužije.
Skrytí je výjimka, ne pravidlo. V UI ikona oka u řádku + hromadné
„skrýt vše / zveřejnit vše".

Skrytá kategorie skrývá i vše pod ní – jinak by ven prosákly modely
z kategorie, kterou servis schoval.

---

## 4. Dostupnost skladu

Servis si volí režim (na úrovni modulu, ne položky):

| režim | co API vrací |
|---|---|
| `hidden` | pole `availability` se neposílá vůbec |
| `boolean` | `"in_stock" \| "out_of_stock"` |
| `exact` | přesné číslo |

Výchozí `boolean`. Přesná čísla říkají konkurenci, co a kolik máte, a na
webu navíc často lžou – mezi prodejem a přegenerováním stránky je prodleva.

---

## 5. Zápis

Čtení je veřejné (bez tokenu). **Zápis vyžaduje token.**

```sql
CREATE TABLE public.api_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  name text NOT NULL,              -- k čemu token je ("web", "pokladna")
  token_hash text NOT NULL,        -- NIKDY samotný token
  scopes text[] NOT NULL,          -- catalog:read, catalog:write, …
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

Pravidla:

- token se ukáže **jednou při vytvoření** a dál se drží jen jeho hash
- rozsahy odděleně pro katalog a sklad, čtení a zápis
- odvolání je okamžité (`revoked_at`), nemaže se – ať je dohledatelné
- `last_used_at`, aby šlo poznat nepoužívaný token a zrušit ho
- hlavička `Idempotency-Key` u zápisu, aby opakovaný požadavek při výpadku
  sítě neaplikoval změnu dvakrát

---

## 6. Nápady navíc

**Hotový snippet na web.** Smyslem je ceník na stránce. Když k API dodáme
kousek JS, který ho vykreslí, odpadne psaní frontendu:

```html
<div id="jobi-cenik"></div>
<script src="https://api.appjobi.com/v1/embed.js" data-service="nazev-servisu"></script>
```

**Verzovaná cesta `/v1/`.** Až se tvar odpovědi změní, weby zákazníků
nespadnou.

**ETag a Cache-Control.** Ceník se mění zřídka. Cachování zrychlí web
a ušetří volání.

**Webhook při změně.** Servis zadá URL, my na ni pingneme po úpravě ceníku.
Statický web (Cloudflare Pages, které už používáme) si tím spustí přegenerování.

**Přehled využití v Owner panelu.** Kolik dotazů, odkud, kdy naposledy –
stejným způsobem, jakým se dnes sbírají chybové logy.

**Veřejné sledování zakázky.** Zákazník zadá kód a telefon a vidí stav.
Pro servis užitečné, ale je to osobní údaj – **samostatný modul a samostatné
rozhodnutí**, ne součást ceníku.

**Popis OpenAPI.** Aby integrátor (nebo tvůj webař) věděl, co čekat.

---

## 7. Co je potřeba rozhodnout

- [ ] Zveřejňovat ceny včetně DPH, bez DPH, nebo obojí?
- [ ] Má být čtení opravdu bez tokenu, nebo i na čtení token (kvůli měření)?
- [ ] Vlastní doména `api.appjobi.com`, nebo přímo Supabase URL?
- [ ] Limit dotazů – kolik za minutu na servis?
