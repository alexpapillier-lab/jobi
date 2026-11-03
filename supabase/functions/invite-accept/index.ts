import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Default capabilities for new members: all allowed (admin can turn off later). Must match whitelist in set_member_capabilities RPC. */
const DEFAULT_MEMBER_CAPABILITIES: Record<string, boolean> = {
  can_manage_tickets_basic: true,
  can_change_ticket_status: true,
  can_delete_tickets: true,
  can_manage_ticket_archive: true,
  can_manage_customers: true,
  can_manage_statuses: true,
  can_manage_documents: true,
  can_print_export: true,
  can_edit_devices: true,
  can_edit_inventory: true,
  can_adjust_inventory_quantity: true,
  can_edit_service_settings: true,
  can_view_statistics: true,
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
          JSON.stringify({ error: "Požadavek je prázdný.", code: "bad_request" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      body = JSON.parse(text);
      // Jen klíče – tělo nese token pozvánky a ten do logu nepatří (audit 4).
      console.log("[invite-accept] body keys", Object.keys((body ?? {}) as Record<string, unknown>));
    } catch (e) {
      console.error("[invite-accept] invalid json", e);
      return new Response(
        JSON.stringify({ error: "Požadavek má neplatný tvar.", code: "bad_request" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get authorization header
    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Nejste přihlášeni. Přihlaste se a zkuste to znovu.", code: "unauthorized" }),
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
        JSON.stringify({ error: "Přihlášení vypršelo. Přihlaste se znovu.", code: "unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const userId = userData.user.id;
    const userEmail = userData.user.email?.toLowerCase() || "";

    // Extract token from body
    const { token } = body;
    if (!token || typeof token !== "string") {
      return new Response(
        JSON.stringify({ error: "Chybí kód pozvánky.", code: "bad_request" }),
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
        JSON.stringify({ error: "Pozvánku se nepodařilo ověřit. Zkuste to prosím znovu.", code: "server_error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!invite) {
      return new Response(
        JSON.stringify({ error: "Pozvánka nenalezena. Zkontrolujte kód, nebo požádejte o novou.", code: "invite_not_found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if invite is already accepted
    if (invite.accepted_at) {
      return new Response(
        JSON.stringify({ error: "Pozvánka už byla využita.", code: "invite_used" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if invite is expired
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ error: "Pozvánce vypršela platnost. Požádejte o novou.", code: "invite_expired" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify email matches (if invite has email)
    // Note: Allow if invite.email is empty/null (invite without email restriction)
    if (invite.email && invite.email.trim() !== "" && invite.email.toLowerCase() !== userEmail) {
      console.log("[invite-accept] Email mismatch", { inviteEmail: invite.email, userEmail });
      return new Response(
        JSON.stringify({ error: "Pozvánka je určená pro jiný e-mail, než se kterým jste přihlášeni. Přihlaste se e-mailem, na který pozvánka přišla.", code: "email_mismatch" }),
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
        JSON.stringify({ error: "Pozvánku se nepodařilo přijmout. Zkuste to prosím znovu.", code: "server_error" }),
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

    // Create membership (for role 'member' set default capabilities to all true)
    const insertPayload: { service_id: string; user_id: string; role: string; capabilities?: Record<string, boolean> } = {
      service_id: invite.service_id,
      user_id: userId,
      role: invite.role,
    };
    if (invite.role === "member") {
      insertPayload.capabilities = DEFAULT_MEMBER_CAPABILITIES;
    }
    console.log("[invite-accept] Creating membership", { 
      service_id: invite.service_id, 
      user_id: userId, 
      role: invite.role,
      hasDefaultCapabilities: invite.role === "member",
    });
    
    const { data: membership, error: membershipErr } = await adminClient
      .from("service_memberships")
      .insert(insertPayload)
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
        JSON.stringify({ error: "Členství se nepodařilo vytvořit. Zkuste to prosím znovu.", code: "server_error" }),
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
    /* Ven jde jen obecná hláška. Zásobník volání prozrazuje cesty k souborům
       a vnitřní strukturu, a tuhle funkci volá kdokoli s odkazem z pozvánky.
       Podrobnosti zůstávají v logu funkce. */
    return new Response(
      JSON.stringify({ error: "Pozvánku se nepodařilo přijmout. Zkuste to prosím znovu.", code: "server_error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

