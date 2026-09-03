import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { otisk, PREFIX, type Rozsah } from "../_shared/tokeny.ts";
import { zmenyProduktu, zmenyOprav, otiskTela } from "../_shared/zapis.ts";

/**
 * Zápis přes veřejné API. Na rozdíl od čtení vyžaduje token.
 *
 *   POST https://api.appjobi.com/v1/write
 *   Authorization: Bearer jobi_…
 *   Idempotency-Key: <libovolný řetězec>      (volitelné, ale doporučené)
 *
 *   { "products": [{ "sku": "BAT-6S", "stock": 4 }],
 *     "repairs":  [{ "id": "…", "price": 1490 }] }
 *
 * Schválně se dá měnit jen to, co se v praxi mění zvenčí – počty kusů,
 * ceny a odhadovaný čas. Názvy, popisy ani vazby na modely ne: to je
 * úprava katalogu a patří do aplikace, kde je vidět souvislost.
 *
 * Limit 30 zápisů za minutu na token. Čtení se limituje na CDN, ne tady
 * (viz docs/ZADANI_API.md, kapitola Limity).
 *
 * Zadání: docs/ZADANI_API.md, kapitola 5.
 */

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  // Bez tohohle klient z prohlížeče nepozná, že dostal zopakovanou odpověď
  // a ne nově provedený zápis.
  "Access-Control-Expose-Headers": "idempotency-replayed, retry-after",
};

const json = (telo: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(telo), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8", ...extra },
  });

const LIMIT_ZA_MINUTU = 30;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Podporováno je jen POST" }, 405);

  const hlavicka = req.headers.get("Authorization") ?? "";
  const token = hlavicka.replace(/^Bearer\s+/i, "").trim();
  if (!token.startsWith(PREFIX)) {
    return json({ error: "Chybí token. Posílá se jako Authorization: Bearer jobi_…" }, 401);
  }

  const svc = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Hledá se podle otisku, samotný token v databázi není.
  const { data: zaznam } = await svc
    .from("api_tokens")
    .select("id, service_id, scopes, revoked_at")
    .eq("token_hash", await otisk(token))
    .maybeSingle();

  // Neplatný a odvolaný token vracejí totéž – ať se nedá zjišťovat,
  // který token existoval.
  if (!zaznam || zaznam.revoked_at) return json({ error: "Neplatný token" }, 401);

  const rozsahy = (zaznam.scopes ?? []) as Rozsah[];

  // Limit se počítá i pro požadavky, které nakonec spadnou na chybu –
  // jinak by šlo přes chybné požadavky zkoušet donekonečna.
  const { data: pocet } = await svc.rpc("api_zapocitej_zapis", { p_token_id: zaznam.id });
  if (typeof pocet === "number" && pocet > LIMIT_ZA_MINUTU) {
    return json(
      { error: `Překročen limit ${LIMIT_ZA_MINUTU} zápisů za minutu` },
      429,
      { "Retry-After": "60" },
    );
  }

  const telo = await req.json().catch(() => null);
  if (!telo || typeof telo !== "object") return json({ error: "Tělo není platný JSON" }, 400);

  const klic = req.headers.get("Idempotency-Key")?.trim() ?? "";
  const otiskT = await otiskTela(telo);

  if (klic) {
    const { data: drive } = await svc
      .from("api_idempotency")
      .select("otisk_tela, odpoved")
      .eq("token_id", zaznam.id)
      .eq("klic", klic)
      .maybeSingle();
    if (drive) {
      // Stejný klíč s jiným tělem je chyba klienta, ne opakování.
      if (drive.otisk_tela !== otiskT) {
        return json({ error: "Idempotency-Key už byl použit s jiným tělem" }, 409);
      }
      return json(drive.odpoved, 200, { "Idempotency-Replayed": "true" });
    }
  }

  const vysledek: Record<string, unknown> = {};
  const chyby: string[] = [];

  // --- produkty ---
  if (Array.isArray((telo as any).products)) {
    if (!rozsahy.includes("inventory:write")) {
      return json({ error: "Token nemá rozsah inventory:write" }, 403);
    }
    const { zmeny, chyby: ch } = zmenyProduktu((telo as any).products);
    chyby.push(...ch);
    let upraveno = 0;
    const nenalezeno: string[] = [];

    // Sklady servisu se načtou jednou, ne u každé položky.
    const { data: sklady } = await svc
      .from("inventory_warehouses")
      .select("id, name, is_default")
      .eq("service_id", zaznam.service_id)
      .order("order_index");
    const seznamSkladu = (sklady ?? []) as { id: string; name: string; is_default: boolean }[];
    const vychoziSkladId = seznamSkladu.find((w) => w.is_default)?.id ?? seznamSkladu[0]?.id ?? null;

    for (const z of zmeny) {
      // `stock` už není sloupec produktu, ale množství v konkrétním skladu.
      const { stock, ...sloupceProduktu } = z.hodnoty;

      // Nejdřív najít produkt – u zápisu podle SKU jinak neznáme jeho id.
      const hledani = svc.from("inventory_products").select("id").eq("service_id", zaznam.service_id);
      const { data: nalezene, error: chybaHledani } = z.id
        ? await hledani.eq("id", z.id)
        : await hledani.eq("sku", z.sku!);
      if (chybaHledani) {
        chyby.push(`${z.id ?? z.sku}: ${chybaHledani.message}`);
        continue;
      }
      if (!nalezene || nalezene.length === 0) {
        nenalezeno.push(z.id ?? z.sku!);
        continue;
      }

      let selhalo = false;
      if (Object.keys(sloupceProduktu).length > 0) {
        const { error } = await svc
          .from("inventory_products")
          .update(sloupceProduktu)
          .in("id", nalezene.map((p: { id: string }) => p.id));
        if (error) { chyby.push(`${z.id ?? z.sku}: ${error.message}`); selhalo = true; }
      }

      if (!selhalo && stock !== undefined) {
        const cil = z.sklad
          ? seznamSkladu.find((w) => w.id === z.sklad || w.name === z.sklad)?.id ?? null
          : vychoziSkladId;
        if (!cil) {
          chyby.push(`${z.id ?? z.sku}: sklad „${z.sklad ?? "výchozí"}“ neexistuje`);
          selhalo = true;
        } else {
          for (const p of nalezene as { id: string }[]) {
            // Nula znamená smazat řádek, ne uložit nulu – stejně jako v aplikaci.
            const { error } = stock === 0
              ? await svc.from("inventory_stock").delete().eq("product_id", p.id).eq("warehouse_id", cil)
              : await svc.from("inventory_stock").upsert(
                  { product_id: p.id, warehouse_id: cil, service_id: zaznam.service_id, quantity: stock },
                  { onConflict: "product_id,warehouse_id" },
                );
            if (error) { chyby.push(`${z.id ?? z.sku}: ${error.message}`); selhalo = true; break; }
          }
        }
      }

      if (!selhalo) upraveno += nalezene.length;
    }
    vysledek.products = { updated: upraveno, not_found: nenalezeno };
  }

  // --- opravy ---
  if (Array.isArray((telo as any).repairs)) {
    if (!rozsahy.includes("catalog:write")) {
      return json({ error: "Token nemá rozsah catalog:write" }, 403);
    }
    const { zmeny, chyby: ch } = zmenyOprav((telo as any).repairs);
    chyby.push(...ch);
    let upraveno = 0;
    const nenalezeno: string[] = [];
    for (const z of zmeny) {
      const { data, error } = await svc
        .from("repairs")
        .update(z.hodnoty)
        .eq("service_id", zaznam.service_id)
        .eq("id", z.id!)
        .select("id");
      if (error) chyby.push(`${z.id}: ${error.message}`);
      else if (!data || data.length === 0) nenalezeno.push(z.id!);
      else upraveno += data.length;
    }
    vysledek.repairs = { updated: upraveno, not_found: nenalezeno };
  }

  if (Object.keys(vysledek).length === 0) {
    return json({ error: "Tělo neobsahuje ani products, ani repairs" }, 400);
  }

  const odpoved = { ok: chyby.length === 0, ...vysledek, ...(chyby.length ? { errors: chyby } : {}) };

  await svc.from("api_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", zaznam.id);

  if (klic) {
    await svc.from("api_idempotency").insert({
      service_id: zaznam.service_id,
      token_id: zaznam.id,
      klic,
      otisk_tela: otiskT,
      odpoved,
    });
  }

  return json(odpoved, chyby.length ? 207 : 200);
});
