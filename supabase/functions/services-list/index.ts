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

    // Create service client for DB operations
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const svc = createClient(supabaseUrl, serviceKey);

    // Fetch services where user is owner
    const { data: memberships, error: membersError } = await svc
      .from("service_memberships")
      .select("service_id, role")
      .eq("user_id", userId)
      .eq("role", "owner");

    if (membersError) {
      return new Response(
        JSON.stringify({ error: `Failed to fetch services: ${membersError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!memberships || memberships.length === 0) {
      return new Response(
        JSON.stringify({ services: [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch service names
    const serviceIds = memberships.map((m) => m.service_id);
    const { data: services, error: servicesError } = await svc
      .from("services")
      .select("id, name")
      .in("id", serviceIds);

    if (servicesError) {
      return new Response(
        JSON.stringify({ error: `Failed to fetch service names: ${servicesError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Combine memberships with service names
    const servicesWithRole = (services || []).map((s) => {
      const membership = memberships.find((m) => m.service_id === s.id);
      return {
        service_id: s.id,
        service_name: s.name || "Unnamed service",
        role: membership?.role || "owner",
      };
    });

    return new Response(
      JSON.stringify({ services: servicesWithRole }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});






