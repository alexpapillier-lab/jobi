/**
 * GDPR: anonymizace starých zákazníků a mazání jejich souborů.
 *
 * Databázi anonymizuje RPC `anonymizace_provest` (migrace 20260927120000).
 * Soubory – fotky zařízení a podpisy převzetí v bucketu `diagnostic-photos`
 * – z SQL smazat nejdou (Supabase přímé mazání ze storage.objects nedovolí),
 * proto je RPC jen zapíše do fronty `gdpr_anonymizace_log.soubory_cekaji`
 * a tady se mažou přes Storage API.
 *
 * Tři vstupy:
 *  1. `{ secret }` – denní pg_cron (gdpr_anonymizace_tick, tajemství
 *     z Vaultu). Nejdřív dočistí frontu souborů po všech dřívějších bězích,
 *     pak pro každý servis se zapnutým a RUČNĚ potvrzeným pravidlem
 *     (anonymizace_cron_servisy) spustí anonymizaci a smaže soubory.
 *  2. `{ serviceId, potvrzeni }` s tokenem správce – ruční spuštění
 *     z Nastavení → Firma → Ochrana údajů. Tady se to pouští pod
 *     service_role, protože přímé RPC z aplikace má časový limit dotazu
 *     (8 s) a první běh u velkého servisu ho může přetáhnout.
 *  3. `{ serviceId, mode: "soubory" }` s tokenem správce – jen dočistit
 *     frontu souborů servisu (když aplikace spustila RPC napřímo).
 *
 * Nasazení (verify_jwt = false v config.toml, identitu ověřuje sama):
 *   npx supabase functions deploy gdpr-anonymizace --no-verify-jwt
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type Svc = SupabaseClient<any, any, any>;

const BUCKET = "diagnostic-photos";
/** Storage API bere při mazání najednou rozumně jen desítky cest. */
const DAVKA = 100;
/** Stejné slovo jako POTVRZOVACI_SLOVO v src/lib/anonymizace.ts a v SQL. */
const POTVRZOVACI_SLOVO = "ANONYMIZOVAT";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function overitTajemstvi(svc: Svc, secret: string): Promise<boolean> {
  const { data, error } = await svc.rpc("gdpr_anonymizace_cron_secret");
  if (error) console.error("[gdpr-anonymizace] tajemství:", error.message);
  const ocekavane = typeof data === "string" ? data : "";
  if (!ocekavane || secret.length !== ocekavane.length) return false;
  let rozdil = 0;
  for (let i = 0; i < secret.length; i++) rozdil |= secret.charCodeAt(i) ^ ocekavane.charCodeAt(i);
  return rozdil === 0;
}

/**
 * Smaže soubory jednoho běhu a odškrtne je ve frontě. Maže jen cesty, které
 * servisu patří (jeho složka nebo podpisy) – fronta je sice zapsaná
 * v databázi funkcí, ale pojistka nic nestojí.
 */
async function smazSoubory(svc: Svc, logId: string, serviceId: string, cesty: string[]): Promise<{ smazano: number; chyba: string | null }> {
  const povolene = cesty.filter((c) => typeof c === "string" && (c.startsWith(`${serviceId}/`) || c.startsWith("signatures/")));
  const smazane: string[] = cesty.filter((c) => !povolene.includes(c)); // cizí cesty se jen vyřadí z fronty
  let chyba: string | null = null;
  for (let i = 0; i < povolene.length; i += DAVKA) {
    const davka = povolene.slice(i, i + DAVKA);
    const { error } = await svc.storage.from(BUCKET).remove(davka);
    if (error) {
      chyba = `Storage: ${error.message}`.slice(0, 500);
      break;
    }
    // Neexistující soubor Storage tiše přeskočí – i ten je „smazaný“.
    smazane.push(...davka);
  }
  const { error: e2 } = await svc.rpc("anonymizace_soubory_hotovo", { p_log_id: logId, p_smazane: smazane, p_chyba: chyba });
  if (e2) console.error("[gdpr-anonymizace] soubory_hotovo:", e2.message);
  return { smazano: smazane.length, chyba };
}

/** Dočistí frontu souborů (všech servisů, nebo jednoho). */
async function docistitFrontu(svc: Svc, serviceId?: string): Promise<{ behu: number; smazano: number; chyby: string[] }> {
  let dotaz = svc
    .from("gdpr_anonymizace_log")
    .select("id, service_id, soubory_cekaji")
    .neq("soubory_cekaji", "{}")
    .order("spusteno_at", { ascending: true })
    .limit(50);
  if (serviceId) dotaz = dotaz.eq("service_id", serviceId);
  const { data, error } = await dotaz;
  if (error) throw new Error(`fronta souborů: ${error.message}`);
  let smazano = 0;
  const chyby: string[] = [];
  for (const r of (data ?? []) as Array<{ id: string; service_id: string; soubory_cekaji: string[] }>) {
    const v = await smazSoubory(svc, r.id, r.service_id, r.soubory_cekaji ?? []);
    smazano += v.smazano;
    if (v.chyba) chyby.push(v.chyba);
  }
  return { behu: data?.length ?? 0, smazano, chyby };
}

type VysledekBehu = { logId: string | null; pocetZakazniku: number; pocetZakazekBezKarty: number; pocetZakazek: number; soubory: string[] };

async function provest(svc: Svc, serviceId: string, zdroj: "rucne" | "cron", spustil: string | null) {
  const { data, error } = await svc.rpc("anonymizace_provest", { p_service_id: serviceId, p_zdroj: zdroj, p_spustil: spustil });
  if (error) throw new Error(error.message);
  const beh = data as VysledekBehu;
  const soubory = beh.logId && beh.soubory.length > 0
    ? await smazSoubory(svc, beh.logId, serviceId, beh.soubory)
    : { smazano: 0, chyba: null };
  return { ...beh, soubory: undefined, pocetSouboru: beh.soubory.length, smazanoSouboru: soubory.smazano, chybaSouboru: soubory.chyba };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const svc: Svc = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));

    // 1) Denní cron.
    if (typeof body.secret === "string" && body.secret) {
      if (!(await overitTajemstvi(svc, body.secret))) return json({ error: "Unauthorized" }, 401);
      const fronta = await docistitFrontu(svc);
      const { data: servisy, error } = await svc.rpc("anonymizace_cron_servisy");
      if (error) throw new Error(`anonymizace_cron_servisy: ${error.message}`);
      const vysledky: unknown[] = [];
      for (const s of (servisy ?? []) as Array<{ service_id: string; po_letech: number }>) {
        try {
          const v = await provest(svc, s.service_id, "cron", null);
          if (v.logId) vysledky.push({ serviceId: s.service_id, ...v });
        } catch (e) {
          // Jeden servis nesmí zastavit ostatní.
          console.error("[gdpr-anonymizace] servis", s.service_id, e);
          vysledky.push({ serviceId: s.service_id, error: e instanceof Error ? e.message : String(e) });
        }
      }
      return json({ ok: true, fronta, servisu: (servisy ?? []).length, vysledky });
    }

    // 2) a 3) Správce servisu z aplikace.
    const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: userData, error: userErr } = await svc.auth.getUser(token);
    const user = userData?.user;
    if (userErr || !user) return json({ error: "Unauthorized" }, 401);

    const serviceId = typeof body.serviceId === "string" ? body.serviceId : "";
    if (!UUID.test(serviceId)) return json({ error: "Chybí serviceId." }, 400);
    const { data: clen } = await svc
      .from("service_memberships")
      .select("role")
      .eq("service_id", serviceId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!clen || !["owner", "admin"].includes((clen as { role: string }).role)) {
      return json({ error: "Anonymizaci může spustit jen majitel nebo správce servisu." }, 403);
    }

    if (body.mode === "soubory") {
      return json({ ok: true, fronta: await docistitFrontu(svc, serviceId) });
    }

    const potvrzeni = typeof body.potvrzeni === "string" ? body.potvrzeni.trim().toUpperCase() : "";
    if (potvrzeni !== POTVRZOVACI_SLOVO) return json({ error: `Pro spuštění napište slovo ${POTVRZOVACI_SLOVO}.` }, 400);

    const v = await provest(svc, serviceId, "rucne", user.id);
    return json({ ok: true, ...v });
  } catch (e) {
    console.error("[gdpr-anonymizace]", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
