/**
 * Edge Function: sms-provision
 * Provision a Twilio phone number for a service (SMS + voice). Requires owner/admin.
 * POST body: { service_id: string, forwarding_number?: string }
 *
 * Number assignment strategy (automatic):
 *   1. If service already has a number → return it.
 *   2. If an existing CZ number has capacity (< SMS_POOL_MAX_SERVICES, default 20) → join that pool.
 *   3. Otherwise → purchase a new number from Twilio (CZ first, US fallback).
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

    // Nárok na modul SMS. Zřízení čísla stojí peníze u Twilia, takže tady
    // je kontrola dvojnásob na místě – bez ní by si vlastník kteréhokoli
    // servisu mohl nechat zřídit číslo, aniž by modul měl zaplacený.
    const { data: hasSms, error: entErr } = await svc.rpc("has_entitlement", {
      p_service_id: serviceId,
      p_module: "sms",
    });
    if (entErr || hasSms !== true) {
      return new Response(
        JSON.stringify({
          error: "Modul SMS není pro tento servis aktivní.",
          detail: entErr?.message ?? "Chybí platný nárok na modul sms.",
        }),
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

    // ---- Auto pool: join existing CZ number if capacity available ----
    // Env var SMS_POOL_MAX_SERVICES controls max services per shared number (default 20).
    const poolMax = parseInt(Deno.env.get("SMS_POOL_MAX_SERVICES") ?? "20");

    const { data: czRows } = await svc
      .from("service_phone_numbers")
      .select("twilio_number, twilio_sid")
      .eq("active", true)
      .eq("country_code", "CZ");

    if (czRows && czRows.length > 0) {
      // Count services per number
      const counts: Record<string, { twilio_number: string; twilio_sid: string | null; count: number }> = {};
      for (const row of czRows as { twilio_number: string; twilio_sid: string | null }[]) {
        const n = row.twilio_number;
        if (!counts[n]) counts[n] = { twilio_number: n, twilio_sid: row.twilio_sid ?? null, count: 0 };
        counts[n].count++;
      }
      // Pick the most-filled pool that still has capacity (pack existing pools first)
      const available = Object.values(counts)
        .filter((c) => c.count < poolMax)
        .sort((a, b) => b.count - a.count)[0];

      if (available) {
        const { error: insertErr } = await svc.from("service_phone_numbers").insert({
          service_id: serviceId,
          twilio_number: available.twilio_number,
          forwarding_number: forwardingNumber,
          twilio_sid: available.twilio_sid,
          active: true,
          country_code: "CZ",
          is_pool_primary: false,
        });

        if (insertErr) {
          return new Response(
            JSON.stringify({ error: "Failed to join number pool", detail: insertErr.message }),
            { status: 500, headers: jsonHeaders }
          );
        }

        return new Response(
          JSON.stringify({
            twilio_number: available.twilio_number,
            service_id: serviceId,
            country_code: "CZ",
            shared: true,
            pool_size: available.count + 1,
          }),
          { status: 200, headers: jsonHeaders }
        );
      }
    }

    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    if (!accountSid || !authToken) {
      return new Response(
        JSON.stringify({ error: "SMS provisioning not configured (missing Twilio credentials)" }),
        { status: 503, headers: jsonHeaders }
      );
    }
    const twilioAuth = twilioAuthHeader(accountSid, authToken);
    const functionsBase = `${supabaseUrl.replace(/\/$/, "")}/functions/v1`;
    const smsUrl = `${functionsBase}/sms-incoming`;
    const voiceUrl = `${functionsBase}/sms-voice`;

    // ---- Use already-owned Twilio +420 number (e.g. bought manually in Console) ----
    // DB pool above only sees numbers already in service_phone_numbers; manual CZ buys are invisible there,
    // which previously led to "purchase" and US fallback when CZ catalog was empty.
    let pageUri: string | null = `${TWILIO_BASE}/Accounts/${accountSid}/IncomingPhoneNumbers.json?PageSize=100`;
    const ownedCz: { phone_number: string; sid: string }[] = [];
    while (pageUri) {
      const listOwned = await fetch(pageUri, { headers: { Authorization: twilioAuth } });
      if (!listOwned.ok) break;
      const ownedJson = await listOwned.json();
      for (const inn of ownedJson.incoming_phone_numbers ?? []) {
        const pn = inn.phone_number as string;
        if (pn?.startsWith("+420")) ownedCz.push({ phone_number: pn, sid: inn.sid as string });
      }
      const next = ownedJson.next_page_uri as string | null;
      pageUri = next ? (next.startsWith("http") ? next : `https://api.twilio.com${next}`) : null;
    }
    if (ownedCz.length > 0) {
      const byNumber = new Map<string, { sid: string; count: number }>();
      for (const o of ownedCz) {
        if (!byNumber.has(o.phone_number)) byNumber.set(o.phone_number, { sid: o.sid, count: 0 });
      }
      const { data: countRows } = await svc
        .from("service_phone_numbers")
        .select("twilio_number")
        .eq("active", true);
      for (const row of countRows ?? []) {
        const e = byNumber.get(row.twilio_number as string);
        if (e) e.count++;
      }
      const ownedCandidates = [...byNumber.entries()]
        .filter(([, v]) => v.count < poolMax)
        .sort((a, b) => b[1].count - a[1].count);
      if (ownedCandidates.length > 0) {
        const [twilioNumber, { sid, count: _c }] = ownedCandidates[0];
        const { count: liveCount } = await svc
          .from("service_phone_numbers")
          .select("id", { count: "exact", head: true })
          .eq("twilio_number", twilioNumber)
          .eq("active", true);
        const count = liveCount ?? 0;
        if (count < poolMax) {
          const hookRes = await fetch(`${TWILIO_BASE}/Accounts/${accountSid}/IncomingPhoneNumbers/${sid}.json`, {
            method: "POST",
            headers: {
              Authorization: twilioAuth,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              SmsUrl: smsUrl,
              SmsMethod: "POST",
              VoiceUrl: voiceUrl,
              VoiceMethod: "POST",
            }).toString(),
          });
          if (!hookRes.ok) {
            const errText = await hookRes.text();
            return new Response(
              JSON.stringify({
                error: "Could not point your Czech Twilio number to Jobi webhooks",
                detail: errText.slice(0, 500),
              }),
              { status: 502, headers: jsonHeaders }
            );
          }
          const { error: insertOwnedErr } = await svc.from("service_phone_numbers").insert({
            service_id: serviceId,
            twilio_number: twilioNumber,
            forwarding_number: forwardingNumber,
            twilio_sid: sid,
            active: true,
            country_code: "CZ",
            is_pool_primary: count === 0,
          });
          if (insertOwnedErr) {
            return new Response(
              JSON.stringify({ error: "Failed to assign owned CZ number", detail: insertOwnedErr.message }),
              { status: 500, headers: jsonHeaders }
            );
          }
          return new Response(
            JSON.stringify({
              twilio_number: twilioNumber,
              service_id: serviceId,
              country_code: "CZ",
              shared: count > 0,
              pool_size: count + 1,
              from_owned_twilio: true,
            }),
            { status: 200, headers: jsonHeaders }
          );
        }
      }
    }

    // ---- Purchase new number ----
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
          headers: { Authorization: twilioAuth },
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
        Authorization: twilioAuth,
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
      is_pool_primary: true,
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
