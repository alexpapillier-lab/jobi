# Spuštění api.appjobi.com

Postup pro převedení veřejného API na vlastní doménu. Worker je
v `infra/cloudflare/jobi-api-worker.js`.

Tenhle soubor je textová verze; klikací podoba s ověřovacími příkazy je
publikovaná jako artefakt (odkaz je v historii konverzace).

## 1. Worker

Cloudflare → Workers & Pages → Create → Start with Hello World! → Deploy.
Pojmenovat `jobi-api`.

## 2. Kód

`jobi-api` → Edit code → vložit celý `infra/cloudflare/jobi-api-worker.js`
→ Deploy.

Worker překládá `/v1/catalog` na `/functions/v1/public-catalog` a cachuje
čtení. Cache Rule z ovládacího panelu se použít nedá – poddotaz míří na
`supabase.co`, tedy na cizí zónu.

Ověření na adrese `workers.dev`:

```bash
curl -s "https://jobi-api.<účet>.workers.dev/v1/catalog?service=iswap-praha" | head -c 120
```

## 3. Doména

`jobi-api` → Settings → Domains & Routes → Add → **Custom Domain** →
`api.appjobi.com`. DNS i certifikát si Cloudflare udělá sám.

Ne přes *Route* – ta vyžaduje ručně založený DNS záznam.

```bash
curl -s "https://api.appjobi.com/v1/catalog?service=iswap-praha" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d['repairs']), 'oprav')"
```

Očekává se `571 oprav`.

## 4. Cachování

```bash
for i in 1 2; do
  curl -sI "https://api.appjobi.com/v1/catalog?service=iswap-praha" | grep -i "cf-cache-status"
done
```

Podruhé musí být `HIT`. Dvakrát `MISS` = cache nechytá.

## 5. Podmíněný dotaz

```bash
A="https://api.appjobi.com/v1/catalog?service=iswap-praha"
E=$(curl -sD - -o /dev/null "$A" | tr -d '\r' | grep -i '^etag:' | sed 's/^[Ee]tag: //')
curl -s -o /dev/null -w "stav: %{http_code}\n" -H "If-None-Match: $E" "$A"
```

Očekává se `304`.

## 6. Zbylé cesty

```bash
curl -s "https://api.appjobi.com/v1/inventory?service=iswap-praha" | head -c 90
curl -s "https://api.appjobi.com/v1/embed.js?service=iswap-praha" | head -c 60
curl -s -o /dev/null -w "%{http_code}\n" "https://api.appjobi.com/v1/neco"   # 404
```

`/v1/write` je jen na POST, testuje se s tokenem z aplikace.

## 7. Až doména běží

Přepsat na `api.appjobi.com`:

- `src/pages/Settings/ApiNastaveni.tsx` – adresy a ukázky
- `supabase/functions/public-embed/index.ts` – `zaklad` pro volání z vloženého skriptu
- `docs/api/openapi.yaml` – `servers`

Staré adresy `…supabase.co/functions/v1/…` zůstávají funkční, takže
přepnutí nikoho nerozbije.
