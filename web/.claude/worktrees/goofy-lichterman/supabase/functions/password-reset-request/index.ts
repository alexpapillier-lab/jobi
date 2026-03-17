import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function generateToken(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";
  for (let i = 0; i < 12; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const emailRaw = body?.email;
    const emailTrim = typeof emailRaw === "string" ? emailRaw.trim().toLowerCase() : "";
    if (!emailTrim) {
      return new Response(
        JSON.stringify({ error: "Chybí e-mail." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const svc = createClient(supabaseUrl, serviceKey);

    const { data: userId } = await svc.rpc("get_auth_user_id_by_email", { p_email: emailTrim });
    if (!userId) {
      return new Response(
        JSON.stringify({ ok: true, message: "Pokud účet s tímto e-mailem existuje, přijde vám e-mail s kódem." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = generateToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await svc.from("password_reset_tokens").delete().eq("email", emailTrim);
    const { error: insertErr } = await svc
      .from("password_reset_tokens")
      .insert({ email: emailTrim, token, expires_at: expiresAt });
    if (insertErr) {
      console.error("[password-reset-request] insert token failed", insertErr);
      return new Response(
        JSON.stringify({ error: "Nepodařilo vytvořit kód. Zkuste to znovu." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const resendKey = Deno.env.get("RESEND_API_KEY")?.trim();
    const fromEmail =
      Deno.env.get("RESEND_FROM_EMAIL_PASSWORD_RESET")?.trim() ||
      Deno.env.get("RESEND_FROM_EMAIL")?.trim() ||
      "Jobi <onboarding@resend.dev>";
    if (resendKey) {
      const escapeHtml = (s: string) =>
        String(s)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      const safeToken = escapeHtml(token);
      const textBody = `Obnovení hesla v Jobi\n\nVáš kód pro obnovu hesla: ${token}\n\nKód platí 1 hodinu. Zadejte ho v aplikaci Jobi (Zapomněl jsem heslo → zadejte kód a nové heslo).`;
      const htmlBody = [
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Obnovení hesla</title></head>",
        "<body style=\"margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,&quot;Segoe UI&quot;,Roboto,sans-serif;background:#faf5ff\">",
        "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background:#faf5ff;padding:24px 16px\"><tr><td align=\"center\">",
        "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:480px;margin:0 auto;background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(124,58,237,0.12)\"><tr><td style=\"padding:32px 24px\">",
        "<h1 style=\"margin:0 0 8px;font-size:22px;font-weight:700;color:#1e1b4b\">Obnovení hesla</h1>",
        "<p style=\"margin:0 0 20px;font-size:14px;color:#6b7280\">V aplikaci Jobi zadejte níže uvedený kód a nové heslo.</p>",
        "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background:#f5f3ff;border:2px solid #c4b5fd;border-radius:12px;margin:20px 0\"><tr><td style=\"padding:20px;text-align:center\">",
        "<p style=\"margin:0 0 6px;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em\">Kód pro obnovu hesla</p>",
        "<p style=\"margin:0;font-family:ui-monospace,monospace;font-size:24px;font-weight:700;letter-spacing:0.15em;color:#1e1b4b\">" + safeToken + "</p>",
        "</td></tr></table>",
        "<p style=\"margin:0;font-size:13px;color:#6b7280\">Kód platí 1 hodinu.</p>",
        "</td></tr></table>",
        "<p style=\"text-align:center;margin-top:20px;font-size:12px;color:#9ca3af\">Jobi – správa zakázek</p>",
        "</td></tr></table></body></html>",
      ].join("");
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
        body: JSON.stringify({
          from: fromEmail,
          to: [emailTrim],
          subject: "Obnovení hesla – Jobi",
          text: textBody,
          html: htmlBody,
        }),
      });
    }

    return new Response(
      JSON.stringify({ ok: true, message: "Pokud účet s tímto e-mailem existuje, přijde vám e-mail s kódem." }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("[password-reset-request]", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Chyba při odeslání." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
