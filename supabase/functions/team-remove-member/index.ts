import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Get authorization header (both case variations)
    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
    
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extract token from "Bearer <token>" format
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return new Response(
        JSON.stringify({ error: "Invalid authorization header format" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create Supabase client with ANON_KEY and Authorization header
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });

    // Verify user via Supabase client
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    
    if (userErr || !user) {
      return new Response(
        JSON.stringify({ 
          code: 401, 
          message: "Invalid JWT", 
          reason: userErr?.message ?? "no_user",
          detail: userErr?.message 
        }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const userId = user.id;

    // Parse request body
    const body = await req.json();
    const { serviceId, userId: targetUserId } = body;

    if (!serviceId || !targetUserId) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: serviceId, userId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const rootOwnerId = Deno.env.get("ROOT_OWNER_ID")?.trim() || null;
    const isRootOwner = !!rootOwnerId && userId.toLowerCase() === rootOwnerId.toLowerCase();

    if (!isRootOwner) {
      const { data: callerMembership, error: callerError } = await supabase
        .from("service_memberships")
        .select("role")
        .eq("service_id", serviceId)
        .eq("user_id", userId)
        .single();

      if (callerError || !callerMembership) {
        return new Response(
          JSON.stringify({ error: "Caller is not a member of this service" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (callerMembership.role !== "owner" && callerMembership.role !== "admin") {
        return new Response(
          JSON.stringify({ error: "Caller must be owner or admin to remove members" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Check target user's current role
    const { data: targetMembership, error: targetError } = await supabase
      .from("service_memberships")
      .select("role")
      .eq("service_id", serviceId)
      .eq("user_id", targetUserId)
      .single();

    if (targetError || !targetMembership) {
      return new Response(
        JSON.stringify({ error: "Target user is not a member of this service" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Prevent removing last owner
    if (targetMembership.role === "owner") {
      const { data: ownerCount, error: countError } = await supabase
        .from("service_memberships")
        .select("user_id", { count: "exact", head: true })
        .eq("service_id", serviceId)
        .eq("role", "owner");

      if (!countError && ownerCount && ownerCount.length <= 1) {
      return new Response(
          JSON.stringify({ error: "Cannot remove the last owner" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
      }
    }

    // Remove member using service role client for admin operations
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceKey);

    const { error: deleteError } = await adminClient
      .from("service_memberships")
      .delete()
      .eq("service_id", serviceId)
      .eq("user_id", targetUserId);

    if (deleteError) {
      return new Response(
        JSON.stringify({ error: `Failed to remove member: ${deleteError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
