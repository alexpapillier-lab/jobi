# API Objednávky – objednávky oprav z vašeho webu do Jobi

Pro servisy a jejich webaře. Váš web (formulář „Pošlete nám zařízení“,
e-shop, rezervační systém) pošle objednávku opravy do Jobi. Servis ji uvidí
v **Zakázkách nahoře v Příchozích objednávkách** a na stránce **Dnes**; když
zásilka dorazí, jedním kliknutím z ní založí zakázku (příjem se předvyplní).
Web se pak přes **webhook** dozví číslo zakázky a každou změnu jejího stavu.

Strojový popis: `https://api.appjobi.com/v1/openapi.json`,
čitelná dokumentace: `https://api.appjobi.com/v1/docs`.

---

## 1. Co je potřeba

1. Servis má zapnutý modul **Veřejné API** (Nastavení → API ukazuje zelené štítky).
2. Majitel nebo správce vytvoří v **Nastavení → API → Zápis – tokeny** token se
   zaškrtnutým **Přijímat objednávky oprav z webu** (scope `orders`). Token se
   ukáže jen jednou; patří na server webu, **nikdy ne do JavaScriptu na stránce**.
3. Volitelně v **Nastavení → API → Objednávky z webu** adresu webhooku
   (oznámení zpět) – tajemství pro ověření podpisu se ukáže jen jednou.

Servis bez vlastního formuláře může místo API vložit hotový
**formulář Jobi** (kapitola 8).

---

## 2. Poslání objednávky

```
POST https://api.appjobi.com/v1/orders
Authorization: Bearer jobi_…
Content-Type: application/json
```

```json
{
  "orders": [{
    "external_id": "SRV-2026-0123",
    "source": "servis.iswap.cz",
    "customer": {
      "name": "Jan Novák", "phone": "+420777123456", "email": "jan@example.cz",
      "company": "Novák s.r.o.", "ico": "12345678", "dic": "CZ12345678",
      "address": { "street": "Dlouhá 1", "city": "Praha", "zip": "110 00" }
    },
    "device": { "name": "iPhone 13", "serial": "356789123456789", "passcode": "1234", "accessories": "obal" },
    "issue": "Prasklý displej, nereaguje dotyk",
    "requested_repair": "Výměna displeje",
    "shipping": {
      "inbound": "DPD", "outbound": "Zásilkovna",
      "pickup_point": { "id": "1234", "name": "Z-BOX Praha 7" },
      "tracking": [{ "carrier": "dpd", "number": "13912345678901", "direction": "inbound" }]
    },
    "consent": {
      "id": "c-7f3a9e21-5b0d-4c1e-9a77-2f1c0b8d4e10",
      "signed_at": "2026-10-13T14:32:05+02:00",
      "method": "drawn",
      "signer_name": "Jan Novák",
      "ip": "203.0.113.7",
      "user_agent": "Mozilla/5.0 …",
      "terms_version": "2026-09",
      "text_hash": "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      "signature_image": "data:image/png;base64,iVBORw0KGgo…"
    },
    "note": "Prosím zavolat před opravou",
    "data": { "cena_dopravy": 99 }
  }]
}
```

| Pole | Povinné | Co znamená |
|---|---|---|
| `external_id` | ano | Číslo objednávky u vás (do 100 znaků). **V servisu jedinečné** – podle něj se objednávka aktualizuje. |
| `status` | ne | `new` (výchozí), `in_transit` (předáno dopravci), `arrived` (doručeno), `cancelled` (zrušeno). `converted` nastavuje jen Jobi. |
| `source` | ne | Odkud objednávka je; bez něj název tokenu. Vytiskne se u elektronického odsouhlasení („formulář servis.iswap.cz“). |
| `branch_id` | ne | Pobočka servisu, kam zařízení jede (UUID z Jobi). |
| `customer.*` | ne | Jméno, telefon, e-mail, firma, IČO, DIČ, adresa (objekt nebo text). |
| `device` | ne | Text, nebo objekt `name`, `model_id` (model z `/v1/catalog`), `serial` (nebo `imei`), `passcode`, `accessories`. |
| `issue` | ne | Popis závady. |
| `requested_repair`, `repair_id` | ne | Požadovaná oprava; `repair_id` z ceníku se při příjmu přidá i s cenou. |
| `shipping.inbound` / `outbound` | ne | Doprava tam a zpět (DPD, Zásilkovna, Osobně…). |
| `shipping.pickup_point`, `return_address` | ne | Výdejní místo a adresa pro vrácení (text nebo objekt). |
| `shipping.tracking` | ne | Sledovací čísla `{ carrier, number, direction: inbound/outbound, url? }` – **celý seznam**, nahradí uložený. Bez `carrier` se dopravce odhadne z `inbound`/`outbound`; odkaz na sledování (DPD, Zásilkovna, PPL, GLS, Česká pošta) sestaví Jobi. |
| `consent` | ne | Elektronické odsouhlasení zakázkového listu – kapitola 4. |
| `note` | ne | Poznámka pro servis. |
| `data` | ne | Cokoli dalšího (objekt do 20 kB). Jobi to jen uloží. |

Vazby (`branch_id`, `model_id`, `repair_id`) se přijmou jen na záznamy servisu
– cizí nebo neexistující id se vynechá a ohlásí v `errors`.

### Odpověď

```json
{
  "ok": true,
  "orders": [{ "index": 0, "external_id": "SRV-2026-0123", "result": "created", "status": "new", "ticket_code": null }]
}
```

- **200** – vše uloženo; `result` je `created`, `updated` nebo `unchanged`.
- **207** – některé položky mají chybu, ostatní jsou uložené. Chyby po položkách:
  `"errors": ["orders[1]: customer.email nevypadá platně"]`.
- **400** – tělo není JSON / chybí `orders` / víc než 50 objednávek.
- **401** – chybějící, neplatný nebo odvolaný token. **403** – token nemá scope
  `orders` nebo servis nemá veřejné API. **413** – tělo nad 512 kB.
  **429** – víc než 60 požadavků za minutu na token (hlavička `Retry-After`).

### Idempotence

Objednávka se pozná podle `external_id`. Stejný požadavek poslaný dvakrát
(timeout, výpadek sítě) nic nezdvojí – podruhé přijde `unchanged`. Proto
**opakujte bez obav**. Aktualizace je PATCH: mění se jen pole, která pošlete;
`null` hodnotu smaže.

---

## 3. Změna stavu a sledovací čísla

```json
{ "orders": [{ "external_id": "SRV-2026-0123", "status": "in_transit",
  "shipping": { "tracking": [{ "carrier": "dpd", "number": "13912345678901", "direction": "inbound" }] } }] }
```

Stavy objednávky:

| API | V Jobi | Kdo ho nastaví |
|---|---|---|
| `new` | Nová | web |
| `in_transit` | Na cestě | web (předáno dopravci) |
| `arrived` | Dorazilo | web nebo servis tlačítkem Dorazilo |
| `converted` | Zakázka založena | jen Jobi – servis založil zakázku |
| `cancelled` | Zrušená | web, nebo servis (pak přijde webhook `order.cancelled`) |

Po převodu na zakázku jde přes API měnit už jen `shipping.tracking`
(např. číslo zásilky zpět), `note` a `data`; stav se řídí zakázkou.
Zrušenou objednávku měnit nejde.

### Stav objednávky a zakázky

```
GET https://api.appjobi.com/v1/orders?external_id=SRV-2026-0123
Authorization: Bearer jobi_…
```

```json
{ "order": {
  "external_id": "SRV-2026-0123", "status": "converted", "source": "servis.iswap.cz",
  "tracking": [{ "carrier": "dpd", "number": "13912345678901", "direction": "inbound", "url": "https://tracking.dpd.de/…" }],
  "consent": { "id": "c-7f3a…", "signed_at": "2026-10-13T12:32:05.000Z", "method": "drawn", "has_signature_image": true },
  "arrived_at": "…", "converted_at": "…",
  "ticket_code": "IRPAZ2601527",
  "ticket": { "code": "IRPAZ2601527", "status": { "key": "in_progress", "label": "V opravě", "is_final": false }, "total": 2990, "updated_at": "…" }
} }
```

---

## 4. Elektronické odsouhlasení zakázkového listu (`consent`)

Když zákazník na vašem webu odsouhlasí (nebo podepíše na displeji) zakázkový
list a podmínky, pošlete to v `consent`. Při založení zakázky se souhlas
**přenese na zakázku** a na vytištěném zakázkovém listu bude v kolonce
„Zákazník – předání do opravy“:

- **obrázek podpisu**, když jste ho poslali (`signature_image`), nebo
- text **„Elektronicky odsouhlaseno 13. 10. 2026 14:32 · ID c-7f3a… · formulář
  servis.iswap.cz“** a pod ním malým písmem IP a verze podmínek.

Když zákazník při převzetí v dílně podepíše ještě ručně, vytiskne se ruční
podpis a text odsouhlasení zůstane pod ním – nic se nepřepisuje. V detailu
zakázky je řádek „Elektronicky odsouhlaseno … (ID …)“ s detailem (čas,
metoda, IP, prohlížeč, verze podmínek).

| Pole | Povinné | Co znamená |
|---|---|---|
| `id` | ano | **Vaše ID odsouhlasení** (do 100 znaků). |
| `signed_at` | ano | Kdy zákazník odsouhlasil, ISO 8601 **s časovou zónou**. |
| `method` | ne | `checkbox` (zaškrtnutí), `drawn` (podpis na displeji), `sms_code`, `email_code`, `bankid`, `other`. Bez hodnoty `drawn` s obrázkem, jinak `checkbox`. |
| `signer_name` | ne | Kdo odsouhlasil. |
| `ip`, `user_agent` | ne | IP adresa a prohlížeč zákazníka v okamžiku odsouhlasení. |
| `terms_version`, `document_version` | ne | Verze podmínek a textu zakázkového listu, které zákazník viděl. |
| `text_hash` | ne | Otisk přesného odsouhlaseného textu (např. `sha256:…`). |
| `terms_url` | ne | Odkaz na znění podmínek (https). |
| `signature_image` | ne | Podpis nakreslený na displeji: `data:image/png;base64,…` (nebo jpeg) do 200 kB, nebo https odkaz, odkud si ho Jobi stáhne. Uloží se do **soukromého úložiště servisu** (čtou ho jen členové servisu přes časově omezený odkaz), ne do databázového řádku. |

**Stejné `id` poslané znovu nic nemění** (obrázek se znovu nenahrává).
Nové `id` = nový souhlas (např. zákazník podepsal znovu). Po převodu na
zakázku se souhlas už nemění; na zakázce ho nemůže změnit ani servis.

### Jak generovat ID

- Náhodné a jedinečné – nejlépe **UUID v4** (`crypto.randomUUID()`), případně
  s předponou (`c-…`). Ne pořadové číslo: z ID se nemá dát odhadnout jiné.
- Vytvořte ho **v okamžiku odsouhlasení** na serveru a uložte k němu záznam
  (níže). ID na papíře pak vede přesně k vašemu záznamu.

### Co si uchovat u sebe jako důkaz

Jobi drží kopii pro tisk a přehled, **důkaz je váš záznam**. U každého ID:

1. **Přesné znění**, které zákazník viděl – vyrenderovaný zakázkový list
   (HTML/PDF) včetně podmínek a jejich verze; `text_hash` = otisk tohoto textu.
2. Čas (serverový, s časovou zónou), IP adresu, prohlížeč, číslo objednávky.
3. Způsob odsouhlasení – u `sms_code`/`email_code` i to, na jaké číslo / adresu
   šel kód a kdy byl ověřen (ne samotný kód); u `drawn` původní obrázek.
4. Neměnný log (záznam se po uložení nepřepisuje) po dobu, kdy může vzniknout
   spor – typicky záruční doba + promlčení.

Zákazníkovi je dobré poslat kopii odsouhlaseného textu e-mailem.

---

## 5. Webhooky zpět na web

Nastavení → API → Objednávky z webu → **Webhook**: adresa (jen `https`
a veřejná adresa), události, zapnuto. Tajemství pro podpis se ukáže jednou
(„Vyměnit tajemství“ vydá nové a staré hned přestane platit).

Jobi pošle `POST` s JSONem:

```json
{
  "event": "ticket.status_changed",
  "external_id": "SRV-2026-0123",
  "source": "servis.iswap.cz",
  "order_status": "converted",
  "ticket_code": "IRPAZ2601527",
  "status": { "key": "in_progress", "label": "V opravě", "is_final": false },
  "total": 2990,
  "updated_at": "2026-10-14T09:12:44.512Z"
}
```

| Událost | Kdy |
|---|---|
| `order.converted` | Servis z objednávky založil zakázku (`ticket_code` je vyplněné). |
| `ticket.status_changed` | Zakázka z objednávky změnila stav. |
| `ticket.completed` | Zakázka přešla do koncového stavu (vydáno apod.; `is_final: true`). Chodí navíc k `ticket.status_changed`. |
| `order.cancelled` | Servis objednávku zrušil v Jobi. |
| `ping` | Tlačítko **Poslat zkušební webhook** (`"test": true`). |

`total` je cena zakázky v Kč (provedené opravy po slevě).

Hlavičky:

```
Content-Type: application/json; charset=utf-8
X-Jobi-Event: ticket.status_changed
X-Jobi-Delivery: 5b0e…            (id doručení – stejné při opakování)
X-Jobi-Signature: sha256=<hex HMAC-SHA256 těla>
```

### Ověření podpisu (Node.js)

Podpis se počítá ze **surového těla** – ověřte ho dřív, než JSON parsujete.

```js
import crypto from "node:crypto";
import express from "express";

const app = express();
app.post("/jobi-webhook", express.raw({ type: "application/json" }), (req, res) => {
  const telo = req.body; // Buffer, ne parsovaný JSON
  const podpis = req.get("X-Jobi-Signature") ?? "";
  const ocekavany = "sha256=" + crypto.createHmac("sha256", process.env.JOBI_WEBHOOK_SECRET).update(telo).digest("hex");
  const ok = podpis.length === ocekavany.length && crypto.timingSafeEqual(Buffer.from(podpis), Buffer.from(ocekavany));
  if (!ok) return res.status(401).end();

  const udalost = JSON.parse(telo.toString("utf8"));
  // Duplicitu poznáte podle req.get("X-Jobi-Delivery").
  // … uložit stav zakázky k objednávce udalost.external_id …
  res.status(204).end();
});
```

PHP: `hash_equals('sha256=' . hash_hmac('sha256', file_get_contents('php://input'), $tajemstvi), $_SERVER['HTTP_X_JOBI_SIGNATURE'])`.

### Doručení a opakování

- Odpovězte **2xx do 10 sekund**; práci si udělejte až potom.
- Výpadek, časový limit, 5xx, 408 a 429 Jobi zkusí **znovu 3×** – po 1, 5
  a 30 minutách. Ostatní 4xx (špatný podpis, 404) neopakuje.
- Pořadí doručení není zaručené – řiďte se `updated_at`.
- Jedno doručení může přijít dvakrát (opakování po timeoutu) – `X-Jobi-Delivery`
  je pro obě stejné.
- Posledních 20 doručení i s chybou je v Nastavení → API → Poslední doručení.
- Přesměrování se nesleduje; adresa musí odpovědět přímo.

---

## 6. Limity

| Co | Limit |
|---|---|
| Požadavky na `/v1/orders` (GET i POST) | 60 za minutu na token (429) |
| Objednávek v jednom požadavku | 50 |
| Tělo požadavku | 512 kB |
| `data` | 20 kB |
| `consent.signature_image` | 200 kB, PNG nebo JPEG |
| Sledovacích čísel | 20 |

---

## 7. Co se děje v Jobi

1. Objednávka přijde → upozornění „Nová objednávka z webu“, panel **Příchozí
   objednávky** v Zakázkách, karta **Objednávky z webu** na stránce Dnes
   (nahoře co dorazilo, pak co je na cestě). Řádek: číslo, zákazník,
   zařízení, stav dopravy, sledovací číslo s odkazem, čas.
2. **Založit zakázku** otevře příjem předvyplněný: zákazník, zařízení
   (model z ceníku, když přišel `model_id`), SN/IMEI, heslo, příslušenství,
   závada jako požadovaná oprava, doprava jako převzetí a předání,
   **Externí identifikace = `external_id`**, pobočka, poznámka s výdejním
   místem a zásilkami. Po uložení je objednávka „Zakázka založena“ a web
   dostane `order.converted`.
3. V detailu zakázky je řádek „Z objednávky SRV-… (zdroj)“ a případně
   „Elektronicky odsouhlaseno …“.

---

## 8. Formulář Jobi (bez vlastního formuláře)

Nastavení → API → Objednávky z webu → **Formulář Jobi pro váš web**:
zapnout, úvodní text, odkaz na podmínky. Na web vložte:

```html
<div id="jobi-objednavka"></div>
<script src="https://api.appjobi.com/v1/order-form.js?service=vas-servis"></script>
```

(nebo přímo `…supabase.co/functions/v1/public-order-form/embed.js?service=…`,
jak ho ukáže aplikace). Formulář má kontakt, zařízení s výběrem z ceníku,
závadu, předání osobně / poštou (s adresou pro vrácení) a povinný souhlas
s podmínkami. Objednávka přijde jako „formulář Jobi“ s číslem
`JOBI-RRMMDD-XXXXXX`; souhlas se uloží jako elektronické odsouhlasení (čas,
IP, prohlížeč) a vytiskne se na zakázkovém listu. Limit 10 objednávek za
hodinu z jedné adresy a 60 za hodinu na servis. Barvu změníte CSS proměnnou
`--jobi-akcent` na `.jobi-obj`.
