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
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceKey) {
      return new Response(
        JSON.stringify({
          error: "Server configuration error",
          code: "missing_env",
          message: "Required environment variables are not set.",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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

    const svc = createClient(supabaseUrl, serviceKey);

    const rootOwnerId = Deno.env.get("ROOT_OWNER_ID")?.trim() || null;
    const isRootOwner = !!rootOwnerId && userId.toLowerCase() === rootOwnerId.toLowerCase();

    // Root owner: vrátí všechny servisy v systému (včetně active a member_count)
    if (isRootOwner) {
      const { data: allServices, error: allErr } = await svc
        .from("services")
        .select("id, name, active");

      if (allErr) {
        return new Response(
          JSON.stringify({ error: `Failed to fetch services: ${allErr.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const ids = (allServices || []).map((s: { id: string }) => s.id);
      let memberCounts: Record<string, number> = {};
      if (ids.length > 0) {
        const { data: counts } = await svc
          .from("service_memberships")
          .select("service_id")
          .in("service_id", ids);
        const byService: Record<string, number> = {};
        for (const sid of ids) byService[sid] = 0;
        for (const row of counts || []) {
          byService[row.service_id] = (byService[row.service_id] || 0) + 1;
        }
        memberCounts = byService;
      }

      const servicesWithRole = (allServices || []).map((s: { id: string; name?: string; active?: boolean }) => ({
        service_id: s.id,
        service_name: s.name || "Unnamed service",
        role: "owner",
        active: s.active !== false,
        member_count: memberCounts[s.id] ?? 0,
      }));

      return new Response(
        JSON.stringify({ services: servicesWithRole }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Ostatní uživatelé: servisy, kde jsou členem (jakákoli role)
    const { data: memberships, error: membersError } = await svc
      .from("service_memberships")
      .select("service_id, role")
      .eq("user_id", userId);

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

    const serviceIds = memberships.map((m) => m.service_id);
    const { data: servicesRaw, error: servicesError } = await svc
      .from("services")
      .select("id, name, active")
      .in("id", serviceIds);

    if (servicesError) {
      return new Response(
        JSON.stringify({ error: `Failed to fetch service names: ${servicesError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Pro ne-root: zobrazit jen aktivní servisy (deaktivované skrýt ze seznamu)
    const services = (servicesRaw || []).filter((s: { id: string; name?: string; active?: boolean }) => s.active !== false);

    const servicesWithRole = services.map((s: { id: string; name?: string; active?: boolean }) => {
      const membership = memberships.find((m: { service_id: string; role: string }) => m.service_id === s.id);
      return {
        service_id: s.id,
        service_name: s.name || "Unnamed service",
        role: membership?.role || "member",
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






