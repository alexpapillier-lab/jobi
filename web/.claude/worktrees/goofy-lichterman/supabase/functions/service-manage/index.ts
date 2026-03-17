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

    const rootOwnerId = Deno.env.get("ROOT_OWNER_ID")?.trim() || null;
    const isRootOwner = !!rootOwnerId && user.id.toLowerCase() === rootOwnerId.toLowerCase();
    if (!isRootOwner) {
      return new Response(
        JSON.stringify({ error: "Only root owner can manage services" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { action, serviceId, name } = body;
    if (!action || !serviceId) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: action, serviceId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (action === "rename" && (name === undefined || typeof name !== "string")) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid field: name (string required for rename)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (action !== "deactivate" && action !== "activate" && action !== "hardDelete" && action !== "rename") {
      return new Response(
        JSON.stringify({ error: "Invalid action. Must be deactivate, activate, hardDelete, or rename" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const svc = createClient(supabaseUrl, serviceKey);

    if (action === "deactivate") {
      const { error: updateErr } = await svc
        .from("services")
        .update({ active: false })
        .eq("id", serviceId);
      if (updateErr) {
        return new Response(
          JSON.stringify({ error: `Failed to deactivate: ${updateErr.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ ok: true, action: "deactivate" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "activate") {
      const { error: updateErr } = await svc
        .from("services")
        .update({ active: true })
        .eq("id", serviceId);
      if (updateErr) {
        return new Response(
          JSON.stringify({ error: `Failed to activate: ${updateErr.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ ok: true, action: "activate" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "rename") {
      const newName = String(name).trim() || "Servis";
      const { error: updateErr } = await svc
        .from("services")
        .update({ name: newName })
        .eq("id", serviceId);
      if (updateErr) {
        return new Response(
          JSON.stringify({ error: `Failed to rename: ${updateErr.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ ok: true, action: "rename", name: newName }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // hardDelete – přes RPC, které nastaví session proměnnou, aby trigger neblokoval CASCADE delete (poslední owner)
    const { error: deleteErr } = await svc.rpc("delete_service_for_root", { p_service_id: serviceId });
    if (deleteErr) {
      return new Response(
        JSON.stringify({ error: `Failed to delete service: ${deleteErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    return new Response(
      JSON.stringify({ ok: true, action: "hardDelete" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
