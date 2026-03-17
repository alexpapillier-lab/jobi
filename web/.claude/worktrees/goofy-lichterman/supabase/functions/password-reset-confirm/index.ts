import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const emailTrim = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";

    if (!emailTrim || !token) {
      return new Response(
        JSON.stringify({ error: "Chybí e-mail nebo kód." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (newPassword.length < 6) {
      return new Response(
        JSON.stringify({ error: "Heslo musí mít alespoň 6 znaků." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const svc = createClient(supabaseUrl, serviceKey);

    const now = new Date().toISOString();
    const { data: row, error: selectErr } = await svc
      .from("password_reset_tokens")
      .select("email, token")
      .eq("email", emailTrim)
      .eq("token", token)
      .gt("expires_at", now)
      .maybeSingle();

    if (selectErr || !row) {
      return new Response(
        JSON.stringify({ error: "Kód je neplatný nebo vypršel. Požádejte znovu o obnovu hesla." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: userId, error: rpcErr } = await svc.rpc("get_auth_user_id_by_email", { p_email: emailTrim });
    if (rpcErr || !userId) {
      return new Response(
        JSON.stringify({ error: "Uživatel nebyl nalezen." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { error: updateErr } = await svc.auth.admin.updateUserById(userId, { password: newPassword });
    if (updateErr) {
      console.error("[password-reset-confirm] updateUserById failed", updateErr);
      return new Response(
        JSON.stringify({ error: updateErr.message || "Nepodařilo nastavit heslo." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    await svc.from("password_reset_tokens").delete().eq("email", emailTrim).eq("token", token);

    return new Response(
      JSON.stringify({ ok: true, message: "Heslo bylo změněno. Můžete se přihlásit." }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("[password-reset-confirm]", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Chyba při změně hesla." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
