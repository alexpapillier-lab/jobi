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

  console.log("[invite-delete] invoked", { method: req.method, url: req.url });

  try {
    // Parse request body safely
    let body: any = null;
    try {
      const text = await req.text();
      console.log("[invite-delete] raw body text", text);
      
      if (!text || text.trim() === "") {
        return new Response(
          JSON.stringify({ error: "Empty request body" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      body = JSON.parse(text);
      console.log("[invite-delete] parsed body", body);
    } catch (e) {
      console.error("[invite-delete] invalid json", e);
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

    // Create user client with anon key and Authorization header (for auth checks via RLS)
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

    // Extract from body
    const { inviteId, serviceId } = body;
    if (!inviteId || !serviceId) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: inviteId, serviceId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if user is admin/owner of the service
    const { data: membership, error: membershipErr } = await userClient
      .from("service_memberships")
      .select("role")
      .eq("service_id", serviceId)
      .eq("user_id", userId)
      .maybeSingle();

    if (membershipErr || !membership) {
      return new Response(
        JSON.stringify({ error: "Not a member of this service" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userRole = membership.role;
    if (userRole !== "owner" && userRole !== "admin") {
      return new Response(
        JSON.stringify({ error: "Only owners and admins can delete invites" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify invite exists and belongs to this service
    const adminClient = createClient(supabaseUrl, serviceKey);
    const { data: invite, error: inviteErr } = await adminClient
      .from("service_invites")
      .select("id, service_id, email")
      .eq("id", inviteId)
      .eq("service_id", serviceId)
      .maybeSingle();

    if (inviteErr) {
      return new Response(
        JSON.stringify({ error: `Failed to check invite: ${inviteErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!invite) {
      return new Response(
        JSON.stringify({ error: "Invite not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Delete invite using admin client (bypasses RLS)
    const { data: deleted, error: delErr } = await adminClient
      .from("service_invites")
      .delete()
      .eq("id", inviteId)
      .eq("service_id", serviceId)
      .select("id");

    if (delErr) {
      console.error("[invite-delete] delete error", delErr);
      return new Response(
        JSON.stringify({ error: `Failed to delete invite: ${delErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!deleted || deleted.length === 0) {
      return new Response(
        JSON.stringify({ error: "Invite not found (0 rows deleted)" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[invite-delete] success", { inviteId, serviceId, deletedBy: userId });

    return new Response(
      JSON.stringify({ ok: true, deleted: deleted[0] }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[invite-delete] exception", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

