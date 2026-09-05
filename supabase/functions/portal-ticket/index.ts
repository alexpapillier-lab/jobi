/**
 * Edge Function: portal-ticket
 * Zákaznický portál – veřejná stránka web/z/?t=<token> ji volá bez přihlášení.
 * Token je jediné oprávnění: tickets.portal_token (zakládá RPC ensure_portal_token z Jobi).
 *
 * GET  ?t=<token>                          → stav zakázky pro zákazníka
 * POST { t, action, note?, signature? }    → approve | reject | sign | pickup
 *
 * Nasazuje se s --no-verify-jwt. Vrací jen to, co zákazník smí vidět –
 * žádný telefon, e-mail, kód zařízení, IMEI, interní poznámky ani nákupní ceny.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildSpayd } from "../_shared/spayd.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const BUCKET = "diagnostic-photos";
const MAX_SIGNATURE_BYTES = 300 * 1024;
const OPENED_EVENT_INTERVAL_MS = 30 * 60 * 1000;
const RATE_LIMIT_PER_MIN = 60;

// ---------------------------------------------------------------------------
// Odpovědi

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

const neplatnyOdkaz = () => json({ error: "Odkaz není platný." }, 404);

// ---------------------------------------------------------------------------
// Lehký rate-limit (per instance, best effort – instance edge funkce nesdílí paměť)

const limity = new Map<string, { od: number; pocet: number }>();

function prekrocenLimit(token: string): boolean {
  const now = Date.now();
  const z = limity.get(token);
  if (!z || now - z.od > 60_000) {
    limity.set(token, { od: now, pocet: 1 });
    // úklid, ať mapa neroste donekonečna
    if (limity.size > 5000) {
      for (const [k, v] of limity) if (now - v.od > 60_000) limity.delete(k);
    }
    return false;
  }
  z.pocet += 1;
  return z.pocet > RATE_LIMIT_PER_MIN;
}

// ---------------------------------------------------------------------------
// Typy

type TicketRow = {
  id: string;
  service_id: string;
  branch_id?: string | null;
  code: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  expected_completion_at: string | null;
  device_label: string | null;
  device_brand: string | null;
  device_model: string | null;
  estimated_price: number | string | null;
  performed_repairs: unknown;
  diagnostic_photos: unknown;
  diagnostic_photos_before: unknown;
  discount_type: string | null;
  discount_value: number | string | null;
  handoff_method: string | null;
  handback_method: string | null;
  quote_amount: number | string | null;
  quote_note: string | null;
  quote_status: string;
  quote_sent_at: string | null;
  quote_decided_at: string | null;
  intake_signature_url: string | null;
  intake_signed_at: string | null;
};

const TICKET_COLUMNS =
  "id, service_id, code, status, notes, created_at, expected_completion_at, " +
  "device_label, device_brand, device_model, estimated_price, performed_repairs, " +
  "diagnostic_photos, diagnostic_photos_before, discount_type, discount_value, " +
  "handoff_method, handback_method, quote_amount, quote_note, quote_status, " +
  "quote_sent_at, quote_decided_at, intake_signature_url, intake_signed_at, branch_id";

type Repair = { name: string; price: number };

// ---------------------------------------------------------------------------
// Pomocné

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function stringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.length > 0);
}

function parseRepairs(v: unknown): Repair[] {
  if (!Array.isArray(v)) return [];
  const out: Repair[] = [];
  for (const r of v) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    out.push({
      name: typeof o.name === "string" ? o.name : "",
      price: toNumber(o.price) ?? 0,
    });
  }
  return out;
}

/** Stejné pravidlo jako computeFinalPrice v src/components/tickets/types.ts */
function computeFinalPrice(repairs: Repair[], discountType: string | null, discountValue: number | null): number {
  const total = repairs.reduce((s, r) => s + (r.price || 0), 0);
  const value = discountValue || 0;
  let discount = 0;
  if (discountType === "percentage") discount = (total * value) / 100;
  else if (discountType === "amount") discount = value;
  return Math.max(0, total - discount);
}

function deviceLabel(t: TicketRow): string {
  if (t.device_label && t.device_label.trim()) return t.device_label.trim();
  return [t.device_brand, t.device_model].filter((x) => x && x.trim()).join(" ").trim();
}

function clientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim() || null;
  return req.headers.get("cf-connecting-ip");
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

// ---------------------------------------------------------------------------
// Načtení zakázky podle tokenu

async function loadTicket(svc: SupabaseClient, token: string): Promise<TicketRow | null> {
  const { data, error } = await svc
    .from("tickets")
    .select(TICKET_COLUMNS)
    .eq("portal_token", token)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    console.error("[portal-ticket] ticket lookup error:", error);
    return null;
  }
  return (data as TicketRow | null) ?? null;
}

// ---------------------------------------------------------------------------
// Sestavení odpovědi pro zákazníka

async function buildPayload(svc: SupabaseClient, t: TicketRow) {
  const [statusRes, settingsRes, serviceRes, branchRes] = await Promise.all([
    svc
      .from("service_statuses")
      .select("key, label, bg, fg, is_final")
      .eq("service_id", t.service_id)
      .eq("key", t.status)
      .maybeSingle(),
    svc.from("service_settings").select("config").eq("service_id", t.service_id).maybeSingle(),
    svc.from("services").select("name").eq("id", t.service_id).maybeSingle(),
    // Pobočka zakázky: její adresa, telefon a e-mail mají v portálu přednost před firemními.
    t.branch_id
      ? svc.from("branches").select("name, phone, email, address_street, address_city, address_zip, opening_hours, is_default, company_name, ico, bank_account, iban").eq("id", t.branch_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const branch = (branchRes?.data ?? null) as
    | { name: string; phone: string | null; email: string | null; address_street: string | null; address_city: string | null; address_zip: string | null; opening_hours: string | null; is_default: boolean; company_name: string | null; ico: string | null; bank_account: string | null; iban: string | null }
    | null;
  const branchHasAddress = !!(branch && (strOrNull(branch.address_street) || strOrNull(branch.address_city) || strOrNull(branch.address_zip)));

  const st = statusRes.data as { key: string; label: string; bg: string | null; fg: string | null; is_final: boolean } | null;
  // Zákazníkovi jde jen „uzavřeno / neuzavřeno“; interní název a barva
  // stavu jsou pracovní členění servisu a na portál nepatří.
  const status = {
    isFinal: st?.is_final === true,
  };

  const config = (settingsRes.data?.config ?? {}) as Record<string, unknown>;
  const cd = (config.companyData && typeof config.companyData === "object"
    ? config.companyData
    : {}) as Record<string, unknown>;
  // Pobočka jako vlastní subjekt: název a účet pobočky mají přednost před firemními.
  const serviceName = (branch && strOrNull(branch.company_name)) ?? strOrNull(cd.name) ?? strOrNull(serviceRes.data?.name) ?? "";
  const branchHasBank = !!(branch && (strOrNull(branch.bank_account) || strOrNull(branch.iban)));

  const service = {
    name: serviceName,
    // Název pobočky jen u vedlejších poboček – u výchozí („Hlavní pobočka“) by za názvem servisu jen překážel.
    branch: branch && !branch.is_default ? strOrNull(branch.name) : null,
    openingHours: branch ? strOrNull(branch.opening_hours) : null,
    phone: (branch && strOrNull(branch.phone)) ?? strOrNull(cd.phone),
    email: (branch && strOrNull(branch.email)) ?? strOrNull(cd.email),
    website: strOrNull(cd.website),
    addressStreet: branchHasAddress ? strOrNull(branch!.address_street) : strOrNull(cd.addressStreet),
    addressCity: branchHasAddress ? strOrNull(branch!.address_city) : strOrNull(cd.addressCity),
    addressZip: branchHasAddress ? strOrNull(branch!.address_zip) : strOrNull(cd.addressZip),
    bankAccount: branchHasBank ? strOrNull(branch!.bank_account) : strOrNull(cd.bankAccount),
    iban: branchHasBank ? strOrNull(branch!.iban) : strOrNull(cd.iban),
  };

  const repairs = parseRepairs(t.performed_repairs);
  const discountValue = toNumber(t.discount_value);
  const discount =
    t.discount_type && discountValue !== null ? { type: t.discount_type, value: discountValue } : null;
  const totalPrice = computeFinalPrice(repairs, t.discount_type, discountValue);
  const quoteAmount = toNumber(t.quote_amount);

  const ticket = {
    code: t.code ?? "",
    createdAt: t.created_at,
    expectedCompletionAt: t.expected_completion_at,
    deviceLabel: deviceLabel(t),
    requestedRepair: t.notes ?? "",
    status,
    photosBefore: stringArray(t.diagnostic_photos_before),
    photos: stringArray(t.diagnostic_photos),
    performedRepairs: repairs,
    discount,
    totalPrice,
    estimatedPrice: toNumber(t.estimated_price),
    quote: {
      amount: quoteAmount,
      note: t.quote_note,
      status: t.quote_status ?? "none",
      sentAt: t.quote_sent_at,
      decidedAt: t.quote_decided_at,
    },
    intakeSignedAt: t.intake_signed_at,
    intakeSignatureUrl: t.intake_signature_url,
    handoffMethod: t.handoff_method,
    handbackMethod: t.handback_method,
  };

  // Platba: schválená nabídka má přednost, jinak cena provedených oprav
  let amount: number | null = null;
  if (t.quote_status === "approved" && quoteAmount !== null && quoteAmount > 0) amount = quoteAmount;
  else if (totalPrice > 0) amount = totalPrice;

  let payment: { amount: number; vs: string; spayd: string | null } | null = null;
  if (amount !== null && (service.iban || service.bankAccount)) {
    const vs = (t.code ?? "").replace(/\D/g, "").slice(-10);
    payment = {
      amount,
      vs,
      spayd: buildSpayd({
        iban: service.iban,
        bankAccount: service.bankAccount,
        amount,
        vs,
        message: `Zakazka ${t.code ?? ""}`.trim(),
      }),
    };
  }

  return { ok: true, ticket, service, payment };
}

// ---------------------------------------------------------------------------
// Události

async function insertEvent(svc: SupabaseClient, t: TicketRow, type: string, meta: Record<string, unknown> | null) {
  const { error } = await svc.from("ticket_portal_events").insert({
    ticket_id: t.id,
    service_id: t.service_id,
    type,
    meta,
  });
  if (error) console.error(`[portal-ticket] event ${type} insert error:`, error);
}

/** Otevření: portal_last_opened_at vždy, událost 'opened' nejvýš jednou za 30 minut. */
async function recordOpened(svc: SupabaseClient, t: TicketRow) {
  const nowIso = new Date().toISOString();
  const { error: updErr } = await svc.from("tickets").update({ portal_last_opened_at: nowIso }).eq("id", t.id);
  if (updErr) console.error("[portal-ticket] portal_last_opened_at update error:", updErr);

  const { data: last } = await svc
    .from("ticket_portal_events")
    .select("created_at")
    .eq("ticket_id", t.id)
    .eq("type", "opened")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const lastMs = last?.created_at ? new Date(last.created_at as string).getTime() : 0;
  if (Date.now() - lastMs >= OPENED_EVENT_INTERVAL_MS) {
    await insertEvent(svc, t, "opened", null);
  }
}

// ---------------------------------------------------------------------------
// Podpis: PNG data URL → Storage

function decodePngDataUrl(signature: unknown): Uint8Array | null {
  if (typeof signature !== "string") return null;
  const m = signature.match(/^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/);
  if (!m) return null;
  const b64 = m[1].replace(/\s/g, "");
  // base64 je ~4/3 velikosti – hrubá pojistka před dekódováním
  if (b64.length > MAX_SIGNATURE_BYTES * 1.4) return null;
  try {
    const binary = atob(b64);
    if (binary.length > MAX_SIGNATURE_BYTES) return null;
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    // PNG signatura
    if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) {
      return null;
    }
    return bytes;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Handler

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const svc = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // ----- GET -------------------------------------------------------------
    if (req.method === "GET") {
      const url = new URL(req.url);
      const token = (url.searchParams.get("t") ?? "").trim();
      if (!token || token.length > 64) return neplatnyOdkaz();
      if (prekrocenLimit(token)) return json({ error: "Příliš mnoho požadavků, zkuste to za chvíli." }, 429);

      const ticket = await loadTicket(svc, token);
      if (!ticket) return neplatnyOdkaz();

      await recordOpened(svc, ticket);
      return json(await buildPayload(svc, ticket));
    }

    // ----- POST ------------------------------------------------------------
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return json({ error: "Neplatný požadavek." }, 400);
    }

    const token = typeof body?.t === "string" ? body.t.trim() : "";
    if (!token || token.length > 64) return neplatnyOdkaz();
    if (prekrocenLimit(token)) return json({ error: "Příliš mnoho požadavků, zkuste to za chvíli." }, 429);

    const action = typeof body?.action === "string" ? body.action : "";
    if (!["approve", "reject", "sign", "pickup"].includes(action)) {
      return json({ error: "Neznámá akce." }, 400);
    }

    const ticket = await loadTicket(svc, token);
    if (!ticket) return neplatnyOdkaz();

    const note = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : null;
    const meta = {
      ip: clientIp(req),
      userAgent: req.headers.get("user-agent"),
      note: note || null,
    };

    if (action === "approve" || action === "reject") {
      if (ticket.quote_status !== "sent") {
        return json({ error: "Nabídka už není k rozhodnutí." }, 409);
      }
      const nextStatus = action === "approve" ? "approved" : "rejected";
      const { error: updErr } = await svc
        .from("tickets")
        .update({
          quote_status: nextStatus,
          quote_decided_at: new Date().toISOString(),
          quote_decision_meta: meta,
        })
        .eq("id", ticket.id)
        .eq("quote_status", "sent"); // ochrana před dvojklikem / souběhem
      if (updErr) {
        console.error("[portal-ticket] quote update error:", updErr);
        return json({ error: "Nepodařilo se uložit rozhodnutí." }, 500);
      }
      await insertEvent(svc, ticket, action === "approve" ? "quote_approved" : "quote_rejected", meta);
    } else if (action === "sign") {
      if (ticket.intake_signed_at) {
        return json({ error: "Převzetí už bylo podepsáno." }, 409);
      }
      const bytes = decodePngDataUrl(body.signature);
      if (!bytes) {
        return json({ error: "Podpis musí být PNG do 300 kB." }, 400);
      }
      const path = `signatures/${ticket.id}-${Date.now()}.png`;
      const { error: uploadErr } = await svc.storage
        .from(BUCKET)
        .upload(path, bytes, { contentType: "image/png", upsert: false });
      if (uploadErr) {
        console.error("[portal-ticket] signature upload error:", uploadErr);
        return json({ error: "Nepodařilo se uložit podpis." }, 500);
      }
      const { data: urlData } = svc.storage.from(BUCKET).getPublicUrl(path);
      const signedAt = new Date().toISOString();
      const { error: updErr } = await svc
        .from("tickets")
        .update({ intake_signature_url: urlData.publicUrl, intake_signed_at: signedAt })
        .eq("id", ticket.id)
        .is("intake_signed_at", null);
      if (updErr) {
        console.error("[portal-ticket] signature update error:", updErr);
        return json({ error: "Nepodařilo se uložit podpis." }, 500);
      }
      await insertEvent(svc, ticket, "signed", { ...meta, url: urlData.publicUrl });
    } else if (action === "pickup") {
      await insertEvent(svc, ticket, "pickup_confirmed", meta);
    }

    const fresh = (await loadTicket(svc, token)) ?? ticket;
    return json(await buildPayload(svc, fresh));
  } catch (error) {
    console.error("[portal-ticket] error:", error);
    return json({ error: (error as Error)?.message || "Nastala chyba." }, 500);
  }
});
