/**
 * Díly od dodavatele – dodavatelé, objednávky a rezervace v Supabase.
 *
 * Tabulky (`inventory_suppliers`, `inventory_purchase_orders`,
 * `inventory_purchase_order_items`, `inventory_reservations`) a RPC
 * (`inventory_next_po_number`, `inventory_receive_order`) na starším
 * serveru nemusí existovat. Každé volání proto selhává měkce: vrací
 * prázdná data a `nedostupne: true`, aby si stránka Sklad mohla vypsat
 * jednu tlumenou větu a dál fungovat. Nic odsud nesmí shodit sklad.
 */

import { getSupabaseClient } from "./supabaseClient";
import { reportSilent } from "./reportError";

export type PurchaseOrderStatus = "draft" | "ordered" | "received" | "cancelled";

export type Supplier = {
  id: string;
  serviceId: string;
  name: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  /** Obvyklá doba dodání ve dnech. */
  leadDays: number | null;
  note: string | null;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
};

export type PurchaseOrderItem = {
  id: string;
  orderId: string;
  productId: string;
  /** Zakázka, kvůli které se díl objednává. Nepovinné. */
  ticketId: string | null;
  qty: number;
  unitPrice: number | null;
  receivedQty: number;
  createdAt: string;
};

export type PurchaseOrder = {
  id: string;
  serviceId: string;
  /** `null` = návrh „Bez dodavatele“. */
  supplierId: string | null;
  number: string;
  status: PurchaseOrderStatus;
  note: string | null;
  orderedAt: string | null;
  expectedAt: string | null;
  receivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: PurchaseOrderItem[];
};

export type Reservation = {
  id: string;
  serviceId: string;
  productId: string;
  ticketId: string | null;
  qty: number;
  status: "reserved" | "consumed" | "released";
};

/**
 * Výsledek každého volání. `nedostupne` znamená, že tabulka nebo funkce
 * na serveru chybí – to není chyba uživatele a stránka to jen tlumeně
 * oznámí. `error` je všechno ostatní (síť, práva, porušený constraint).
 */
export type PoVysledek<T> = { data: T; error?: string; nedostupne?: boolean };

export const HLASKA_NEDOSTUPNE = "Objednávky nejsou na serveru zapnuté";

type DbChyba = { code?: string; message?: string; details?: string } | null | undefined;

/**
 * Chybějící tabulka, sloupec nebo funkce. Postgres hlásí 42P01/42703/42883,
 * PostgREST před nimi ještě PGRST202 (funkce) a PGRST205 (tabulka)
 * z vlastní cache schématu.
 */
export function jeChybaChybejicihoObjektu(err: DbChyba): boolean {
  if (!err) return false;
  const kod = err.code ?? "";
  if (["42P01", "42703", "42883", "PGRST202", "PGRST205", "PGRST204"].includes(kod)) return true;
  const zprava = `${err.message ?? ""} ${err.details ?? ""}`.toLowerCase();
  return (
    zprava.includes("does not exist") ||
    zprava.includes("schema cache") ||
    zprava.includes("could not find the")
  );
}

function jeUnikatniKolize(err: DbChyba): boolean {
  return !!err && (err.code === "23505" || (err.message ?? "").toLowerCase().includes("duplicate key"));
}

function selhani<T>(prazdne: T, err: DbChyba): PoVysledek<T> {
  if (jeChybaChybejicihoObjektu(err)) return { data: prazdne, nedostupne: true, error: err?.message };
  return { data: prazdne, error: err?.message ?? "Neznámá chyba" };
}

function bezKlienta<T>(prazdne: T): PoVysledek<T> {
  return { data: prazdne, nedostupne: true };
}

function uuid() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random()}`;
}

function cislo(v: unknown, vychozi: number): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : vychozi;
}

/* ---------- mapování řádků ---------- */

type SupplierRow = {
  id: string; service_id: string; name: string; email: string | null; phone: string | null; website: string | null;
  lead_days: number | null; note: string | null; order_index: number | null; created_at: string; updated_at: string | null;
};

function mapSupplier(r: SupplierRow): Supplier {
  return {
    id: r.id,
    serviceId: r.service_id,
    name: r.name,
    email: r.email ?? null,
    phone: r.phone ?? null,
    website: r.website ?? null,
    leadDays: r.lead_days === null || r.lead_days === undefined ? null : cislo(r.lead_days, 0),
    note: r.note ?? null,
    orderIndex: cislo(r.order_index, 0),
    createdAt: r.created_at,
    updatedAt: r.updated_at ?? r.created_at,
  };
}

type ItemRow = {
  id: string; order_id: string; product_id: string; ticket_id: string | null;
  qty: number | string; unit_price: number | string | null; received_qty: number | string | null; created_at: string;
};

function mapItem(r: ItemRow): PurchaseOrderItem {
  return {
    id: r.id,
    orderId: r.order_id,
    productId: r.product_id,
    ticketId: r.ticket_id ?? null,
    qty: cislo(r.qty, 0),
    unitPrice: r.unit_price === null || r.unit_price === undefined ? null : cislo(r.unit_price, 0),
    receivedQty: cislo(r.received_qty, 0),
    createdAt: r.created_at,
  };
}

type OrderRow = {
  id: string; service_id: string; supplier_id: string | null; number: string; status: PurchaseOrderStatus; note: string | null;
  ordered_at: string | null; expected_at: string | null; received_at: string | null; created_at: string; updated_at: string | null;
};

function mapOrder(r: OrderRow, items: PurchaseOrderItem[]): PurchaseOrder {
  return {
    id: r.id,
    serviceId: r.service_id,
    supplierId: r.supplier_id ?? null,
    number: r.number,
    status: r.status,
    note: r.note ?? null,
    orderedAt: r.ordered_at ?? null,
    expectedAt: r.expected_at ?? null,
    receivedAt: r.received_at ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at ?? r.created_at,
    items,
  };
}

const SUPPLIER_COLS = "id, service_id, name, email, phone, website, lead_days, note, order_index, created_at, updated_at";
const ORDER_COLS = "id, service_id, supplier_id, number, status, note, ordered_at, expected_at, received_at, created_at, updated_at";
const ITEM_COLS = "id, order_id, product_id, ticket_id, qty, unit_price, received_qty, created_at";

/* ---------- dodavatelé ---------- */

export async function loadSuppliers(serviceId: string | null): Promise<PoVysledek<Supplier[]>> {
  const supabase = getSupabaseClient();
  if (!supabase || !serviceId) return bezKlienta([]);
  try {
    const res = await (supabase.from("inventory_suppliers") as any)
      .select(SUPPLIER_COLS)
      .eq("service_id", serviceId)
      .order("order_index")
      .order("name");
    if (res.error) return selhani([], res.error);
    return { data: ((res.data ?? []) as SupplierRow[]).map(mapSupplier) };
  } catch (e) {
    return selhani([], { message: (e as Error)?.message });
  }
}

export type SupplierInput = {
  id?: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  leadDays?: number | null;
  note?: string | null;
  orderIndex?: number;
};

/** Založí (bez `id`) nebo upraví dodavatele. Vrací uloženou podobu. */
export async function saveSupplier(serviceId: string | null, s: SupplierInput): Promise<PoVysledek<Supplier | null>> {
  const supabase = getSupabaseClient();
  if (!supabase || !serviceId) return bezKlienta(null);
  const name = s.name.trim();
  if (!name) return { data: null, error: "Název dodavatele je povinný" };
  const radek = {
    id: s.id ?? uuid(),
    service_id: serviceId,
    name,
    email: s.email?.trim() || null,
    phone: s.phone?.trim() || null,
    website: s.website?.trim() || null,
    lead_days: s.leadDays === null || s.leadDays === undefined || !Number.isFinite(s.leadDays) ? null : Math.max(0, Math.round(s.leadDays)),
    note: s.note?.trim() || null,
    ...(s.orderIndex !== undefined ? { order_index: s.orderIndex } : {}),
    updated_at: new Date().toISOString(),
  };
  try {
    const res = await (supabase.from("inventory_suppliers") as any)
      .upsert(radek, { onConflict: "id" })
      .select(SUPPLIER_COLS)
      .single();
    if (res.error) return selhani(null, res.error);
    return { data: mapSupplier(res.data as SupplierRow) };
  } catch (e) {
    return selhani(null, { message: (e as Error)?.message });
  }
}

export async function deleteSupplier(id: string): Promise<PoVysledek<boolean>> {
  const supabase = getSupabaseClient();
  if (!supabase) return bezKlienta(false);
  try {
    const res = await (supabase.from("inventory_suppliers") as any).delete().eq("id", id);
    if (res.error) return selhani(false, res.error);
    return { data: true };
  } catch (e) {
    return selhani(false, { message: (e as Error)?.message });
  }
}

/* ---------- objednávky ---------- */

/** Načte objednávky servisu včetně položek, nejnovější první. */
export async function loadOrders(serviceId: string | null): Promise<PoVysledek<PurchaseOrder[]>> {
  const supabase = getSupabaseClient();
  if (!supabase || !serviceId) return bezKlienta([]);
  try {
    const ordersRes = await (supabase.from("inventory_purchase_orders") as any)
      .select(ORDER_COLS)
      .eq("service_id", serviceId)
      .order("created_at", { ascending: false });
    if (ordersRes.error) return selhani([], ordersRes.error);
    const rows = (ordersRes.data ?? []) as OrderRow[];
    if (rows.length === 0) return { data: [] };

    const ids = rows.map((r) => r.id);
    const itemsRes = await (supabase.from("inventory_purchase_order_items") as any)
      .select(ITEM_COLS)
      .in("order_id", ids)
      .order("created_at");
    if (itemsRes.error) return selhani([], itemsRes.error);

    const podleObjednavky = new Map<string, PurchaseOrderItem[]>();
    for (const r of (itemsRes.data ?? []) as ItemRow[]) {
      const list = podleObjednavky.get(r.order_id) ?? [];
      list.push(mapItem(r));
      podleObjednavky.set(r.order_id, list);
    }
    return { data: rows.map((r) => mapOrder(r, podleObjednavky.get(r.id) ?? [])) };
  } catch (e) {
    return selhani([], { message: (e as Error)?.message });
  }
}

/**
 * Číslo objednávky. Primárně z RPC (`OBJ-2026-001`); když funkce na serveru
 * chybí, dopočítá se z existujících čísel letošního roku, ať se návrh dá
 * založit i tak. Kolizi mezi dvěma klienty řeší volající opakováním.
 */
async function dalsiCislo(supabase: any, serviceId: string): Promise<{ cislo: string; error?: DbChyba }> {
  const rpc = await (supabase as any).rpc("inventory_next_po_number", { p_service_id: serviceId });
  if (!rpc.error && typeof rpc.data === "string" && rpc.data.trim()) return { cislo: rpc.data.trim() };
  if (rpc.error && !jeChybaChybejicihoObjektu(rpc.error)) return { cislo: "", error: rpc.error };

  const rok = new Date().getFullYear();
  const prefix = `OBJ-${rok}-`;
  const res = await supabase
    .from("inventory_purchase_orders")
    .select("number")
    .eq("service_id", serviceId)
    .like("number", `${prefix}%`);
  if (res.error) return { cislo: "", error: res.error };
  let max = 0;
  for (const r of (res.data ?? []) as { number: string }[]) {
    const n = parseInt(r.number.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return { cislo: `${prefix}${String(max + 1).padStart(3, "0")}` };
}

export type NewOrderItem = {
  productId: string;
  qty: number;
  unitPrice?: number | null;
  ticketId?: string | null;
};

function radekPolozky(orderId: string, it: NewOrderItem & { id?: string; receivedQty?: number }) {
  return {
    id: it.id ?? uuid(),
    order_id: orderId,
    product_id: it.productId,
    ticket_id: it.ticketId ?? null,
    qty: Math.max(0, Math.round(it.qty)),
    unit_price: it.unitPrice === null || it.unitPrice === undefined || !Number.isFinite(it.unitPrice) ? null : it.unitPrice,
    received_qty: Math.max(0, Math.round(it.receivedQty ?? 0)),
  };
}

/**
 * Založí návrh objednávky. Číslo dává RPC; když se sejdou dva klienti a
 * databáze ohlásí kolizi čísla, zkusí se to ještě jednou s novým číslem.
 */
export async function createOrder(
  serviceId: string | null,
  supplierId: string | null,
  items: NewOrderItem[],
  note?: string | null,
): Promise<PoVysledek<PurchaseOrder | null>> {
  const supabase = getSupabaseClient();
  if (!supabase || !serviceId) return bezKlienta(null);
  try {
    let vlozeno: OrderRow | null = null;
    for (let pokus = 0; pokus < 2 && !vlozeno; pokus++) {
      const c = await dalsiCislo(supabase, serviceId);
      if (c.error) return selhani(null, c.error);
      const res = await (supabase.from("inventory_purchase_orders") as any)
        .insert({
          id: uuid(),
          service_id: serviceId,
          supplier_id: supplierId,
          number: c.cislo,
          status: "draft",
          note: note?.trim() || null,
        })
        .select(ORDER_COLS)
        .single();
      if (res.error) {
        if (jeUnikatniKolize(res.error) && pokus === 0) continue;
        return selhani(null, res.error);
      }
      vlozeno = res.data as OrderRow;
    }
    if (!vlozeno) return { data: null, error: "Číslo objednávky se nepodařilo přidělit" };

    let polozky: PurchaseOrderItem[] = [];
    const platne = items.filter((it) => it.productId && it.qty > 0);
    if (platne.length > 0) {
      const itemsRes = await (supabase.from("inventory_purchase_order_items") as any)
        .insert(platne.map((it) => radekPolozky(vlozeno!.id, it)))
        .select(ITEM_COLS);
      if (itemsRes.error) return selhani(null, itemsRes.error);
      polozky = ((itemsRes.data ?? []) as ItemRow[]).map(mapItem);
    }
    return { data: mapOrder(vlozeno, polozky) };
  } catch (e) {
    return selhani(null, { message: (e as Error)?.message });
  }
}

export type OrderPatch = {
  status?: PurchaseOrderStatus;
  note?: string | null;
  expectedAt?: string | null;
  supplierId?: string | null;
};

/** Povolené přechody stavu. Přijetí jde jedině přes `receiveOrder`. */
const PRECHODY: Record<PurchaseOrderStatus, PurchaseOrderStatus[]> = {
  draft: ["ordered", "cancelled"],
  ordered: ["cancelled"],
  received: [],
  cancelled: [],
};

/**
 * Změna stavu, poznámky nebo očekávaného termínu. Přepnutí na „objednáno“
 * doplní `ordered_at`, když ještě chybí. Nepovolený přechod vrací chybu
 * dřív, než se na server cokoli pošle.
 */
export async function updateOrder(order: PurchaseOrder, patch: OrderPatch): Promise<PoVysledek<PurchaseOrder | null>> {
  const supabase = getSupabaseClient();
  if (!supabase) return bezKlienta(null);
  if (patch.status && patch.status !== order.status && !PRECHODY[order.status].includes(patch.status)) {
    return { data: null, error: `Objednávku ve stavu „${order.status}“ nejde přepnout na „${patch.status}“` };
  }
  const radek: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.note !== undefined) radek.note = patch.note?.trim() || null;
  if (patch.expectedAt !== undefined) radek.expected_at = patch.expectedAt || null;
  if (patch.supplierId !== undefined) radek.supplier_id = patch.supplierId;
  if (patch.status && patch.status !== order.status) {
    radek.status = patch.status;
    if (patch.status === "ordered" && !order.orderedAt) radek.ordered_at = new Date().toISOString();
  }
  try {
    const res = await (supabase.from("inventory_purchase_orders") as any)
      .update(radek)
      .eq("id", order.id)
      .select(ORDER_COLS)
      .single();
    if (res.error) return selhani(null, res.error);
    return { data: mapOrder(res.data as OrderRow, order.items) };
  } catch (e) {
    return selhani(null, { message: (e as Error)?.message });
  }
}

/** Smaže návrh i s položkami (kaskádou). Jiný stav než návrh se nemaže. */
export async function deleteOrder(order: PurchaseOrder): Promise<PoVysledek<boolean>> {
  const supabase = getSupabaseClient();
  if (!supabase) return bezKlienta(false);
  if (order.status !== "draft") return { data: false, error: "Smazat jde jen návrh objednávky" };
  try {
    const items = await (supabase.from("inventory_purchase_order_items") as any).delete().eq("order_id", order.id);
    if (items.error) return selhani(false, items.error);
    const res = await (supabase.from("inventory_purchase_orders") as any).delete().eq("id", order.id);
    if (res.error) return selhani(false, res.error);
    return { data: true };
  } catch (e) {
    return selhani(false, { message: (e as Error)?.message });
  }
}

export type OrderItemInput = NewOrderItem & { id?: string; receivedQty?: number };

/**
 * Nastaví položky objednávky přesně na `items`: existující (podle `id`)
 * upraví, nové vloží, ostatní smaže. Položky s nulovým množstvím se
 * nedrží – řádek bez kusů nemá v objednávce co dělat.
 */
export async function updateItems(orderId: string, items: OrderItemInput[]): Promise<PoVysledek<PurchaseOrderItem[]>> {
  const supabase = getSupabaseClient();
  if (!supabase) return bezKlienta([]);
  try {
    const radky = items.filter((it) => it.productId && it.qty > 0).map((it) => radekPolozky(orderId, it));
    const drzene = radky.map((r) => r.id);

    const existujici = await (supabase.from("inventory_purchase_order_items") as any).select("id").eq("order_id", orderId);
    if (existujici.error) return selhani([], existujici.error);
    const keSmazani = ((existujici.data ?? []) as { id: string }[]).map((r) => r.id).filter((id) => !drzene.includes(id));
    if (keSmazani.length > 0) {
      const del = await (supabase.from("inventory_purchase_order_items") as any).delete().in("id", keSmazani);
      if (del.error) return selhani([], del.error);
    }
    if (radky.length === 0) return { data: [] };
    const res = await (supabase.from("inventory_purchase_order_items") as any)
      .upsert(radky, { onConflict: "id" })
      .select(ITEM_COLS)
      .order("created_at");
    if (res.error) return selhani([], res.error);
    return { data: ((res.data ?? []) as ItemRow[]).map(mapItem) };
  } catch (e) {
    return selhani([], { message: (e as Error)?.message });
  }
}

/**
 * Přijetí na sklad – jedna transakce v databázi: přičte kusy do zásoby,
 * doplní `received_qty` a přepne stav. Nic z toho se nedělá na klientovi,
 * aby polovina nemohla projít a druhá ne.
 */
export async function receiveOrder(orderId: string, warehouseId: string): Promise<PoVysledek<boolean>> {
  const supabase = getSupabaseClient();
  if (!supabase) return bezKlienta(false);
  try {
    const res = await (supabase as any).rpc("inventory_receive_order", { p_order_id: orderId, p_warehouse_id: warehouseId });
    if (res.error) return selhani(false, res.error);
    return { data: true };
  } catch (e) {
    return selhani(false, { message: (e as Error)?.message });
  }
}

/* ---------- rezervace a kusy na cestě ---------- */

/** Rezervované kusy po produktech (jen stav `reserved`). */
export async function loadReservations(serviceId: string | null): Promise<PoVysledek<Map<string, number>>> {
  const supabase = getSupabaseClient();
  if (!supabase || !serviceId) return bezKlienta(new Map());
  try {
    const res = await (supabase.from("inventory_reservations") as any)
      .select("product_id, qty, status")
      .eq("service_id", serviceId)
      .eq("status", "reserved");
    if (res.error) return selhani(new Map(), res.error);
    const out = new Map<string, number>();
    for (const r of (res.data ?? []) as { product_id: string; qty: number | string }[]) {
      out.set(r.product_id, (out.get(r.product_id) ?? 0) + cislo(r.qty, 0));
    }
    return { data: out };
  } catch (e) {
    return selhani(new Map(), { message: (e as Error)?.message });
  }
}

/** Kusy objednané a dosud nepřijaté, po produktech. Návrhy se nepočítají. */
export function onOrderQty(orders: PurchaseOrder[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const o of orders) {
    if (o.status !== "ordered") continue;
    for (const it of o.items) {
      const zbyva = Math.max(0, it.qty - it.receivedQty);
      if (zbyva > 0) out.set(it.productId, (out.get(it.productId) ?? 0) + zbyva);
    }
  }
  return out;
}

/* ---------- text objednávky pro schránku a e-mail ---------- */

export function textObjednavky(
  order: { number: string; note: string | null; items: { productId: string; qty: number }[] },
  supplier: Supplier | null,
  produkty: Map<string, { name: string; supplierSku?: string | null; sku?: string }>,
): string {
  const radky = order.items.map((it) => {
    const p = produkty.get(it.productId);
    const nazev = p?.name ?? "Neznámý produkt";
    const kod = p?.supplierSku || p?.sku;
    return `${it.qty} × ${nazev}${kod ? ` (${kod})` : ""}`;
  });
  const hlava = [`Objednávka ${order.number}`, supplier ? `Dodavatel: ${supplier.name}` : null].filter(Boolean);
  const pata = order.note ? ["", `Poznámka: ${order.note}`] : [];
  return [...hlava, "", ...radky, ...pata].join("\n");
}

/* ---------- rezervace dílů ze zakázky ---------- */
/*
 * RPC inventory_reserve_for_repair / inventory_release_reservations /
 * inventory_consume_ticket (migrace 20260905100000). Volá se z detailu
 * zakázky vedle úprav oprav a změny stavu, proto všechno selhává měkce:
 * `null` = nepodařilo se (chybějící funkce na serveru se ani nehlásí),
 * ostatní chyby jdou tiše do reportSilent. Zakázku to nikdy nezablokuje.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Jen platná uuid – produkt z lokálního katalogu s jiným id by RPC shodil (22P02). */
export function jenUuid(ids: readonly string[] | undefined | null): string[] {
  return Array.from(new Set((ids ?? []).filter((x) => typeof x === "string" && UUID_RE.test(x))));
}

export type ReserveShortage = {
  productId: string;
  name: string;
  /** Aktuální stav skladu (součet skladů). */
  stock: number;
  /** Součet živých rezervací tohoto produktu přes všechny zakázky. */
  reservedTotal: number;
};

export type ReserveResult = { reserved: number; shortages: ReserveShortage[] };

export type ConsumeShortage = {
  productId: string;
  name: string;
  requested: number;
  consumed: number;
  missing: number;
};

export type ConsumeResult = { consumed: number; shortages: ConsumeShortage[] };

export type TicketReservation = Reservation & {
  repairEntryId: string | null;
  productName: string;
  createdAt: string;
};

function tichaChyba(code: string, source: string, err: DbChyba) {
  if (jeChybaChybejicihoObjektu(err)) return;
  reportSilent({ code, error: err, source });
}

/**
 * Zarezervuje díly opravy pro zakázku (jeden řádek na produkt).
 * `repairEntryId` je `id` položky v performed_repairs.
 */
export async function reserveForRepair(
  ticketId: string,
  repairEntryId: string,
  productIds: readonly string[],
  qty = 1,
): Promise<ReserveResult | null> {
  const supabase = getSupabaseClient();
  const ids = jenUuid(productIds);
  if (!supabase || !ticketId || ids.length === 0) return null;
  try {
    const res = await (supabase as any).rpc("inventory_reserve_for_repair", {
      p_ticket_id: ticketId,
      p_repair_entry_id: repairEntryId,
      p_product_ids: ids,
      p_qty: qty,
    });
    if (res.error) {
      tichaChyba("inventory.reserve_failed", "purchaseOrders.reserveForRepair", res.error);
      return null;
    }
    const d = (res.data ?? {}) as { reserved?: unknown; shortages?: unknown };
    const shortages = Array.isArray(d.shortages) ? d.shortages : [];
    return {
      reserved: cislo(d.reserved, 0),
      shortages: shortages.map((s: any) => ({
        productId: String(s?.product_id ?? ""),
        name: String(s?.name ?? "Díl"),
        stock: cislo(s?.stock, 0),
        reservedTotal: cislo(s?.reserved_total, 0),
      })),
    };
  } catch (e) {
    tichaChyba("inventory.reserve_failed", "purchaseOrders.reserveForRepair", { message: (e as Error)?.message });
    return null;
  }
}

/** Uvolní rezervace zakázky; s `repairEntryId` jen rezervace jedné opravy. Vrací počet uvolněných řádků. */
export async function releaseReservations(ticketId: string, repairEntryId?: string | null): Promise<number | null> {
  const supabase = getSupabaseClient();
  if (!supabase || !ticketId) return null;
  try {
    const res = await (supabase as any).rpc("inventory_release_reservations", {
      p_ticket_id: ticketId,
      p_repair_entry_id: repairEntryId ?? null,
    });
    if (res.error) {
      tichaChyba("inventory.release_failed", "purchaseOrders.releaseReservations", res.error);
      return null;
    }
    return cislo((res.data as { released?: unknown } | null)?.released, 0);
  } catch (e) {
    tichaChyba("inventory.release_failed", "purchaseOrders.releaseReservations", { message: (e as Error)?.message });
    return null;
  }
}

/** Odečte živé rezervace zakázky ze skladu (koncový stav zakázky). Nikdy nejde pod nulu – chybějící kusy jsou v `shortages`. */
export async function consumeTicketReservations(ticketId: string, warehouseId?: string | null): Promise<ConsumeResult | null> {
  const supabase = getSupabaseClient();
  if (!supabase || !ticketId) return null;
  try {
    const res = await (supabase as any).rpc("inventory_consume_ticket", {
      p_ticket_id: ticketId,
      p_warehouse_id: warehouseId ?? null,
    });
    if (res.error) {
      tichaChyba("inventory.consume_failed", "purchaseOrders.consumeTicketReservations", res.error);
      return null;
    }
    const d = (res.data ?? {}) as { consumed?: unknown; shortages?: unknown };
    const shortages = Array.isArray(d.shortages) ? d.shortages : [];
    return {
      consumed: cislo(d.consumed, 0),
      shortages: shortages.map((s: any) => ({
        productId: String(s?.product_id ?? ""),
        name: String(s?.name ?? "Díl"),
        requested: cislo(s?.requested, 0),
        consumed: cislo(s?.consumed, 0),
        missing: cislo(s?.missing, 0),
      })),
    };
  } catch (e) {
    tichaChyba("inventory.consume_failed", "purchaseOrders.consumeTicketReservations", { message: (e as Error)?.message });
    return null;
  }
}

/** Rezervace jedné zakázky (všechny stavy) s názvy produktů. */
export async function loadTicketReservations(ticketId: string): Promise<TicketReservation[] | null> {
  const supabase = getSupabaseClient();
  if (!supabase || !ticketId) return null;
  try {
    const res = await (supabase.from("inventory_reservations") as any)
      .select("id, service_id, product_id, ticket_id, repair_entry_id, qty, status, created_at")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true });
    if (res.error) {
      tichaChyba("inventory.reservations_load_failed", "purchaseOrders.loadTicketReservations", res.error);
      return null;
    }
    type Row = {
      id: string; service_id: string; product_id: string; ticket_id: string | null;
      repair_entry_id: string | null; qty: number | string; status: Reservation["status"]; created_at: string;
    };
    const rows = (res.data ?? []) as Row[];
    const productIds = Array.from(new Set(rows.map((r) => r.product_id)));
    const names = new Map<string, string>();
    if (productIds.length > 0) {
      const pr = await (supabase.from("inventory_products") as any).select("id, name").in("id", productIds);
      if (!pr.error) {
        for (const p of (pr.data ?? []) as { id: string; name: string }[]) names.set(p.id, p.name);
      }
    }
    return rows.map((r) => ({
      id: r.id,
      serviceId: r.service_id,
      productId: r.product_id,
      ticketId: r.ticket_id,
      qty: cislo(r.qty, 1),
      status: r.status,
      repairEntryId: r.repair_entry_id ?? null,
      productName: names.get(r.product_id) ?? "Neznámý díl",
      createdAt: r.created_at,
    }));
  } catch (e) {
    tichaChyba("inventory.reservations_load_failed", "purchaseOrders.loadTicketReservations", { message: (e as Error)?.message });
    return null;
  }
}
