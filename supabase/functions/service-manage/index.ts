import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * Tabulky, které se exportují podle service_id. Pořadí je jen kvůli
 * čitelnosti výsledného souboru – jde o kompletní obsah servisu.
 */
const SERVICE_TABLES = [
  "service_settings",
  "service_statuses",
  "service_memberships",
  "service_invites",
  "service_entitlements",
  "service_billing",
  "service_integrations",
  "service_phone_numbers",
  "service_document_settings",
  "service_document_templates",
  "document_profiles",
  "branches",
  "customers",
  "customer_history",
  "device_categories",
  "device_brands",
  "device_models",
  "repairs",
  "tickets",
  "ticket_comments",
  "ticket_history",
  "ticket_documents",
  "ticket_portal_events",
  "warranty_claims",
  "warranty_claim_history",
  "invoice_series",
  "invoices",
  "inventory_warehouses",
  "inventory_suppliers",
  "inventory_product_categories",
  "inventory_products",
  "inventory_stock",
  "inventory_reservations",
  "inventory_purchase_orders",
  "automation_rules",
  "automation_runs",
  "sms_automations",
  "sms_conversations",
  "api_tokens",
  "capture_tokens",
  "error_logs",
] as const;

/**
 * Sloupce, které se z exportu vyhazují: tajemství (hash tokenu, klíče k
 * integracím) by se v souboru předávaném zákazníkovi objevit neměla a k ničemu
 * mu nejsou – token se z hashe zpět nedopočítá.
 */
const REDACTED_COLUMNS: Record<string, string[]> = {
  api_tokens: ["token_hash"],
  capture_tokens: ["token"],
  service_integrations: ["config"],
};

/** Načte celou tabulku po tisícovkách, aby export nespadl na limitu dotazu. */
async function fetchAll(
  svc: ReturnType<typeof createClient>,
  table: string,
  column: string,
  value: string | string[],
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  const KROK = 1000;
  for (let od = 0; ; od += KROK) {
    let q = svc.from(table).select("*").range(od, od + KROK - 1);
    q = Array.isArray(value) ? q.in(column, value) : q.eq(column, value);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    const davka = (data ?? []) as Record<string, unknown>[];
    out.push(...davka);
    if (davka.length < KROK) break;
  }
  const skryt = REDACTED_COLUMNS[table];
  if (!skryt) return out;
  return out.map((r) => {
    const kopie = { ...r };
    for (const c of skryt) if (c in kopie) kopie[c] = null;
    return kopie;
  });
}

/** Rozdělí seznam id na dávky – `in` s tisíci hodnotami se do URL nevejde. */
function poDavkach(ids: string[], velikost = 200): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += velikost) out.push(ids.slice(i, i + velikost));
  return out;
}

async function fetchByParents(
  svc: ReturnType<typeof createClient>,
  table: string,
  column: string,
  ids: string[],
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (const davka of poDavkach(ids)) {
    out.push(...(await fetchAll(svc, table, column, davka)));
  }
  return out;
}

/** Kompletní obsah servisu jako jeden JSON – přenositelnost dat podle GDPR. */
async function exportService(svc: ReturnType<typeof createClient>, serviceId: string) {
  const tabulky: Record<string, Record<string, unknown>[]> = {};

  const { data: servis, error: servisErr } = await svc.from("services").select("*").eq("id", serviceId).maybeSingle();
  if (servisErr) throw new Error(`services: ${servisErr.message}`);
  if (!servis) throw new Error("Servis neexistuje.");
  tabulky.services = [servis as Record<string, unknown>];

  for (const t of SERVICE_TABLES) {
    tabulky[t] = await fetchAll(svc, t, "service_id", serviceId);
  }

  // Podřízené tabulky bez service_id se dotahují přes rodiče.
  const idsFaktur = (tabulky.invoices ?? []).map((r) => String(r.id));
  tabulky.invoice_items = await fetchByParents(svc, "invoice_items", "invoice_id", idsFaktur);
  tabulky.invoice_events = await fetchByParents(svc, "invoice_events", "invoice_id", idsFaktur);
  const idsObjednavek = (tabulky.inventory_purchase_orders ?? []).map((r) => String(r.id));
  tabulky.inventory_purchase_order_items = await fetchByParents(svc, "inventory_purchase_order_items", "order_id", idsObjednavek);
  const idsKonverzaci = (tabulky.sms_conversations ?? []).map((r) => String(r.id));
  tabulky.sms_messages = await fetchByParents(svc, "sms_messages", "conversation_id", idsKonverzaci);
  const idsCapture = (tabulky.capture_tokens ?? []).map((r) => String(r.id));
  tabulky.draft_capture_photos = await fetchByParents(svc, "draft_capture_photos", "capture_token_id", idsCapture);

  // Členové týmu jen jako přezdívka k user_id, ať se v exportu dá poznat, kdo
  // zakázku psal. Účty samotné do dat servisu nepatří a nevyváží se.
  const idsClenu = (tabulky.service_memberships ?? []).map((r) => String(r.user_id));
  tabulky.profiles = await fetchByParents(svc, "profiles", "id", idsClenu);

  // K souborům se přikládá jen seznam s odkazy; binárky by JSON nafoukly.
  const soubory = await listServiceFiles(svc, serviceId);

  const pocty: Record<string, number> = {};
  for (const [k, v] of Object.entries(tabulky)) pocty[k] = v.length;
  pocty.storage_files = soubory.length;

  return {
    format: "jobi-service-export",
    version: 1,
    exported_at: new Date().toISOString(),
    service_id: serviceId,
    counts: pocty,
    files: soubory,
    tables: tabulky,
  };
}

/** Soubory servisu v úložišti: složka <service_id>/ a podpisy podle zakázek. */
async function listServiceFiles(
  svc: ReturnType<typeof createClient>,
  serviceId: string,
): Promise<{ bucket: string; path: string; url: string }[]> {
  const out: { bucket: string; path: string; url: string }[] = [];
  // PostgREST vystavuje jen public schéma, na storage.objects se proto chodí
  // přes RPC (viz migrace 20260906090000); podpisy podle zakázek filtruje ona.
  const { data, error } = await svc.rpc("service_storage_objects", { p_service_id: serviceId });
  if (error) throw new Error(`storage.objects: ${error.message}`);
  for (const r of (data ?? []) as { bucket_id: string; name: string }[]) {
    out.push({
      bucket: r.bucket_id,
      path: r.name,
      url: `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/${r.bucket_id}/${r.name}`,
    });
  }
  return out;
}

/** Smaže soubory z úložiště – databáze se o ně sama nepostará. */
async function deleteFiles(
  svc: ReturnType<typeof createClient>,
  soubory: { bucket: string; path: string }[],
): Promise<number> {
  const podleBucketu = new Map<string, string[]>();
  for (const s of soubory) {
    const seznam = podleBucketu.get(s.bucket) ?? [];
    seznam.push(s.path);
    podleBucketu.set(s.bucket, seznam);
  }
  let smazano = 0;
  for (const [bucket, cesty] of podleBucketu) {
    for (const davka of poDavkach(cesty, 100)) {
      const { error } = await svc.storage.from(bucket).remove(davka);
      if (error) throw new Error(`storage ${bucket}: ${error.message}`);
      smazano += davka.length;
    }
  }
  return smazano;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", detail: userErr?.message }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const rootOwnerId = Deno.env.get("ROOT_OWNER_ID")?.trim() || null;
    const isRootOwner = !!rootOwnerId && user.id.toLowerCase() === rootOwnerId.toLowerCase();
    if (!isRootOwner) {
      return new Response(
        JSON.stringify({ error: "Only root owner can manage services" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { action, serviceId, name } = body;
    if (!action || !serviceId) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: action, serviceId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (action === "rename" && (name === undefined || typeof name !== "string")) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid field: name (string required for rename)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const POVOLENE = ["deactivate", "activate", "hardDelete", "rename", "export"];
    if (!POVOLENE.includes(action)) {
      return new Response(
        JSON.stringify({ error: `Invalid action. Must be one of: ${POVOLENE.join(", ")}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const svc = createClient(supabaseUrl, serviceKey);

    if (action === "export") {
      const data = await exportService(svc, serviceId);
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "deactivate") {
      const { error: updateErr } = await svc
        .from("services")
        .update({ active: false })
        .eq("id", serviceId);
      if (updateErr) {
        return new Response(
          JSON.stringify({ error: `Failed to deactivate: ${updateErr.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ ok: true, action: "deactivate" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "activate") {
      const { error: updateErr } = await svc
        .from("services")
        .update({ active: true })
        .eq("id", serviceId);
      if (updateErr) {
        return new Response(
          JSON.stringify({ error: `Failed to activate: ${updateErr.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ ok: true, action: "activate" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "rename") {
      const newName = String(name).trim() || "Servis";
      const { error: updateErr } = await svc
        .from("services")
        .update({ name: newName })
        .eq("id", serviceId);
      if (updateErr) {
        return new Response(
          JSON.stringify({ error: `Failed to rename: ${updateErr.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ ok: true, action: "rename", name: newName }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // hardDelete. Seznam souborů se pořizuje ještě před mazáním – podpisy se
    // dohledávají přes zakázky, které za chvíli nebudou existovat. Samotné
    // smazání z úložiště až potom, aby po neúspěšném mazání servisu (trigger,
    // cizí klíč) nezůstal servis bez fotek. Databáze se maže přes RPC, které
    // nastaví session proměnnou, aby triggery nebránily kaskádě (poslední
    // vlastník, výchozí pobočka).
    let soubory: { bucket: string; path: string; url: string }[] = [];
    try {
      soubory = await listServiceFiles(svc, serviceId);
    } catch (e) {
      return new Response(
        JSON.stringify({ error: `Failed to list files: ${e instanceof Error ? e.message : String(e)}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { error: deleteErr } = await svc.rpc("delete_service_for_root", { p_service_id: serviceId });
    if (deleteErr) {
      return new Response(
        JSON.stringify({ error: `Failed to delete service: ${deleteErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Servis je pryč; kdyby se soubory nepodařilo smazat, je to potřeba říct
    // nahlas, protože v úložišti by po nich zůstaly osobní údaje.
    let smazanoSouboru = 0;
    try {
      smazanoSouboru = await deleteFiles(svc, soubory);
    } catch (e) {
      return new Response(
        JSON.stringify({
          error: `Servis byl smazán, ale ${soubory.length} souborů zůstalo v úložišti: ${e instanceof Error ? e.message : String(e)}`,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    return new Response(
      JSON.stringify({ ok: true, action: "hardDelete", files_deleted: smazanoSouboru }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
