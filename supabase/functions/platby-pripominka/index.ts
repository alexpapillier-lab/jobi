/**
 * Připomínka plateb servisů majiteli aplikace.
 *
 * Denně (pg_cron → platby_tick → sem, s tajemstvím z Vaultu) projde
 * platby_prehled za aktuální měsíc a majiteli aplikace (root_owner_id)
 * pošle e-mail, když má některý servis dnes den platby a nezaplatil,
 * nebo je po splatnosti – pak znovu každé 3 dny, dokud platba nepřijde.
 *
 * Stejné pravidlo stavu jako src/lib/platbyServisu.ts (stavPlatby).
 *
 * Volání: { secret } z cronu, nebo přihlášený root owner s { mode: "test" }
 * (pošle e-mail hned, i když nikdo nedluží – ke zkoušce z Owneru).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type Svc = SupabaseClient<any, any, any>;
type Radek = { serviceId: string; nazev: string; aktivniServis: boolean; cenaMesicne: number; denPlatby: number; aktivni: boolean; obdobi: string; zaplacenoAt: string | null; posledniObdobi: string | null };

function castiVPraze(d: Date): { rok: number; mesic: number; den: number } {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Prague", year: "numeric", month: "numeric", day: "numeric" });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(d)) p[x.type] = x.value;
  return { rok: Number(p.year), mesic: Number(p.month), den: Number(p.day) };
}

function dniPoSplatnosti(denPlatby: number, obdobi: string, dnes: { rok: number; mesic: number; den: number }): number {
  const [r, m] = obdobi.split("-").map(Number);
  const splatnost = Date.UTC(r, m - 1, Math.min(Math.max(denPlatby, 1), 28));
  const d0 = Date.UTC(dnes.rok, dnes.mesic - 1, dnes.den);
  return Math.round((d0 - splatnost) / 86_400_000);
}

const kc = (n: number) => `${new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 0 }).format(Number(n) || 0)} Kč`;

async function overitTajemstvi(svc: Svc, secret: string): Promise<boolean> {
  const { data, error } = await svc.rpc("platby_cron_secret");
  if (error) console.error("[platby-pripominka] tajemství:", error.message);
  const ocekavane = typeof data === "string" ? data : "";
  if (!ocekavane || secret.length !== ocekavane.length) return false;
  let rozdil = 0;
  for (let i = 0; i < secret.length; i++) rozdil |= secret.charCodeAt(i) ^ ocekavane.charCodeAt(i);
  return rozdil === 0;
}

async function emailMajitele(svc: Svc): Promise<string | null> {
  const { data: id } = await svc.rpc("root_owner_id");
  if (typeof id !== "string" || !id) return null;
  const { data } = await svc.auth.admin.getUserById(id);
  return data?.user?.email ?? null;
}

async function odeslat(prijemce: string, dluzi: Array<Radek & { dni: number }>, obdobi: string, zkusebni: boolean): Promise<{ ok: boolean; error?: string }> {
  const key = Deno.env.get("RESEND_API_KEY")?.trim();
  if (!key) return { ok: false, error: "Chybí RESEND_API_KEY." };
  const from = Deno.env.get("RESEND_FROM_EMAIL")?.trim() || "Jobi <onboarding@resend.dev>";
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
  const celkem = dluzi.reduce((s, d) => s + (Number(d.cenaMesicne) || 0), 0);
  const radky = dluzi.map((d) => `<tr><td style="padding:6px 0">${esc(d.nazev)}</td><td style="padding:6px 0;text-align:right;font-weight:700">${kc(d.cenaMesicne)}</td><td style="padding:6px 0 6px 12px;color:#64748b;font-size:12px">${d.dni === 0 ? "dnes" : `${d.dni} dní po splatnosti`}</td></tr>`).join("");
  const predmet = `${zkusebni ? "[Zkušební] " : ""}${dluzi.length === 0 ? "Platby servisů: nikdo nedluží" : `Platby servisů: ${dluzi.length === 1 ? "1 servis má zaplatit" : `${dluzi.length} servisů má zaplatit`} (${kc(celkem)})`}`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f1f5f9;padding:24px"><table cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:20px 24px"><tr><td><div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#64748b">JOBI · PLATBY SERVISŮ</div><div style="font-size:20px;font-weight:800;margin:4px 0 12px">${esc(obdobi)}</div>${dluzi.length === 0 ? '<p style="margin:0;color:#334155">Za tento měsíc nikdo nedluží.</p>' : `<table width="100%" style="border-collapse:collapse">${radky}</table><p style="margin:12px 0 0;color:#64748b;font-size:12px">Zaplacení zapište v Jobi → Nastavení → Owner → Platby servisů. Připomínka chodí v den platby a pak každé 3 dny.</p>`}</td></tr></table></body></html>`;
  const text = [`Platby servisů ${obdobi}`, ...dluzi.map((d) => `${d.nazev}: ${kc(d.cenaMesicne)} (${d.dni === 0 ? "dnes" : `${d.dni} dní po splatnosti`})`), dluzi.length === 0 ? "Nikdo nedluží." : ""].join("\n");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ from, to: [prijemce], subject: predmet, text, html }),
  });
  if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${(await res.text()).slice(0, 300)}` };
  return { ok: true };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const svc: Svc = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    let zkusebni = false;
    if (typeof body.secret === "string" && body.secret) {
      if (!(await overitTajemstvi(svc, body.secret))) return json({ error: "Unauthorized" }, 401);
    } else {
      const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
      if (!authHeader) return json({ error: "Unauthorized" }, 401);
      const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
      const { data: jeRoot } = await userClient.rpc("je_root_owner");
      if (jeRoot !== true) return json({ error: "Jen majitel aplikace." }, 403);
      zkusebni = body.mode === "test";
    }

    const dnes = castiVPraze(new Date());
    const obdobi = `${dnes.rok}-${String(dnes.mesic).padStart(2, "0")}`;
    const { data, error } = await svc.rpc("platby_prehled", { p_obdobi: obdobi });
    if (error) throw new Error(`platby_prehled: ${error.message}`);
    const radky = (Array.isArray(data) ? data : []) as Radek[];
    const dluzi = radky
      .filter((r) => r.aktivni && r.aktivniServis !== false && Number(r.cenaMesicne) > 0 && !r.zaplacenoAt)
      .map((r) => ({ ...r, dni: dniPoSplatnosti(Number(r.denPlatby) || 1, obdobi, dnes) }))
      .filter((r) => r.dni >= 0)
      .sort((a, b) => b.dni - a.dni);
    // Z cronu: jen v den platby a pak každý třetí den; zkouška z aplikace vždy.
    const poslat = zkusebni || dluzi.some((r) => r.dni % 3 === 0);
    if (!poslat) return json({ ok: true, odeslano: false, dluzi: dluzi.length });

    const prijemce = await emailMajitele(svc);
    if (!prijemce) return json({ error: "Majitel aplikace nemá e-mail." }, 400);
    const vysledek = await odeslat(prijemce, dluzi, obdobi, zkusebni);
    if (!vysledek.ok) return json({ error: vysledek.error }, 502);
    return json({ ok: true, odeslano: true, prijemce, dluzi: dluzi.length });
  } catch (e) {
    console.error("[platby-pripominka]", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
