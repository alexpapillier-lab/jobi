/**
 * Edge Function: capture-upload
 * Přijímá fotku z mobilní capture stránky (bez auth), validuje token, nahraje do Storage a přidá k zakázce.
 * POST body: { ticketId, token, image: base64 }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BUCKET = "diagnostic-photos";

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
    const body = await req.json();
    const { ticketId, token, image } = body;

    if (!ticketId || !token || !image || typeof image !== "string") {
      return new Response(
        JSON.stringify({ error: "Chybí ticketId, token nebo obrázek." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const svc = createClient(supabaseUrl, serviceKey);

    // Validace tokenu
    const { data: row, error: tokenErr } = await svc
      .from("capture_tokens")
      .select("id, ticket_id, service_id")
      .eq("token", token)
      .eq("ticket_id", ticketId)
      .gt("expires_at", new Date().toISOString())
      .single();

    if (tokenErr || !row) {
      return new Response(
        JSON.stringify({ error: "Neplatný nebo vypršený odkaz. Naskenujte QR kód znovu v aplikaci Jobi." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const serviceId = row.service_id;

    // Dekódování base64
    let bytes: Uint8Array;
    try {
      const binary = atob(image);
      bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    } catch {
      return new Response(
        JSON.stringify({ error: "Neplatný formát obrázku." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const uuid = crypto.randomUUID();
    const path = `${serviceId}/${ticketId}/${uuid}.jpg`;

    const { error: uploadErr } = await svc.storage
      .from(BUCKET)
      .upload(path, bytes, {
        contentType: "image/jpeg",
        upsert: false,
      });

    if (uploadErr) {
      console.error("[capture-upload] storage error:", uploadErr);
      return new Response(
        JSON.stringify({ error: "Nepodařilo se nahrát obrázek." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: urlData } = svc.storage.from(BUCKET).getPublicUrl(path);
    const photoUrl = urlData.publicUrl;

    // Přidat URL k zakázce
    const { data: ticket, error: fetchErr } = await svc
      .from("tickets")
      .select("diagnostic_photos")
      .eq("id", ticketId)
      .single();

    if (fetchErr || !ticket) {
      return new Response(
        JSON.stringify({ error: "Zakázka nenalezena." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const current = Array.isArray(ticket.diagnostic_photos) ? ticket.diagnostic_photos : [];
    const updated = [...current, photoUrl];

    const { error: updateErr } = await svc
      .from("tickets")
      .update({ diagnostic_photos: updated })
      .eq("id", ticketId);

    if (updateErr) {
      console.error("[capture-upload] update error:", updateErr);
      return new Response(
        JSON.stringify({ error: "Nepodařilo se přidat fotku k zakázce." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Token NEmazat – umožnit přidat více fotek v rámci jedné session (do expirace)

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[capture-upload] error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Nastala neočekávaná chyba." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
