import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { novyToken, otisk, nahled, ocistiRozsahy } from "../_shared/tokeny.ts";

/**
 * Správa tokenů pro zápis přes veřejné API.
 *
 *   { action: "list",   serviceId }                  – tokeny servisu, bez hashů
 *   { action: "create", serviceId, name, scopes }    – vytvoří a JEDNOU vrátí token
 *   { action: "revoke", serviceId, tokenId }         – zneplatní (nemaže)
 *
 * Smí jen owner nebo admin servisu. Řadový člen si nesmí vyrobit token na
 * zápis do ceníku – to je vyšší oprávnění, než jaké má v aplikaci samotné.
 *
 * Do tabulky se zapisuje výhradně odsud (service_role). Klient nemá na
 * api_tokens žádnou zapisovací politiku, jinak by šlo generování obejít
 * a uložit si vlastní známý hash.
 *
 * Zadání: docs/ZADANI_API.md, kapitola 5.
 */

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (telo: unknown, status = 200) =>
  new Response(JSON.stringify(telo), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Podporováno je jen POST" }, 405);

  const hlavicka = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!hlavicka) return json({ error: "Chybí přihlášení" }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const uzivatel = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: hlavicka } },
  });
  const { data: kdo, error: chybaUzivatele } = await uzivatel.auth.getUser();
  if (chybaUzivatele || !kdo?.user) return json({ error: "Nepřihlášený" }, 401);

  const telo = await req.json().catch(() => ({}));
  const serviceId = typeof telo?.serviceId === "string" ? telo.serviceId : "";
  const action = typeof telo?.action === "string" ? telo.action : "list";
  if (!serviceId) return json({ error: "Chybí serviceId" }, 400);

  const svc = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Oprávnění se ověřuje tady, ne přes RLS – funkce jede pod service_role,
  // takže by ji RLS stejně pustila všude.
  const { data: clenstvi } = await svc
    .from("service_memberships")
    .select("role")
    .eq("service_id", serviceId)
    .eq("user_id", kdo.user.id)
    .maybeSingle();

  if (!clenstvi || (clenstvi.role !== "owner" && clenstvi.role !== "admin")) {
    return json({ error: "Tokeny smí spravovat jen majitel nebo admin servisu" }, 403);
  }

  if (action === "list") {
    const { data, error } = await svc
      .from("api_tokens")
      .select("id, name, scopes, last_used_at, revoked_at, created_at")
      .eq("service_id", serviceId)
      .order("created_at", { ascending: false });
    if (error) return json({ error: error.message }, 500);
    return json({ tokens: data ?? [] });
  }

  if (action === "create") {
    const nazev = typeof telo?.name === "string" ? telo.name.trim() : "";
    if (!nazev) return json({ error: "Vyplň, k čemu token bude" }, 400);
    if (nazev.length > 60) return json({ error: "Název je moc dlouhý" }, 400);

    const rozsahy = ocistiRozsahy(telo?.scopes);
    if (rozsahy.length === 0) return json({ error: "Vyber aspoň jeden rozsah" }, 400);

    // Deset tokenů na servis je víc, než kdo potřebuje; brání to tomu, aby
    // se tabulka dala zaplnit ve smyčce.
    const { count } = await svc
      .from("api_tokens")
      .select("id", { count: "exact", head: true })
      .eq("service_id", serviceId)
      .is("revoked_at", null);
    if ((count ?? 0) >= 10) {
      return json({ error: "Servis má už 10 platných tokenů. Nepoužívané odvolej." }, 400);
    }

    const token = novyToken();
    const { data, error } = await svc
      .from("api_tokens")
      .insert({
        service_id: serviceId,
        name: nazev,
        token_hash: await otisk(token),
        scopes: rozsahy,
        created_by: kdo.user.id,
      })
      .select("id, name, scopes, created_at")
      .single();
    if (error) return json({ error: error.message }, 500);

    // Jediné místo, kde token opustí server. Dál je v databázi jen otisk.
    return json({ token, nahled: nahled(token), record: data });
  }

  if (action === "revoke") {
    const tokenId = typeof telo?.tokenId === "string" ? telo.tokenId : "";
    if (!tokenId) return json({ error: "Chybí tokenId" }, 400);
    const { error } = await svc
      .from("api_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", tokenId)
      .eq("service_id", serviceId)   // ať nejde odvolat token cizího servisu
      .is("revoked_at", null);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  return json({ error: `Neznámá akce "${action}"` }, 400);
});
