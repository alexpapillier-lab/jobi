# Jobi Capture – focení z telefonu

Mobilní stránka pro nahrání diagnostické fotky přes QR kód. Otevře se na telefonu, vyfotí a odešle do zakázky.

## Konfigurace

V `index.html` uprav `window.CAPTURE_CONFIG`:

```js
window.CAPTURE_CONFIG = { supabaseUrl: 'https://TVUJ_PROJEKT.supabase.co' };
```

## Nasazení na Cloudflare Pages

1. Cloudflare Dashboard → Workers & Pages → **Upload your static files**
2. Vyber složku `capture/` (nebo nahraj zip obsahující `index.html` a `capture.js`)
3. Deploy

## Edge Functions

- **capture-upload** – přijímá fotku (bez auth), validuje token, nahraje do Storage, přidá k zakázce
- **capture-create-token** – vytvoří token pro QR (vyžaduje auth), vrací `{ token, url }`

Migrace: `20260228000000_capture_tokens.sql` – tabulka `capture_tokens`

Deploy:
```bash
npx supabase functions deploy capture-upload --no-verify-jwt
npx supabase functions deploy capture-create-token
npx supabase db push   # migrace
```

## URL pro QR kód

`https://capture.appjobi.com/?ticket=XXX&token=YYY`

`ticket` = ID zakázky  
`token` = jednorázový token (vygeneruje Jobi při zobrazení QR)
