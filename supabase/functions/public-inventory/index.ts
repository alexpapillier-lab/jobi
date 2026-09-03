import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cenoveVarianty } from "../_shared/ceny.ts";
import { dostupnost, rezimDostupnosti } from "../_shared/dostupnost.ts";
import { viditelneVetve } from "../_shared/viditelnost.ts";
import { otiskKlienta, vyhodnotLimit } from "../_shared/limity.ts";

/**
 * Veřejný sklad servisu. Bez přihlášení, ke čtení z webu.
 *
 *   GET https://api.appjobi.com/v1/inventory?service=<slug>
 *   (přímo: /functions/v1/public-inventory?service=<slug>)
 *
 * Podmínky, aby něco vrátil:
 *   - servis má vyplněný public_slug
 *   - má aktivní modul `api_inventory` (Nastavení → Owner)
 *
 * Záměrně oddělené od ceníku: servis může chtít zveřejnit ceník a sklad ne.
 * Kdo má zapnutý jen `api_catalog`, dostane odsud 404 – a naopak.
 *
 * Co se ven NEDOSTANE: přesný počet kusů, pokud si servis nezvolil režim
 * `exact`, dále interní service_id, order_index, created_at a vazba
 * repair_ids. Sloupce se vypisují jmenovitě – žádné select *.
 *
 * Nákupní cena (purchase_price) se posílá JEN když si servis zapne
 * `public_inventory_show_purchase_price`. Výchozí je false, protože
 * prozrazuje marži.
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

/** Slabý ETag z obsahu – ať web nestahuje sklad, který se nezměnil. */
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
    .select("id, name, vat_payer, default_vat_rate, prices_include_vat, inventory_availability_mode, public_inventory_show_purchase_price")
    .eq("public_slug", slug)
    .maybeSingle();

  // Neexistující servis a vypnutý modul vracejí totéž, aby přes tenhle
  // endpoint nešlo zjišťovat, které slugy existují.
  const nenalezeno = () => json({ error: "Sklad není k dispozici" }, 404);
  if (!servis) return nenalezeno();

  const { data: modul } = await svc
    .from("service_entitlements")
    .select("active, valid_until")
    .eq("service_id", servis.id)
    .eq("module", "api_inventory")
    .maybeSingle();

  const platny = modul?.active === true &&
    (!modul.valid_until || new Date(modul.valid_until).getTime() > Date.now());
  if (!platny) return nenalezeno();

  // Limit se počítá až tady – neexistující slug nesmí jít použít k tomu,
  // aby někomu vyčerpal jeho limit.
  const { data: pocty } = await svc.rpc("api_zapocitej_cteni", {
    p_service_id: servis.id,
    p_klic: await otiskKlienta(req),
    p_endpoint: "inventory",
  });
  const radek = Array.isArray(pocty) ? pocty[0] : pocty;
  const limit = vyhodnotLimit(Number(radek?.za_servis ?? 0), Number(radek?.za_klic ?? 0));
  if (limit.prekroceno) {
    return json({ error: limit.duvod }, 429, { "Retry-After": "60" });
  }

  const [kategorie, produkty, znacky, katZarizeni, modely] = await Promise.all([
    svc.from("inventory_product_categories").select("id, name").eq("service_id", servis.id).eq("public_visible", true).order("order_index").order("id"),
    svc.from("inventory_products")
      // public_stock, ne stock: do veřejné dostupnosti se počítají jen sklady,
      // které si servis označil. Dodavatelský sklad zákazníkům neslibujeme.
      .select("id, category_id, name, price, purchase_price, sku, description, image_url, model_ids, public_stock")
      .eq("service_id", servis.id).eq("public_visible", true).order("order_index").order("id"),
    // Zařízení jen kvůli tomu, ať produkt neukazuje na model, který servis
    // z ceníku schoval. Když má vypnutý ceník, nic tím neomezíme – sloupce
    // jsou ve výchozím stavu viditelné.
    svc.from("device_brands").select("id").eq("service_id", servis.id).eq("public_visible", true).order("id"),
    svc.from("device_categories").select("id, brand_id").eq("service_id", servis.id).eq("public_visible", true).order("id"),
    svc.from("device_models").select("id, category_id").eq("service_id", servis.id).eq("public_visible", true).order("id"),
  ]);

  const selhalo = [kategorie, produkty, znacky, katZarizeni, modely].find((r) => r.error);
  if (selhalo) {
    console.error("[public-inventory] dotaz selhal:", selhalo.error?.message);
    return json({ error: "Sklad se teď nepodařilo načíst" }, 503, { "Retry-After": "30" });
  }

  const { idModelu } = viditelneVetve(znacky.data ?? [], katZarizeni.data ?? [], modely.data ?? []);

  // Skrytá kategorie skryje i produkty pod sebou. Produkt bez kategorie
  // (category_id je nullable) se posílá dál – není co schovávat.
  const idKategorii = new Set((kategorie.data ?? []).map((c) => c.id));
  const viditelneProdukty = (produkty.data ?? [])
    .filter((p) => p.category_id === null || idKategorii.has(p.category_id));

  const platce = servis.vat_payer !== false;
  const sazba = Number(servis.default_vat_rate ?? 21);
  const vcetne = servis.prices_include_vat !== false;
  const rezim = rezimDostupnosti(servis.inventory_availability_mode);
  // Nákupní cena prozrazuje marži, takže se posílá jen na výslovné přání
  // servisu. Výchozí hodnota sloupce je false.
  const posilatNakupni = servis.public_inventory_show_purchase_price === true;

  const vystup = {
    service: { name: servis.name, slug },
    vat: { payer: platce, rate: platce ? sazba : 0, prices_include_vat: vcetne },
    availability_mode: rezim,
    categories: kategorie.data ?? [],
    products: viditelneProdukty.map((p) => {
      const stav = dostupnost(p.public_stock, rezim);
      const modelIds = Array.isArray(p.model_ids) ? p.model_ids : [];
      return {
        id: p.id,
        category_id: p.category_id,
        name: p.name,
        ...cenoveVarianty(Number(p.price ?? 0), sazba, vcetne, platce),
        sku: p.sku ?? null,
        description: p.description ?? "",
        image_url: p.image_url ?? null,
        // produkt nabízíme jen u modelů, které jsou samy viditelné
        model_ids: modelIds.filter((id: string) => idModelu.has(id)),
        // v režimu `hidden` se pole neposílá vůbec, ne jako null – ať web
        // nemusí řešit rozdíl mezi „nevíme“ a „není skladem“
        ...(stav === undefined ? {} : { availability: stav }),
        // Nákupní cena jen když si to servis zapnul. Když ne, pole ve
        // výstupu vůbec není – stejný princip jako u availability.
        ...(posilatNakupni && p.purchase_price !== null
          ? { purchase_price: Number(p.purchase_price) }
          : {}),
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
