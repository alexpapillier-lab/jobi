/**
 * Veřejné API servisu: tokeny, zápis, idempotence a limity.
 *
 * Tohle je jediná cesta, kterou cizí program sahá zákazníkovi do skladu
 * a do ceníku. Když se splete, buď se zápis provede dvakrát (a servis má
 * na skladě dvojnásobek toho, co doopravdy má), nebo se provede z půlky
 * (a ceník je nekonzistentní), nebo projde tam, kam neměl.
 *
 * PROČ TO ŽIJE V src/lib A NE U EDGE FUNKCÍ
 * Stejný důvod jako u billingWebhook.test.ts: `npx vitest run` bere podle
 * vite.config.ts jen `src/**`, a `api-write/index.ts` se naimportovat nedá –
 * tahá `serve` z deno.land a `createClient` z esm.sh. Testuje se proto ve
 * třech vrstvách:
 *
 *  1. Co jde importovat doopravdy, se importuje doopravdy: `otisk`,
 *     `ocistiRozsahy`, `modulProRozsah` z `_shared/tokeny.ts` a celé
 *     `_shared/zapis.ts` jsou tady ty samé funkce, jaké běží na serveru.
 *  2. Obsluha požadavku je přepsaná jako referenční implementace
 *     (`zpracujZapis`) nad pamětovou náhradou Supabase klienta. Je to
 *     zrcadlo, ne originál – drží se předlohy co nejtěsněji a všechno, co
 *     jde, počítá ze skutečných funkcí z `_shared`.
 *  3. Místa, kde se chyba opravdu stala, hlídá test přímo ve zdrojáku edge
 *     funkce (viz „pojistky ve zdrojácích edge funkcí“).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { modulProRozsah, NAZEV_MODULU, otisk, PREFIX, novyToken, type Rozsah } from "../../supabase/functions/_shared/tokeny";
import {
  zmenyProduktu,
  zmenyOprav,
  zmenyKatalogu,
  otiskTela,
  type DruhKatalogu,
} from "../../supabase/functions/_shared/zapis";

const KOREN = join(__dirname, "..", "..");

// ---------------------------------------------------------------------------
// Pamětová náhrada Supabase klienta
//
// Jen to, co api-write doopravdy volá: select/insert/update/delete/upsert
// s řetězenými filtry a rpc. Filtry se skládají přes AND – přesně proto, že
// právě na tom stojí oddělení servisů (`.eq("service_id", …)`).
// ---------------------------------------------------------------------------

type Radek = Record<string, unknown>;
type Filtr = { op: "eq" | "in" | "is"; klic: string; hodnota: unknown };
type Odpoved<T> = { data: T; error: { message: string; code?: string } | null };

let citac = 0;
function noveId(): string {
  citac += 1;
  return `00000000-0000-4000-8000-${String(citac).padStart(12, "0")}`;
}

class Dotaz implements PromiseLike<Odpoved<unknown>> {
  private op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private telo: Radek[] = [];
  private filtry: Filtr[] = [];
  private vracet = false;
  private jeden: "single" | "maybe" | null = null;
  private strop: number | null = null;
  private konflikt: string[] = [];

  constructor(private db: FakeDb, private tabulka: string) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.op === "select") this.pocitat = opts?.count === "exact";
    this.vracet = true;
    return this;
  }
  private pocitat = false;
  insert(radky: Radek | Radek[]) { this.op = "insert"; this.telo = Array.isArray(radky) ? radky : [radky]; return this; }
  update(zmena: Radek) { this.op = "update"; this.telo = [zmena]; return this; }
  upsert(radky: Radek | Radek[], opts?: { onConflict?: string }) {
    this.op = "upsert";
    this.telo = Array.isArray(radky) ? radky : [radky];
    this.konflikt = (opts?.onConflict ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    return this;
  }
  delete() { this.op = "delete"; return this; }
  eq(klic: string, hodnota: unknown) { this.filtry.push({ op: "eq", klic, hodnota }); return this; }
  in(klic: string, hodnota: unknown[]) { this.filtry.push({ op: "in", klic, hodnota }); return this; }
  is(klic: string, hodnota: unknown) { this.filtry.push({ op: "is", klic, hodnota }); return this; }
  order(_k?: string, _o?: unknown) { return this; }
  limit(n: number) { this.strop = n; return this; }
  single() { this.jeden = "single"; return this; }
  maybeSingle() { this.jeden = "maybe"; return this; }

  private radky(): Radek[] {
    return this.db.tabulka(this.tabulka).filter((r) =>
      this.filtry.every((f) => {
        if (f.op === "eq") return r[f.klic] === f.hodnota;
        if (f.op === "is") return (r[f.klic] ?? null) === f.hodnota;
        return Array.isArray(f.hodnota) && f.hodnota.includes(r[f.klic]);
      }),
    );
  }

  private vykonej(): Odpoved<unknown> {
    const chyba = this.db.chyby[`${this.tabulka}:${this.op}`];
    if (chyba) return { data: null, error: { message: chyba } };

    let vysledek: Radek[] = [];
    if (this.op === "select") {
      vysledek = this.radky();
      if (this.strop !== null) vysledek = vysledek.slice(0, this.strop);
    } else if (this.op === "insert") {
      vysledek = this.telo.map((r) => ({ id: noveId(), ...r }));
      this.db.tabulka(this.tabulka).push(...vysledek);
      this.db.zapisy.push({ tabulka: this.tabulka, op: "insert", radky: vysledek });
    } else if (this.op === "upsert") {
      for (const r of this.telo) {
        const stavajici = this.db
          .tabulka(this.tabulka)
          .find((x) => this.konflikt.every((k) => x[k] === r[k]));
        if (stavajici) Object.assign(stavajici, r);
        else this.db.tabulka(this.tabulka).push({ id: noveId(), ...r });
        vysledek.push(r);
      }
      this.db.zapisy.push({ tabulka: this.tabulka, op: "upsert", radky: this.telo });
    } else if (this.op === "update") {
      vysledek = this.radky();
      for (const r of vysledek) Object.assign(r, this.telo[0]);
      this.db.zapisy.push({ tabulka: this.tabulka, op: "update", radky: vysledek, filtry: this.filtry });
    } else {
      vysledek = this.radky();
      const zbytek = this.db.tabulka(this.tabulka).filter((r) => !vysledek.includes(r));
      this.db.tabulky[this.tabulka] = zbytek;
      this.db.zapisy.push({ tabulka: this.tabulka, op: "delete", radky: vysledek, filtry: this.filtry });
    }

    if (this.pocitat) return { data: null, error: null, ...{ count: vysledek.length } } as Odpoved<unknown>;
    if (this.jeden === "single") {
      if (vysledek.length !== 1) return { data: null, error: { message: "očekáván právě jeden řádek" } };
      return { data: vysledek[0], error: null };
    }
    if (this.jeden === "maybe") return { data: vysledek[0] ?? null, error: null };
    if (!this.vracet && this.op !== "select") return { data: null, error: null };
    return { data: vysledek, error: null };
  }

  then<A, B>(splneno?: ((h: Odpoved<unknown>) => A | PromiseLike<A>) | null, chyba?: ((d: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve(this.vykonej()).then(splneno, chyba);
  }
}

class FakeDb {
  tabulky: Record<string, Radek[]> = {};
  /** Co všechno se do databáze zapsalo – z toho se pozná „půlka zápisu“. */
  zapisy: Array<{ tabulka: string; op: string; radky: Radek[]; filtry?: Filtr[] }> = [];
  /** Vynucená chyba: klíč „tabulka:op“. */
  chyby: Record<string, string> = {};
  naroky: Record<string, boolean> = {};
  /** Počet zápisů na token a minutu – jako api_write_hits. */
  zapisyTokenu: Record<string, number> = {};

  tabulka(jmeno: string): Radek[] {
    if (!this.tabulky[jmeno]) this.tabulky[jmeno] = [];
    return this.tabulky[jmeno];
  }
  from(jmeno: string) { return new Dotaz(this, jmeno); }
  async rpc(jmeno: string, args: Radek): Promise<Odpoved<unknown>> {
    if (jmeno === "has_entitlement") {
      const klic = `${args.p_service_id}:${args.p_module}`;
      return { data: this.naroky[klic] === true, error: null };
    }
    if (jmeno === "api_zapocitej_zapis") {
      const id = String(args.p_token_id);
      this.zapisyTokenu[id] = (this.zapisyTokenu[id] ?? 0) + 1;
      return { data: this.zapisyTokenu[id], error: null };
    }
    return { data: null, error: { message: `neznámé RPC ${jmeno}` } };
  }
}

// ---------------------------------------------------------------------------
// Referenční implementace api-write/index.ts
// ---------------------------------------------------------------------------

const LIMIT_ZA_MINUTU = 30;

type Vysledek = { stav: number; telo: any; hlavicky: Record<string, string> };

const odpoved = (telo: unknown, stav = 200, hlavicky: Record<string, string> = {}): Vysledek =>
  ({ stav, telo, hlavicky });

type Pozadavek = { token?: string | null; telo: unknown; klic?: string };

/** Zrcadlo obsluhy z supabase/functions/api-write/index.ts. */
async function zpracujZapis(db: FakeDb, req: Pozadavek): Promise<Vysledek> {
  const token = (req.token ?? "").trim();
  if (!token.startsWith(PREFIX)) {
    return odpoved({ error: "Chybí token. Posílá se jako Authorization: Bearer jobi_…" }, 401);
  }

  const hash = await otisk(token);
  const zaznam = db.tabulka("api_tokens").find((t) => t.token_hash === hash) as
    | { id: string; service_id: string; scopes: Rozsah[]; revoked_at: string | null }
    | undefined;

  // Neplatný a odvolaný token vracejí totéž – ať se nedá zjišťovat,
  // který token existoval a pro který servis.
  if (!zaznam || zaznam.revoked_at) return odpoved({ error: "Neplatný token" }, 401);

  const rozsahy = (zaznam.scopes ?? []) as Rozsah[];
  const naroky = new Map<string, boolean>();
  const branaRozsahu = async (r: Rozsah): Promise<Vysledek | null> => {
    if (!rozsahy.includes(r)) return odpoved({ error: `Token nemá rozsah ${r}` }, 403);
    const modul = modulProRozsah(r);
    let ma = naroky.get(modul);
    if (ma === undefined) {
      const { data, error } = await db.rpc("has_entitlement", { p_service_id: zaznam.service_id, p_module: modul });
      ma = !error && data === true;
      naroky.set(modul, ma);
    }
    if (!ma) return odpoved({ error: `${NAZEV_MODULU[modul]} není pro tento servis aktivní.` }, 403);
    return null;
  };

  const { data: pocet } = await db.rpc("api_zapocitej_zapis", { p_token_id: zaznam.id });
  if (typeof pocet === "number" && pocet > LIMIT_ZA_MINUTU) {
    return odpoved({ error: `Překročen limit ${LIMIT_ZA_MINUTU} zápisů za minutu` }, 429, { "Retry-After": "60" });
  }

  const telo = req.telo;
  if (!telo || typeof telo !== "object") return odpoved({ error: "Tělo není platný JSON" }, 400);

  const klic = req.klic?.trim() ?? "";
  const otiskT = await otiskTela(telo);

  if (klic) {
    const { data: drive } = await db
      .from("api_idempotency")
      .select("otisk_tela, odpoved")
      .eq("token_id", zaznam.id)
      .eq("klic", klic)
      .maybeSingle() as Odpoved<{ otisk_tela: string; odpoved: { ok?: boolean } } | null>;
    if (drive) {
      if (drive.otisk_tela !== otiskT) {
        return odpoved({ error: "Idempotency-Key už byl použit s jiným tělem" }, 409);
      }
      return odpoved(drive.odpoved, drive.odpoved?.ok === false ? 207 : 200, { "Idempotency-Replayed": "true" });
    }
  }

  // Rozsahy se ověří najednou, ještě než se cokoli zapíše.
  const SEKCE_KATALOGU = ["brands", "categories", "models", "repairs"] as const;
  const potrebneRozsahy: Rozsah[] = [];
  if (SEKCE_KATALOGU.some((k) => Array.isArray((telo as any)[k]))) potrebneRozsahy.push("catalog:write");
  if (Array.isArray((telo as any).products)) potrebneRozsahy.push("inventory:write");
  for (const r of potrebneRozsahy) {
    const brana = await branaRozsahu(r);
    if (brana) return brana;
  }

  const vysledek: Record<string, unknown> = {};
  const chyby: string[] = [];
  const sid = zaznam.service_id;

  const vlastni = async (tabulka: string, ids: string[]): Promise<Set<string>> => {
    if (ids.length === 0) return new Set();
    const { data } = await db.from(tabulka).select("id").eq("service_id", sid).in("id", ids) as Odpoved<{ id: string }[]>;
    return new Set((data ?? []).map((x) => x.id));
  };
  const overVazby = async (hodnoty: Record<string, unknown>, prefix: string) => {
    for (const [k, tabulka] of [["model_ids", "device_models"], ["product_ids", "inventory_products"]] as const) {
      if (Array.isArray(hodnoty[k])) {
        const ok = await vlastni(tabulka, hodnoty[k] as string[]);
        const vynechano = (hodnoty[k] as string[]).filter((x) => !ok.has(x));
        if (vynechano.length) chyby.push(`${prefix}: ${k} – neznámé id vynecháno: ${vynechano.join(", ")}`);
        hodnoty[k] = (hodnoty[k] as string[]).filter((x) => ok.has(x));
      }
    }
    for (const [k, tabulka] of [["category_id", null], ["brand_id", "device_brands"]] as const) {
      if (typeof hodnoty[k] === "string") {
        const t = tabulka ?? (hodnoty.__kategorieTabulka as string);
        const ok = await vlastni(t, [hodnoty[k] as string]);
        if (ok.size === 0) { chyby.push(`${prefix}: ${k} ${hodnoty[k]} v tomhle servisu není`); delete hodnoty[k]; }
      }
    }
    delete hodnoty.__kategorieTabulka;
  };

  type Pocty = { updated: number; created: number; deleted: number; not_found: string[]; created_ids: string[] };
  const pocty = (): Pocty => ({ updated: 0, created: 0, deleted: 0, not_found: [], created_ids: [] });

  const KATALOG: Record<DruhKatalogu, string> = { brands: "device_brands", categories: "device_categories", models: "device_models" };
  for (const druh of ["brands", "categories", "models"] as DruhKatalogu[]) {
    if (!Array.isArray((telo as any)[druh])) continue;
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
        const { data, error } = await db.from(KATALOG[druh]).insert({ ...z.hodnoty, service_id: sid }).select("id").single() as Odpoved<{ id: string }>;
        if (error) chyby.push(`${prefix}: ${error.message}`);
        else { p.created += 1; p.created_ids.push(data.id); }
        continue;
      }
      if (Object.keys(z.hodnoty).length === 0) continue;
      const { data, error } = await db.from(KATALOG[druh]).update(z.hodnoty).eq("service_id", sid).eq("id", z.id!).select("id") as Odpoved<{ id: string }[]>;
      if (error) chyby.push(`${prefix}: ${error.message}`);
      else if (!data || data.length === 0) p.not_found.push(z.id!);
      else p.updated += data.length;
    }
    vysledek[druh] = p;
  }

  if (Array.isArray((telo as any).repairs)) {
    const { zmeny, chyby: ch } = zmenyOprav((telo as any).repairs);
    chyby.push(...ch);
    const p = pocty();
    for (const [i, z] of zmeny.entries()) {
      const prefix = `repairs[${i}]`;
      if (z.akce === "delete") {
        const { data, error } = await db.from("repairs").delete().eq("service_id", sid).eq("id", z.id!).select("id") as Odpoved<{ id: string }[]>;
        if (error) chyby.push(`${prefix}: ${error.message}`);
        else if (!data || data.length === 0) p.not_found.push(z.id!);
        else p.deleted += data.length;
        continue;
      }
      await overVazby(z.hodnoty, prefix);
      if (z.akce === "create") {
        if (!Array.isArray(z.hodnoty.model_ids) || (z.hodnoty.model_ids as string[]).length === 0) {
          chyby.push(`${prefix}: žádný z model_ids v servisu není`);
          continue;
        }
        const { data, error } = await db.from("repairs").insert({ price: 0, estimated_time: 0, details: "", ...z.hodnoty, service_id: sid }).select("id").single() as Odpoved<{ id: string }>;
        if (error) chyby.push(`${prefix}: ${error.message}`);
        else { p.created += 1; p.created_ids.push(data.id); }
        continue;
      }
      if (Object.keys(z.hodnoty).length === 0) continue;
      const { data, error } = await db.from("repairs").update(z.hodnoty).eq("service_id", sid).eq("id", z.id!).select("id") as Odpoved<{ id: string }[]>;
      if (error) chyby.push(`${prefix}: ${error.message}`);
      else if (!data || data.length === 0) p.not_found.push(z.id!);
      else p.updated += data.length;
    }
    vysledek.repairs = p;
  }

  if (Array.isArray((telo as any).products)) {
    const { zmeny, chyby: ch } = zmenyProduktu((telo as any).products);
    chyby.push(...ch);
    const p = pocty();
    const { data: sklady } = await db.from("inventory_warehouses").select("id, name, is_default").eq("service_id", sid) as Odpoved<{ id: string; name: string; is_default: boolean }[]>;
    const seznamSkladu = sklady ?? [];
    const vychoziSkladId = seznamSkladu.find((w) => w.is_default)?.id ?? seznamSkladu[0]?.id ?? null;
    const zapisStock = async (productIds: string[], stock: number, sklad: string | undefined, prefix: string): Promise<boolean> => {
      const cil = sklad ? seznamSkladu.find((w) => w.id === sklad || w.name === sklad)?.id ?? null : vychoziSkladId;
      if (!cil) { chyby.push(`${prefix}: sklad „${sklad ?? "výchozí"}“ neexistuje`); return false; }
      for (const pid of productIds) {
        const { error } = stock === 0
          ? await db.from("inventory_stock").delete().eq("product_id", pid).eq("warehouse_id", cil) as Odpoved<unknown>
          : await db.from("inventory_stock").upsert({ product_id: pid, warehouse_id: cil, service_id: sid, quantity: stock }, { onConflict: "product_id,warehouse_id" }) as Odpoved<unknown>;
        if (error) { chyby.push(`${prefix}: ${error.message}`); return false; }
      }
      return true;
    };
    for (const [i, z] of zmeny.entries()) {
      const prefix = `products[${i}]`;
      if (z.akce === "delete") {
        const { data, error } = await db.from("inventory_products").delete().eq("service_id", sid).eq("id", z.id!).select("id") as Odpoved<{ id: string }[]>;
        if (error) chyby.push(`${prefix}: ${error.message}`);
        else if (!data || data.length === 0) p.not_found.push(z.id!);
        else p.deleted += data.length;
        continue;
      }
      z.hodnoty.__kategorieTabulka = "inventory_product_categories";
      await overVazby(z.hodnoty, prefix);
      const { stock, ...sloupce } = z.hodnoty as Record<string, unknown> & { stock?: number };
      if (z.akce === "create") {
        if (typeof sloupce.sku === "string") {
          const { data: dup } = await db.from("inventory_products").select("id").eq("service_id", sid).eq("sku", sloupce.sku).limit(1) as Odpoved<{ id: string }[]>;
          if (dup && dup.length) { chyby.push(`${prefix}: sku ${sloupce.sku} už existuje`); continue; }
        }
        const { data, error } = await db.from("inventory_products").insert({ price: 0, ...sloupce, service_id: sid }).select("id").single() as Odpoved<{ id: string }>;
        if (error) { chyby.push(`${prefix}: ${error.message}`); continue; }
        p.created += 1; p.created_ids.push(data.id);
        if (typeof stock === "number" && stock > 0) await zapisStock([data.id], stock, z.sklad, prefix);
        continue;
      }
      const hledani = db.from("inventory_products").select("id").eq("service_id", sid);
      const { data: nalezene, error: chybaHledani } = (z.id ? await hledani.eq("id", z.id) : await hledani.eq("sku", z.sku!)) as Odpoved<{ id: string }[]>;
      if (chybaHledani) { chyby.push(`${prefix}: ${chybaHledani.message}`); continue; }
      if (!nalezene || nalezene.length === 0) { p.not_found.push(z.id ?? z.sku!); continue; }
      const ids = nalezene.map((x) => x.id);
      let selhalo = false;
      if (Object.keys(sloupce).length > 0) {
        const { error } = await db.from("inventory_products").update(sloupce).in("id", ids) as Odpoved<unknown>;
        if (error) { chyby.push(`${prefix}: ${error.message}`); selhalo = true; }
      }
      if (!selhalo && typeof stock === "number") selhalo = !(await zapisStock(ids, stock, z.sklad, prefix));
      if (!selhalo) p.updated += ids.length;
    }
    vysledek.products = p;
  }

  if (Object.keys(vysledek).length === 0) {
    return odpoved({ error: "Tělo neobsahuje products, repairs, brands, categories ani models" }, 400);
  }

  const telOdpovedi = { ok: chyby.length === 0, ...vysledek, ...(chyby.length ? { errors: chyby } : {}) };

  await db.from("api_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", zaznam.id);

  if (klic) {
    const { error } = await db.from("api_idempotency").insert({
      service_id: zaznam.service_id,
      token_id: zaznam.id,
      klic,
      otisk_tela: otiskT,
      odpoved: telOdpovedi,
    }) as Odpoved<unknown>;
    // Zápis klíče smí selhat jen do logu – data už jsou zapsaná, 500 by
    // klienta poslalo požadavek zopakovat a provedlo by ho podruhé.
    if (error) db.zapisy.push({ tabulka: "log", op: "chyba-klice", radky: [{ klic }] });
  }

  return odpoved(telOdpovedi, chyby.length ? 207 : 200);
}

// ---------------------------------------------------------------------------
// Příprava dat
// ---------------------------------------------------------------------------

const NAS = "11111111-1111-4111-8111-111111111111";
const CIZI = "22222222-2222-4222-8222-222222222222";

/** Id ve tvaru UUID – `_shared/zapis.ts` jiný tvar odmítne už při čtení těla. */
function idV(sid: string, n: number): string {
  const p = sid === NAS ? "1" : "2";
  return `${p.repeat(8)}-0000-4000-8000-${String(n).padStart(12, "0")}`;
}
const ZNACKA = (sid: string) => idV(sid, 1);
const KATEGORIE = (sid: string) => idV(sid, 2);
const MODEL = (sid: string) => idV(sid, 3);
const OPRAVA = (sid: string) => idV(sid, 4);
const PRODUKT = (sid: string) => idV(sid, 5);
const SKLAD = (sid: string) => idV(sid, 6);

let db: FakeDb;
let tokenNas: string;
let tokenCizi: string;

async function pridejToken(sid: string, scopes: Rozsah[], revoked = false): Promise<string> {
  const token = novyToken();
  db.tabulka("api_tokens").push({
    id: `token-${sid}-${db.tabulka("api_tokens").length}`,
    service_id: sid,
    token_hash: await otisk(token),
    scopes,
    revoked_at: revoked ? new Date().toISOString() : null,
  });
  return token;
}

beforeEach(async () => {
  db = new FakeDb();
  db.naroky[`${NAS}:api_catalog`] = true;
  db.naroky[`${NAS}:api_inventory`] = true;
  db.naroky[`${CIZI}:api_catalog`] = true;
  db.naroky[`${CIZI}:api_inventory`] = true;
  tokenNas = await pridejToken(NAS, ["catalog:write", "inventory:write"]);
  tokenCizi = await pridejToken(CIZI, ["catalog:write", "inventory:write"]);

  // Katalog obou servisů – ať je co plést dohromady.
  for (const sid of [NAS, CIZI]) {
    db.tabulka("device_brands").push({ id: ZNACKA(sid), service_id: sid, name: "Apple" });
    db.tabulka("device_categories").push({ id: KATEGORIE(sid), service_id: sid, brand_id: ZNACKA(sid), name: "iPhone" });
    db.tabulka("device_models").push({ id: MODEL(sid), service_id: sid, category_id: KATEGORIE(sid), name: "iPhone 13" });
    db.tabulka("repairs").push({ id: OPRAVA(sid), service_id: sid, name: "Displej", price: 1000, model_ids: [MODEL(sid)] });
    db.tabulka("inventory_products").push({ id: PRODUKT(sid), service_id: sid, sku: "BAT-6S", name: "Baterie", price: 100 });
    db.tabulka("inventory_warehouses").push({ id: SKLAD(sid), service_id: sid, name: "Hlavní", is_default: true });
  }
  db.zapisy = [];
});

/** Zápisy, které se dotkly jiného servisu než `sid`. */
function zapisyMimo(sid: string): Array<{ tabulka: string; op: string }> {
  return db.zapisy.filter((z) =>
    z.radky.some((r) => typeof r.service_id === "string" && r.service_id !== sid),
  );
}

// ---------------------------------------------------------------------------
// 1. Autorizace
// ---------------------------------------------------------------------------

describe("veřejné API: autorizace zápisu", () => {
  it("bez tokenu vrací 401 a nic nezapíše", async () => {
    const r = await zpracujZapis(db, { token: null, telo: { brands: [{ name: "Nová" }] } });
    expect(r.stav).toBe(401);
    expect(db.zapisy).toHaveLength(0);
  });

  it("token bez našeho prefixu se ani nehledá v databázi", async () => {
    // Kdyby se hledal, dal by se přes časy odpovědí odhadovat obsah tabulky.
    const r = await zpracujZapis(db, { token: "sk_live_neco", telo: { brands: [] } });
    expect(r.stav).toBe(401);
    expect(r.telo.error).toContain("Chybí token");
  });

  it("neznámý a odvolaný token vracejí stejnou hlášku – nedá se zjistit, který existoval", async () => {
    const odvolany = await pridejToken(NAS, ["catalog:write"], true);
    const neznamy = await zpracujZapis(db, { token: novyToken(), telo: { brands: [{ name: "X" }] } });
    const zrusen = await zpracujZapis(db, { token: odvolany, telo: { brands: [{ name: "X" }] } });
    expect(neznamy.stav).toBe(401);
    expect(zrusen.stav).toBe(401);
    expect(zrusen.telo).toEqual(neznamy.telo);
    expect(db.zapisy).toHaveLength(0);
  });

  it("odvolání platí okamžitě – token, který právě zapisoval, přestane", async () => {
    const t = await pridejToken(NAS, ["catalog:write"]);
    expect((await zpracujZapis(db, { token: t, telo: { brands: [{ name: "Před" }] } })).stav).toBe(200);
    const radek = db.tabulka("api_tokens").find((x) => x.service_id === NAS && x.scopes as string[]);
    db.tabulka("api_tokens").forEach((x) => { if (x.id === radek?.id) x.revoked_at = new Date().toISOString(); });
    // odvolá se ten správný: hledáme podle otisku
    const hash = await otisk(t);
    db.tabulka("api_tokens").forEach((x) => { if (x.token_hash === hash) x.revoked_at = new Date().toISOString(); });
    expect((await zpracujZapis(db, { token: t, telo: { brands: [{ name: "Po" }] } })).stav).toBe(401);
  });

  it("token bez rozsahu nezapíše ani to, na co rozsah má", async () => {
    // Tohle je regrese: brána se dřív otevírala až u své sekce těla, takže
    // {brands, products} s tokenem jen na ceník značku založilo a teprve pak
    // vrátilo 403. Půlka zápisu byla venku a klíč idempotence se neuložil.
    const jenKatalog = await pridejToken(NAS, ["catalog:write"]);
    const r = await zpracujZapis(db, {
      token: jenKatalog,
      klic: "pulka",
      telo: { brands: [{ name: "Nesmí vzniknout" }], products: [{ sku: "BAT-6S", stock: 4 }] },
    });
    expect(r.stav).toBe(403);
    expect(r.telo.error).toContain("inventory:write");
    expect(db.tabulka("device_brands").some((b) => b.name === "Nesmí vzniknout")).toBe(false);
    expect(db.zapisy).toHaveLength(0);
    // A protože se nic nezapsalo, nemá se uložit ani klíč idempotence.
    expect(db.tabulka("api_idempotency")).toHaveLength(0);
  });

  it("vypršelý nárok na modul zastaví i platný token s rozsahem", async () => {
    // Rozsah říká, co token smí; nárok, jestli si to servis platí. Bez druhé
    // kontroly píše vydaný token dál i měsíce po konci předplatného.
    db.naroky[`${NAS}:api_inventory`] = false;
    const r = await zpracujZapis(db, { token: tokenNas, telo: { products: [{ sku: "BAT-6S", stock: 9 }] } });
    expect(r.stav).toBe(403);
    expect(r.telo.error).toContain(NAZEV_MODULU.api_inventory);
    expect(db.zapisy).toHaveLength(0);
  });

  it("token cizího servisu píše výhradně do svého servisu", async () => {
    const r = await zpracujZapis(db, { token: tokenCizi, telo: { brands: [{ name: "Cizí značka" }] } });
    expect(r.stav).toBe(200);
    const nova = db.tabulka("device_brands").find((b) => b.name === "Cizí značka");
    expect(nova?.service_id).toBe(CIZI);
    expect(zapisyMimo(CIZI)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Oddělení servisů
// ---------------------------------------------------------------------------

describe("veřejné API: cizí id se podstrčit nedá", () => {
  it("úprava opravy cizího servisu skončí jako „nenalezeno“ a nic nezmění", async () => {
    const puvodni = { ...db.tabulka("repairs").find((r) => r.service_id === CIZI)! };
    const r = await zpracujZapis(db, { token: tokenNas, telo: { repairs: [{ id: OPRAVA(CIZI), price: 1 }] } });
    expect(r.stav).toBe(200);
    expect(r.telo.repairs.not_found).toEqual([OPRAVA(CIZI)]);
    expect(r.telo.repairs.updated).toBe(0);
    expect(db.tabulka("repairs").find((x) => x.id === OPRAVA(CIZI))).toEqual(puvodni);
  });

  it("smazání produktu cizího servisu nic nesmaže", async () => {
    const r = await zpracujZapis(db, { token: tokenNas, telo: { products: [{ id: PRODUKT(CIZI), delete: true }] } });
    expect(r.telo.products.deleted).toBe(0);
    expect(r.telo.products.not_found).toEqual([PRODUKT(CIZI)]);
    expect(db.tabulka("inventory_products").some((p) => p.id === PRODUKT(CIZI))).toBe(true);
  });

  it("stejné SKU v obou servisech se nepoplete – přepíše se jen náš produkt", async () => {
    const r = await zpracujZapis(db, { token: tokenNas, telo: { products: [{ sku: "BAT-6S", price: 555 }] } });
    expect(r.telo.products.updated).toBe(1);
    expect(db.tabulka("inventory_products").find((p) => p.service_id === NAS)!.price).toBe(555);
    expect(db.tabulka("inventory_products").find((p) => p.service_id === CIZI)!.price).toBe(100);
  });

  it("vazba na model cizího servisu se vynechá a řekne se to", async () => {
    const r = await zpracujZapis(db, {
      token: tokenNas,
      telo: { repairs: [{ id: OPRAVA(NAS), model_ids: [MODEL(NAS), MODEL(CIZI)] }] },
    });
    expect(r.stav).toBe(207);
    expect(r.telo.errors.join(" ")).toContain(MODEL(CIZI));
    expect(db.tabulka("repairs").find((x) => x.id === OPRAVA(NAS))!.model_ids).toEqual([MODEL(NAS)]);
  });

  it("nová oprava jen s cizími modely nevznikne", async () => {
    const r = await zpracujZapis(db, {
      token: tokenNas,
      telo: { repairs: [{ create: true, name: "Podvrh", model_ids: [MODEL(CIZI)] }] },
    });
    expect(r.stav).toBe(207);
    expect(r.telo.repairs.created).toBe(0);
    expect(db.tabulka("repairs").some((x) => x.name === "Podvrh")).toBe(false);
  });

  it("kategorie pod cizí značkou nevznikne", async () => {
    const r = await zpracujZapis(db, {
      token: tokenNas,
      telo: { categories: [{ name: "Podvržená", brand_id: ZNACKA(CIZI) }] },
    });
    expect(r.stav).toBe(207);
    expect(r.telo.categories.created).toBe(0);
    expect(zapisyMimo(NAS)).toHaveLength(0);
  });

  it("service_id z těla se ignoruje – vlastnictví určuje token", async () => {
    const r = await zpracujZapis(db, {
      token: tokenNas,
      telo: { brands: [{ name: "Přepis vlastníka", service_id: CIZI }] },
    });
    expect(r.stav).toBe(200);
    expect(db.tabulka("device_brands").find((b) => b.name === "Přepis vlastníka")!.service_id).toBe(NAS);
  });
});

// ---------------------------------------------------------------------------
// 3. Idempotence
// ---------------------------------------------------------------------------

describe("veřejné API: idempotence zápisu", () => {
  it("stejný klíč a stejné tělo se neprovede podruhé", async () => {
    const telo = { products: [{ sku: "BAT-6S", stock: 4 }] };
    const prvni = await zpracujZapis(db, { token: tokenNas, telo, klic: "abc" });
    const pocetZapisu = db.zapisy.length;
    const druha = await zpracujZapis(db, { token: tokenNas, telo, klic: "abc" });
    expect(prvni.stav).toBe(200);
    expect(druha.stav).toBe(200);
    expect(druha.hlavicky["Idempotency-Replayed"]).toBe("true");
    expect(druha.telo).toEqual(prvni.telo);
    // Jediné, co po opakování přibylo, je čtení – žádný nový zápis.
    expect(db.zapisy.filter((z) => z.op !== "select")).toHaveLength(pocetZapisu);
  });

  it("dvakrát poslané založení produktu založí jeden, ne dva", async () => {
    const telo = { products: [{ create: true, name: "Sklo", sku: "SKLO-1", price: 200 }] };
    await zpracujZapis(db, { token: tokenNas, telo, klic: "dvakrat" });
    await zpracujZapis(db, { token: tokenNas, telo, klic: "dvakrat" });
    expect(db.tabulka("inventory_products").filter((p) => p.sku === "SKLO-1")).toHaveLength(1);
  });

  it("stejný klíč s jiným tělem je 409, ne tiché opakování", async () => {
    await zpracujZapis(db, { token: tokenNas, telo: { products: [{ sku: "BAT-6S", stock: 1 }] }, klic: "k" });
    const r = await zpracujZapis(db, { token: tokenNas, telo: { products: [{ sku: "BAT-6S", stock: 99 }] }, klic: "k" });
    expect(r.stav).toBe(409);
    // A hodnota z prvního zápisu zůstala.
    expect(db.tabulka("inventory_stock")[0].quantity).toBe(1);
  });

  it("klíč patří tokenu, ne servisu – token cizího servisu se na náš klíč nesvezí", async () => {
    const telo = { brands: [{ name: "Sdílený klíč" }] };
    await zpracujZapis(db, { token: tokenNas, telo, klic: "spolecny" });
    const r = await zpracujZapis(db, { token: tokenCizi, telo, klic: "spolecny" });
    expect(r.hlavicky["Idempotency-Replayed"]).toBeUndefined();
    expect(db.tabulka("device_brands").filter((b) => b.name === "Sdílený klíč")).toHaveLength(2);
  });

  it("opakování částečného úspěchu vrátí zase 207, ne 200", async () => {
    // Klient, který se řídí stavovým kódem, by jinak po výpadku sítě
    // přehlédl seznam chyb, který napoprvé viděl.
    const telo = { brands: [{ name: "Dobrá" }, { neco: 1 }] };
    const prvni = await zpracujZapis(db, { token: tokenNas, telo, klic: "castecny" });
    const druha = await zpracujZapis(db, { token: tokenNas, telo, klic: "castecny" });
    expect(prvni.stav).toBe(207);
    expect(druha.stav).toBe(207);
    expect(druha.telo.errors).toEqual(prvni.telo.errors);
  });

  it("klíč se ukládá i s otiskem těla a uloženou odpovědí", async () => {
    const telo = { brands: [{ name: "S klíčem" }] };
    const r = await zpracujZapis(db, { token: tokenNas, telo, klic: "ulozeny" });
    const radek = db.tabulka("api_idempotency")[0];
    expect(radek.klic).toBe("ulozeny");
    expect(radek.otisk_tela).toBe(await otiskTela(telo));
    expect(radek.odpoved).toEqual(r.telo);
    expect(radek.service_id).toBe(NAS);
  });

  it("bez hlavičky se nic nepamatuje – dvě stejná volání se provedou dvakrát", async () => {
    const telo = { brands: [{ name: "Bez klíče" }] };
    await zpracujZapis(db, { token: tokenNas, telo });
    await zpracujZapis(db, { token: tokenNas, telo });
    expect(db.tabulka("device_brands").filter((b) => b.name === "Bez klíče")).toHaveLength(2);
    expect(db.tabulka("api_idempotency")).toHaveLength(0);
  });

  it("selhání zápisu klíče nesmí shodit odpověď – data už jsou v databázi", async () => {
    // Nedávno se opravovalo tiché selhání zápisu klíče. Chování má zůstat:
    // zápis dat proběhl, takže se nevrací 500 (opakování by ho provedlo
    // podruhé), ale selhání se nesmí ztratit úplně.
    db.chyby["api_idempotency:insert"] = "duplicate key";
    const r = await zpracujZapis(db, { token: tokenNas, telo: { brands: [{ name: "Přesto" }] }, klic: "selze" });
    expect(r.stav).toBe(200);
    expect(db.tabulka("device_brands").some((b) => b.name === "Přesto")).toBe(true);
    expect(db.zapisy.some((z) => z.op === "chyba-klice")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Limity
// ---------------------------------------------------------------------------

describe("veřejné API: limit zápisů", () => {
  it("třicátý první zápis za minutu je 429 s Retry-After", async () => {
    let posledni: Vysledek | null = null;
    for (let i = 0; i < 31; i++) posledni = await zpracujZapis(db, { token: tokenNas, telo: { brands: [] } });
    expect(posledni!.stav).toBe(429);
    expect(posledni!.hlavicky["Retry-After"]).toBe("60");
  });

  it("limit se počítá na token, ne globálně – cizí servis jede dál", async () => {
    for (let i = 0; i < 31; i++) await zpracujZapis(db, { token: tokenNas, telo: { brands: [] } });
    const cizi = await zpracujZapis(db, { token: tokenCizi, telo: { brands: [{ name: "Cizí" }] } });
    expect(cizi.stav).toBe(200);
  });

  it("do limitu se počítají i požadavky, které skončí chybou", async () => {
    // Jinak by šlo limit obejít posíláním nesmyslů: chybný požadavek by
    // nestál nic a zkoušet by se dalo donekonečna.
    for (let i = 0; i < 30; i++) await zpracujZapis(db, { token: tokenNas, telo: { nic: true } });
    const r = await zpracujZapis(db, { token: tokenNas, telo: { brands: [{ name: "Po limitu" }] } });
    expect(r.stav).toBe(429);
    expect(db.tabulka("device_brands").some((b) => b.name === "Po limitu")).toBe(false);
  });

  it("limit platí dřív než idempotence – zopakovaný požadavek se nepočítá jako zadarmo", async () => {
    const telo = { brands: [{ name: "K" }] };
    await zpracujZapis(db, { token: tokenNas, telo, klic: "x" });
    for (let i = 0; i < 29; i++) await zpracujZapis(db, { token: tokenNas, telo, klic: "x" });
    const r = await zpracujZapis(db, { token: tokenNas, telo, klic: "x" });
    expect(r.stav).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// 5. Data: chybný vstup nesmí zapsat půlku
// ---------------------------------------------------------------------------

describe("veřejné API: zápis dat", () => {
  it("dávka nad 200 položek se odmítne celá, ne po kusech", async () => {
    const produkty = Array.from({ length: 201 }, (_, i) => ({ create: true, name: `P${i}`, sku: `P${i}` }));
    const r = await zpracujZapis(db, { token: tokenNas, telo: { products: produkty } });
    expect(r.stav).toBe(207);
    expect(r.telo.products.created).toBe(0);
    expect(db.tabulka("inventory_products").filter((p) => String(p.sku).startsWith("P"))).toHaveLength(0);
  });

  it("částečný úspěch je 207 se seznamem chyb i s počty toho, co prošlo", async () => {
    const r = await zpracujZapis(db, {
      token: tokenNas,
      telo: {
        products: [
          { create: true, name: "Dobrý", sku: "DOBRY" },
          { create: true, sku: "BEZ-JMENA" },
          { sku: "NENI-TAKOVE", price: 5 },
        ],
      },
    });
    expect(r.stav).toBe(207);
    expect(r.telo.ok).toBe(false);
    expect(r.telo.products.created).toBe(1);
    expect(r.telo.products.not_found).toEqual(["NENI-TAKOVE"]);
    expect(r.telo.errors.some((e: string) => e.includes("products[1]"))).toBe(true);
  });

  it("úplný úspěch je 200 a bez seznamu chyb", async () => {
    const r = await zpracujZapis(db, { token: tokenNas, telo: { brands: [{ name: "Čistá" }] } });
    expect(r.stav).toBe(200);
    expect(r.telo.ok).toBe(true);
    expect(r.telo.errors).toBeUndefined();
  });

  it("nulový stav řádek skladu smaže, neuloží nulu", async () => {
    await zpracujZapis(db, { token: tokenNas, telo: { products: [{ sku: "BAT-6S", stock: 5 }] } });
    expect(db.tabulka("inventory_stock")).toHaveLength(1);
    await zpracujZapis(db, { token: tokenNas, telo: { products: [{ sku: "BAT-6S", stock: 0 }] } });
    expect(db.tabulka("inventory_stock")).toHaveLength(0);
  });

  it("stock jde do skladu servisu, ne do cizího", async () => {
    db.tabulka("inventory_warehouses").push({ id: "cizi-sklad", service_id: CIZI, name: "Cizí", is_default: true });
    const r = await zpracujZapis(db, { token: tokenNas, telo: { products: [{ sku: "BAT-6S", stock: 2, warehouse: "cizi-sklad" }] } });
    expect(r.stav).toBe(207);
    expect(r.telo.errors.join(" ")).toContain("neexistuje");
    expect(db.tabulka("inventory_stock")).toHaveLength(0);
  });

  it("neznámé sekce těla se ignorují a prázdný požadavek je 400", async () => {
    const r = await zpracujZapis(db, { token: tokenNas, telo: { tickets: [{ id: "x" }], customers: [] } });
    expect(r.stav).toBe(400);
    expect(db.zapisy.filter((z) => z.op !== "select" && z.tabulka !== "api_tokens")).toHaveLength(0);
  });

  it("mazání značek, kategorií a modelů přes API nejde", async () => {
    const r = await zpracujZapis(db, { token: tokenNas, telo: { brands: [{ id: ZNACKA(NAS), delete: true }] } });
    expect(r.stav).toBe(207);
    expect(r.telo.errors.join(" ")).toContain("jde jen v aplikaci");
    expect(db.tabulka("device_brands").some((b) => b.id === ZNACKA(NAS))).toBe(true);
  });

  it("chyba databáze v jedné sekci nezruší sekci, která prošla", async () => {
    // Zápis není transakce: co se stihlo, zůstává. Klient to musí poznat
    // z 207 a ze seznamu chyb, ne z toho, že mu zmizí i to, co prošlo.
    db.chyby["repairs:update"] = "spojení do databáze spadlo";
    const r = await zpracujZapis(db, {
      token: tokenNas,
      telo: { brands: [{ name: "První" }], repairs: [{ id: OPRAVA(NAS), price: 1234 }] },
    });
    expect(r.stav).toBe(207);
    expect(r.telo.brands.created).toBe(1);
    expect(r.telo.errors.join(" ")).toContain("spojení do databáze spadlo");
    expect(db.tabulka("device_brands").some((b) => b.name === "První")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Pojistky ve zdrojácích edge funkcí
//
// Referenční implementace výš je zrcadlo: kdyby někdo přepsal index.ts,
// nepozná to. Tyhle testy čtou skutečný zdroják a hlídají v něm právě ta
// místa, kde chyba znamená cizí data nebo dvojí zápis.
// ---------------------------------------------------------------------------

describe("pojistky ve zdrojácích veřejného API", () => {
  const bezKomentaru = (cesta: string) =>
    readFileSync(join(KOREN, cesta), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

  const zapis = () => bezKomentaru("supabase/functions/api-write/index.ts");

  it("rozsahy se ověří dřív, než se do databáze cokoli zapíše", () => {
    // Regrese: brána byla uvnitř každé sekce, takže {brands, products}
    // s tokenem jen na ceník značky založilo a pak vrátilo 403.
    const zdroj = zapis();
    const brana = zdroj.lastIndexOf("await branaRozsahu");
    const prvniZapis = Math.min(
      ...[".insert(", ".update(", ".delete(", ".upsert("]
        .map((x) => zdroj.indexOf(x))
        .filter((i) => i > -1),
    );
    expect(brana, "kontrola rozsahu ve zdrojáku chybí").toBeGreaterThan(-1);
    expect(brana, "poslední kontrola rozsahu musí být před prvním zápisem").toBeLessThan(prvniZapis);
  });

  it("každá změna dat je omezená na servis tokenu", () => {
    const zdroj = zapis();
    // Řádky s update/delete nad daty servisu musí mít filtr na service_id.
    const podezrele = zdroj
      .split("\n")
      .filter((r) => /\.(update|delete)\(/.test(r))
      // inventory_stock a api_tokens se adresují id, které už prošlo
      // dotazem omezeným na servis – hlídají je testy níž.
      .filter((r) => !/inventory_stock|api_tokens|api_idempotency/.test(r))
      .filter((r) => !/\.in\("id", ids\)/.test(r))
      .filter((r) => !/service_id/.test(r));
    expect(podezrele, `zápis bez filtru na servis: ${podezrele.join(" | ")}`).toHaveLength(0);
  });

  it("hromadná úprava produktů jede jen přes id, která se předtím našla v servisu", () => {
    // `.update(sloupce).in("id", ids)` filtr na servis nemá – drží ho jen to,
    // že `ids` pocházejí z dotazu omezeného na servis. Kdyby ten filtr někdo
    // odstranil, dal by se přes `sku` přepsat produkt cizího servisu.
    const zdroj = zapis();
    expect(zdroj).toMatch(
      /const hledani = svc\.from\("inventory_products"\)\.select\("id"\)\.eq\("service_id", sid\)/,
    );
    expect(zdroj).toMatch(/const ids = \(nalezene as \{ id: string \}\[\]\)\.map/);
  });

  it("stav skladu se zapisuje jen na produkty, které se předtím našly v servisu", () => {
    // inventory_stock nemá filtr na service_id v samotném dotazu – drží ho
    // jen to, že product_id i warehouse_id pocházejí ze seznamů servisu.
    const zdroj = zapis();
    expect(zdroj).toMatch(/inventory_warehouses[\s\S]{0,120}\.eq\("service_id", sid\)/);
    expect(zdroj, "cíl skladu se hledá v seznamu skladů servisu").toMatch(/seznamSkladu\.find/);
  });

  it("do nového záznamu se service_id doplňuje z tokenu, ne z těla", () => {
    const zdroj = zapis();
    const inserty = zdroj.split("\n").filter((r) => r.includes(".insert({") && !r.includes("api_idempotency"));
    expect(inserty.length).toBeGreaterThan(2);
    for (const radek of inserty) {
      expect(radek, `insert bez service_id: ${radek.trim()}`).toMatch(/service_id: sid|service_id: zaznam\.service_id/);
      // `service_id: sid` musí být AŽ ZA rozbalením hodnot od klienta,
      // jinak by ho `...z.hodnoty` přebilo.
      const rozbaleni = radek.indexOf("...");
      const vlastnik = radek.indexOf("service_id: sid");
      if (rozbaleni > -1 && vlastnik > -1) expect(vlastnik).toBeGreaterThan(rozbaleni);
    }
  });

  it("neplatný a odvolaný token se vyhodnocují jednou podmínkou", () => {
    // Dvě větve = dvě různé hlášky = dá se zjistit, který token existoval.
    const zdroj = zapis();
    expect(zdroj).toMatch(/if \(!zaznam \|\| zaznam\.revoked_at\) return json\(\{ error: "Neplatný token" \}, 401\)/);
  });

  it("limit se počítá dřív, než se čte tělo požadavku", () => {
    const zdroj = zapis();
    expect(zdroj.indexOf("api_zapocitej_zapis")).toBeLessThan(zdroj.indexOf("await req.json()"));
  });

  it("selhání zápisu idempotenčního klíče se nesmí ztratit", () => {
    // Bez uloženého klíče přestane idempotence platit a opakovaný požadavek
    // se provede podruhé. Vracet 500 nejde (data už jsou zapsaná), ale
    // chyba musí aspoň dojít do logu.
    const zdroj = zapis();
    expect(zdroj, "výsledek insertu klíče se musí přečíst").toMatch(/const \{ error: chybaKlice \}[\s\S]{0,400}api_idempotency/);
    expect(zdroj, "a zalogovat").toMatch(/if \(chybaKlice\) console\.error/);
  });

  it("opakovaná odpověď si nese původní stav i hlavičku", () => {
    const zdroj = zapis();
    expect(zdroj).toMatch(/Idempotency-Replayed/);
    expect(zdroj, "částečný úspěch se musí opakovat jako 207").toMatch(/ok === false \? 207 : 200/);
  });

  it("čtení ceníku i skladu tají, jestli servis existuje", () => {
    for (const cesta of ["supabase/functions/public-catalog/index.ts", "supabase/functions/public-inventory/index.ts"]) {
      const zdroj = bezKomentaru(cesta);
      // Jedna společná funkce pro „servis není“ i „modul je vypnutý“.
      const pocet = zdroj.match(/return nenalezeno\(\)/g)?.length ?? 0;
      expect(pocet, `${cesta}: obě větve musí vracet totéž`).toBeGreaterThanOrEqual(2);
      expect(zdroj, `${cesta}: limit se smí počítat až po nalezení servisu`).toMatch(
        /if \(!platny\) return nenalezeno\(\)[\s\S]*api_zapocitej_cteni/,
      );
    }
  });

  it("veřejný ceník neposílá ven náklady servisu", () => {
    const zdroj = bezKomentaru("supabase/functions/public-catalog/index.ts");
    expect(zdroj, "žádné select *").not.toMatch(/\.select\(\s*["'`]\*/);
    expect(zdroj, "costs prozrazuje marži").not.toMatch(/costs/);
  });

  it("veřejný sklad posílá nákupní cenu jen na výslovné přání servisu", () => {
    const zdroj = bezKomentaru("supabase/functions/public-inventory/index.ts");
    expect(zdroj).toMatch(/public_inventory_show_purchase_price === true/);
    expect(zdroj).toMatch(/posilatNakupni && p\.purchase_price !== null/);
  });

  it("token vydává jen majitel nebo admin a jen na zaplacený modul", () => {
    const zdroj = bezKomentaru("supabase/functions/api-tokens-manage/index.ts");
    expect(zdroj).toMatch(/clenstvi\.role !== "owner" && clenstvi\.role !== "admin"/);
    const kontrola = zdroj.indexOf("has_entitlement");
    const vytvoreni = zdroj.indexOf("novyToken()");
    expect(kontrola, "nárok se ověřuje").toBeGreaterThan(-1);
    expect(vytvoreni, "kontrola nároku musí být před vytvořením tokenu").toBeGreaterThan(kontrola);
  });

  it("odvolat jde jen token vlastního servisu a hash se ven nevrací", () => {
    const zdroj = bezKomentaru("supabase/functions/api-tokens-manage/index.ts");
    expect(zdroj).toMatch(/\.eq\("id", tokenId\)[\s\S]{0,200}\.eq\("service_id", serviceId\)/);
    expect(zdroj, "výpis tokenů nesmí obsahovat token_hash").not.toMatch(/select\("[^"]*token_hash/);
  });

  it("v databázi je jen otisk – samotný token se vrací jedinkrát", () => {
    const zdroj = bezKomentaru("supabase/functions/api-tokens-manage/index.ts");
    expect(zdroj).toMatch(/token_hash: await otisk\(token\)/);
    expect(zdroj.match(/return json\(\{ token,/g)?.length, "token opouští server na jediném místě").toBe(1);
  });

  it("obrazovka v Nastavení ukazuje čerstvý token jen do zavření, seznam už ne", () => {
    const zdroj = bezKomentaru("src/pages/Settings/ApiNastaveni.tsx");
    // Token drží jedna proměnná ve stavu; „Mám ho uložený“ ji vynuluje.
    expect(zdroj).toMatch(/setCerstvyToken\(null\)/);
    // Seznam tokenů vykresluje jen název, rozsahy a časy – nic z tokenu.
    const seznam = zdroj.slice(zdroj.indexOf("tokeny.map((t)"), zdroj.indexOf("Jak zapisovat"));
    expect(seznam, "v seznamu se nesmí objevit hodnota tokenu").not.toMatch(/cerstvyToken|t\.token\b|token_hash/);
  });
});
