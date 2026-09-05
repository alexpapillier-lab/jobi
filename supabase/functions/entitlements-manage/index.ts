/**
 * Edge Function: entitlements-manage
 *
 * Správa nároků servisů na placené moduly. Volat smí VÝHRADNĚ majitel
 * aplikace (root owner) – tabulka service_entitlements má RLS, která zápis
 * nikomu nepovoluje, takže se sem chodí přes service_role po ověření
 * identity. Stejný vzor jako services-list a error-logs-list.
 *
 * POST body:
 *   { action: "list" }                          – všechny nároky + názvy servisů
 *   { action: "grant", serviceId, module,
 *     validUntil?: string|null, note?: string,
 *     quota?: number|null }                      – udělí nebo obnoví; quota = počet
 *                                                  kusů (dnes poboček), null = bez omezení.
 *                                                  Neposlaná pole zůstanou beze změny.
 *   { action: "revoke", serviceId, module }      – zneplatní (nemaže, jen active=false)
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Moduly, které lze prodávat. Nový modul se přidá sem. */
const KNOWN_MODULES = ["sms", "invoices", "api_catalog", "api_inventory", "branches", "accounting"] as const;

/** Moduly, které se prodávají po kusech – u nich má smysl `quota`. */
const QUOTA_MODULES = ["branches"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
    if (!authHeader) return json({ error: "Missing authorization header" }, 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes?.user) return json({ error: "Unauthorized" }, 401);

    const rootOwnerId = Deno.env.get("ROOT_OWNER_ID")?.trim() || null;
    const isRootOwner =
      !!rootOwnerId && userRes.user.id.toLowerCase() === rootOwnerId.toLowerCase();
    if (!isRootOwner) return json({ error: "Forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const action = typeof body?.action === "string" ? body.action : "list";
    const svc = createClient(supabaseUrl, serviceKey);

    if (action === "list") {
      const { data: rows, error } = await svc
        .from("service_entitlements")
        .select("id, service_id, module, active, valid_until, note, quota, created_at, updated_at")
        .order("created_at", { ascending: false });
      if (error) return json({ error: error.message }, 500);

      const ids = [...new Set((rows ?? []).map((r) => r.service_id))];
      const names: Record<string, string> = {};
      if (ids.length) {
        const { data: services } = await svc.from("services").select("id, name").in("id", ids);
        for (const s of services ?? []) names[s.id as string] = (s.name as string) ?? "";
      }

      // Kolik poboček servisy opravdu mají – ať je u limitu vidět „3 z 5“.
      const branchCounts: Record<string, number> = {};
      const { data: branchRows } = await svc.from("branches").select("service_id");
      for (const b of branchRows ?? []) {
        const id = b.service_id as string;
        branchCounts[id] = (branchCounts[id] ?? 0) + 1;
      }

      return json({
        ok: true,
        modules: KNOWN_MODULES,
        quotaModules: QUOTA_MODULES,
        branchCounts,
        entitlements: (rows ?? []).map((r) => ({ ...r, service_name: names[r.service_id] ?? null })),
      });
    }

    const serviceId = typeof body?.serviceId === "string" ? body.serviceId : "";
    const module = typeof body?.module === "string" ? body.module : "";
    if (!serviceId || !module) return json({ error: "Chybí serviceId nebo module." }, 400);
    if (!KNOWN_MODULES.includes(module as (typeof KNOWN_MODULES)[number])) {
      return json({ error: `Neznámý modul "${module}". Známé: ${KNOWN_MODULES.join(", ")}` }, 400);
    }

    // Ověřit, že servis existuje – jinak by šlo založit nárok na překlep.
    const { data: service } = await svc.from("services").select("id").eq("id", serviceId).maybeSingle();
    if (!service) return json({ error: "Servis nenalezen." }, 404);

    if (action === "grant") {
      // Pole, která tělo neposlalo, se nepřepisují – jinak by nastavení počtu
      // poboček smazalo poznámku i platnost, které se nastavovaly zvlášť.
      const { data: existing } = await svc
        .from("service_entitlements")
        .select("valid_until, note, quota")
        .eq("service_id", serviceId)
        .eq("module", module)
        .maybeSingle();

      const validUntil = "validUntil" in (body ?? {})
        ? (typeof body.validUntil === "string" && body.validUntil.trim() ? body.validUntil : null)
        : (existing?.valid_until ?? null);
      const note = "note" in (body ?? {})
        ? (typeof body.note === "string" && body.note.trim() ? body.note : null)
        : (existing?.note ?? null);

      let quota: number | null;
      if ("quota" in (body ?? {})) {
        if (body.quota === null || body.quota === "" || body.quota === undefined) {
          quota = null;
        } else {
          const n = Number(body.quota);
          if (!Number.isInteger(n) || n < 1) {
            return json({ error: "Počet musí být celé číslo aspoň 1 (nebo prázdné = bez omezení)." }, 400);
          }
          quota = n;
        }
      } else {
        quota = existing?.quota ?? null;
      }
      if (quota !== null && !QUOTA_MODULES.includes(module)) {
        return json({ error: `Modul "${module}" se nepočítá na kusy.` }, 400);
      }

      const { error } = await svc.from("service_entitlements").upsert(
        {
          service_id: serviceId,
          module,
          active: true,
          valid_until: validUntil,
          note,
          quota,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "service_id,module" }
      );
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, granted: { serviceId, module, validUntil, quota } });
    }

    if (action === "revoke") {
      // Záměrně se nemaže – historie, kdo co kdy měl, je k něčemu dobrá.
      const { error } = await svc
        .from("service_entitlements")
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq("service_id", serviceId)
        .eq("module", module);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, revoked: { serviceId, module } });
    }

    return json({ error: `Neznámá akce "${action}".` }, 400);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
