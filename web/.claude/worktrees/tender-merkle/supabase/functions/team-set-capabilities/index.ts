import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ALLOWED_KEYS = [
  "can_manage_tickets_basic",
  "can_change_ticket_status",
  "can_delete_tickets",
  "can_manage_ticket_archive",
  "can_manage_customers",
  "can_manage_statuses",
  "can_manage_documents",
  "can_print_export",
  "can_edit_devices",
  "can_edit_inventory",
  "can_adjust_inventory_quantity",
  "can_edit_service_settings",
];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", detail: userErr?.message }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { serviceId, userId: targetUserId, capabilities } = body;
    if (!serviceId || !targetUserId || capabilities === undefined) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: serviceId, userId, capabilities" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Oprávnění má owner nebo admin servisu (nebo root owner pro libovolný servis)
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const svc = createClient(supabaseUrl, serviceKey);
    const rootOwnerId = Deno.env.get("ROOT_OWNER_ID")?.trim() || null;
    const isRootOwner = !!rootOwnerId && user.id.toLowerCase() === rootOwnerId.toLowerCase();

    if (!isRootOwner) {
      const { data: callerMembership, error: callerErr } = await svc
        .from("service_memberships")
        .select("role")
        .eq("service_id", serviceId)
        .eq("user_id", user.id)
        .single();

      if (callerErr || !callerMembership) {
        return new Response(
          JSON.stringify({ error: "Nejste členem tohoto servisu" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (callerMembership.role !== "owner" && callerMembership.role !== "admin") {
        return new Response(
          JSON.stringify({ error: "Změna oprávnění člena je jen pro ownera nebo admina" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const filtered: Record<string, boolean> = {};
    for (const key of Object.keys(capabilities)) {
      if (ALLOWED_KEYS.includes(key) && typeof capabilities[key] === "boolean") {
        filtered[key] = capabilities[key];
      }
    }

    const { data: targetRow, error: fetchErr } = await svc
      .from("service_memberships")
      .select("role")
      .eq("service_id", serviceId)
      .eq("user_id", targetUserId)
      .single();

    if (fetchErr || !targetRow) {
      return new Response(
        JSON.stringify({ error: "Target user is not a member of this service" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (targetRow.role === "owner") {
      return new Response(
        JSON.stringify({ error: "Cannot change capabilities of owner" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { error: updateErr } = await svc
      .from("service_memberships")
      .update({ capabilities: filtered })
      .eq("service_id", serviceId)
      .eq("user_id", targetUserId);

    if (updateErr) {
      return new Response(
        JSON.stringify({ error: `Failed to update capabilities: ${updateErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
