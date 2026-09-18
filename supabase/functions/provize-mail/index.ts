import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { escapeHtml } from "../_shared/html.ts";
import { formatujCastku, formatujDatum } from "../_shared/penize.ts";

/**
 * E-mail se souhrnem vyúčtování provizí – to, co dřív posílal Apps Script nad
 * Google tabulkou. Volá ho stránka Owner → Provize hned po vyúčtování (nebo
 * tlačítkem „Poslat znovu“).
 *
 * Jen pro majitele aplikace: volající se ověří tokenem a databázovou funkcí
 * je_root_owner(); data se pak čtou pod service_role, protože tabulky provize_*
 * nikoho jiného nepustí.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Polozka = { zakazka_kod: string; poradi: number; zaklad: number; provize: number; ticket_id: string | null };

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return json({ error: "Unauthorized" }, 401);
    const { data: jeRoot, error: eRoot } = await userClient.rpc("je_root_owner");
    if (eRoot || jeRoot !== true) return json({ error: "Jen majitel aplikace." }, 403);

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const vyuctovaniId = Number(body.vyuctovaniId);
    if (!Number.isFinite(vyuctovaniId)) return json({ error: "Chybí vyuctovaniId." }, 400);

    const svc = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: v, error: eV } = await svc.from("provize_vyuctovani").select("id, service_id, oznaceni, pocet, soucet_zaklad, soucet_provize, created_at").eq("id", vyuctovaniId).maybeSingle();
    if (eV) throw new Error(eV.message);
    if (!v) return json({ error: "Vyúčtování neexistuje." }, 404);

    const [{ data: servis }, { data: nast }, { data: polozkyRaw, error: eP }] = await Promise.all([
      svc.from("services").select("name").eq("id", v.service_id).maybeSingle(),
      svc.from("provize_nastaveni").select("email").eq("service_id", v.service_id).maybeSingle(),
      svc.from("provize_polozky").select("zakazka_kod, poradi, zaklad, provize, ticket_id").eq("vyuctovani_id", v.id).order("zapsano_at", { ascending: true }),
    ]);
    if (eP) throw new Error(eP.message);
    const polozky = (polozkyRaw ?? []) as Polozka[];

    const ticketIds = [...new Set(polozky.map((p) => p.ticket_id).filter((x): x is string => !!x))];
    const zarizeni = new Map<string, string>();
    for (let i = 0; i < ticketIds.length; i += 200) {
      const { data: t } = await svc.from("tickets").select("id, title, device_label").in("id", ticketIds.slice(i, i + 200));
      for (const r of (t ?? []) as Array<{ id: string; title: string | null; device_label: string | null }>) {
        zarizeni.set(r.id, (r.title ?? "").trim() || (r.device_label ?? "").trim());
      }
    }

    const prijemce = ((nast as { email?: string | null } | null)?.email ?? "").trim() || userData.user.email || "";
    if (!prijemce) return json({ error: "Není kam poslat – chybí e-mail v nastavení provizí." }, 400);

    const key = Deno.env.get("RESEND_API_KEY")?.trim();
    if (!key) return json({ error: "Chybí RESEND_API_KEY v secrets edge funkcí." }, 500);
    const from = Deno.env.get("RESEND_FROM_EMAIL")?.trim() || "Jobi <onboarding@resend.dev>";

    const nazevServisu = (servis as { name?: string } | null)?.name ?? "servis";
    const predmet = `Vyúčtování provizí ${v.oznaceni} – ${nazevServisu}`;
    const kc = (n: number) => formatujCastku(Number(n) || 0, "CZK");

    const radkyHtml = polozky
      .map((p) => `<tr><td style="padding:6px 8px 6px 0;font-size:13px;color:#0f172a;white-space:nowrap">${escapeHtml(p.zakazka_kod)}${p.poradi > 0 ? ' <span style="color:#2563eb;font-size:11px">doplatek</span>' : ""}</td><td style="padding:6px 8px;font-size:12px;color:#64748b">${escapeHtml(zarizeni.get(p.ticket_id ?? "") ?? "")}</td><td style="padding:6px 0 6px 8px;font-size:13px;text-align:right;white-space:nowrap">${escapeHtml(kc(p.zaklad))}</td><td style="padding:6px 0 6px 12px;font-size:13px;text-align:right;font-weight:700;white-space:nowrap">${escapeHtml(kc(p.provize))}</td></tr>`)
      .join("");

    const html = [
      '<!DOCTYPE html><html><head><meta charset="utf-8"></head>',
      '<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;background:#f1f5f9">',
      '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 16px"><tr><td align="center">',
      '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)">',
      `<tr><td style="background:#0f172a;padding:24px 28px"><div style="color:#93c5fd;font-size:11px;font-weight:700;letter-spacing:0.08em">VYÚČTOVÁNÍ PROVIZÍ</div><div style="color:#fff;font-size:22px;font-weight:800;margin-top:4px">${escapeHtml(v.oznaceni)}</div><div style="color:#cbd5e1;font-size:12px;margin-top:4px">${escapeHtml(nazevServisu)} · ${escapeHtml(formatujDatum(v.created_at))}</div></td></tr>`,
      '<tr><td style="padding:20px 28px">',
      '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:16px">',
      `<tr><td style="padding:6px 0;color:#64748b;font-size:13px">Počet zakázek</td><td style="padding:6px 0;text-align:right;font-weight:700;font-size:15px;color:#0f172a">${v.pocet}</td></tr>`,
      `<tr><td style="padding:6px 0;color:#64748b;font-size:13px">Součet cen</td><td style="padding:6px 0;text-align:right;font-weight:700;font-size:15px;color:#0f172a">${escapeHtml(kc(v.soucet_zaklad))}</td></tr>`,
      `<tr><td style="padding:6px 0;color:#64748b;font-size:13px">Součet provizí</td><td style="padding:6px 0;text-align:right;font-weight:800;font-size:18px;color:#0f172a">${escapeHtml(kc(v.soucet_provize))}</td></tr>`,
      "</table>",
      polozky.length
        ? `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-top:1px solid #e2e8f0"><tr><th align="left" style="padding:8px 8px 4px 0;font-size:11px;color:#94a3b8;font-weight:600">Zakázka</th><th align="left" style="padding:8px 8px 4px;font-size:11px;color:#94a3b8;font-weight:600">Zařízení</th><th align="right" style="padding:8px 0 4px 8px;font-size:11px;color:#94a3b8;font-weight:600">Základ</th><th align="right" style="padding:8px 0 4px 12px;font-size:11px;color:#94a3b8;font-weight:600">Provize</th></tr>${radkyHtml}</table>`
        : "",
      "</td></tr></table>",
      '<p style="text-align:center;margin-top:16px;font-size:11px;color:#94a3b8">Odesláno z Jobi · Nastavení → Owner → Provize</p>',
      "</td></tr></table></body></html>",
    ].join("");

    const text = [
      `Vyúčtování provizí ${v.oznaceni} – ${nazevServisu}`,
      "",
      `Počet zakázek: ${v.pocet}`,
      `Součet cen: ${kc(v.soucet_zaklad)}`,
      `Součet provizí: ${kc(v.soucet_provize)}`,
      "",
      ...polozky.map((p) => `${p.zakazka_kod}${p.poradi > 0 ? " (doplatek)" : ""}  ${kc(p.zaklad)}  →  ${kc(p.provize)}`),
    ].join("\n");

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ from, to: [prijemce], subject: predmet, text, html }),
    });
    if (!res.ok) return json({ error: `Resend ${res.status}: ${(await res.text()).slice(0, 300)}` }, 502);
    return json({ ok: true, prijemce });
  } catch (e) {
    console.error("[provize-mail]", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
