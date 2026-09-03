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

## 7. Rozhodnuto

### DPH – nejdřív je potřeba říct, co cena znamená

Zjištění při návrhu: **`repairs.price` má dnes nedefinovaný význam.**
V nastavení je jen DIČ jako text (navíc v localStorage, ne v DB), faktury
mají `vat_rate` po položkách, ale u ceníku o DPH není nikde nic. Nikdo
tedy neví, jestli uložené číslo je s daní nebo bez.

Než půjde posílat obojí, musí to servis deklarovat:

```sql
ALTER TABLE public.services
  ADD COLUMN prices_include_vat boolean NOT NULL DEFAULT true,
  ADD COLUMN default_vat_rate numeric(5,2) NOT NULL DEFAULT 21;
```

API pak u každé ceny pošle obě varianty a nechá web vybrat:

```json
{ "price": 2500, "price_incl_vat": 2500, "price_excl_vat": 2066.12,
  "vat_rate": 21, "prices_include_vat": true }
```

### Čtení bez tokenu

**Token v JavaScriptu na webu není tajemství** – kdokoli si otevře zdroj
stránky a má ho. Nekoupí se tím bezpečnost, jen komplikace pro webaře
a rozbité cachování na CDN. Data mají být veřejná; identifikace jde přes
slug, měření přes log dotazů.

Kdyby někdo chtěl ceník polosoukromý, přidá se později přepínač
„vyžadovat token i na čtení". Dopředu to nestavíme.

### Doména

`api.appjobi.com` (proxy na Supabase edge funkce).

### Limity

| co | limit |
|---|---:|
| čtení, na IP | 60/min |
| čtení, na servis | 600/min |
| zápis, na token | 30/min |

K tomu `Cache-Control: max-age=300` a ETag. Většina opakovaných dotazů se
pak k funkci vůbec nedostane a limity zůstanou rezervou pro skutečný provoz.

---

## 8. Stav k 3. 9. 2026

Hotovo a nasazené na produkci:

| co | kde |
|---|---|
| Ceník | `public-catalog`, modul `api_catalog` |
| Sklad | `public-inventory`, modul `api_inventory` |
| Viditelnost po položkách | značka, kategorie, model, oprava, kategorie produktů, produkt |
| Výjimky po modelech u opravy | `repairs.public_hidden_model_ids` |
| Hromadné skrytí/zveřejnění | Zařízení a Sklad, působí na zobrazený výběr |
| DPH ve třech variantách | `price`, `price_incl_vat`, `price_excl_vat` |
| Čas v lidské podobě | `estimated_time_label` |
| ETag + `max-age=300` | obě čtecí funkce |
| Režimy dostupnosti | `hidden` / `boolean` / `exact`, přepínatelné v Nastavení → API |
| Tokeny | `api-tokens-manage`, jen owner/admin, hash-only |
| Zápis | `api-write`, rozsahy, `Idempotency-Key`, 30/min na token |
| Limity čtení | 60/min na IP, 600/min na servis, v `api_read_hits` |
| Přehled využití | Nastavení → API, za 7 dní a za dnešek |
| Webhook | `public-webhook-ping`, jen https a veřejné adresy |
| Snippet na web | `public-embed` |
| OpenAPI | `docs/api/openapi.yaml` |

### Co ještě zbývá

**Doména `api.appjobi.com`.** Hotovo (3. 9. 2026). Před edge funkcemi stojí
Cloudflare Worker `jobi-api` (`infra/cloudflare/jobi-api-worker.js`), připojený
přes Route `api.appjobi.com/*` v zóně `appjobi.com`. Překládá cesty:

| veřejně | funkce |
|---|---|
| `/v1/catalog` | `public-catalog` |
| `/v1/inventory` | `public-inventory` |
| `/v1/embed.js` | `public-embed` |
| `/v1/write` | `api-write` |

Adresy `…supabase.co/functions/v1/…` fungují dál, ale ven se rozdává jen ta nová.

**Cachování.** Řeší si Worker sám přes Cache API, ne Cache Rule z panelu –
poddotaz míří na `supabase.co`, tedy na cizí zónu, na kterou se pravidla téhle
nevztahují. Dvě věci, o které to při zprovoznění zakoplo a stojí za zapamatování:

- klíč musí být adresa z **vlastní** zóny (`api.appjobi.com/…`), ne ta cílová;
  s cizí doménou `put` projde bez chyby, ale `match` nikdy nic nenajde
- Supabase sám běží za Cloudflare, takže jeho odpovědi nesou cookie `__cf_bm`,
  a odpověď se `Set-Cookie` Cache API mlčky neuloží – hlavička se proto zahazuje

Stav cache je vidět v odpovědi jako `X-Jobi-Cache: HIT | MISS`. Bez ní se to
ladilo naslepo, `cf-cache-status` o téhle vrstvě nic neříká.

**Úklid starých záznamů.** Hotovo, ověřeno 3. 9. 2026. Migrace
`20260903180000_api_uklid_plan.sql` naplánovala `api_uklid_starych_zaznamu()`
přes pg_cron na 3:20 denně. Úloha `jobi-uklid-api` je aktivní – bez ní by
`api_read_hits` rostla donekonečna. Zkontrolovat jde takhle:

```sql
select jobname, schedule, active from cron.job where jobname = 'jobi-uklid-api';
```

**Veřejné sledování zakázky.** Zákazník zadá kód a telefon a vidí stav.
Pro servis užitečné, ale je to osobní údaj – **samostatný modul a samostatné
rozhodnutí**, ne součást ceníku.

**Popis OpenAPI.** Aby integrátor (nebo tvůj webař) věděl, co čekat.

---

## 7. Rozhodnuto

### DPH – nejdřív je potřeba říct, co cena znamená

Zjištění při návrhu: **`repairs.price` má dnes nedefinovaný význam.**
V nastavení je jen DIČ jako text (navíc v localStorage, ne v DB), faktury
mají `vat_rate` po položkách, ale u ceníku o DPH není nikde nic. Nikdo
tedy neví, jestli uložené číslo je s daní nebo bez.

Než půjde posílat obojí, musí to servis deklarovat:

```sql
ALTER TABLE public.services
  ADD COLUMN prices_include_vat boolean NOT NULL DEFAULT true,
  ADD COLUMN default_vat_rate numeric(5,2) NOT NULL DEFAULT 21;
```

API pak u každé ceny pošle obě varianty a nechá web vybrat:

```json
{ "price": 2500, "price_incl_vat": 2500, "price_excl_vat": 2066.12,
  "vat_rate": 21, "prices_include_vat": true }
```

### Čtení bez tokenu

**Token v JavaScriptu na webu není tajemství** – kdokoli si otevře zdroj
stránky a má ho. Nekoupí se tím bezpečnost, jen komplikace pro webaře
a rozbité cachování na CDN. Data mají být veřejná; identifikace jde přes
slug, měření přes log dotazů.

Kdyby někdo chtěl ceník polosoukromý, přidá se později přepínač
„vyžadovat token i na čtení". Dopředu to nestavíme.

### Doména

`api.appjobi.com` (proxy na Supabase edge funkce).

### Limity

| co | limit |
|---|---:|
| čtení, na IP | 60/min |
| čtení, na servis | 600/min |
| zápis, na token | 30/min |

K tomu `Cache-Control: max-age=300` a ETag. Většina opakovaných dotazů se
pak k funkci vůbec nedostane a limity zůstanou rezervou pro skutečný provoz.

---

## 8. Stav k 3. 9. 2026

Hotovo a nasazené na produkci:

| co | kde |
|---|---|
| Ceník | `public-catalog`, modul `api_catalog` |
| Sklad | `public-inventory`, modul `api_inventory` |
| Viditelnost po položkách | značka, kategorie, model, oprava, kategorie produktů, produkt |
| Výjimky po modelech u opravy | `repairs.public_hidden_model_ids` |
| Hromadné skrytí/zveřejnění | Zařízení a Sklad, působí na zobrazený výběr |
| DPH ve třech variantách | `price`, `price_incl_vat`, `price_excl_vat` |
| Čas v lidské podobě | `estimated_time_label` |
| ETag + `max-age=300` | obě čtecí funkce |
| Režimy dostupnosti | `hidden` / `boolean` / `exact`, přepínatelné v Nastavení → API |
| Tokeny | `api-tokens-manage`, jen owner/admin, hash-only |
| Zápis | `api-write`, rozsahy, `Idempotency-Key`, 30/min na token |
| Limity čtení | 60/min na IP, 600/min na servis, v `api_read_hits` |
| Přehled využití | Nastavení → API, za 7 dní a za dnešek |
| Webhook | `public-webhook-ping`, jen https a veřejné adresy |
| Snippet na web | `public-embed` |
| OpenAPI | `docs/api/openapi.yaml` |

### Co ještě zbývá

**Doména `api.appjobi.com`.** Hotovo (3. 9. 2026). Před edge funkcemi stojí
Cloudflare Worker `jobi-api` (`infra/cloudflare/jobi-api-worker.js`), připojený
přes Route `api.appjobi.com/*` v zóně `appjobi.com`. Překládá cesty:

| veřejně | funkce |
|---|---|
| `/v1/catalog` | `public-catalog` |
| `/v1/inventory` | `public-inventory` |
| `/v1/embed.js` | `public-embed` |
| `/v1/write` | `api-write` |

Adresy `…supabase.co/functions/v1/…` fungují dál, ale ven se rozdává jen ta nová.

**Cachování.** Řeší si Worker sám přes Cache API, ne Cache Rule z panelu –
poddotaz míří na `supabase.co`, tedy na cizí zónu, na kterou se pravidla téhle
nevztahují. Dvě věci, o které to při zprovoznění zakoplo a stojí za zapamatování:

- klíč musí být adresa z **vlastní** zóny (`api.appjobi.com/…`), ne ta cílová;
  s cizí doménou `put` projde bez chyby, ale `match` nikdy nic nenajde
- Supabase sám běží za Cloudflare, takže jeho odpovědi nesou cookie `__cf_bm`,
  a odpověď se `Set-Cookie` Cache API mlčky neuloží – hlavička se proto zahazuje

Stav cache je vidět v odpovědi jako `X-Jobi-Cache: HIT | MISS`. Bez ní se to
ladilo naslepo, `cf-cache-status` o téhle vrstvě nic neříká.

**Úklid starých záznamů.** Migrace `20260903180000_api_uklid_plan.sql` plánuje
`api_uklid_starych_zaznamu()` na 3:20 denně, ale sama se přeskočí, když projekt
nemá `pg_cron`. Ověřit dotazem:

```sql
select jobname, schedule, active from cron.job where jobname = 'jobi-uklid-api';
```

Prázdný výsledek = pg_cron není zapnutý (Database → Extensions) a migraci je
potřeba pustit znovu. Bez toho `api_read_hits` roste donekonečna.

**Veřejné sledování zakázky.** Samostatný modul a samostatné rozhodnutí,
je to osobní údaj. Zatím se nedělalo.
