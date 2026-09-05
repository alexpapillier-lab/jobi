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

/**
 * Limity. Funkce běží bez přihlášení, stačí odkaz z QR kódu – bez stropů by
 * kdokoli s odkazem mohl nahrát libovolně velký soubor libovolněkrát a platil
 * by to servis.
 */
const MAX_BAJTU = 8 * 1024 * 1024;
const MAX_FOTEK_NA_TOKEN = 40;
const MAX_ZA_MINUTU = 20;

/**
 * Poznat obrázek podle prvních bajtů. Přípona ani hlavička od klienta nic
 * neznamenají a bucket je veřejný, takže se do něj nemá dostat nic jiného
 * než obrázek.
 */
function typObrazku(b: Uint8Array): string | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  const ascii = (od: number, delka: number) => String.fromCharCode(...b.slice(od, od + delka));
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "image/webp";
  if (ascii(4, 4) === "ftyp") {
    const znacka = ascii(8, 4);
    if (znacka.startsWith("hei") || znacka.startsWith("hev") || znacka === "mif1") return "image/heic";
  }
  return null;
}

const PRIPONY: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
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
    const body = await req.json();
    const { ticketId, token, image, scope } = body;

    if (!token || !image || typeof image !== "string") {
      return new Response(
        JSON.stringify({ error: "Chybí token nebo obrázek." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const svc = createClient(supabaseUrl, serviceKey);

    // Validace tokenu: token je unikátní, proto načteme jen podle tokenu + expirace.
    const { data: row, error: tokenErr } = await svc
      .from("capture_tokens")
      .select("id, ticket_id, service_id")
      .eq("token", token)
      .gt("expires_at", new Date().toISOString())
      .single();

    if (tokenErr || !row) {
      return new Response(
        JSON.stringify({ error: "Neplatný nebo vypršený odkaz. Naskenujte QR kód znovu v aplikaci Jobi." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const isDraftToken = row.ticket_id === null;
    if (!isDraftToken && ticketId !== row.ticket_id) {
      return new Response(
        JSON.stringify({ error: "Neplatný odkaz pro tuto zakázku. Naskenujte QR kód znovu v aplikaci Jobi." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const serviceId = row.service_id;

    // Limit se počítá hned po ověření tokenu, ještě před dekódováním – base64
    // desítek megabajtů se nemá vůbec rozbalovat.
    const { data: zaMinutu } = await svc.rpc("zapocitej_udalost", { p_kanal: "capture-upload", p_klic: row.id });
    if (typeof zaMinutu === "number" && zaMinutu > MAX_ZA_MINUTU) {
      return new Response(
        JSON.stringify({ error: "Fotky se posílají moc rychle. Zkuste to za chvíli." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "60" } }
      );
    }

    // Base64 je o třetinu delší než data; ověřuje se dřív, než se rozbalí.
    if (image.length > MAX_BAJTU * 1.4) {
      return new Response(
        JSON.stringify({ error: "Fotka je moc velká. Pošlete ji v menším rozlišení." }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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
    if (bytes.length > MAX_BAJTU) {
      return new Response(
        JSON.stringify({ error: "Fotka je moc velká. Pošlete ji v menším rozlišení." }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const mime = typObrazku(bytes);
    if (!mime) {
      return new Response(
        JSON.stringify({ error: "Tohle není obrázek. Podporujeme JPEG, PNG, WebP a HEIC." }),
        { status: 415, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Kolik fotek už z tohohle odkazu přišlo. Jeden příjem zakázky se do
    // desítek fotek vejde; víc znamená, že odkaz někdo zneužívá.
    const { data: dosud } = await svc.rpc("pocet_udalosti", { p_kanal: "capture-upload", p_klic: row.id, p_minut: 60 * 24 * 7 });
    if (typeof dosud === "number" && dosud > MAX_FOTEK_NA_TOKEN) {
      return new Response(
        JSON.stringify({ error: `Z tohoto odkazu už bylo nahráno ${MAX_FOTEK_NA_TOKEN} fotek. Vygenerujte v Jobi nový QR kód.` }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const uuid = crypto.randomUUID();
    const pripona = PRIPONY[mime] ?? "jpg";
    const path = isDraftToken
      ? `${serviceId}/draft/${row.id}/${uuid}.${pripona}`
      : `${serviceId}/${ticketId}/${uuid}.${pripona}`;

    const { error: uploadErr } = await svc.storage
      .from(BUCKET)
      .upload(path, bytes, {
        contentType: mime,
        // Náhodné UUID v cestě znamená neměnný obsah; bez tohohle jde ven
        // no-cache a stejná fotka se stahuje při každém zobrazení znovu.
        cacheControl: "31536000",
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

    if (isDraftToken) {
      const { error: insertErr } = await svc.from("draft_capture_photos").insert({
        capture_token_id: row.id,
        photo_url: photoUrl,
      });
      if (insertErr) {
        console.error("[capture-upload] draft_capture_photos insert error:", insertErr);
        return new Response(
          JSON.stringify({ error: "Nepodařilo se uložit fotku." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ ok: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const isBefore = scope === "before";

    const { data: ticket, error: fetchErr } = await svc
      .from("tickets")
      .select(isBefore ? "diagnostic_photos_before" : "diagnostic_photos")
      .eq("id", ticketId)
      .single();

    if (fetchErr || !ticket) {
      return new Response(
        JSON.stringify({ error: "Zakázka nenalezena." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const current = isBefore
      ? (Array.isArray(ticket.diagnostic_photos_before) ? ticket.diagnostic_photos_before : [])
      : (Array.isArray(ticket.diagnostic_photos) ? ticket.diagnostic_photos : []);
    const updated = [...current, photoUrl];

    const updatePayload = isBefore ? { diagnostic_photos_before: updated } : { diagnostic_photos: updated };

    const { error: updateErr } = await svc
      .from("tickets")
      .update(updatePayload)
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
