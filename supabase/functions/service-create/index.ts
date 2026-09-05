/**
 * Edge Function: service-create
 *
 * Založení vlastního servisu po registraci. Do teď mohl servis vytvořit jen
 * majitel aplikace (invite_create v režimu „stock“), takže se nový zákazník
 * po registraci díval na prázdnou aplikaci a čekal, až mu servis někdo
 * založí. Tahle funkce to umožní jemu samotnému – stane se jeho majitelem.
 *
 * POST { name } → { service_id }
 *
 * Omezení: jeden uživatel si založí nejvýš MAX_SERVICES servisů. Není to
 * bezpečnostní hranice, jen zábrana proti tomu, aby jeden účet nadělal
 * stovky prázdných servisů.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_SERVICES = 3;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "Chybí přihlášení." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes?.user) return json({ error: "Neplatné přihlášení.", detail: userErr?.message }, 401);
    const userId = userRes.user.id;

    const body = await req.json().catch(() => ({}));
    const nazev = typeof body?.name === "string" ? body.name.trim() : "";
    if (!nazev) return json({ error: "Zadejte název servisu." }, 400);
    if (nazev.length > 80) return json({ error: "Název servisu je příliš dlouhý." }, 400);

    const svc = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { count, error: countErr } = await svc
      .from("service_memberships")
      .select("service_id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("role", "owner");
    if (countErr) return json({ error: `Nepodařilo se ověřit stávající servisy: ${countErr.message}` }, 500);
    if ((count ?? 0) >= MAX_SERVICES) {
      const kolik = count ?? 0;
      const slovo = kolik === 1 ? "servis" : kolik < 5 ? "servisy" : "servisů";
      return json({ error: `Máte už ${kolik} ${slovo}. Další vám na požádání založíme.` }, 403);
    }

    const { data: novy, error: serviceErr } = await svc
      .from("services")
      .insert({ name: nazev })
      .select("id")
      .single();
    if (serviceErr || !novy) return json({ error: `Servis se nepodařilo založit: ${serviceErr?.message ?? "neznámá chyba"}` }, 500);

    const { error: membershipErr } = await svc
      .from("service_memberships")
      .upsert({ service_id: novy.id, user_id: userId, role: "owner" }, { onConflict: "service_id,user_id" });
    if (membershipErr) {
      // Servis bez majitele by nikdo neviděl ani nesmazal – radši uklidit.
      await svc.from("services").delete().eq("id", novy.id);
      return json({ error: `Přiřazení majitele selhalo: ${membershipErr.message}` }, 500);
    }

    // Název servisu rovnou i do firemních údajů, ať se objeví na dokumentech
    // dřív, než je majitel doplní celé.
    await svc
      .from("service_settings")
      .upsert({ service_id: novy.id, config: { companyData: { name: nazev } } }, { onConflict: "service_id" })
      .then(() => {}, () => {});

    return json({ ok: true, service_id: novy.id });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
