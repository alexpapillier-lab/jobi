import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const hasAuth = !!token;

    if (!authHeader) {
      console.error("[team-invite-list] Missing authorization header");
      return new Response(
        JSON.stringify({ code: 401, message: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!token) {
      console.error("[team-invite-list] Invalid authorization header format");
      return new Response(
        JSON.stringify({ code: 401, message: "Invalid authorization header format" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });

    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) {
      console.error("[team-invite-list] getUser failed:", { hasAuth, tokenLen: token.length, error: userErr?.message, code: userErr?.code });
      return new Response(
        JSON.stringify({
          code: 401,
          message: "Invalid JWT",
          detail: userErr?.message ?? null,
          hint: "getUser rejected the token – check Supabase Auth / JWT secret",
        }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { serviceId } = body;
    if (!serviceId) {
      return new Response(
        JSON.stringify({ error: "Missing required field: serviceId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: membership, error: membershipError } = await supabase
      .from("service_memberships")
      .select("service_id, role")
      .eq("service_id", serviceId)
      .eq("user_id", user.id)
      .single();

    if (membershipError || !membership) {
      return new Response(
        JSON.stringify({ error: "User is not a member of this service" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (membership.role !== "owner" && membership.role !== "admin") {
      return new Response(
        JSON.stringify({ error: "User must be owner or admin to view invites" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: invites, error: invitesError } = await supabase
      .from("service_invites")
      .select("id, email, role, created_at, expires_at")
      .eq("service_id", serviceId)
      .is("accepted_at", null)
      .order("created_at", { ascending: false });

    if (invitesError) {
      return new Response(
        JSON.stringify({ error: `Failed to fetch invites: ${invitesError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ invites: invites ?? [] }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error?.message ?? "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
