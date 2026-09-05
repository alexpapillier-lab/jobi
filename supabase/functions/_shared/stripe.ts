/**
 * Minimální klient Stripe API přes fetch.
 *
 * Záměrně bez SDK: potřebujeme čtyři volání a jednu kontrolu podpisu, a tohle
 * se nemusí verzovat ani stahovat. Stripe bere formulářové kódování a vrací
 * JSON; vnořené hodnoty se posílají jako `a[b][c]`.
 *
 * Klíč je v tajemství `STRIPE_SECRET_KEY`. Dokud není nastavené, funkce
 * `stripeReady()` vrací false a volající odpoví srozumitelně, místo aby
 * spadl na 500 – aplikace tak jde nasadit dřív, než existuje účet u Stripe.
 */
const API = "https://api.stripe.com/v1";

export function stripeKey(): string | null {
  const k = Deno.env.get("STRIPE_SECRET_KEY")?.trim();
  return k ? k : null;
}

export function stripeReady(): boolean {
  return stripeKey() !== null;
}

export class StripeError extends Error {}

/** Zploští objekt do formulářového zápisu, který Stripe očekává. */
function encode(data: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (typeof item === "object" && item !== null) out.push(...encode(item as Record<string, unknown>, `${key}[${i}]`));
        else out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
      });
    } else if (typeof v === "object") {
      out.push(...encode(v as Record<string, unknown>, key));
    } else {
      out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return out;
}

export async function stripe<T = Record<string, unknown>>(
  method: "GET" | "POST",
  path: string,
  data?: Record<string, unknown>,
): Promise<T> {
  const key = stripeKey();
  if (!key) throw new StripeError("Platby zatím nejsou nastavené (chybí STRIPE_SECRET_KEY).");
  const body = data ? encode(data).join("&") : undefined;
  const url = method === "GET" && body ? `${API}${path}?${body}` : `${API}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": "2024-06-20",
    },
    body: method === "POST" ? body : undefined,
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  if (!res.ok) {
    const msg = parsed?.error?.message ?? text.slice(0, 200);
    throw new StripeError(`Stripe ${method} ${path} → ${res.status}: ${msg}`);
  }
  return parsed as T;
}

/** Cena podle lookup key – ať se do konfigurace nemusí opisovat `price_…` id. */
export async function priceIdByLookupKey(lookupKey: string): Promise<string | null> {
  const res = await stripe<{ data?: Array<{ id: string }> }>("GET", "/prices", {
    lookup_keys: [lookupKey],
    active: true,
    limit: 1,
  });
  return res.data?.[0]?.id ?? null;
}

/**
 * Ověření podpisu webhooku (schéma `t=…,v1=…`, HMAC-SHA256 nad `t.payload`).
 * Bez něj by kdokoli poslal „zaplaceno“ a odemkl si aplikaci.
 */
export async function overitPodpis(payload: string, header: string | null, secret: string): Promise<boolean> {
  if (!header) return false;
  const casti = Object.fromEntries(
    header.split(",").map((c) => {
      const [k, ...zbytek] = c.split("=");
      return [k.trim(), zbytek.join("=")];
    }),
  );
  const t = casti["t"];
  const v1 = casti["v1"];
  if (!t || !v1) return false;
  // Stará zpráva = nejspíš přehrávaný útok.
  const stari = Math.abs(Date.now() / 1000 - Number(t));
  if (!Number.isFinite(stari) || stari > 300) return false;

  const klic = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const podpis = await crypto.subtle.sign("HMAC", klic, new TextEncoder().encode(`${t}.${payload}`));
  const ocekavano = Array.from(new Uint8Array(podpis)).map((b) => b.toString(16).padStart(2, "0")).join("");
  // Porovnání v konstantním čase.
  if (ocekavano.length !== v1.length) return false;
  let rozdil = 0;
  for (let i = 0; i < ocekavano.length; i++) rozdil |= ocekavano.charCodeAt(i) ^ v1.charCodeAt(i);
  return rozdil === 0;
}

/**
 * Tarify a příplatky. Klíč je `lookup key` nastavený ve Stripe u ceny, takže
 * změna částky ani přejmenování produktu se téhle tabulky netýká. Když
 * přibude tarif, přidá se sem řádek a nikde jinde.
 */
export type PlanDef = {
  /** Lidský název pro obrazovku Předplatné. */
  label: string;
  /** Co tarif zapíná (viz service_entitlements.module). */
  modules: string[];
  /** Kolik poboček je v ceně; další jsou příplatek. */
  branchesIncluded: number;
  /** Kolik SMS měsíčně je v ceně. 0 = modul SMS není součástí tarifu. */
  smsIncluded: number;
  interval: "month" | "year";
  /** Stupeň tarifu – kvůli řazení a přepínači měsíčně/ročně. */
  tier: "starter" | "business" | "enterprise";
};

const ZAKLAD = ["access", "invoices"];
const BUSINESS = [...ZAKLAD, "accounting", "sms", "branches"];
const ENTERPRISE = [...BUSINESS, "api_catalog", "api_inventory"];

export const PLANS: Record<string, PlanDef> = {
  jobi_starter_monthly: { label: "Starter", modules: ZAKLAD, branchesIncluded: 1, smsIncluded: 0, interval: "month", tier: "starter" },
  jobi_starter_yearly: { label: "Starter", modules: ZAKLAD, branchesIncluded: 1, smsIncluded: 0, interval: "year", tier: "starter" },
  jobi_business_monthly: { label: "Business", modules: BUSINESS, branchesIncluded: 1, smsIncluded: 300, interval: "month", tier: "business" },
  jobi_business_yearly: { label: "Business", modules: BUSINESS, branchesIncluded: 1, smsIncluded: 300, interval: "year", tier: "business" },
  jobi_enterprise_monthly: { label: "Enterprise", modules: ENTERPRISE, branchesIncluded: 2, smsIncluded: 600, interval: "month", tier: "enterprise" },
  jobi_enterprise_yearly: { label: "Enterprise", modules: ENTERPRISE, branchesIncluded: 2, smsIncluded: 600, interval: "year", tier: "enterprise" },
};

/**
 * Příplatky. `branches` a `sms` se násobí množstvím u položky předplatného,
 * takže dva balíčky SMS znamenají dvojnásobný měsíční strop.
 */
export const ADDONS: Record<string, { modules?: string[]; branches?: number; sms?: number }> = {
  jobi_sms_addon_monthly: { modules: ["sms"], sms: 100 },
  jobi_sms_addon_yearly: { modules: ["sms"], sms: 100 },
  jobi_branch_addon_monthly: { branches: 1 },
  jobi_branch_addon_yearly: { branches: 1 },
};

/** Lookup key příplatku ve stejném období jako tarif. */
export function addonKey(zaklad: "jobi_sms_addon" | "jobi_branch_addon", interval: "month" | "year"): string {
  return `${zaklad}_${interval === "year" ? "yearly" : "monthly"}`;
}

/** Kolik dní po konci období nechat přístup, než se zamkne (platba se může opozdit). */
export const GRACE_DAYS = 3;
