/**
 * Export vystavené faktury do fakturační aplikace (dnes iDoklad).
 *
 * POST { service_id, invoice_id, provider }         → založí doklad, zapíše stopu do invoices
 * POST { service_id, provider, action: "test" }     → jen ověří přihlašovací údaje
 *
 * iDoklad API v3: token přes client credentials (identity.idoklad.cz), pak
 * /Contacts (odběratel podle IČO nebo názvu), /IssuedInvoices/Default (výchozí
 * číselná řada, způsob platby, měna) a POST /IssuedInvoices. Tajemství leží
 * v service_integrations, sem se dostane jen přes service role.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const IDOKLAD_TOKEN_URL = "https://identity.idoklad.cz/server/v2/connect/token";
const IDOKLAD_API = "https://api.idoklad.cz/v3";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

type InvoiceRow = {
  id: string; service_id: string; number: string; variable_symbol: string | null; status: string;
  issue_date: string; due_date: string; taxable_date: string | null; currency: string;
  customer_name: string | null; customer_ico: string | null; customer_dic: string | null;
  customer_address: string | null; customer_email: string | null; customer_phone: string | null;
  notes: string | null; external_provider: string | null; external_id: string | null; external_number: string | null; external_url: string | null;
};
type ItemRow = { name: string; qty: number; unit: string; unit_price: number; vat_rate: number; sort_order: number };

class IdokladError extends Error {}

async function idokladToken(cfg: Record<string, unknown>): Promise<string> {
  const clientId = typeof cfg.client_id === "string" ? cfg.client_id.trim() : "";
  const clientSecret = typeof cfg.client_secret === "string" ? cfg.client_secret.trim() : "";
  if (!clientId || !clientSecret) throw new IdokladError("Chybí Client ID nebo Client Secret.");
  const form = new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret, scope: "idoklad_api" });
  if (typeof cfg.application_id === "string" && cfg.application_id.trim()) form.set("application_id", cfg.application_id.trim());
  const res = await fetch(IDOKLAD_TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form });
  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try { const j = JSON.parse(text); detail = j.error_description ?? j.error ?? text; } catch { /* text */ }
    throw new IdokladError(`iDoklad odmítl přihlášení (${res.status}): ${detail}`.slice(0, 300));
  }
  const data = JSON.parse(text) as { access_token?: string };
  if (!data.access_token) throw new IdokladError("iDoklad nevrátil přístupový token.");
  return data.access_token;
}

async function idoklad<T>(token: string, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${IDOKLAD_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json", "X-App": "Jobi" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  if (!res.ok) {
    const msg = parsed?.Message ?? parsed?.message ?? parsed?.ErrorMessage ?? text;
    const detail = parsed?.ModelState ? " " + JSON.stringify(parsed.ModelState).slice(0, 400) : "";
    throw new IdokladError(`iDoklad ${method} ${path} → ${res.status}: ${String(msg).slice(0, 300)}${detail}`);
  }
  // v3 obaluje odpověď do { Data, Status, Message } – u seznamů Data.Items
  return (parsed && typeof parsed === "object" && "Data" in parsed ? parsed.Data : parsed) as T;
}

/** Sazba DPH → typ sazby iDokladu (Basic=1, Reduced1=0, Reduced2=3, Zero=2). */
function vatRateType(rate: number): number {
  if (rate <= 0) return 2;
  if (rate >= 20) return 1;
  if (rate >= 14) return 0; // 15 % (i historická 15 %)
  return 3; // 10–12 %
}

function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return { first: "", last: name.trim() };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

function parseAddress(addr: string | null): { street: string; city: string; zip: string } {
  if (!addr) return { street: "", city: "", zip: "" };
  const parts = addr.split(",").map((p) => p.trim()).filter(Boolean);
  const street = parts[0] ?? "";
  const rest = parts.slice(1).join(" ");
  const m = rest.match(/(\d{3}\s?\d{2})/);
  const zip = m ? m[1] : "";
  const city = rest.replace(zip, "").replace(/\s+/g, " ").trim();
  return { street, city, zip };
}

async function findOrCreateContact(token: string, inv: InvoiceRow): Promise<number> {
  const ico = (inv.customer_ico ?? "").replace(/\s/g, "");
  const name = (inv.customer_name ?? "").trim() || "Zákazník";
  const list = async (filter: string) =>
    idoklad<{ Items?: Array<{ Id: number }> }>(token, "GET", `/Contacts?filter=${encodeURIComponent(filter)}&pageSize=5`);
  if (ico) {
    const r = await list(`IdentificationNumber~eq~${ico}`);
    if (r?.Items?.[0]?.Id) return r.Items[0].Id;
  }
  if (!ico) {
    const r = await list(`CompanyName~eq~${name}`);
    if (r?.Items?.[0]?.Id) return r.Items[0].Id;
  }
  // Země: CZ (fallback 2 = Česko v iDokladu, když by číselník nešel načíst)
  let countryId = 2;
  try {
    const c = await idoklad<{ Items?: Array<{ Id: number }> }>(token, "GET", `/Countries?filter=${encodeURIComponent("Code~eq~CZ")}&pageSize=1`);
    if (c?.Items?.[0]?.Id) countryId = c.Items[0].Id;
  } catch { /* fallback */ }
  const addr = parseAddress(inv.customer_address);
  const isCompany = !!ico || /s\.r\.o\.|a\.s\.|spol\.|z\.s\.|s\.p\./i.test(name);
  const person = isCompany ? { first: "", last: "" } : splitName(name);
  const created = await idoklad<{ Id: number }>(token, "POST", "/Contacts", {
    CompanyName: name,
    Firstname: person.first || null,
    Surname: person.last || null,
    IdentificationNumber: ico || null,
    VatIdentificationNumber: (inv.customer_dic ?? "").replace(/\s/g, "") || null,
    Email: inv.customer_email || null,
    Mobile: inv.customer_phone || null,
    Street: addr.street || null,
    City: addr.city || null,
    PostalCode: addr.zip || null,
    CountryId: countryId,
  });
  if (!created?.Id) throw new IdokladError("iDoklad nevrátil id nového kontaktu.");
  return created.Id;
}

function dateOnly(d: string | null | undefined, fallback: string): string {
  const v = (d ?? fallback).slice(0, 10);
  return `${v}T00:00:00`;
}

async function exportToIdoklad(token: string, inv: InvoiceRow, items: ItemRow[]): Promise<{ id: string; number: string; url: string | null }> {
  const partnerId = await findOrCreateContact(token, inv);
  const def = await idoklad<Record<string, unknown>>(token, "GET", "/IssuedInvoices/Default");
  const today = new Date().toISOString().slice(0, 10);
  const payload: Record<string, unknown> = {
    ...def,
    PartnerId: partnerId,
    DateOfIssue: dateOnly(inv.issue_date, today),
    DateOfTaxing: dateOnly(inv.taxable_date ?? inv.issue_date, today),
    DateOfMaturity: dateOnly(inv.due_date, today),
    Description: `Faktura ${inv.number}`,
    VariableSymbol: inv.variable_symbol ?? inv.number.replace(/\D/g, "").slice(-10) ?? null,
    Note: inv.notes || null,
    OrderNumber: inv.number,
    IsEet: false,
    IsIncomeTax: typeof def.IsIncomeTax === "boolean" ? def.IsIncomeTax : true,
    Items: [...items]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((it) => ({
        Name: it.name.slice(0, 200),
        Amount: Number(it.qty) || 1,
        Unit: (it.unit || "ks").slice(0, 20),
        UnitPrice: Number(it.unit_price) || 0,
        PriceType: 1, // bez DPH – Jobi drží jednotkové ceny bez DPH
        VatRateType: vatRateType(Number(it.vat_rate) || 0),
        DiscountPercentage: 0,
        IsTaxMovement: false,
        ItemType: 0,
      })),
  };
  // Pole z Default, která POST nezná, iDoklad ignoruje; Items z Default nahrazujeme.
  delete payload.Id;
  delete payload.DocumentNumber;
  const created = await idoklad<{ Id: number; DocumentNumber?: string }>(token, "POST", "/IssuedInvoices", payload);
  if (!created?.Id) throw new IdokladError("iDoklad doklad nevrátil.");
  return { id: String(created.Id), number: created.DocumentNumber ?? "", url: null };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "Missing authorization header" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes?.user) return json({ error: "Unauthorized", detail: userErr?.message }, 401);
    const userId = userRes.user.id;

    const svc: SupabaseClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));
    const { service_id, invoice_id, provider = "idoklad", action } = body as { service_id?: string; invoice_id?: string; provider?: string; action?: string };
    if (!service_id) return json({ error: "Chybí service_id" }, 400);
    if (provider !== "idoklad") return json({ error: `Propojení „${provider}“ zatím není podporované.` }, 400);

    const { data: membership } = await svc.from("service_memberships").select("role").eq("service_id", service_id).eq("user_id", userId).maybeSingle();
    if (!membership) return json({ error: "Nejste členem tohoto servisu." }, 403);

    const { data: integ } = await svc.from("service_integrations").select("config, active").eq("service_id", service_id).eq("provider", provider).maybeSingle();
    if (!integ || integ.active === false) return json({ error: "iDoklad není pro tento servis propojený. Nastavení → Fakturace a DPH." }, 400);
    const cfg = (integ.config ?? {}) as Record<string, unknown>;

    const markError = async (msg: string) => {
      await svc.from("service_integrations").update({ last_error: msg.slice(0, 500) }).eq("service_id", service_id).eq("provider", provider);
    };

    let apiToken: string;
    try {
      apiToken = await idokladToken(cfg);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await markError(msg);
      return json({ ok: false, error: msg }, 400);
    }

    if (action === "test") {
      try {
        await idoklad(apiToken, "GET", "/IssuedInvoices/Default");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await markError(msg);
        return json({ ok: false, error: msg }, 400);
      }
      await svc.from("service_integrations").update({ last_ok_at: new Date().toISOString(), last_error: null }).eq("service_id", service_id).eq("provider", provider);
      return json({ ok: true });
    }

    if (!invoice_id) return json({ error: "Chybí invoice_id" }, 400);
    const { data: inv } = await svc.from("invoices").select("*").eq("id", invoice_id).eq("service_id", service_id).is("deleted_at", null).maybeSingle();
    if (!inv) return json({ error: "Faktura nenalezena." }, 404);
    const invoice = inv as InvoiceRow;
    if (invoice.status === "draft") return json({ error: "Koncept nejde odeslat – fakturu nejdřív vystavte." }, 400);
    if (invoice.external_provider) {
      return json({ ok: true, already: true, external_id: invoice.external_id, external_number: invoice.external_number, external_url: invoice.external_url });
    }
    const { data: items } = await svc.from("invoice_items").select("name, qty, unit, unit_price, vat_rate, sort_order").eq("invoice_id", invoice_id).order("sort_order");
    if (!items || items.length === 0) return json({ error: "Faktura nemá žádné položky." }, 400);

    try {
      const out = await exportToIdoklad(apiToken, invoice, items as ItemRow[]);
      const exportedAt = new Date().toISOString();
      await svc.from("invoices").update({
        external_provider: provider, external_id: out.id, external_number: out.number || null, external_url: out.url, exported_at: exportedAt,
      }).eq("id", invoice_id);
      await svc.from("invoice_events").insert({ invoice_id, type: "exported", payload: { provider, external_id: out.id, external_number: out.number }, created_by: userId }).then(() => {}, () => {});
      await svc.from("service_integrations").update({ last_ok_at: exportedAt, last_error: null }).eq("service_id", service_id).eq("provider", provider);
      return json({ ok: true, external_id: out.id, external_number: out.number, external_url: out.url });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await markError(msg);
      return json({ ok: false, error: msg }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
