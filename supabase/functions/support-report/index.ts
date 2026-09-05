import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Hlášení chyby z aplikace.
 *
 * Zákazník napíše, co se stalo, a Jobi k tomu přiloží, co o tom ví: verzi,
 * platformu, servis, uživatele a posledních pár chyb z `error_logs`. Bez toho
 * chodí e-maily typu „nejde mi to" a hledání začíná dotazem, ve které verzi
 * a na čem. Text hlášení je jediné, co píše člověk; zbytek se dopočítá zde,
 * aby se nedal podvrhnout z klienta.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PODPORA = Deno.env.get("SUPPORT_EMAIL")?.trim() || "podpora@appjobi.com";
const MAX_ZPRAVA = 4000;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  try {
    const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
    if (!authHeader) return json({ error: "Nepřihlášeno." }, 401);

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Nepřihlášeno." }, 401);

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const zprava = String(body.message ?? "").trim().slice(0, MAX_ZPRAVA);
    if (zprava.length < 10) return json({ error: "Napište prosím aspoň větu o tom, co se stalo." }, 400);
    const serviceId = typeof body.serviceId === "string" ? body.serviceId : null;
    const appVersion = String(body.appVersion ?? "").slice(0, 40) || null;
    const platform = String(body.platform ?? "").slice(0, 40) || null;

    const svc = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Servis se ověřuje, ne přebírá – jinak by šlo do hlášení napsat cizí id
    // a vytáhnout tak cizí chyby.
    let servisNazev: string | null = null;
    let clenem = false;
    if (serviceId) {
      const { data: clenstvi } = await svc
        .from("service_memberships")
        .select("service_id")
        .eq("service_id", serviceId)
        .eq("user_id", user.id)
        .maybeSingle();
      clenem = !!clenstvi;
      if (clenem) {
        const { data: s } = await svc.from("services").select("name").eq("id", serviceId).maybeSingle();
        servisNazev = (s as { name?: string } | null)?.name ?? null;
      }
    }

    let chyby: { code: string; message: string | null; created_at: string; source: string | null }[] = [];
    if (clenem && serviceId) {
      const { data } = await svc
        .from("error_logs")
        .select("code,message,created_at,source")
        .eq("service_id", serviceId)
        .order("created_at", { ascending: false })
        .limit(10);
      chyby = (data ?? []) as typeof chyby;
    }

    const key = Deno.env.get("RESEND_API_KEY")?.trim();
    if (!key) return json({ error: "Odesílání e-mailů zatím není nastavené." }, 503);
    const from = Deno.env.get("RESEND_FROM_EMAIL")?.trim() || "Jobi <onboarding@resend.dev>";

    const radky = [
      ["Servis", servisNazev ? `${servisNazev} (${serviceId})` : serviceId ?? "—"],
      ["Uživatel", `${user.email ?? "bez e-mailu"} (${user.id})`],
      ["Verze", appVersion ?? "—"],
      ["Platforma", platform ?? "—"],
      ["Odesláno", new Date().toISOString()],
    ];

    const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.6;color:#111">
<p style="margin:0 0 12px"><strong>Hlášení chyby z Jobi</strong></p>
<div style="white-space:pre-wrap;padding:12px 14px;background:#f6f7fb;border-radius:8px">${esc(zprava)}</div>
<table style="margin-top:16px;border-collapse:collapse;font-size:13px">
${radky.map(([k, v]) => `<tr><td style="padding:3px 12px 3px 0;color:#666">${esc(k)}</td><td style="padding:3px 0">${esc(v)}</td></tr>`).join("")}
</table>
${chyby.length > 0 ? `<p style="margin:18px 0 6px;font-size:13px;color:#666">Posledních ${chyby.length} chyb tohoto servisu:</p>
<ul style="margin:0;padding-left:18px;font-size:12px;color:#444">${chyby
      .map((c) => `<li>${esc(new Date(c.created_at).toLocaleString("cs-CZ"))} · ${esc(c.code)}${c.source ? ` (${esc(c.source)})` : ""} – ${esc((c.message ?? "").slice(0, 200))}</li>`)
      .join("")}</ul>` : `<p style="margin:18px 0 0;font-size:12px;color:#666">V logu servisu nejsou žádné chyby.</p>`}
</div>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        from,
        to: [PODPORA],
        // Odpovědět jde rovnou tomu, kdo hlásil.
        reply_to: user.email ? [user.email] : undefined,
        subject: `Jobi – hlášení chyby${servisNazev ? ` (${servisNazev})` : ""}`,
        html,
      }),
    });
    if (!res.ok) return json({ error: `Nepodařilo se odeslat: ${res.status}` }, 502);

    return json({ ok: true, errors_attached: chyby.length });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }

  function json(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] ?? c));
}
