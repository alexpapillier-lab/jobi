import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function generateToken(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let token = "";
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return new Response(
        JSON.stringify({ error: "Invalid authorization header format" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes?.user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", detail: userErr?.message }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const userId = userRes.user.id;

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const svc = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const { serviceId, email, role, mode = "current", serviceName } = body;

    const modeNorm = (mode || "current").trim().toLowerCase();
    if (modeNorm !== "current" && modeNorm !== "stock") {
      return new Response(
        JSON.stringify({ error: "Invalid mode. Must be 'current' or 'stock'" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (modeNorm === "current") {
      if (!serviceId) {
        return new Response(
          JSON.stringify({ error: "Missing required field: serviceId (required for mode='current')" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (!email || !role) {
        return new Response(
          JSON.stringify({ error: "Missing required fields: email, role" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else {
      const emailTrim = email ? String(email).trim() : "";
      const hasEmail = emailTrim.length > 0;
      if (hasEmail && !role) {
        return new Response(
          JSON.stringify({ error: "Missing required field: role (required when email is provided)" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    let roleNorm: string | null = null;
    if (role) {
      roleNorm = role.trim().toLowerCase();
      if (!["owner", "admin", "member"].includes(roleNorm)) {
        return new Response(
          JSON.stringify({ error: "Invalid role. Must be owner, admin, or member" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const emailTrim = email ? String(email).trim() : "";
    const hasEmail = emailTrim.length > 0;
    const willCreateInvite = hasEmail && roleNorm !== null;

    let targetServiceId: string;

    if (modeNorm === "stock") {
      const rootOwnerId = Deno.env.get("ROOT_OWNER_ID")?.trim() || null;
      const isRootOwner = !!rootOwnerId && userId.toLowerCase() === rootOwnerId.toLowerCase();

      if (!isRootOwner) {
        return new Response(
          JSON.stringify({ error: "Pouze majitel aplikace může vytvářet nové servisy" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: newService, error: serviceError } = await svc
        .from("services")
        .insert({ name: serviceName?.trim() || "Stock service" })
        .select("id")
        .single();

      if (serviceError || !newService) {
        return new Response(
          JSON.stringify({ error: `Failed to create service: ${serviceError?.message || "Unknown error"}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      targetServiceId = newService.id;

      // Vždy přidat tvůrce servisu jako ownera (včetně root ownera), aby mohl servis používat (statusy, RLS, Tým/Kontakt v Nastavení).
      const { error: membershipError } = await svc
        .from("service_memberships")
        .upsert(
          { service_id: targetServiceId, user_id: userId, role: "owner" },
          { onConflict: "service_id,user_id" }
        );
      if (membershipError) {
        return new Response(
          JSON.stringify({ error: `Failed to create membership: ${membershipError.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!willCreateInvite) {
        return new Response(
          JSON.stringify({ service_id: targetServiceId, created_service: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else {
      if (!serviceId) {
        return new Response(
          JSON.stringify({ error: "Missing required field: serviceId (required for mode='current')" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const rootOwnerIdCurrent = Deno.env.get("ROOT_OWNER_ID")?.trim() || null;
      const isRootOwnerCurrent = !!rootOwnerIdCurrent && userId.toLowerCase() === rootOwnerIdCurrent.toLowerCase();

      if (!isRootOwnerCurrent) {
        const { data: membership, error: membershipError } = await svc
          .from("service_memberships")
          .select("role")
          .eq("service_id", serviceId)
          .eq("user_id", userId)
          .single();

        if (membershipError || !membership) {
          return new Response(
            JSON.stringify({ error: "User is not a member of this service" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        if (membership.role !== "owner" && membership.role !== "admin") {
          return new Response(
            JSON.stringify({ error: "User must be owner or admin to create invites" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      targetServiceId = serviceId;
    }

    const inviteToken = generateToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 14);
    const expiresAtISO = expiresAt.toISOString();

    const { data: invite, error: inviteError } = await svc
      .from("service_invites")
      .upsert(
        {
          service_id: targetServiceId,
          email: emailTrim.toLowerCase(),
          role: roleNorm!,
          invited_by: userId,
          token: inviteToken,
          expires_at: expiresAtISO,
          accepted_at: null,
          accepted_by: null,
        },
        { onConflict: "service_id,email" }
      )
      .select()
      .single();

    if (inviteError) {
      return new Response(
        JSON.stringify({ error: `Failed to create invite: ${inviteError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let serviceNameForEmail = "Servis";
    const { data: serviceRow } = await svc.from("services").select("name").eq("id", targetServiceId).maybeSingle();
    if (serviceRow?.name) serviceNameForEmail = serviceRow.name;

    let emailSent = false;
    let emailError: string | null = null;
    let emailSkippedReason: string | null = null;

    const resendKey = Deno.env.get("RESEND_API_KEY")?.trim();
    if (!resendKey && emailTrim) {
      emailSkippedReason = "RESEND_API_KEY není nastaven v Supabase (Edge Functions → Secrets)";
    }
    if (resendKey && emailTrim) {
      try {
        const escapeHtml = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
        const safeName = escapeHtml(serviceNameForEmail || "Servis");
        const safeToken = escapeHtml(inviteToken);
        const textBody = `Pozvánka do servisu: ${serviceNameForEmail}\n\nV aplikaci Jobi při registraci zadej tento kód:\n\n${inviteToken}\n\nKód platí 14 dní.`;
        const htmlBody = [
          "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"></head>",
          "<body style=\"margin:0;padding:24px;font-family:system-ui,sans-serif;background:#eef0f4\">",
          "<div style=\"max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:24px;box-shadow:0 10px 30px rgba(0,0,0,0.1)\">",
          "<h1 style=\"margin:0 0 8px;font-size:20px;color:#1e1b4b\">Pozvánka do servisu</h1>",
          "<p style=\"margin:0 0 16px;color:#6b7280;font-size:14px\">" + safeName + "</p>",
          "<p style=\"margin:0 0 16px;color:#111;font-size:15px\">Při registraci v Jobi zadej níže uvedený kód.</p>",
          "<div style=\"background:rgba(37,99,235,0.08);border:2px solid rgba(37,99,235,0.25);border-radius:12px;padding:16px;text-align:center;margin:16px 0\">",
          "<p style=\"margin:0 0 4px;font-size:11px;color:#6b7280;text-transform:uppercase\">Kód z pozvánky</p>",
          "<p style=\"margin:0;font-family:monospace;font-size:18px;font-weight:700;letter-spacing:0.08em;color:#111\">" + safeToken + "</p>",
          "</div>",
          "<p style=\"margin:0;font-size:13px;color:#6b7280\">Kód platí 14 dní.</p>",
          "</div><p style=\"text-align:center;margin-top:16px;font-size:12px;color:#6b7280\">Jobi</p></body></html>",
        ].join("");
        const fromEmail = Deno.env.get("RESEND_FROM_EMAIL")?.trim() || "Jobi <onboarding@resend.dev>";
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
          body: JSON.stringify({
            from: fromEmail,
            to: [emailTrim],
            subject: `Pozvánka do servisu: ${serviceNameForEmail}`,
            text: textBody,
            html: htmlBody,
          }),
        });
        if (res.ok) emailSent = true;
        else {
          const resBody = await res.text();
          emailError = `Resend ${res.status}: ${resBody.slice(0, 200)}`;
        }
      } catch (e) {
        emailError = e instanceof Error ? e.message : String(e);
      }
    }

    const inviteLink = `jobsheet://invite?token=${inviteToken}`;
    return new Response(
      JSON.stringify({
        invite,
        token: inviteToken,
        inviteLink,
        service_id: targetServiceId,
        role: roleNorm!,
        email_sent: emailSent,
        ...(emailError && { email_error: emailError }),
        ...(emailSkippedReason && { email_skipped_reason: emailSkippedReason }),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
