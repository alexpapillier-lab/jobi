/**
 * Edge Function: capture-claim-draft
 * Přesune fotky z draft capture tokenu do zakázky (diagnostic_photos_before).
 * POST body: { token, ticketId }
 * Vyžaduje auth + oprávnění k zakázce.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) {
      return new Response(
        JSON.stringify({ error: "Missing authorization" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });

    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(jwt);
    if (claimsErr || !claimsData?.claims?.sub) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const userId = claimsData.claims.sub as string;

    const body = await req.json();
    const token = body?.token;
    const ticketId = body?.ticketId;
    if (!token || !ticketId) {
      return new Response(
        JSON.stringify({ error: "Missing token or ticketId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const svc = createClient(supabaseUrl, serviceKey);

    const { data: tokenRow, error: tokenErr } = await svc
      .from("capture_tokens")
      .select("id, service_id")
      .eq("token", token)
      .is("ticket_id", null)
      .single();

    if (tokenErr || !tokenRow) {
      return new Response(
        JSON.stringify({ error: "Draft token nenalezen nebo již byl použit." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: membership } = await svc
      .from("service_memberships")
      .select("role")
      .eq("service_id", tokenRow.service_id)
      .eq("user_id", userId)
      .single();

    if (!membership) {
      return new Response(
        JSON.stringify({ error: "Nemáte oprávnění" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: ticket, error: ticketErr } = await svc
      .from("tickets")
      .select("id, diagnostic_photos_before")
      .eq("id", ticketId)
      .eq("service_id", tokenRow.service_id)
      .is("deleted_at", null)
      .single();

    if (ticketErr || !ticket) {
      return new Response(
        JSON.stringify({ error: "Zakázka nenalezena" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: draftPhotos } = await svc
      .from("draft_capture_photos")
      .select("photo_url")
      .eq("capture_token_id", tokenRow.id)
      .order("created_at", { ascending: true });

    const urls = (draftPhotos ?? []).map((r: { photo_url: string }) => r.photo_url);
    const current = Array.isArray(ticket.diagnostic_photos_before) ? ticket.diagnostic_photos_before : [];
    const updated = [...current, ...urls];

    const { error: updateErr } = await svc
      .from("tickets")
      .update({ diagnostic_photos_before: updated })
      .eq("id", ticketId);

    if (updateErr) {
      console.error("[capture-claim-draft] ticket update error:", updateErr);
      return new Response(
        JSON.stringify({ error: "Nepodařilo se přidat fotky k zakázce." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    await svc.from("draft_capture_photos").delete().eq("capture_token_id", tokenRow.id);
    await svc.from("capture_tokens").delete().eq("id", tokenRow.id);

    return new Response(
      JSON.stringify({ ok: true, count: urls.length }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[capture-claim-draft] error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Nastala chyba." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
