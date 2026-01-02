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

  try {
    // Get authorization header
    const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create user client with anon key and Authorization header
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes?.user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", detail: userErr?.message }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const userId = userRes.user.id;

    // Parse request body
    const body = await req.json();
    const { serviceId, userId: targetUserId, role } = body;

    if (!serviceId || !targetUserId || !role) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: serviceId, userId, role" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Normalize role
    const roleNorm = role.trim().toLowerCase();
    if (!["owner", "admin", "member"].includes(roleNorm)) {
      return new Response(
        JSON.stringify({ error: "Invalid role. Must be owner, admin, or member" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create service client for DB operations
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const svc = createClient(supabaseUrl, serviceKey);

    // Verify caller is owner or admin
    const { data: callerMembership, error: callerError } = await svc
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
        JSON.stringify({ error: "Caller must be owner or admin to update roles" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check target user's current role
    const { data: targetMembership, error: targetError } = await svc
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

    // Prevent downgrading last owner
    if (targetMembership.role === "owner" && roleNorm !== "owner") {
      // Count owners
      const { data: owners, error: ownersError } = await svc
        .from("service_memberships")
        .select("user_id")
        .eq("service_id", serviceId)
        .eq("role", "owner");

      if (ownersError || !owners || owners.length <= 1) {
        return new Response(
          JSON.stringify({ error: "Cannot downgrade the last owner" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Update role
    const { error: updateError } = await svc
      .from("service_memberships")
      .update({ role: roleNorm })
      .eq("service_id", serviceId)
      .eq("user_id", targetUserId);

    if (updateError) {
      return new Response(
        JSON.stringify({ error: `Failed to update role: ${updateError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});






