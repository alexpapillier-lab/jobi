import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Hlídač provozu. Jednou za hodinu se podívá, jestli se něco neděje, a když
 * ano, pošle e-mail. Volá ho pg_cron přes `public.alerts_tick()` se sdíleným
 * tajemstvím z Vaultu; ručně jde spustit i s tokenem root ownera, aby se dal
 * vyzkoušet.
 *
 * Záměrně hlídá jen málo věcí, ale takových, které znamenají „zákazník teď
 * nemůže pracovat“. Upozornění, které chodí zbytečně, si člověk za týden
 * odfiltruje do koše a pak přehlédne i to důležité.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Kolik chyb za hodinu už není normální provoz. */
const PRAH_CHYB = 5;
/** Kolik pádů aplikace stačí – pád znamená bílou obrazovku u zákazníka. */
const PRAH_PADU = 2;
/** Stejné upozornění se neopakuje dřív než za tolik hodin. */
const TICHO_HODIN = 6;

type Podnet = { druh: string; nadpis: string; podrobnosti: string[] };

/** „90 minut“ se čte hůř než „1,5 hodiny“ – v předmětu e-mailu to vadí. */
function popisOkna(minut: number): string {
  if (minut < 120) return `${minut} minut`;
  const h = minut / 60;
  const cele = Number.isInteger(h) ? String(h) : h.toFixed(1).replace(".", ",");
  return `${cele} ${h === 1 ? "hodinu" : h < 5 ? "hodiny" : "hodin"}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const svc = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const povoleno = await overitPristup(req, body, svc, supabaseUrl);
    if (!povoleno) {
      return json({ error: "Unauthorized" }, 401);
    }

    const oknoMinut = Number(body.windowMinutes) > 0 ? Math.min(1440, Number(body.windowMinutes)) : 60;
    const zkouska = body.dryRun === true;
    const od = new Date(Date.now() - oknoMinut * 60_000).toISOString();

    const podnety = await zjistitPodnety(svc, od, oknoMinut);
    if (podnety.length === 0) {
      return json({ ok: true, checked_since: od, alerts: 0 });
    }

    // Bez tlumení by při delším výpadku přišel e-mail každou hodinu.
    const poslane: string[] = [];
    const tlumene: string[] = [];
    for (const p of podnety) {
      if (await bylUzPoslan(svc, p.druh)) {
        tlumene.push(p.druh);
        continue;
      }
      poslane.push(p.druh);
    }
    const kOdeslani = podnety.filter((p) => poslane.includes(p.druh));
    if (kOdeslani.length === 0) {
      return json({ ok: true, checked_since: od, alerts: podnety.length, sent: 0, suppressed: tlumene });
    }

    if (zkouska) {
      return json({ ok: true, dryRun: true, checked_since: od, would_send: kOdeslani, suppressed: tlumene });
    }

    const komu = await adresat(svc);
    if (!komu) return json({ error: "Není kam upozornění poslat: nastav secret ALERT_EMAIL." }, 503);

    const vysledek = await odeslat(komu, kOdeslani, oknoMinut);
    if (!vysledek.ok) return json({ error: vysledek.error }, 502);

    for (const p of kOdeslani) {
      await svc.from("alert_events").insert({ kind: p.druh, detail: { nadpis: p.nadpis, podrobnosti: p.podrobnosti } });
    }
    return json({ ok: true, checked_since: od, sent: kOdeslani.map((p) => p.druh), suppressed: tlumene, to: komu });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }

  function json(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

/** Pustí dovnitř cron s tajemstvím z Vaultu, nebo root ownera s tokenem. */
async function overitPristup(
  req: Request,
  body: Record<string, unknown>,
  svc: ReturnType<typeof createClient>,
  supabaseUrl: string,
): Promise<boolean> {
  const secret = typeof body.secret === "string" ? body.secret : "";
  if (secret) {
    const { data } = await svc.rpc("alerts_cron_secret");
    const ocekavane = typeof data === "string" ? data : "";
    // Porovnání konstantní dobou – tajemství chodí zvenčí.
    if (ocekavane && secret.length === ocekavane.length) {
      let rozdil = 0;
      for (let i = 0; i < secret.length; i++) rozdil |= secret.charCodeAt(i) ^ ocekavane.charCodeAt(i);
      if (rozdil === 0) return true;
    }
    return false;
  }

  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!authHeader) return false;
  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  const rootOwnerId = Deno.env.get("ROOT_OWNER_ID")?.trim() || null;
  return !!user && !!rootOwnerId && user.id.toLowerCase() === rootOwnerId.toLowerCase();
}

/** Co se za poslední okno stalo a stojí za e-mail. */
async function zjistitPodnety(
  svc: ReturnType<typeof createClient>,
  od: string,
  oknoMinut: number,
): Promise<Podnet[]> {
  const podnety: Podnet[] = [];

  const { data: chyby, error } = await svc
    .from("error_logs")
    .select("code,message,service_id,app_version,created_at,context")
    .gte("created_at", od)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(`error_logs: ${error.message}`);
  type Radek = { code: string; message: string | null; service_id: string | null; app_version: string | null; context: Record<string, unknown> | null };
  // Chyby z vývojového serveru (hot reload) se zákazníka netýkají.
  const radky = ((chyby ?? []) as Radek[]).filter((r) => r.context?.dev !== true);

  const pady = radky.filter((r) => r.code === "react.render_crash");
  if (pady.length >= PRAH_PADU) {
    podnety.push({
      druh: "pady_aplikace",
      nadpis: `Aplikace spadla ${pady.length}× za posledních ${popisOkna(oknoMinut)}`,
      podrobnosti: shrnout(pady),
    });
  }

  // Zbytek chyb se počítá dohromady; jednotlivá chyba je běžný provoz.
  const ostatni = radky.filter((r) => r.code !== "react.render_crash");
  if (ostatni.length >= PRAH_CHYB) {
    podnety.push({
      druh: "hodne_chyb",
      nadpis: `${ostatni.length} chyb za posledních ${popisOkna(oknoMinut)}`,
      podrobnosti: shrnout(ostatni),
    });
  }

  // Jedna chyba, která se opakuje v jednom servisu, znamená, že tam někdo
  // pořád dokola naráží do stejné zdi.
  const podleKombinace = new Map<string, number>();
  for (const r of radky) {
    const k = `${r.code}|${r.service_id ?? "-"}`;
    podleKombinace.set(k, (podleKombinace.get(k) ?? 0) + 1);
  }
  for (const [k, n] of podleKombinace) {
    if (n < 10) continue;
    const [code, servis] = k.split("|");
    podnety.push({
      druh: `opakovana_chyba:${code}`,
      nadpis: `Chyba ${code} se opakuje ${n}× v jednom servisu`,
      podrobnosti: [`servis ${servis}`, ...shrnout(radky.filter((r) => r.code === code).slice(0, 3))],
    });
  }

  return podnety;
}

function shrnout(radky: { code: string; message: string | null; app_version: string | null }[]): string[] {
  const podle = new Map<string, { n: number; ukazka: string; verze: string | null }>();
  for (const r of radky) {
    const z = podle.get(r.code) ?? { n: 0, ukazka: (r.message ?? "").slice(0, 160), verze: r.app_version };
    z.n += 1;
    podle.set(r.code, z);
  }
  return [...podle.entries()]
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, 6)
    .map(([code, z]) => `${z.n}× ${code}${z.verze ? ` (verze ${z.verze})` : ""}${z.ukazka ? ` – ${z.ukazka}` : ""}`);
}

async function bylUzPoslan(svc: ReturnType<typeof createClient>, druh: string): Promise<boolean> {
  const od = new Date(Date.now() - TICHO_HODIN * 3600_000).toISOString();
  const { data } = await svc
    .from("alert_events")
    .select("id")
    .eq("kind", druh)
    .gte("sent_at", od)
    .limit(1);
  return (data ?? []).length > 0;
}

/** Komu psát: secret ALERT_EMAIL, jinak e-mail root ownera. */
async function adresat(svc: ReturnType<typeof createClient>): Promise<string | null> {
  const zSecrets = Deno.env.get("ALERT_EMAIL")?.trim();
  if (zSecrets) return zSecrets;
  const rootOwnerId = Deno.env.get("ROOT_OWNER_ID")?.trim();
  if (!rootOwnerId) return null;
  const { data } = await svc.auth.admin.getUserById(rootOwnerId);
  return data?.user?.email ?? null;
}

async function odeslat(komu: string, podnety: Podnet[], oknoMinut: number): Promise<{ ok: boolean; error?: string }> {
  const key = Deno.env.get("RESEND_API_KEY")?.trim();
  if (!key) return { ok: false, error: "Chybí RESEND_API_KEY." };
  const from = Deno.env.get("RESEND_FROM_EMAIL")?.trim() || "Jobi <onboarding@resend.dev>";

  const nadpis = podnety.length === 1 ? podnety[0].nadpis : `${podnety.length} upozornění z Jobi`;
  const telo = podnety
    .map((p) => `<h3 style="margin:20px 0 6px;font-size:15px">${esc(p.nadpis)}</h3><ul style="margin:0;padding-left:18px;color:#444">${p.podrobnosti.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>`)
    .join("");
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.6;color:#111">
<p style="margin:0 0 4px"><strong>Hlídač provozu Jobi</strong></p>
<p style="margin:0;color:#666">Okno ${popisOkna(oknoMinut)}. Stejné upozornění se neopakuje dřív než za ${TICHO_HODIN} hodin.</p>
${telo}
<p style="margin:24px 0 0;color:#666;font-size:12px">Podrobnosti jsou v aplikaci v Nastavení → Owner → Chyby.</p>
</div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ from, to: [komu], subject: `Jobi: ${nadpis}`, html }),
  });
  if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${(await res.text()).slice(0, 300)}` };
  return { ok: true };
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] ?? c));
}
