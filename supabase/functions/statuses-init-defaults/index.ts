import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Default statuses (same as in StatusesStore)
const DEFAULT_STATUSES = [
  { key: "received", label: "Přijato", bg: "#3b82f6", fg: "#ffffff", isFinal: false },
  { key: "diagnosis", label: "Diagnostika", bg: "#8b5cf6", fg: "#ffffff", isFinal: false },
  { key: "repair", label: "Oprava", bg: "#f59e0b", fg: "#ffffff", isFinal: false },
  { key: "testing", label: "Testování", bg: "#10b981", fg: "#ffffff", isFinal: false },
  { key: "ready", label: "Připraveno", bg: "#06b6d4", fg: "#ffffff", isFinal: false },
  { key: "completed", label: "Dokončeno", bg: "#059669", fg: "#ffffff", isFinal: true },
  { key: "cancelled", label: "Zrušeno", bg: "#6b7280", fg: "#ffffff", isFinal: true },
];

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
    const { serviceId } = body;

    if (!serviceId) {
      return new Response(
        JSON.stringify({ error: "Missing required field: serviceId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify user is a member of this service
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

    // Create service client for admin operations (bypasses RLS)
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceKey);

    // Check if statuses already exist
    const { data: existing, error: checkError } = await adminClient
      .from("service_statuses")
      .select("key")
      .eq("service_id", serviceId)
      .limit(1);

    if (checkError) {
      return new Response(
        JSON.stringify({ error: `Failed to check existing statuses: ${checkError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (existing && existing.length > 0) {
      return new Response(
        JSON.stringify({ ok: true, message: "Statuses already exist", count: existing.length }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Insert default statuses
    const toInsert = DEFAULT_STATUSES.map((s, idx) => ({
      service_id: serviceId,
      key: s.key,
      label: s.label,
      bg: s.bg || null,
      fg: s.fg || null,
      is_final: s.isFinal,
      order_index: idx,
    }));

    const { data: inserted, error: insertError } = await adminClient
      .from("service_statuses")
      .insert(toInsert)
      .select("key, label");

    if (insertError) {
      return new Response(
        JSON.stringify({ error: `Failed to create default statuses: ${insertError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ ok: true, count: inserted?.length || 0, statuses: inserted }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[statuses-init-defaults] exception", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});






