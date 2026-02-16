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
    // All DB queries will run as the authenticated user (via RLS)
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });

    // Verify user via Supabase client (getUser() without parameter - uses header)
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
    const { serviceId } = body;

    if (!serviceId) {
      return new Response(
        JSON.stringify({ error: "Missing required field: serviceId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const rootOwnerId = Deno.env.get("ROOT_OWNER_ID")?.trim() || null;
    const isRootOwner = !!rootOwnerId && userId.toLowerCase() === rootOwnerId.toLowerCase();

    let memberships: { user_id: string; service_id: string; role: string; created_at: string; capabilities: unknown }[] | null = null;
    let membersError: { message: string } | null = null;

    if (isRootOwner) {
      // Root owner can view team for any service – use service role to fetch
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const adminClient = createClient(supabaseUrl, serviceKey);
      const res = await adminClient
        .from("service_memberships")
        .select("user_id, service_id, role, created_at, capabilities")
        .eq("service_id", serviceId)
        .order("created_at", { ascending: true });
      memberships = res.data;
      membersError = res.error;
    } else {
      // Verify user is owner or admin in service_memberships
      const { data: membership, error: membershipError } = await supabase
        .from("service_memberships")
        .select("service_id, role, capabilities")
        .eq("service_id", serviceId)
        .eq("user_id", userId)
        .single();

      if (membershipError || !membership) {
        return new Response(
          JSON.stringify({ error: "User is not a member of this service" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (membership.role !== "owner" && membership.role !== "admin") {
        return new Response(
          JSON.stringify({ error: "User must be owner or admin to view team members" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const res = await supabase
        .from("service_memberships")
        .select("user_id, service_id, role, created_at, capabilities")
        .eq("service_id", serviceId)
        .order("created_at", { ascending: true });
      memberships = res.data;
      membersError = res.error;
    }

    // Debug: log memberships list query
    console.log(
      "[team-list] memberships list:",
      JSON.stringify({
        err: membersError?.message ?? null,
        count: memberships?.length ?? 0,
        rows: (memberships ?? []).map((m) => ({ user_id: m.user_id, role: m.role })),
      })
    );

    if (membersError) {
      return new Response(
        JSON.stringify({ error: `Failed to fetch members: ${membersError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch emails for each member
    // Note: Using service role client for admin.getUserById (bypasses RLS)
    // For regular DB queries, we use the authenticated supabase client above
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceKey);
    
    const membersWithEmails = await Promise.all(
      (memberships || []).map(async (m) => {
        try {
          const { data: userData, error: userError } = await adminClient.auth.admin.getUserById(m.user_id);
          const email = userError ? null : userData?.user?.email ?? null;
          return {
            ...m,
            email,
          };
        } catch {
          return {
            ...m,
            email: null,
          };
        }
      })
    );

    // Sort: owner/admin first, then by created_at
    membersWithEmails.sort((a, b) => {
      const roleOrder = { owner: 0, admin: 1, member: 2 };
      const aOrder = roleOrder[a.role as keyof typeof roleOrder] ?? 3;
      const bOrder = roleOrder[b.role as keyof typeof roleOrder] ?? 3;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });

    // Debug: log response members after email enrichment
    console.log(
      "[team-list] response members:",
      JSON.stringify({
        count: membersWithEmails?.length ?? 0,
        users: (membersWithEmails ?? []).map((u) => ({ user_id: u.user_id, role: u.role, email: u.email ?? null })),
      })
    );

    // Pending invites – root owner uses adminClient (RLS may block), others use supabase
    const invitesClient = isRootOwner ? adminClient : supabase;
    const { data: invites, error: invitesError } = await invitesClient
      .from("service_invites")
      .select("id, email, role, created_at, expires_at")
      .eq("service_id", serviceId)
      .is("accepted_at", null)
      .order("created_at", { ascending: false });

    if (invitesError) {
      console.error("[team-list] invites query err:", invitesError.message);
      // Vrátíme aspoň members, invites prázdné
      return new Response(
        JSON.stringify({ members: membersWithEmails, invites: [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ members: membersWithEmails, invites: invites ?? [] }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
