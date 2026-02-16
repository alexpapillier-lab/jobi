import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

// Generate URL-safe random token (min 20 characters)
function generateToken(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
  let token = ""
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return token
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    // Parse request body FIRST (before auth) for logging
    const body = await req.json()
    console.log("[invite-create] body", JSON.stringify(body, null, 2))

    // Get authorization header
    const authHeader = req.headers.get("Authorization") || req.headers.get("authorization")
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // Create user client with anon key and Authorization header
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userRes, error: userErr } = await userClient.auth.getUser()
    if (userErr || !userRes?.user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", detail: userErr?.message }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }
    const userId = userRes.user.id

    // Create service client for admin operations
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    const svc = createClient(supabaseUrl, serviceKey)

    // Extract from body
    const { serviceId, email, role, mode = "current", serviceName } = body

    // Validate mode
    const modeNorm = (mode || "current").trim().toLowerCase()
    if (modeNorm !== "current" && modeNorm !== "stock") {
      return new Response(
        JSON.stringify({ error: "Invalid mode. Must be 'current' or 'stock'" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // Validate required fields based on mode
    if (modeNorm === "current") {
      // Current mode: require serviceId, email, role
      if (!serviceId) {
        return new Response(
          JSON.stringify({ error: "Missing required field: serviceId (required for mode='current')" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        )
      }
      if (!email || !role) {
        return new Response(
          JSON.stringify({ error: "Missing required fields: email, role" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        )
      }
    } else {
      // Stock mode: serviceId not required, email and role only if creating invite
      const emailTrim = email ? String(email).trim() : ""
      const hasEmail = emailTrim.length > 0
      if (hasEmail && !role) {
        return new Response(
          JSON.stringify({ error: "Missing required field: role (required when email is provided)" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        )
      }
    }

    // Normalize role (only if provided)
    let roleNorm: string | null = null
    if (role) {
      roleNorm = role.trim().toLowerCase()
      if (!["owner", "admin", "member"].includes(roleNorm)) {
        return new Response(
          JSON.stringify({ error: "Invalid role. Must be owner, admin, or member" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        )
      }
    }

    const emailTrim = email ? String(email).trim() : ""
    const hasEmail = emailTrim.length > 0
    const willCreateInvite = hasEmail && roleNorm !== null

    let targetServiceId: string

    if (modeNorm === "stock") {
      const rootOwnerId = Deno.env.get("ROOT_OWNER_ID")?.trim() || null;
      const isRootOwner = !!rootOwnerId && userId.toLowerCase() === rootOwnerId.toLowerCase();

      if (!isRootOwner) {
        // Non-root: only owners can create new services (and get added as owner)
        const { data: ownerMemberships, error: ownerError } = await svc
          .from("service_memberships")
          .select("service_id")
          .eq("user_id", userId)
          .eq("role", "owner")
          .limit(1);

        if (ownerError || !ownerMemberships || ownerMemberships.length === 0) {
          return new Response(
            JSON.stringify({ error: "Only owners can create stock services" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      // Create new service
      const { data: newService, error: serviceError } = await svc
        .from("services")
        .insert({
          name: serviceName?.trim() || "Stock service",
        })
        .select("id")
        .single();

      if (serviceError || !newService) {
        return new Response(
          JSON.stringify({ error: `Failed to create service: ${serviceError?.message || "Unknown error"}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      targetServiceId = newService.id;

      // Root owner is NOT added to service_memberships (D1: servisy bez ownera, první pozvaný = admin)
      if (!isRootOwner) {
        const { error: membershipError } = await svc
          .from("service_memberships")
          .upsert({
            service_id: targetServiceId,
            user_id: userId,
            role: "owner",
          }, {
            onConflict: "service_id,user_id",
          });

        if (membershipError) {
          return new Response(
            JSON.stringify({ error: `Failed to create membership: ${membershipError.message}` }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      // If no email provided, just return the created service (no invite)
      if (!willCreateInvite) {
        return new Response(
          JSON.stringify({
            service_id: targetServiceId,
            created_service: true,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else {
      // Current mode: require serviceId and verify user is admin/owner (or root owner)
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

    // If no invite should be created, we already returned above (for stock mode)
    // For current mode, invite is always required, so we continue here

    // Generate token
    const token = generateToken()

    // Calculate expires_at (14 days from now)
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 14)
    const expiresAtISO = expiresAt.toISOString()

    // Upsert invite (reset accepted_at/accepted_by on re-invite)
    const { data: invite, error: inviteError } = await svc
      .from("service_invites")
      .upsert(
        {
          service_id: targetServiceId,
          email: emailTrim.toLowerCase(),
          role: roleNorm!,
          invited_by: userId,
          token,
          expires_at: expiresAtISO,
          accepted_at: null,
          accepted_by: null,
        },
        {
          onConflict: "service_id,email",
        }
      )
      .select()
      .single()

    if (inviteError) {
      return new Response(
        JSON.stringify({ error: `Failed to create invite: ${inviteError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // Get service name for email
    let serviceName = "Servis"
    const { data: serviceRow } = await svc.from("services").select("name").eq("id", targetServiceId).maybeSingle()
    if (serviceRow?.name) serviceName = serviceRow.name

    // Send email with invite code (Resend)
    let emailSent = false
    let emailError: string | null = null
    let emailSkippedReason: string | null = null

    const resendKey = Deno.env.get("RESEND_API_KEY")?.trim()
    console.log("[invite-create] Resend check:", {
      hasKey: !!resendKey,
      keyPrefix: resendKey ? resendKey.slice(0, 6) + "…" : null,
      emailTrim: emailTrim ? `${emailTrim.slice(0, 3)}…` : "",
    })
    if (!resendKey && emailTrim) {
      emailSkippedReason = "RESEND_API_KEY není nastaven v Supabase (Edge Functions → Secrets)"
      console.warn("[invite-create] Resend skipped:", emailSkippedReason)
    }
    if (resendKey && emailTrim) {
      try {
        console.log("[invite-create] Calling Resend API POST https://api.resend.com/emails")
        const escapeHtml = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
        const safeName = escapeHtml(serviceName || "Servis")
        const safeToken = escapeHtml(token)

        const textBody = `Pozvánka do servisu: ${serviceName}\n\nV aplikaci Jobi při registraci zadej tento kód:\n\n${token}\n\nKód platí 14 dní. Po registraci budeš přidán/a do servisu.`

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
          "<p style=\"margin:0;font-size:13px;color:#6b7280\">Kód platí 14 dní. Po registraci budeš přidán/a do servisu.</p>",
          "</div><p style=\"text-align:center;margin-top:16px;font-size:12px;color:#6b7280\">Jobi – správa zakázek</p></body></html>",
        ].join("")

        const fromEmail = Deno.env.get("RESEND_FROM_EMAIL")?.trim() || "Jobi <onboarding@resend.dev>"
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${resendKey}`,
          },
          body: JSON.stringify({
            from: fromEmail,
            to: [emailTrim],
            subject: `Pozvánka do servisu: ${serviceName}`,
            text: textBody,
            html: htmlBody,
          }),
        })
        const resBody = await res.text()
        console.log("[invite-create] Resend response:", { status: res.status, ok: res.ok, bodyPreview: resBody.slice(0, 300) })
        if (res.ok) {
          emailSent = true
        } else {
          emailError = `Resend ${res.status}: ${resBody.slice(0, 200)}`
          console.error("[invite-create] Resend error", res.status, resBody)
        }
      } catch (e) {
        emailError = e instanceof Error ? e.message : String(e)
        console.error("[invite-create] Failed to send invite email", e)
      }
    }

    const inviteLink = `jobsheet://invite?token=${token}`

    return new Response(
      JSON.stringify({
        invite,
        token,
        inviteLink,
        service_id: targetServiceId,
        role: roleNorm!,
        email_sent: emailSent,
        ...(emailError && { email_error: emailError }),
        ...(emailSkippedReason && { email_skipped_reason: emailSkippedReason }),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }
})






