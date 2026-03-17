/**
 * Edge Function: sms-provision
 * Provision a Twilio phone number for a service (SMS + voice). Requires owner/admin or service_role.
 * POST body: { service_id: string, forwarding_number?: string }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TWILIO_BASE = "https://api.twilio.com/2010-04-01";

function twilioAuthHeader(accountSid: string, authToken: string): string {
  const encoded = btoa(`${accountSid}:${authToken}`);
  return `Basic ${encoded}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

  try {
    const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid authorization header" }),
        { status: 401, headers: jsonHeaders }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes?.user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", detail: userErr?.message }),
        { status: 401, headers: jsonHeaders }
      );
    }
    const userId = userRes.user.id;

    const body = await req.json().catch(() => ({}));
    const serviceId = body?.service_id?.trim?.();
    const forwardingNumber = body?.forwarding_number?.trim?.() || null;

    if (!serviceId) {
      return new Response(
        JSON.stringify({ error: "Missing required field: service_id" }),
        { status: 400, headers: jsonHeaders }
      );
    }

    const svc = createClient(supabaseUrl, serviceKey);

    // Authorize: caller must be owner or admin of the service
    const { data: membership, error: memErr } = await svc
      .from("service_memberships")
      .select("role")
      .eq("service_id", serviceId)
      .eq("user_id", userId)
      .single();

    if (memErr || !membership) {
      return new Response(
        JSON.stringify({ error: "Not a member of this service" }),
        { status: 403, headers: jsonHeaders }
      );
    }
    if (membership.role !== "owner" && membership.role !== "admin") {
      return new Response(
        JSON.stringify({ error: "Only owner or admin can provision SMS" }),
        { status: 403, headers: jsonHeaders }
      );
    }

    // Already provisioned?
    const { data: existing, error: existingErr } = await svc
      .from("service_phone_numbers")
      .select("id, twilio_number, service_id, country_code")
      .eq("service_id", serviceId)
      .maybeSingle();

    if (existingErr) {
      return new Response(
        JSON.stringify({ error: "Failed to check existing number", detail: existingErr.message }),
        { status: 500, headers: jsonHeaders }
      );
    }
    if (existing) {
      const existingRow = existing as { twilio_number: string; service_id: string; country_code?: string };
      return new Response(
        JSON.stringify({
          twilio_number: existingRow.twilio_number,
          service_id: existingRow.service_id,
          country_code: existingRow.country_code ?? "CZ",
          already_existed: true,
        }),
        { status: 200, headers: jsonHeaders }
      );
    }

    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    if (!accountSid || !authToken) {
      return new Response(
        JSON.stringify({ error: "SMS provisioning not configured (missing Twilio credentials)" }),
        { status: 503, headers: jsonHeaders }
      );
    }

    const functionsBase = `${supabaseUrl.replace(/\/$/, "")}/functions/v1`;
    const smsUrl = `${functionsBase}/sms-incoming`;
    const voiceUrl = `${functionsBase}/sms-voice`;
    const auth = twilioAuthHeader(accountSid, authToken);

    // Fetch available numbers: CZ (Local, Mobile) first, then US (Local, Mobile) as fallback
    const countryTypes: { country: string; types: ("Local" | "Mobile")[] }[] = [
      { country: "CZ", types: ["Local", "Mobile"] },
      { country: "US", types: ["Local", "Mobile"] },
    ];
    let phoneNumber: string | null = null;
    let countryCode = "CZ";
    for (const { country, types } of countryTypes) {
      for (const type of types) {
        const listUrl = `${TWILIO_BASE}/Accounts/${accountSid}/AvailablePhoneNumbers/${country}/${type}.json?SmsEnabled=true&VoiceEnabled=true`;
        const listRes = await fetch(listUrl, {
          method: "GET",
          headers: { Authorization: auth },
        });
        if (!listRes.ok) {
          const errText = await listRes.text();
          return new Response(
            JSON.stringify({
              error: `Twilio API error (available ${country} ${type} numbers)`,
              detail: errText.slice(0, 500),
            }),
            { status: 502, headers: jsonHeaders }
          );
        }
        const listData = await listRes.json();
        const available = listData?.available_phone_numbers;
        if (Array.isArray(available) && available.length > 0) {
          phoneNumber = available[0].phone_number;
          countryCode = country;
          break;
        }
      }
      if (phoneNumber) break;
    }
    if (!phoneNumber) {
      return new Response(
        JSON.stringify({ error: "No available phone numbers (tried CZ and US)" }),
        { status: 503, headers: jsonHeaders }
      );
    }

    // Purchase the number and set webhooks
    const buyUrl = `${TWILIO_BASE}/Accounts/${accountSid}/IncomingPhoneNumbers.json`;
    const buyBody = new URLSearchParams({
      PhoneNumber: phoneNumber,
      SmsUrl: smsUrl,
      SmsMethod: "POST",
      VoiceUrl: voiceUrl,
      VoiceMethod: "POST",
    });

    const buyRes = await fetch(buyUrl, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: buyBody.toString(),
    });

    if (!buyRes.ok) {
      const errText = await buyRes.text();
      return new Response(
        JSON.stringify({
          error: "Twilio API error (purchase number)",
          detail: errText.slice(0, 500),
        }),
        { status: 502, headers: jsonHeaders }
      );
    }

    const buyData = await buyRes.json();
    const sid = buyData?.sid ?? null;
    const twilioNumber = buyData?.phone_number ?? phoneNumber;

    const { error: insertErr } = await svc.from("service_phone_numbers").insert({
      service_id: serviceId,
      twilio_number: twilioNumber,
      forwarding_number: forwardingNumber,
      twilio_sid: sid,
      active: true,
      country_code: countryCode,
    });

    if (insertErr) {
      return new Response(
        JSON.stringify({
          error: "Number purchased but failed to save. Contact support.",
          detail: insertErr.message,
        }),
        { status: 500, headers: jsonHeaders }
      );
    }

    return new Response(
      JSON.stringify({ twilio_number: twilioNumber, service_id: serviceId, country_code: countryCode }),
      { status: 200, headers: jsonHeaders }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "Internal error", detail: String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
