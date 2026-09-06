/**
 * Edge Function: sms-send
 * Send an SMS via Twilio. Caller must be a member of the service.
 * POST body: { service_id, to (E.164), body, ticket_id? }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMS_MAX_BODY_LENGTH, normalizeE164, segmentu, textProSms, zkontrolujBalicek, type SmsKlient } from "../_shared/sms.ts";

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

    const body = await req.json().catch(() => ({}));
    const serviceId = body?.service_id?.trim?.();
    let to = body?.to?.trim?.();
    const messageBody = body?.body;
    const ticketId = body?.ticket_id?.trim?.() || null;
    const customerName =
      typeof body?.customer_name === "string" ? body.customer_name.trim().slice(0, 200) || null : null;

    if (!serviceId || !to) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: service_id, to" }),
        { status: 400, headers: jsonHeaders }
      );
    }
    if (messageBody == null || typeof messageBody !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing or invalid field: body" }),
        { status: 400, headers: jsonHeaders }
      );
    }
    if (messageBody.length > SMS_MAX_BODY_LENGTH) {
      return new Response(
        JSON.stringify({ error: "Message too long (max 1600 characters)" }),
        { status: 400, headers: jsonHeaders }
      );
    }

    to = normalizeE164(to);

    // Check membership the same way the client does: can the user see service_phone_numbers for this service?
    // (RLS on service_phone_numbers requires membership, so this is consistent with the app.)
    const { data: phoneRow, error: phoneErr } = await userClient
      .from("service_phone_numbers")
      .select("id, twilio_number")
      .eq("service_id", serviceId)
      .eq("active", true)
      .maybeSingle();

    if (phoneErr || !phoneRow) {
      return new Response(
        JSON.stringify({
          error: "SMS not activated or no access to this service",
          detail: phoneErr?.message ?? "Ensure SMS is enabled and you are a member of the service.",
        }),
        { status: 403, headers: jsonHeaders }
      );
    }

    const svc = createClient(supabaseUrl, serviceKey);

    // Nárok na modul SMS. Kontrola členství výš nestačí – schování modulu
    // v UI obejde každý, kdo si otevře vývojářské nástroje a zavolá tuhle
    // funkci přímo. Placený modul se proto ověřuje tady, na serveru.
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

    /* Balíček SMS: kolik segmentů má servis na měsíc. Počítání i strop jsou
       v _shared/sms.ts, aby automatizace (automations-run) braly z téhož
       balíčku a stejně je počítaly – dřív šly mimo něj úplně. */
    const textProOdeslani = textProSms(messageBody);
    const potreba = segmentu(textProOdeslani);
    // Přetypování: _shared/sms.ts schválně nezná typy z esm.sh, aby se dal
    // v testu poslat i pár řádků místo celého klienta.
    const balicek = await zkontrolujBalicek(svc as unknown as SmsKlient, serviceId, potreba);
    if (balicek.prekroceno) {
      return new Response(
        JSON.stringify({
          error: balicek.zprava,
          quota_exceeded: true,
          used: balicek.spotrebovano,
          limit: balicek.limit,
        }),
        { status: 402, headers: jsonHeaders },
      );
    }

    // Find or create conversation
    let conversationId: string;
    const { data: existingConv } = await svc
      .from("sms_conversations")
      .select("id")
      .eq("service_id", serviceId)
      .eq("customer_phone", to)
      .maybeSingle();

    if (existingConv) {
      conversationId = existingConv.id;
      const updates: Record<string, unknown> = {};
      if (ticketId) updates.ticket_id = ticketId;
      if (customerName) {
        const { data: cn } = await svc.from("sms_conversations").select("customer_name").eq("id", conversationId).maybeSingle();
        if (cn && !(cn as { customer_name?: string }).customer_name?.trim()) {
          updates.customer_name = customerName;
        }
      }
      if (Object.keys(updates).length > 0) {
        await svc.from("sms_conversations").update(updates).eq("id", conversationId);
      }
    } else {
      const { data: newConv, error: insertConvErr } = await svc
        .from("sms_conversations")
        .insert({
          service_id: serviceId,
          customer_phone: to,
          ticket_id: ticketId,
          customer_name: customerName,
        })
        .select("id")
        .single();
      if (insertConvErr || !newConv) {
        return new Response(
          JSON.stringify({ error: "Failed to create conversation", detail: insertConvErr?.message }),
          { status: 500, headers: jsonHeaders }
        );
      }
      conversationId = newConv.id;
    }

    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    if (!accountSid || !authToken) {
      return new Response(
        JSON.stringify({ error: "SMS not configured" }),
        { status: 503, headers: jsonHeaders }
      );
    }

    const messagesUrl = `${TWILIO_BASE}/Accounts/${accountSid}/Messages.json`;
    const form = new URLSearchParams({
      From: phoneRow.twilio_number,
      To: to,
      Body: textProOdeslani,
    });

    const twilioRes = await fetch(messagesUrl, {
      method: "POST",
      headers: {
        Authorization: twilioAuthHeader(accountSid, authToken),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });

    const twilioData = await twilioRes.json().catch(() => ({}));

    if (!twilioRes.ok) {
      const code = twilioData?.code;
      const more = twilioData?.message ?? twilioData?.more_info ?? "";
      if (code === 21211) {
        return new Response(
          JSON.stringify({ error: "Invalid phone number", detail: more }),
          { status: 400, headers: jsonHeaders }
        );
      }
      const detail = twilioData?.message ?? twilioRes.statusText;
      let detailWithHint = detail;
      if (String(more).includes("current combination") && (String(more).includes("To") || String(more).includes("From"))) {
        const fromIsUs = /^\+?1\d/.test(phoneRow.twilio_number?.trim() ?? "");
        const toIsCz = to.startsWith("+420");
        if (fromIsUs && toIsCz) {
          detailWithHint = `${detail}\n\nPokud na jiná česká čísla odesílání funguje, problém může být u tohoto konkrétního čísla (opt-out, typ linky, operátor). Pokud nefunguje na žádné +420, potřebuješ české Twilio číslo (viz docs/SMS_TWILIO_SECRETS.md).`;
        }
      }
      return new Response(
        JSON.stringify({
          error: "Twilio error",
          detail: detailWithHint,
          code,
        }),
        { status: 502, headers: jsonHeaders }
      );
    }

    const twilioSid = twilioData?.sid ?? null;

    const { data: msgRow, error: msgErr } = await svc
      .from("sms_messages")
      .insert({
        conversation_id: conversationId,
        direction: "outbound",
        body: textProOdeslani,
        twilio_sid: twilioSid,
        status: twilioData?.status ?? null,
      })
      .select("id")
      .single();

    if (msgErr) {
      return new Response(
        JSON.stringify({
          error: "Message sent but failed to save locally",
          detail: msgErr.message,
          twilio_sid: twilioSid,
        }),
        { status: 500, headers: jsonHeaders }
      );
    }

    return new Response(
      JSON.stringify({
        message_id: msgRow.id,
        conversation_id: conversationId,
        twilio_sid: twilioSid,
      }),
      { status: 200, headers: jsonHeaders }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "Internal error", detail: String(e) }),
      { status: 500, headers: jsonHeaders }
    );
  }
});
