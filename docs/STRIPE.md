# Spuštění plateb (Stripe)

Všechno v Jobi je připravené. Až založíte účet, projděte tenhle seznam;
kód se měnit nemusí.

## 1. Ve Stripe

Účet ve **zkušebním (test) režimu**, přepnutí naostro až nakonec.

**Produkty a ceny** (Product catalog → Add product). U každé ceny nastavte
`Lookup key` – kód se odkazuje na něj, ne na `price_…` id, takže cenu můžete
kdykoli změnit bez zásahu do aplikace.

| Co | Cena podle ceníku | Lookup key |
|---|---|---|
| Starter měsíčně | 590 Kč / měsíc | `jobi_starter_monthly` |
| Starter ročně | 6 012 Kč / rok | `jobi_starter_yearly` |
| Business měsíčně | 1 190 Kč / měsíc | `jobi_business_monthly` |
| Business ročně | 12 138 Kč / rok | `jobi_business_yearly` |
| Enterprise měsíčně | 2 490 Kč / měsíc | `jobi_enterprise_monthly` |
| Enterprise ročně | 25 398 Kč / rok | `jobi_enterprise_yearly` |
| SMS k Starteru měsíčně | 199 Kč / měsíc | `jobi_sms_addon_monthly` |
| SMS k Starteru ročně | roční částka | `jobi_sms_addon_yearly` |
| Pobočka navíc měsíčně | 490 Kč / měsíc | `jobi_branch_addon_monthly` |
| Pobočka navíc ročně | roční částka | `jobi_branch_addon_yearly` |

Co který tarif zapíná, je v `supabase/functions/_shared/stripe.ts` (`PLANS`):
Starter zakázky a faktury, Business navíc SMS, pobočky a napojení na
účetnictví, Enterprise navíc veřejné API a dvě pobočky v ceně. Ceny se
v aplikaci nikde neopisují – obrazovka Předplatné si je bere ze Stripe
(funkce `billing-prices`).

Měnu nastavte na CZK. U pobočky navíc povolte množství (quantity), aby si
servis mohl koupit víc než jednu.

**Zákaznický portál** (Settings → Billing → Customer portal): zapnout,
povolit změnu karty, faktury a zrušení předplatného. Nic dalšího se
neprogramuje, aplikace na něj jen odkazuje.

**Webhook** (Developers → Webhooks → Add endpoint):

- URL: `https://ijtvcgolsdsrquqbvjrz.supabase.co/functions/v1/billing-webhook`
- Události: `customer.subscription.created`, `customer.subscription.updated`,
  `customer.subscription.deleted`, `invoice.payment_failed`
- Po uložení zkopírujte **Signing secret** (`whsec_…`).

**Daně** (volitelné): Stripe Tax spočítá DPH sám. Jinak nastavte ceny včetně
DPH a fakturu vystavujte ve svém účetnictví.

## 2. Klíče do Supabase

```bash
npx supabase secrets set STRIPE_SECRET_KEY=sk_test_… STRIPE_WEBHOOK_SECRET=whsec_…
```

Víc není potřeba. Funkce `billing-checkout`, `billing-portal`
a `billing-webhook` jsou nasazené a do té doby vracejí „Platby zatím nejsou
spuštěné“, takže nic nespadne.

## 3. Vyzkoušení (test režim)

1. V Jobi otevřete Nastavení → Firma → Předplatné → **Vybrat plán**.
2. Ve Stripe Checkout zaplaťte testovací kartou `4242 4242 4242 4242`,
   libovolné datum v budoucnu a CVC.
3. Po návratu zkontrolujte v databázi:

```sql
select * from service_billing where service_id = '…';
select module, active, valid_until, quota from service_entitlements where service_id = '…';
```

Mělo by být: `status = active`, u nároků `valid_until` = konec období + 3 dny
hájení a u `branches` limit = pobočky v tarifu plus dokoupené.

4. Ve Stripe zrušte předplatné (Customer → Subscription → Cancel) a ověřte,
   že se v Jobi zamkne obrazovka „Zkušební období skončilo“.

## 4. Naostro

Přepnout Stripe do živého režimu, znovu vytvořit produkty a ceny se stejnými
lookup key, přidat živý webhook a nastavit `sk_live_…` a nové `whsec_…`.

## Jak to spolu souvisí

- **Stripe** drží ceny a platby.
- **`service_entitlements`** drží, co má servis zapnuté; podle nich se řídí
  aplikace. Zapisuje je jen webhook (nebo ručně Owner panel).
- **`service_billing`** drží spojení na Stripe a stav předplatného kvůli
  zobrazení „platí do“ a odkazu do portálu.
- Nárok **`access`** znamená „smí se pracovat“. Bez něj se aplikace zamkne.
- Mapování cena → moduly je v `supabase/functions/_shared/stripe.ts`
  (`PLANS`, `ADDONS`, `GRACE_DAYS`). Nový tarif = jeden řádek navíc.

## Co zbývá dořešit obchodně

- **Platba převodem.** Stripe umí kartu; kdo bude chtít fakturu a převod,
  vystavte ji ručně a nárok zapněte v Owner → Placené moduly (kliknutím na
  datum platnosti se z nároku stane trvalý).
- **Kdo vystaví fakturu za předplatné** – Stripe Invoicing, nebo si ji
  generovat do Fakturoidu, na který má Jobi napojení.
- **Serverové zamčení zápisů** po vypršení. Dnes zámek hlídá jen aplikace.
  Až budou platby živé, přidat kontrolu `access` i do RLS u zápisů.
