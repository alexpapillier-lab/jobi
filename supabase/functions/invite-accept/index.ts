import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  console.log("[invite-accept] invoked");

  try {
    // Parse request body
    let body: any = null;
    try {
      const text = await req.text();
      if (!text || text.trim() === "") {
        return new Response(
          JSON.stringify({ error: "Empty request body" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      body = JSON.parse(text);
      console.log("[invite-accept] body", body);
    } catch (e) {
      console.error("[invite-accept] invalid json", e);
      return new Response(
        JSON.stringify({ error: "Invalid JSON body", detail: e instanceof Error ? e.message : String(e) }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get authorization header
    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing Authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create user client with anon key and Authorization header
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify user is authenticated
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", detail: userErr?.message }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const userId = userData.user.id;
    const userEmail = userData.user.email?.toLowerCase() || "";

    // Extract token from body
    const { token } = body;
    if (!token || typeof token !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing or invalid token" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create admin client for DB operations
    const adminClient = createClient(supabaseUrl, serviceKey);

    // Find invite by token
    const { data: invite, error: inviteErr } = await adminClient
      .from("service_invites")
      .select("id, service_id, email, role, expires_at, accepted_at")
      .eq("token", token)
      .maybeSingle();

    if (inviteErr) {
      console.error("[invite-accept] Error finding invite:", inviteErr);
      return new Response(
        JSON.stringify({ error: `Failed to find invite: ${inviteErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!invite) {
      return new Response(
        JSON.stringify({ error: "Invite not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if invite is already accepted
    if (invite.accepted_at) {
      return new Response(
        JSON.stringify({ error: "Invite already accepted" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if invite is expired
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ error: "Invite has expired" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify email matches (if invite has email)
    // Note: Allow if invite.email is empty/null (invite without email restriction)
    if (invite.email && invite.email.trim() !== "" && invite.email.toLowerCase() !== userEmail) {
      console.log("[invite-accept] Email mismatch", { inviteEmail: invite.email, userEmail });
      return new Response(
        JSON.stringify({ error: "Email does not match invite" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if user already has membership in this service
    const { data: existingMembership, error: existingErr } = await adminClient
      .from("service_memberships")
      .select("service_id, user_id")
      .eq("service_id", invite.service_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (existingErr) {
      console.error("[invite-accept] Error checking existing membership:", existingErr);
      return new Response(
        JSON.stringify({ error: `Failed to check membership: ${existingErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (existingMembership) {
      // User already has membership, just mark invite as accepted
      const { error: updateErr } = await adminClient
        .from("service_invites")
        .update({
          accepted_at: new Date().toISOString(),
          accepted_by: userId,
        })
        .eq("id", invite.id);

      if (updateErr) {
        console.error("[invite-accept] Error updating invite:", updateErr);
      }

      return new Response(
        JSON.stringify({ 
          ok: true, 
          serviceId: invite.service_id,
          message: "Already a member of this service"
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create membership
    console.log("[invite-accept] Creating membership", { 
      service_id: invite.service_id, 
      user_id: userId, 
      role: invite.role 
    });
    
    const { data: membership, error: membershipErr } = await adminClient
      .from("service_memberships")
      .insert({
        service_id: invite.service_id,
        user_id: userId,
        role: invite.role,
      })
      .select("service_id, user_id, role")
      .single();

    if (membershipErr) {
      console.error("[invite-accept] Error creating membership:", membershipErr);
      console.error("[invite-accept] Membership error details", {
        message: membershipErr.message,
        code: membershipErr.code,
        details: membershipErr.details,
        hint: membershipErr.hint
      });
      return new Response(
        JSON.stringify({ 
          error: `Failed to create membership: ${membershipErr.message}`,
          code: membershipErr.code,
          details: membershipErr.details
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[invite-accept] Membership created", membership);

    // Mark invite as accepted
    const { error: updateErr } = await adminClient
      .from("service_invites")
      .update({
        accepted_at: new Date().toISOString(),
        accepted_by: userId,
      })
      .eq("id", invite.id);

    if (updateErr) {
      console.error("[invite-accept] Error updating invite:", updateErr);
      // Don't fail the request if invite update fails, but log it
    } else {
      console.log("[invite-accept] Invite marked as accepted", { inviteId: invite.id });
    }

    console.log("[invite-accept] success", { 
      userId, 
      serviceId: invite.service_id, 
      role: invite.role 
    });

    return new Response(
      JSON.stringify({ 
        ok: true, 
        serviceId: invite.service_id,
        membership: membership
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[invite-accept] exception", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error("[invite-accept] exception details", { errorMessage, errorStack });
    return new Response(
      JSON.stringify({ 
        error: errorMessage,
        detail: errorStack 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

