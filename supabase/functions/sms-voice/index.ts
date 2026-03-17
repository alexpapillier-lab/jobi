/**
 * Edge Function: sms-voice
 * Twilio webhook for incoming voice calls. Forwards to forwarding_number or plays unavailable message.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TWIML_HEADERS = { "Content-Type": "text/xml; charset=utf-8" };

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

function twimlDial(forwardingNumber: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>${escapeXml(forwardingNumber)}</Dial>
</Response>`;
}

function twimlSayUnavailable(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="cs-CZ">Omlouváme se, tato služba není momentálně dostupná.</Say>
</Response>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(twimlSayUnavailable(), { status: 200, headers: TWIML_HEADERS });
  }

  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  if (!authToken) {
    return new Response(twimlSayUnavailable(), { status: 200, headers: TWIML_HEADERS });
  }

  let bodyText: string;
  try {
    bodyText = await req.text();
  } catch {
    return new Response(twimlSayUnavailable(), { status: 200, headers: TWIML_HEADERS });
  }

  const params: Record<string, string> = {};
  new URLSearchParams(bodyText).forEach((value, key) => {
    params[key] = value;
  });

  const signature = req.headers.get("X-Twilio-Signature") ?? "";
  const baseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "") ?? "";
  const webhookUrl = `${baseUrl}/functions/v1/sms-voice`;

  const valid = await validateTwilioSignature(authToken, signature, webhookUrl, params);
  if (!valid) {
    return new Response("Unauthorized", { status: 403 });
  }

  const to = params.To?.trim();
  if (!to) {
    return new Response(twimlSayUnavailable(), { status: 200, headers: TWIML_HEADERS });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const svc = createClient(supabaseUrl, serviceKey);

  const { data: phoneRow } = await svc
    .from("service_phone_numbers")
    .select("forwarding_number")
    .eq("twilio_number", to)
    .eq("active", true)
    .maybeSingle();

  const forwarding = phoneRow?.forwarding_number?.trim();
  const xml = forwarding ? twimlDial(forwarding) : twimlSayUnavailable();
  return new Response(xml, { status: 200, headers: TWIML_HEADERS });
});
