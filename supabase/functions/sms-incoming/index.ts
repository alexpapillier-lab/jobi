/**
 * Edge Function: sms-incoming
 * Twilio webhook for incoming SMS. Validates signature, finds service by To, stores message, returns TwiML.
 *
 * Signature: Twilio signs the exact public URL they POST to. Supabase proxy / forwarded headers
 * can differ from SUPABASE_URL — we try several URL candidates (worked before when only one matched).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>';
const TWIML_HEADERS = { "Content-Type": "text/xml; charset=utf-8" };

function normalizeE164(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 9 && /^[5-9]/.test(digits)) return `+420${digits}`;
  if (digits.length === 10 && digits.startsWith("0") && /^0[79]/.test(digits)) return `+420${digits.slice(1)}`;
  if (digits.startsWith("420") && digits.length === 12) return `+${digits}`;
  if (digits.length >= 9 && !phone.trim().startsWith("+")) return `+${digits}`;
  return phone.trim().startsWith("+") ? `+${digits}` : `+${digits}`;
}

/** Normalize Twilio "To" (our number) to match service_phone_numbers.twilio_number */
function normalizeOurNumber(to: string): string {
  return normalizeE164(to.trim());
}

function webhookUrlCandidates(req: Request): string[] {
  const out: string[] = [];
  const extra = Deno.env.get("TWILIO_SMS_WEBHOOK_URL")?.replace(/\/$/, "").trim();
  if (extra) {
    out.push(extra);
    out.push(`${extra}/`);
  }
  const base = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "") ?? "";
  if (base) {
    out.push(`${base}/functions/v1/sms-incoming`);
    out.push(`${base}/functions/v1/sms-incoming/`);
  }
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "")
    .split(",")[0]
    .trim();
  const proto = (req.headers.get("x-forwarded-proto") ?? "https").split(",")[0].trim() || "https";
  if (host && !host.startsWith("127.") && host !== "localhost") {
    out.push(`${proto}://${host}/functions/v1/sms-incoming`);
    out.push(`${proto}://${host}/functions/v1/sms-incoming/`);
  }
  try {
    const u = new URL(req.url);
    if (u.hostname && u.hostname.length > 4 && u.pathname.includes("sms-incoming")) {
      const path = u.pathname.replace(/\/$/, "") || "/functions/v1/sms-incoming";
      out.push(`${u.protocol}//${u.host}${path}`);
    }
  } catch {
    /* ignore */
  }
  return [...new Set(out)];
}

async function validateTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>
): Promise<boolean> {
  const sortedKeys = Object.keys(params).sort();
  const data = url + sortedKeys.map((k) => k + params[k]).join("");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  const computed = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return computed === signature;
}

async function signatureValid(
  authToken: string,
  signature: string,
  params: Record<string, string>,
  req: Request
): Promise<boolean> {
  if (!signature) return false;
  for (const url of webhookUrlCandidates(req)) {
    try {
      if (await validateTwilioSignature(authToken, signature, url, params)) return true;
    } catch {
      /* next candidate */
    }
  }
  console.error(
    "[sms-incoming] Twilio signature rejected for all URL candidates. Set TWILIO_SMS_WEBHOOK_URL in Edge secrets to the exact webhook URL from Twilio Console."
  );
  return false;
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(EMPTY_TWIML, { status: 200, headers: TWIML_HEADERS });
  }

  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  if (!authToken) {
    return new Response(EMPTY_TWIML, { status: 200, headers: TWIML_HEADERS });
  }

  let bodyText: string;
  try {
    bodyText = await req.text();
  } catch {
    return new Response(EMPTY_TWIML, { status: 200, headers: TWIML_HEADERS });
  }

  const params: Record<string, string> = {};
  new URLSearchParams(bodyText).forEach((value, key) => {
    params[key] = value;
  });

  const signature = req.headers.get("X-Twilio-Signature") ?? "";
  const valid = await signatureValid(authToken, signature, params, req);
  if (!valid) {
    return new Response("Unauthorized", { status: 403 });
  }

  const toRaw = params.To?.trim() ?? "";
  const from = params.From?.trim();
  const messageBody = params.Body ?? "";
  const messageSid = params.MessageSid?.trim();
  const numMedia = params.NumMedia?.trim();

  if (numMedia && numMedia !== "0") {
    console.log("Incoming SMS has media, NumMedia:", numMedia);
  }

  if (!toRaw || !from) {
    return new Response(EMPTY_TWIML, { status: 200, headers: TWIML_HEADERS });
  }

  const toNorm = normalizeOurNumber(toRaw);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const svc = createClient(supabaseUrl, serviceKey);

  let phoneRows =
    (
      await svc
        .from("service_phone_numbers")
        .select("service_id, is_pool_primary, twilio_number")
        .eq("twilio_number", toRaw)
        .eq("active", true)
    ).data ?? [];

  if (phoneRows.length === 0 && toNorm !== toRaw) {
    const { data } = await svc
      .from("service_phone_numbers")
      .select("service_id, is_pool_primary, twilio_number")
      .eq("twilio_number", toNorm)
      .eq("active", true);
    phoneRows = data ?? [];
  }

  if (phoneRows.length === 0) {
    const { data: allNums, error: listErr } = await svc
      .from("service_phone_numbers")
      .select("service_id, is_pool_primary, twilio_number")
      .eq("active", true);
    if (!listErr && allNums?.length) {
      const wantA = toNorm.replace(/\D/g, "");
      const wantB = toRaw.replace(/\D/g, "");
      phoneRows = allNums.filter((r: { twilio_number: string }) => {
        const d = (r.twilio_number || "").replace(/\D/g, "");
        return d === wantA || d === wantB;
      }) as typeof phoneRows;
    }
  }

  if (phoneRows.length === 0) {
    console.error("[sms-incoming] No service_phone_numbers for To=", toRaw, "normalized=", toNorm);
    return new Response(EMPTY_TWIML, { status: 200, headers: TWIML_HEADERS });
  }

  const fromNorm = normalizeE164(from);
  const fromDigits = fromNorm.replace(/\D/g, "");

  function phoneMatchesTicket(raw: string | null): boolean {
    if (!raw?.trim()) return false;
    const tp = normalizeE164(raw);
    const td = tp.replace(/\D/g, "");
    if (tp === fromNorm || td === fromDigits) return true;
    if (fromDigits.length >= 9 && td.length >= 9 && (td.endsWith(fromDigits.slice(-9)) || fromDigits.endsWith(td.slice(-9)))) {
      return true;
    }
    return false;
  }

  let serviceId: string;
  if (phoneRows.length === 1) {
    serviceId = phoneRows[0].service_id;
  } else {
    const serviceIds = phoneRows.map((r: { service_id: string }) => r.service_id);
    const { data: existingConvs } = await svc
      .from("sms_conversations")
      .select("service_id, updated_at")
      .in("service_id", serviceIds)
      .eq("customer_phone", fromNorm)
      .order("updated_at", { ascending: false })
      .limit(1);

    if (existingConvs && existingConvs.length > 0) {
      serviceId = existingConvs[0].service_id;
    } else {
      const { data: tix } = await svc
        .from("tickets")
        .select("service_id, customer_phone, updated_at")
        .in("service_id", serviceIds)
        .is("deleted_at", null)
        .not("customer_phone", "is", null)
        .order("updated_at", { ascending: false })
        .limit(1000);

      let ticketService: string | null = null;
      for (const t of tix ?? []) {
        const row = t as { service_id: string; customer_phone: string | null };
        if (phoneMatchesTicket(row.customer_phone)) {
          ticketService = row.service_id;
          break;
        }
      }

      if (ticketService && serviceIds.includes(ticketService)) {
        serviceId = ticketService;
      } else {
        const { data: custRows } = await svc
          .from("customers")
          .select("service_id, updated_at")
          .in("service_id", serviceIds)
          .eq("phone_norm", fromNorm)
          .order("updated_at", { ascending: false })
          .limit(5);

        if (custRows && custRows.length > 0) {
          serviceId = (custRows[0] as { service_id: string }).service_id;
        } else {
          const primary = phoneRows.find((r: { is_pool_primary: boolean }) => r.is_pool_primary);
          serviceId = (primary ?? phoneRows[0]).service_id;
        }
      }
    }
  }

  if (messageSid) {
    const { data: existing } = await svc
      .from("sms_messages")
      .select("id")
      .eq("twilio_sid", messageSid)
      .maybeSingle();
    if (existing) {
      return new Response(EMPTY_TWIML, { status: 200, headers: TWIML_HEADERS });
    }
  }

  let customerName: string | null = null;
  const { data: customer } = await svc
    .from("customers")
    .select("name")
    .eq("service_id", serviceId)
    .eq("phone_norm", fromNorm)
    .maybeSingle();
  if (customer?.name) customerName = customer.name;

  let conversationId: string;

  const { data: existingConv } = await svc
    .from("sms_conversations")
    .select("id, ticket_id")
    .eq("service_id", serviceId)
    .eq("customer_phone", fromNorm)
    .maybeSingle();

  if (existingConv) {
    conversationId = existingConv.id;
    const ticketId = existingConv.ticket_id;
    if (!ticketId) {
      const byPhone = await svc
        .from("tickets")
        .select("id")
        .eq("service_id", serviceId)
        .eq("customer_phone", fromNorm)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const openId = byPhone.data?.id ?? null;
      if (openId) {
        await svc.from("sms_conversations").update({ ticket_id: openId }).eq("id", conversationId);
      }
    }
  } else {
    const byPhone = await svc
      .from("tickets")
      .select("id")
      .eq("service_id", serviceId)
      .eq("customer_phone", fromNorm)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const ticketIdToSet = byPhone.data?.id ?? null;

    const { data: newConv, error: insertConvErr } = await svc
      .from("sms_conversations")
      .insert({
        service_id: serviceId,
        customer_phone: fromNorm,
        customer_name: customerName,
        ticket_id: ticketIdToSet,
      })
      .select("id")
      .single();

    if (insertConvErr || !newConv) {
      console.error("[sms-incoming] conversation insert failed:", insertConvErr?.message);
      return new Response(EMPTY_TWIML, { status: 200, headers: TWIML_HEADERS });
    }
    conversationId = newConv.id;
  }

  const { error: msgErr } = await svc.from("sms_messages").insert({
    conversation_id: conversationId,
    direction: "inbound",
    body: messageBody,
    twilio_sid: messageSid || null,
  });

  if (msgErr) {
    console.error("[sms-incoming] sms_messages insert failed:", msgErr.message);
  }

  return new Response(EMPTY_TWIML, { status: 200, headers: TWIML_HEADERS });
});
