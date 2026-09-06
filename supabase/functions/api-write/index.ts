import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { modulProRozsah, NAZEV_MODULU, otisk, PREFIX, type Rozsah } from "../_shared/tokeny.ts";
import { zmenyProduktu, zmenyOprav, zmenyKatalogu, otiskTela, type DruhKatalogu } from "../_shared/zapis.ts";

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
 * Od 6. 9. jde přes API i zakládat, přejmenovávat a mazat produkty
 * a opravy a spravovat značky, kategorie a modely (`brands`, `categories`,
 * `models`; ty se nemažou – kaskáda přes celý katalog patří do aplikace).
 * Vazby (category_id, model_ids, product_ids, brand_id) se přijmou jen na
 * záznamy téhož servisu; cizí id se tiše vynechá, aby přes API nešlo
 * zjišťovat, co existuje jinde.
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

  /**
   * Rozsah tokenu říká, co token smí. Nárok na modul říká, jestli si to
   * servis platí – a to je jiná otázka. Bez druhé kontroly píše vydaný token
   * dál i měsíce po vypršení předplatného.
   *
   * Výsledek se drží v paměti požadavku, ať se stejný modul neptá databáze
   * u každé sekce těla zvlášť.
   */
  const naroky = new Map<string, boolean>();
  const branaRozsahu = async (r: Rozsah): Promise<Response | null> => {
    if (!rozsahy.includes(r)) return json({ error: `Token nemá rozsah ${r}` }, 403);
    const modul = modulProRozsah(r);
    let ma = naroky.get(modul);
    if (ma === undefined) {
      const { data, error } = await svc.rpc("has_entitlement", { p_service_id: zaznam.service_id, p_module: modul });
      ma = !error && data === true;
      naroky.set(modul, ma);
    }
    if (!ma) return json({ error: `${NAZEV_MODULU[modul]} není pro tento servis aktivní.` }, 403);
    return null;
  };

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
  const sid = zaznam.service_id;

  /** Id z dané tabulky, která patří servisu – cizí a neexistující se vynechají. */
  const vlastni = async (tabulka: string, ids: string[]): Promise<Set<string>> => {
    if (ids.length === 0) return new Set();
    const { data } = await svc.from(tabulka).select("id").eq("service_id", sid).in("id", ids);
    return new Set(((data ?? []) as { id: string }[]).map((x) => x.id));
  };
  /** Vazby v hodnotách ořízne na záznamy servisu. */
  const overVazby = async (hodnoty: Record<string, unknown>, prefix: string) => {
    for (const [klic, tabulka] of [["model_ids", "device_models"], ["product_ids", "inventory_products"]] as const) {
      if (Array.isArray(hodnoty[klic])) {
        const ok = await vlastni(tabulka, hodnoty[klic] as string[]);
        const vynechano = (hodnoty[klic] as string[]).filter((x) => !ok.has(x));
        if (vynechano.length) chyby.push(`${prefix}: ${klic} – neznámé id vynecháno: ${vynechano.join(", ")}`);
        hodnoty[klic] = (hodnoty[klic] as string[]).filter((x) => ok.has(x));
      }
    }
    for (const [klic, tabulka] of [["category_id", null], ["brand_id", "device_brands"]] as const) {
      if (typeof hodnoty[klic] === "string") {
        // category_id znamená u produktu kategorii skladu, u modelu kategorii zařízení – rozliší volající.
        const t = tabulka ?? (hodnoty.__kategorieTabulka as string);
        const ok = await vlastni(t, [hodnoty[klic] as string]);
        if (ok.size === 0) { chyby.push(`${prefix}: ${klic} ${hodnoty[klic]} v tomhle servisu není`); delete hodnoty[klic]; }
      }
    }
    delete hodnoty.__kategorieTabulka;
  };
  type Pocty = { updated: number; created: number; deleted: number; not_found: string[]; created_ids: string[] };
  const pocty = (): Pocty => ({ updated: 0, created: 0, deleted: 0, not_found: [], created_ids: [] });

  // --- značky, kategorie, modely (v tomhle pořadí, ať nová kategorie může odkazovat na novou značku v dalším požadavku) ---
  const KATALOG: Record<DruhKatalogu, string> = { brands: "device_brands", categories: "device_categories", models: "device_models" };
  for (const druh of ["brands", "categories", "models"] as DruhKatalogu[]) {
    if (!Array.isArray((telo as any)[druh])) continue;
    const brana = await branaRozsahu("catalog:write");
    if (brana) return brana;
    const { zmeny, chyby: ch } = zmenyKatalogu((telo as any)[druh], druh);
    chyby.push(...ch);
    const p = pocty();
    for (const [i, z] of zmeny.entries()) {
      const prefix = `${druh}[${i}]`;
      if (druh === "models") z.hodnoty.__kategorieTabulka = "device_categories";
      await overVazby(z.hodnoty, prefix);
      if (z.akce === "create") {
        const rodic = druh === "categories" ? "brand_id" : druh === "models" ? "category_id" : null;
        if (rodic && !z.hodnoty[rodic]) { chyby.push(`${prefix}: bez platného ${rodic} nejde založit`); continue; }
        const { data, error } = await svc.from(KATALOG[druh]).insert({ ...z.hodnoty, service_id: sid }).select("id").single();
        if (error) chyby.push(`${prefix}: ${error.message}`);
        else { p.created += 1; p.created_ids.push((data as { id: string }).id); }
        continue;
      }
      if (Object.keys(z.hodnoty).length === 0) continue;
      const { data, error } = await svc.from(KATALOG[druh]).update(z.hodnoty).eq("service_id", sid).eq("id", z.id!).select("id");
      if (error) chyby.push(`${prefix}: ${error.message}`);
      else if (!data || data.length === 0) p.not_found.push(z.id!);
      else p.updated += data.length;
    }
    vysledek[druh] = p;
  }

  // --- opravy ---
  if (Array.isArray((telo as any).repairs)) {
    const brana = await branaRozsahu("catalog:write");
    if (brana) return brana;
    const { zmeny, chyby: ch } = zmenyOprav((telo as any).repairs);
    chyby.push(...ch);
    const p = pocty();
    for (const [i, z] of zmeny.entries()) {
      const prefix = `repairs[${i}]`;
      if (z.akce === "delete") {
        const { data, error } = await svc.from("repairs").delete().eq("service_id", sid).eq("id", z.id!).select("id");
        if (error) chyby.push(`${prefix}: ${error.message}`);
        else if (!data || data.length === 0) p.not_found.push(z.id!);
        else p.deleted += data.length;
        continue;
      }
      await overVazby(z.hodnoty, prefix);
      if (z.akce === "create") {
        if (!Array.isArray(z.hodnoty.model_ids) || (z.hodnoty.model_ids as string[]).length === 0) { chyby.push(`${prefix}: žádný z model_ids v servisu není`); continue; }
        const { data, error } = await svc.from("repairs").insert({ price: 0, estimated_time: 0, details: "", ...z.hodnoty, service_id: sid }).select("id").single();
        if (error) chyby.push(`${prefix}: ${error.message}`);
        else { p.created += 1; p.created_ids.push((data as { id: string }).id); }
        continue;
      }
      if (Object.keys(z.hodnoty).length === 0) continue;
      const { data, error } = await svc.from("repairs").update(z.hodnoty).eq("service_id", sid).eq("id", z.id!).select("id");
      if (error) chyby.push(`${prefix}: ${error.message}`);
      else if (!data || data.length === 0) p.not_found.push(z.id!);
      else p.updated += data.length;
    }
    vysledek.repairs = p;
  }

  // --- produkty ---
  if (Array.isArray((telo as any).products)) {
    const brana = await branaRozsahu("inventory:write");
    if (brana) return brana;
    const { zmeny, chyby: ch } = zmenyProduktu((telo as any).products);
    chyby.push(...ch);
    const p = pocty();
    // Sklady servisu se načtou jednou, ne u každé položky.
    const { data: sklady } = await svc.from("inventory_warehouses").select("id, name, is_default").eq("service_id", sid).order("order_index");
    const seznamSkladu = (sklady ?? []) as { id: string; name: string; is_default: boolean }[];
    const vychoziSkladId = seznamSkladu.find((w) => w.is_default)?.id ?? seznamSkladu[0]?.id ?? null;
    const zapisStock = async (productIds: string[], stock: number, sklad: string | undefined, prefix: string): Promise<boolean> => {
      const cil = sklad ? seznamSkladu.find((w) => w.id === sklad || w.name === sklad)?.id ?? null : vychoziSkladId;
      if (!cil) { chyby.push(`${prefix}: sklad „${sklad ?? "výchozí"}“ neexistuje`); return false; }
      for (const pid of productIds) {
        // Nula znamená smazat řádek, ne uložit nulu – stejně jako v aplikaci.
        const { error } = stock === 0
          ? await svc.from("inventory_stock").delete().eq("product_id", pid).eq("warehouse_id", cil)
          : await svc.from("inventory_stock").upsert({ product_id: pid, warehouse_id: cil, service_id: sid, quantity: stock }, { onConflict: "product_id,warehouse_id" });
        if (error) { chyby.push(`${prefix}: ${error.message}`); return false; }
      }
      return true;
    };
    for (const [i, z] of zmeny.entries()) {
      const prefix = `products[${i}]`;
      if (z.akce === "delete") {
        const { data, error } = await svc.from("inventory_products").delete().eq("service_id", sid).eq("id", z.id!).select("id");
        if (error) chyby.push(`${prefix}: ${error.message}`);
        else if (!data || data.length === 0) p.not_found.push(z.id!);
        else p.deleted += data.length;
        continue;
      }
      z.hodnoty.__kategorieTabulka = "inventory_product_categories";
      await overVazby(z.hodnoty, prefix);
      // `stock` není sloupec produktu, ale množství v konkrétním skladu.
      const { stock, ...sloupce } = z.hodnoty as Record<string, unknown> & { stock?: number };
      if (z.akce === "create") {
        if (typeof sloupce.sku === "string") {
          const { data: dup } = await svc.from("inventory_products").select("id").eq("service_id", sid).eq("sku", sloupce.sku).limit(1);
          if (dup && dup.length) { chyby.push(`${prefix}: sku ${sloupce.sku} už existuje`); continue; }
        }
        const { data, error } = await svc.from("inventory_products").insert({ price: 0, ...sloupce, service_id: sid }).select("id").single();
        if (error) { chyby.push(`${prefix}: ${error.message}`); continue; }
        const nid = (data as { id: string }).id;
        p.created += 1; p.created_ids.push(nid);
        if (typeof stock === "number" && stock > 0) await zapisStock([nid], stock, z.sklad, prefix);
        continue;
      }
      // Nejdřív najít produkt – u zápisu podle SKU jinak neznáme jeho id.
      const hledani = svc.from("inventory_products").select("id").eq("service_id", sid);
      const { data: nalezene, error: chybaHledani } = z.id ? await hledani.eq("id", z.id) : await hledani.eq("sku", z.sku!);
      if (chybaHledani) { chyby.push(`${prefix}: ${chybaHledani.message}`); continue; }
      if (!nalezene || nalezene.length === 0) { p.not_found.push(z.id ?? z.sku!); continue; }
      const ids = (nalezene as { id: string }[]).map((x) => x.id);
      let selhalo = false;
      if (Object.keys(sloupce).length > 0) {
        const { error } = await svc.from("inventory_products").update(sloupce).in("id", ids);
        if (error) { chyby.push(`${prefix}: ${error.message}`); selhalo = true; }
      }
      if (!selhalo && typeof stock === "number") selhalo = !(await zapisStock(ids, stock, z.sklad, prefix));
      if (!selhalo) p.updated += ids.length;
    }
    vysledek.products = p;
  }

  if (Object.keys(vysledek).length === 0) {
    return json({ error: "Tělo neobsahuje products, repairs, brands, categories ani models" }, 400);
  }

  const odpoved = { ok: chyby.length === 0, ...vysledek, ...(chyby.length ? { errors: chyby } : {}) };

  const { error: chybaTokenu } = await svc.from("api_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", zaznam.id);
  if (chybaTokenu) console.error("[api-write] last_used_at:", chybaTokenu.message);

  if (klic) {
    // Bez uloženého klíče přestane idempotence platit: stejné volání by se
    // při opakování (timeout na straně klienta) provedlo podruhé. Chyba se
    // proto aspoň loguje – zápis dat už proběhl, takže se nevrací 500.
    const { error: chybaKlice } = await svc.from("api_idempotency").insert({
      service_id: zaznam.service_id,
      token_id: zaznam.id,
      klic,
      otisk_tela: otiskT,
      odpoved,
    });
    if (chybaKlice) console.error("[api-write] idempotenční klíč se neuložil:", klic, chybaKlice.message);
  }

  return json(odpoved, chyby.length ? 207 : 200);
});
