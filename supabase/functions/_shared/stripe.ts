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
 * Co která cena zapíná. Lookup key se nastavuje ve Stripe u ceny, takže
 * přejmenování produktu ani změna částky se téhle tabulky netýká.
 */
export const PLAN_MODULES: Record<string, string[]> = {
  jobi_plan_monthly: ["access", "invoices", "accounting", "api_catalog", "api_inventory", "branches"],
  jobi_plan_yearly: ["access", "invoices", "accounting", "api_catalog", "api_inventory", "branches"],
};

/** Cena za pobočku navíc – množství se promítne do limitu poboček. */
export const BRANCH_ADDON_KEYS = ["jobi_branch_addon", "jobi_branch_addon_yearly"];

/** Kolik dní po konci období nechat přístup, než se zamkne (platba se může opozdit). */
export const GRACE_DAYS = 3;
