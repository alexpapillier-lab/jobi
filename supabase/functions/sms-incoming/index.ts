/**
 * Edge Function: sms-incoming
 * Twilio webhook for incoming SMS. Validates signature, finds service by To, stores message, returns TwiML.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>';
const TWIML_HEADERS = { "Content-Type": "text/xml; charset=utf-8" };

function normalizeE164(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 9 && digits.startsWith("9")) return `+420${digits}`;
  if (digits.length >= 9 && !phone.startsWith("+")) return `+${digits}`;
  return phone.startsWith("+") ? phone : `+${phone}`;
}

/** Validate X-Twilio-Signature using HMAC-SHA1 over url + sorted params (name+value). */
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
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data)
  );
  const computed = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return computed === signature;
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
  const baseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "") ?? "";
  const webhookUrl = `${baseUrl}/functions/v1/sms-incoming`;

  const valid = await validateTwilioSignature(authToken, signature, webhookUrl, params);
  if (!valid) {
    return new Response("Unauthorized", { status: 403 });
  }

  const to = params.To?.trim();
  const from = params.From?.trim();
  const messageBody = params.Body ?? "";
  const messageSid = params.MessageSid?.trim();
  const numMedia = params.NumMedia?.trim();

  if (numMedia && numMedia !== "0") {
    console.log("Incoming SMS has media, NumMedia:", numMedia);
  }

  if (!to || !from) {
    return new Response(EMPTY_TWIML, { status: 200, headers: TWIML_HEADERS });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const svc = createClient(supabaseUrl, serviceKey);

  const { data: phoneRow, error: phoneErr } = await svc
    .from("service_phone_numbers")
    .select("service_id")
    .eq("twilio_number", to)
    .eq("active", true)
    .maybeSingle();

  if (phoneErr || !phoneRow) {
    return new Response(EMPTY_TWIML, { status: 200, headers: TWIML_HEADERS });
  }

  const serviceId = phoneRow.service_id;
  const fromNorm = normalizeE164(from);

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
  let ticketId: string | null = null;

  const { data: existingConv } = await svc
    .from("sms_conversations")
    .select("id, ticket_id")
    .eq("service_id", serviceId)
    .eq("customer_phone", fromNorm)
    .maybeSingle();

  if (existingConv) {
    conversationId = existingConv.id;
    ticketId = existingConv.ticket_id;
    if (!ticketId) {
      const byPhone = await svc.from("tickets").select("id").eq("service_id", serviceId).eq("customer_phone", fromNorm).is("deleted_at", null).order("updated_at", { ascending: false }).limit(1).maybeSingle();
      const openId = byPhone.data?.id ?? null;
      if (openId) {
        await svc.from("sms_conversations").update({ ticket_id: openId }).eq("id", conversationId);
      }
    }
  } else {
    const byPhone = await svc.from("tickets").select("id").eq("service_id", serviceId).eq("customer_phone", fromNorm).is("deleted_at", null).order("updated_at", { ascending: false }).limit(1).maybeSingle();
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
      return new Response(EMPTY_TWIML, { status: 200, headers: TWIML_HEADERS });
    }
    conversationId = newConv.id;
  }

  await svc.from("sms_messages").insert({
    conversation_id: conversationId,
    direction: "inbound",
    body: messageBody,
    twilio_sid: messageSid || null,
  });

  return new Response(EMPTY_TWIML, { status: 200, headers: TWIML_HEADERS });
});
