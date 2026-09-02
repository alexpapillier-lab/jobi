/**
 * Edge Function: error-logs-list
 *
 * Vrací chybové logy napříč všemi servisy. Určeno VÝHRADNĚ pro root ownera
 * (majitele aplikace) – tabulka error_logs má RLS, která čtení nikomu
 * nepovoluje, takže se sem chodí přes service_role po ověření identity.
 * Stejný vzor jako services-list.
 *
 * POST body (vše volitelné):
 *   { serviceId?: string, code?: string, platform?: string,
 *     sinceHours?: number, limit?: number }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const rootOwnerId = Deno.env.get("ROOT_OWNER_ID")?.trim() || null;
    const isRootOwner =
      !!rootOwnerId && userRes.user.id.toLowerCase() === rootOwnerId.toLowerCase();

    if (!isRootOwner) {
      return new Response(
        JSON.stringify({ error: "Forbidden" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const limit = Math.min(
      typeof body?.limit === "number" && body.limit > 0 ? body.limit : DEFAULT_LIMIT,
      MAX_LIMIT
    );
    const sinceHours = typeof body?.sinceHours === "number" ? body.sinceHours : 24 * 7;
    const since = new Date(Date.now() - sinceHours * 3600 * 1000).toISOString();

    const svc = createClient(supabaseUrl, serviceKey);

    let q = svc
      .from("error_logs")
      .select("id, service_id, user_id, code, message, source, context, app_version, platform, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (typeof body?.serviceId === "string" && body.serviceId) q = q.eq("service_id", body.serviceId);
    if (typeof body?.code === "string" && body.code) q = q.eq("code", body.code);
    if (typeof body?.platform === "string" && body.platform) q = q.eq("platform", body.platform);

    const { data: logs, error: logsErr } = await q;
    if (logsErr) {
      return new Response(
        JSON.stringify({ error: `Failed to fetch logs: ${logsErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Doplnit názvy servisů, ať se v přehledu nekouká na UUID.
    const serviceIds = [...new Set((logs ?? []).map((l) => l.service_id).filter(Boolean))];
    const names: Record<string, string> = {};
    if (serviceIds.length > 0) {
      const { data: services } = await svc.from("services").select("id, name").in("id", serviceIds);
      for (const s of services ?? []) names[s.id as string] = (s.name as string) ?? "";
    }

    return new Response(
      JSON.stringify({
        ok: true,
        logs: (logs ?? []).map((l) => ({ ...l, service_name: l.service_id ? names[l.service_id] ?? null : null })),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
