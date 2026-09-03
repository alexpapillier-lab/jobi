import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cenoveVarianty } from "../_shared/ceny.ts";
import { popisCasu } from "../_shared/cas.ts";
import { viditelneVetve } from "../_shared/viditelnost.ts";
import { otiskKlienta, vyhodnotLimit } from "../_shared/limity.ts";

/**
 * Veřejný ceník servisu. Bez přihlášení, ke čtení z webu.
 *
 *   GET https://api.appjobi.com/v1/catalog?service=<slug>
 *   (přímo: /functions/v1/public-catalog?service=<slug>)
 *
 * Podmínky, aby něco vrátil:
 *   - servis má vyplněný public_slug
 *   - má aktivní modul `api_catalog` (Nastavení → Owner)
 *
 * Co se ven NEDOSTANE: repairs.costs (náklady servisu, tedy marže),
 * interní service_id, order_index, created_at. Sloupce se vypisují
 * jmenovitě – žádné select *.
 *
 * Zadání: docs/ZADANI_API.md
 */

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, if-none-match",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Expose-Headers": "etag",
};

const json = (telo: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(telo), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8", ...extra },
  });

/** Slabý ETag z obsahu – ať web nestahuje ceník, který se nezměnil. */
async function etag(data: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  const hash = await crypto.subtle.digest("SHA-1", bytes);
  const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `W/"${hex.slice(0, 16)}"`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  // HEAD posílají CDN i nástroje na kontrolu dostupnosti; runtime u něj tělo
  // sám zahodí, takže stačí ho pustit dál jako GET.
  if (req.method !== "GET" && req.method !== "HEAD") {
    return json({ error: "Podporováno je jen GET" }, 405);
  }

  const slug = new URL(req.url).searchParams.get("service")?.trim().toLowerCase() ?? "";
  if (!slug) return json({ error: "Chybí parametr service" }, 400);

  const svc = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: servis } = await svc
    .from("services")
    .select("id, name, vat_payer, default_vat_rate, prices_include_vat")
    .eq("public_slug", slug)
    .maybeSingle();

  // Neexistující servis a vypnutý modul vracejí totéž, aby přes tenhle
  // endpoint nešlo zjišťovat, které slugy existují.
  const nenalezeno = () => json({ error: "Ceník není k dispozici" }, 404);
  if (!servis) return nenalezeno();

  const { data: modul } = await svc
    .from("service_entitlements")
    .select("active, valid_until")
    .eq("service_id", servis.id)
    .eq("module", "api_catalog")
    .maybeSingle();

  const platny = modul?.active === true &&
    (!modul.valid_until || new Date(modul.valid_until).getTime() > Date.now());
  if (!platny) return nenalezeno();

  // Limit se počítá až tady – neexistující slug nesmí jít použít k tomu,
  // aby někomu vyčerpal jeho limit.
  const { data: pocty } = await svc.rpc("api_zapocitej_cteni", {
    p_service_id: servis.id,
    p_klic: await otiskKlienta(req),
    p_endpoint: "catalog",
  });
  const radek = Array.isArray(pocty) ? pocty[0] : pocty;
  const limit = vyhodnotLimit(Number(radek?.za_servis ?? 0), Number(radek?.za_klic ?? 0));
  if (limit.prekroceno) {
    return json({ error: limit.duvod }, 429, { "Retry-After": "60" });
  }

  // Řazení je povinné, ne kosmetika: bez ORDER BY vrací Postgres řádky
  // v proměnlivém pořadí, otisk pro ETag se pak mění mezi dvěma stejnými
  // dotazy a cachování je k ničemu. Web by navíc dostával ceník pokaždé
  // jinak seřazený. Pořadí odpovídá tomu, co uživatel vidí v aplikaci.
  const [znacky, kategorie, modely, opravy] = await Promise.all([
    // device_brands jako jediná z těchhle tabulek order_index nemá
    svc.from("device_brands").select("id, name").eq("service_id", servis.id).eq("public_visible", true).order("name").order("id"),
    svc.from("device_categories").select("id, brand_id, name").eq("service_id", servis.id).eq("public_visible", true).order("order_index").order("id"),
    svc.from("device_models").select("id, category_id, name").eq("service_id", servis.id).eq("public_visible", true).order("order_index").order("id"),
    // costs se nevybírá záměrně
    svc.from("repairs").select("id, name, price, estimated_time, details, model_ids, public_hidden_model_ids").eq("service_id", servis.id).eq("public_visible", true).order("order_index").order("id"),
  ]);

  // Když dotaz selže, .data je null a bez tohohle by ven odešel prázdný,
  // ale úspěšný ceník – tedy vyprázdněný web zákazníka. Radši chyba.
  const selhalo = [znacky, kategorie, modely, opravy].find((r) => r.error);
  if (selhalo) {
    console.error("[public-catalog] dotaz selhal:", selhalo.error?.message);
    return json({ error: "Ceník se teď nepodařilo načíst" }, 503, { "Retry-After": "30" });
  }

  const { kategorie: viditelneKategorie, modely: viditelneModely, idModelu } =
    viditelneVetve(znacky.data ?? [], kategorie.data ?? [], modely.data ?? []);

  // Modely, u kterých se oprava zveřejní: musí být samy viditelné a nesmí být
  // vyjmenované ve výjimkách té opravy. Výjimky řeší případ „reinstalaci
  // nabízíme u všech iPhonů kromě 6s“ – model_ids se kvůli tomu nesahá,
  // uvnitř aplikace se oprava na zakázce vybírá dál.
  const modelyOpravy = (r: { model_ids: unknown; public_hidden_model_ids?: unknown }) => {
    const vsechny = Array.isArray(r.model_ids) ? (r.model_ids as string[]) : [];
    const vyjimky = new Set(
      Array.isArray(r.public_hidden_model_ids) ? (r.public_hidden_model_ids as string[]) : [],
    );
    return vsechny.filter((id) => idModelu.has(id) && !vyjimky.has(id));
  };

  const platce = servis.vat_payer !== false;
  const sazba = Number(servis.default_vat_rate ?? 21);
  const vcetne = servis.prices_include_vat !== false;

  const vystup = {
    service: { name: servis.name, slug },
    vat: { payer: platce, rate: platce ? sazba : 0, prices_include_vat: vcetne },
    brands: znacky.data ?? [],
    categories: viditelneKategorie,
    models: viditelneModely,
    // Oprava vázaná jen na skryté modely ven nepatří – jinak by u schované
    // větve zůstal veřejně viditelný název i cena, jen bez modelů. Opravy,
    // které model nemají od začátku (obecné úkony), se nechávají být.
    repairs: (opravy.data ?? []).filter((r) => {
      const modelIds = Array.isArray(r.model_ids) ? r.model_ids : [];
      return modelIds.length === 0 || modelyOpravy(r).length > 0;
    }).map((r) => {
      const modelIds = modelyOpravy(r);
      return {
        id: r.id,
        name: r.name,
        ...cenoveVarianty(Number(r.price ?? 0), sazba, vcetne, platce),
        estimated_time: r.estimated_time,
        // Syrové minuty (10080) se na web napsat nedají – posíláme i podobu
        // pro člověka, ať to nemusí řešit každý web zvlášť.
        estimated_time_label: popisCasu(r.estimated_time),
        details: r.details ?? "",
        model_ids: modelIds,
      };
    }),
    generated_at: new Date().toISOString(),
  };

  // generated_at se do otisku nezapočítává, jinak by ETag nikdy nesouhlasil
  const { generated_at: _, ...proOtisk } = vystup;
  const tag = await etag(proOtisk);
  if (req.headers.get("if-none-match") === tag) {
    return new Response(null, { status: 304, headers: { ...cors, ETag: tag, "Cache-Control": "public, max-age=300" } });
  }

  return json(vystup, 200, { ETag: tag, "Cache-Control": "public, max-age=300" });
});
