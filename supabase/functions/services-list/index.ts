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

      // Obsazenost a předplatné se NEPOČÍTAJÍ tady, ale funkcí
      // service_seat_overview(). Dřív se tu členové sčítali ručně, což
      // dávalo jiné číslo než kontrola při zvaní: nepočítaly se visící
      // pozvánky a naopak se počítal root owner. Teď je zdroj pravdy
      // jeden – stejné funkce, jaké hlídají limit v invite_create.
      type SeatRow = {
        service_id: string;
        seats: number | null;
        seat_limit: number | null;
        plan_key: string | null;
        plan_name: string | null;
        status: string | null;
        current_period_end: string | null;
      };
      const { data: seatRows, error: seatErr } = await svc.rpc("service_seat_overview", {
        p_exclude_user: rootOwnerId,
      });
      if (seatErr) {
        console.warn("[services-list] service_seat_overview selhalo:", seatErr.message);
      }
      const overview: Record<string, SeatRow> = {};
      for (const row of (seatRows as SeatRow[] | null) || []) {
        overview[row.service_id] = row;
      }

      const servicesWithRole = (allServices || []).map((s: { id: string; name?: string; active?: boolean }) => {
        const o = overview[s.id];
        return {
          service_id: s.id,
          service_name: s.name || "Unnamed service",
          role: "owner",
          active: s.active !== false,
          // Když RPC selže, radši neposílat číslo než poslat špatné –
          // UI počet členů schová, místo aby lhalo.
          member_count: o ? Number(o.seats ?? 0) : undefined,
          // null = bez omezení (Enterprise, legacy)
          seat_limit: o ? o.seat_limit : undefined,
          plan_key: o?.plan_key ?? undefined,
          plan_name: o?.plan_name ?? undefined,
          billing_status: o?.status ?? undefined,
          current_period_end: o?.current_period_end ?? undefined,
        };
      });

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






