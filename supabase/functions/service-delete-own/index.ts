/**
 * Edge Function: service-delete-own
 *
 * Smazání vlastního servisu i s daty a soubory. Do teď uměl servis smazat jen
 * `service-manage`, a to výhradně majiteli aplikace – zákazník, který chtěl
 * skončit nebo si jen zkusil druhou provozovnu, musel psát podporu. To je
 * zároveň špatně proti GDPR: právo na výmaz nemá viset na cizím člověku.
 *
 * POST { serviceId } → { ok: true, files_deleted }
 *
 * Proč vlastní funkce a ne další větev v `service-manage`: ta umí smazat
 * libovolný servis a schválně ji pouští jen jeden účet. Kdyby v ní přibyl
 * druhý způsob, jak se dostat k mazání, rozhodovalo by o osudu cizích servisů
 * jedno `if` navíc v kódu, který drží service_role klíč. Tady je jediné
 * povolení: volající musí být v `service_memberships` majitelem právě toho
 * servisu, který maže. Nic jiného funkce neumí.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Soubory servisu v úložišti: složka <service_id>/ a podpisy podle zakázek. */
async function souboryServisu(
  svc: ReturnType<typeof createClient>,
  serviceId: string,
): Promise<{ bucket: string; path: string }[]> {
  // PostgREST vystavuje jen public schéma, na storage.objects se proto chodí
  // přes RPC (viz migrace 20260906090000).
  const { data, error } = await svc.rpc("service_storage_objects", { p_service_id: serviceId });
  if (error) throw new Error(`storage.objects: ${error.message}`);
  return ((data ?? []) as { bucket_id: string; name: string }[]).map((r) => ({ bucket: r.bucket_id, path: r.name }));
}

/** Smaže soubory z úložiště – databáze se o ně sama nepostará. */
async function smazSoubory(
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
    for (let i = 0; i < cesty.length; i += 100) {
      const davka = cesty.slice(i, i + 100);
      const { error } = await svc.storage.from(bucket).remove(davka);
      if (error) throw new Error(`storage ${bucket}: ${error.message}`);
      smazano += davka.length;
    }
  }
  return smazano;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
    if (!authHeader) return json({ error: "Chybí přihlášení." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "Neplatné přihlášení.", detail: userErr?.message }, 401);

    const body = await req.json().catch(() => ({}));
    const serviceId = typeof body?.serviceId === "string" ? body.serviceId.trim() : "";
    // Bez tvaru UUID by se dál posílal cizí řetězec do dotazů; RPC by ho sice
    // odmítla, ale chyba by vypadala jako porucha, ne jako špatný vstup.
    if (!UUID.test(serviceId)) return json({ error: "Chybí nebo je neplatné serviceId." }, 400);

    const svc = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Jediné povolení téhle funkce. Ne „owner nebo admin“: admin spravuje
    // provoz, zrušit firmu smí jen ten, komu patří.
    const { data: clenstvi, error: clenstviErr } = await svc
      .from("service_memberships")
      .select("role")
      .eq("service_id", serviceId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (clenstviErr) return json({ error: `Nepodařilo se ověřit oprávnění: ${clenstviErr.message}` }, 500);
    if (!clenstvi || (clenstvi as { role?: string }).role !== "owner") {
      return json({ error: "Smazat servis smí jen jeho majitel." }, 403);
    }

    // Seznam souborů se pořizuje ještě před mazáním – podpisy se dohledávají
    // přes zakázky, které za chvíli nebudou existovat. Samotné smazání z
    // úložiště až potom, aby po neúspěšném mazání servisu (trigger, cizí klíč)
    // nezůstal servis bez fotek.
    let soubory: { bucket: string; path: string }[] = [];
    try {
      soubory = await souboryServisu(svc, serviceId);
    } catch (e) {
      return json({ error: `Nepodařilo se načíst soubory servisu: ${e instanceof Error ? e.message : String(e)}` }, 500);
    }

    // Mazání přes RPC, které nastaví session proměnnou, aby triggery nebránily
    // kaskádě (poslední vlastník, výchozí pobočka).
    const { error: deleteErr } = await svc.rpc("delete_service_for_root", { p_service_id: serviceId });
    if (deleteErr) return json({ error: `Servis se nepodařilo smazat: ${deleteErr.message}` }, 500);

    // Servis je pryč; kdyby soubory zůstaly, je to potřeba říct nahlas –
    // v úložišti by po nich zůstaly osobní údaje zákazníků.
    let smazanoSouboru = 0;
    try {
      smazanoSouboru = await smazSoubory(svc, soubory);
    } catch (e) {
      return json({
        error: `Servis byl smazán, ale ${soubory.length} souborů zůstalo v úložišti: ${e instanceof Error ? e.message : String(e)}`,
      }, 500);
    }

    return json({ ok: true, files_deleted: smazanoSouboru });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
