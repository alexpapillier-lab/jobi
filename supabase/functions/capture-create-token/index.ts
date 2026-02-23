/**
 * Edge Function: capture-create-token
 * Vytvoří jednorázový token pro QR kód – Jobi ho volá při zobrazení tlačítka "Vyfotit z telefonu".
 * Vyžaduje auth + oprávnění k zakázce.
 * POST body: { ticketId }
 * Vrací: { token, url } – url je plná adresa pro capture stránku
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CAPTURE_BASE_URL = "https://capture.appjobi.com";
const TOKEN_EXPIRY_MINUTES = 15;

function generateToken(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let token = "";
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

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

    // getClaims() podporuje ES256 (asymetrické JWT), getUser() v Edge může selhat
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(jwt);
    if (claimsErr || !claimsData?.claims?.sub) {
      console.error("[capture-create-token] getClaims failed:", claimsErr?.message ?? "no sub");
      return new Response(
        JSON.stringify({ error: "Unauthorized", detail: claimsErr?.message }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const userId = claimsData.claims.sub as string;

    const body = await req.json();
    const ticketId = body?.ticketId;
    const isBefore = body?.isBefore === true;
    if (!ticketId) {
      return new Response(
        JSON.stringify({ error: "Missing ticketId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const svc = createClient(supabaseUrl, serviceKey);

    const { data: ticket, error: ticketErr } = await svc
      .from("tickets")
      .select("id, service_id")
      .eq("id", ticketId)
      .is("deleted_at", null)
      .single();

    if (ticketErr || !ticket) {
      return new Response(
        JSON.stringify({ error: "Zakázka nenalezena" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: membership } = await svc
      .from("service_memberships")
      .select("role")
      .eq("service_id", ticket.service_id)
      .eq("user_id", userId)
      .single();

    if (!membership) {
      return new Response(
        JSON.stringify({ error: "Nemáte oprávnění k této zakázce" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = generateToken();
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MINUTES * 60 * 1000).toISOString();

    const { error: insertErr } = await svc.from("capture_tokens").insert({
      token,
      ticket_id: ticketId,
      service_id: ticket.service_id,
      expires_at: expiresAt,
    });

    if (insertErr) {
      console.error("[capture-create-token] insert error:", insertErr);
      return new Response(
        JSON.stringify({ error: "Nepodařilo se vytvořit odkaz" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const captureBase = Deno.env.get("CAPTURE_BASE_URL") || CAPTURE_BASE_URL;
    const base = `${captureBase.replace(/\/$/, "")}/?ticket=${encodeURIComponent(ticketId)}&token=${encodeURIComponent(token)}`;
    const url = isBefore ? `${base}&scope=before` : base;

    return new Response(
      JSON.stringify({ token, url }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[capture-create-token] error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Nastala chyba." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
