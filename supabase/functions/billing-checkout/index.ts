/**
 * Edge Function: billing-checkout
 *
 * Vytvoří platební sezení u Stripe pro daný servis a vrátí adresu, kam
 * uživatele přesměrovat. Kartu ani částku aplikace nikdy nevidí.
 *
 * POST { service_id, plan?: lookup key tarifu, branches?: number, sms?: boolean, return_url }
 *   → { url }
 *
 * Dokud není nastavené STRIPE_SECRET_KEY, vrací 503 se srozumitelnou zprávou –
 * aplikace s tím počítá a ukáže „platby zatím nejsou spuštěné“.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { priceIdByLookupKey, stripe, stripeReady, addonKey, PLANS } from "../_shared/stripe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Strop na příplatkové pobočky v jednom sezení – překlep v množství jinak projde do platby. */
const MAX_POBOCEK_NAVIC = 50;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!stripeReady()) return json({ error: "Platby zatím nejsou spuštěné." }, 503);

    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "Chybí přihlášení." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const { data: userRes } = await userClient.auth.getUser();
    if (!userRes?.user) return json({ error: "Neplatné přihlášení." }, 401);
    const userId = userRes.user.id;

    const body = await req.json().catch(() => ({}));
    const serviceId = typeof body?.service_id === "string" ? body.service_id : "";
    const plan = typeof body?.plan === "string" && body.plan in PLANS ? body.plan : "jobi_business_monthly";
    const pobocekNavic = Number.isInteger(body?.branches) && body.branches > 0 ? Number(body.branches) : 0;
    const chceSms = body?.sms === true;
    /* Adresa pro návrat musí být naše. Stačilo „http“ na začátku, takže
       stránka Stripe Checkout uměla po zaplacení poslat zákazníka kamkoli –
       a klidně po nešifrovaném spojení. */
    const povolenyNavrat = (u: string): boolean => {
      try {
        const url = new URL(u);
        if (url.protocol !== "https:") return url.hostname === "localhost" || url.hostname === "127.0.0.1";
        return url.hostname === "appjobi.com" || url.hostname.endsWith(".appjobi.com");
      } catch {
        return false;
      }
    };
    const returnUrl = typeof body?.return_url === "string" && povolenyNavrat(body.return_url)
      ? body.return_url
      : "https://appjobi.com/servis/";
    if (!serviceId) return json({ error: "Chybí service_id." }, 400);

    const svc = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Platit smí jen majitel nebo správce servisu.
    const { data: clenstvi } = await svc
      .from("service_memberships")
      .select("role")
      .eq("service_id", serviceId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!clenstvi || (clenstvi.role !== "owner" && clenstvi.role !== "admin")) {
      return json({ error: "Předplatné může sjednat jen majitel nebo správce servisu." }, 403);
    }

    const planPrice = await priceIdByLookupKey(plan);
    if (!planPrice) return json({ error: `Ve Stripe chybí cena s lookup key „${plan}“.` }, 400);

    const interval = PLANS[plan].interval;
    const polozky: Array<{ price: string; quantity: number }> = [{ price: planPrice, quantity: 1 }];
    // Pobočky navíc dávají smysl jen tam, kde tarif pobočky vůbec umí.
    // Bez téhle kontroly si Starter připlatil za druhou pobočku, ale modul
    // `branches` mu nevznikl a databáze mu ji dál odmítala – platil za nic.
    if (pobocekNavic > 0 && !PLANS[plan].modules.includes("branches")) {
      return json({ error: `Tarif ${PLANS[plan].label} pobočky navíc neumí. Vyberte vyšší tarif.` }, 400);
    }
    if (pobocekNavic > MAX_POBOCEK_NAVIC) {
      return json({ error: `Najednou lze přikoupit nejvýš ${MAX_POBOCEK_NAVIC} poboček. Napište nám, potřebujete-li víc.` }, 400);
    }
    // Chybějící cena příplatku se dřív mlčky přeskočila: zákazník prošel
    // Checkoutem v přesvědčení, že si pobočku nebo SMS koupil, zaplatil jen
    // tarif a modul nedostal. U ceny tarifu se vrací 400, tady taky.
    if (pobocekNavic > 0) {
      const klic = addonKey("jobi_branch_addon", interval);
      const cena = await priceIdByLookupKey(klic);
      if (!cena) return json({ error: `Ve Stripe chybí cena s lookup key „${klic}“.` }, 400);
      polozky.push({ price: cena, quantity: pobocekNavic });
    }
    // SMS jsou v ceně od Business výš; u Starteru se přikupují.
    if (chceSms && !PLANS[plan].modules.includes("sms")) {
      const klic = addonKey("jobi_sms_addon", interval);
      const cena = await priceIdByLookupKey(klic);
      if (!cena) return json({ error: `Ve Stripe chybí cena s lookup key „${klic}“.` }, 400);
      polozky.push({ price: cena, quantity: 1 });
    }

    // Zákazník Stripe patří servisu, ne uživateli – předplatné platí za dílnu.
    const { data: billing } = await svc
      .from("service_billing")
      .select("stripe_customer_id")
      .eq("service_id", serviceId)
      .maybeSingle();

    const { data: service } = await svc.from("services").select("name").eq("id", serviceId).maybeSingle();

    let customerId = billing?.stripe_customer_id as string | undefined;
    if (!customerId) {
      const zakaznik = await stripe<{ id: string }>("POST", "/customers", {
        name: service?.name ?? "Servis",
        email: userRes.user.email ?? undefined,
        metadata: { service_id: serviceId },
      });
      customerId = zakaznik.id;
      // Neuložené id znamená, že se příště založí druhý zákazník u Stripe –
      // dvě karty, dvě předplatná na jednu dílnu. Platba se kvůli tomu
      // nepřeruší (webhook servis dohledá z metadat), ale musí to být v logu.
      const { error } = await svc.from("service_billing").upsert({ service_id: serviceId, stripe_customer_id: customerId }, { onConflict: "service_id" });
      if (error) console.error("[billing-checkout] uložení stripe_customer_id:", serviceId, error.message);
    }

    const sezeni = await stripe<{ url: string }>("POST", "/checkout/sessions", {
      mode: "subscription",
      customer: customerId,
      line_items: polozky,
      success_url: `${returnUrl}?predplatne=hotovo`,
      cancel_url: `${returnUrl}?predplatne=zruseno`,
      allow_promotion_codes: true,
      // Ať se dá vyplnit IČO/DIČ a faktura sedí na firmu.
      tax_id_collection: { enabled: true },
      billing_address_collection: "required",
      subscription_data: { metadata: { service_id: serviceId } },
      metadata: { service_id: serviceId },
    });

    return json({ ok: true, url: sezeni.url });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
