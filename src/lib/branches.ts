/**
 * Pobočky servisu.
 *
 * Pobočka je místo uvnitř servisu – ne nový servis. Nese adresu, telefon
 * a e-mail na dokumenty a do portálu, zkratku do čísla zakázky, vlastní
 * sklady a slouží jako filtr v Zakázkách, Kalendáři, Skladu a Statistikách.
 * Každý servis má aspoň jednu (výchozí) pobočku, kterou zakládá databáze.
 *
 * Tenhle modul je jediné místo s typy a přístupem k tabulce `branches`;
 * stav (aktivní pobočka, seznam) drží `BranchContext`.
 */
import { supabase } from "./supabaseClient";
import type { CompanyData } from "./companyData";

export type Branch = {
  id: string;
  serviceId: string;
  name: string;
  /** Zkratka v čísle zakázky, jen A–Z (max 3). Prázdná = bez zkratky. */
  code: string;
  addressStreet: string;
  addressCity: string;
  addressZip: string;
  phone: string;
  email: string;
  openingHours: string;
  defaultWarehouseId: string | null;
  isDefault: boolean;
  orderIndex: number;
};

export type BranchInput = Omit<Branch, "id" | "serviceId" | "orderIndex"> & { id?: string; orderIndex?: number };

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function mapBranchRow(r: Record<string, unknown>): Branch {
  return {
    id: String(r.id),
    serviceId: String(r.service_id),
    name: str(r.name),
    code: str(r.code),
    addressStreet: str(r.address_street),
    addressCity: str(r.address_city),
    addressZip: str(r.address_zip),
    phone: str(r.phone),
    email: str(r.email),
    openingHours: str(r.opening_hours),
    defaultWarehouseId: typeof r.default_warehouse_id === "string" ? r.default_warehouse_id : null,
    isDefault: r.is_default === true,
    orderIndex: typeof r.order_index === "number" ? r.order_index : 0,
  };
}

/** Zkratka pobočky do čísla zakázky: velká písmena bez diakritiky, max 3. */
export function normalizeBranchCode(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 3);
}

export async function loadBranches(serviceId: string): Promise<{ branches: Branch[]; unavailable?: boolean; error?: string }> {
  if (!supabase) return { branches: [] };
  const { data, error } = await (supabase.from("branches") as any)
    .select("*")
    .eq("service_id", serviceId)
    .order("is_default", { ascending: false })
    .order("order_index", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) {
    // Tabulka ještě nemusí na serveru být (starší databáze) – pak se aplikace chová jako bez poboček.
    const msg = String(error.message ?? "");
    const unavailable = /relation .*branches.* does not exist|Could not find the table|schema cache/i.test(msg) || error.code === "42P01" || error.code === "PGRST205";
    return { branches: [], unavailable, error: msg };
  }
  return { branches: ((data ?? []) as Record<string, unknown>[]).map(mapBranchRow) };
}

export async function saveBranch(serviceId: string, input: BranchInput): Promise<{ branch?: Branch; error?: string }> {
  if (!supabase) return { error: "Supabase není k dispozici" };
  const row: Record<string, unknown> = {
    service_id: serviceId,
    name: input.name.trim(),
    code: normalizeBranchCode(input.code),
    address_street: input.addressStreet.trim() || null,
    address_city: input.addressCity.trim() || null,
    address_zip: input.addressZip.trim() || null,
    phone: input.phone.trim() || null,
    email: input.email.trim() || null,
    opening_hours: input.openingHours.trim() || null,
    default_warehouse_id: input.defaultWarehouseId || null,
    is_default: input.isDefault === true,
  };
  if (typeof input.orderIndex === "number") row.order_index = input.orderIndex;
  if (input.id) row.id = input.id;
  const { data, error } = await (supabase.from("branches") as any).upsert(row, { onConflict: "id" }).select("*").single();
  if (error) return { error: humanizeBranchError(error.message ?? String(error)) };
  return { branch: mapBranchRow(data as Record<string, unknown>) };
}

export async function deleteBranch(id: string): Promise<{ error?: string }> {
  if (!supabase) return { error: "Supabase není k dispozici" };
  const { error } = await (supabase.from("branches") as any).delete().eq("id", id);
  return error ? { error: humanizeBranchError(error.message ?? String(error)) } : {};
}

export async function setBranchDefault(id: string): Promise<{ error?: string }> {
  if (!supabase) return { error: "Supabase není k dispozici" };
  const { error } = await (supabase.from("branches") as any).update({ is_default: true }).eq("id", id);
  return error ? { error: humanizeBranchError(error.message ?? String(error)) } : {};
}

/** Přesun zakázky na jinou pobočku. */
export async function setTicketBranch(ticketId: string, branchId: string): Promise<{ error?: string }> {
  if (!supabase) return { error: "Supabase není k dispozici" };
  const { error } = await (supabase.from("tickets") as any).update({ branch_id: branchId }).eq("id", ticketId);
  return error ? { error: error.message } : {};
}

/** Domovská pobočka člena (sám sobě, nebo owner/admin komukoli). */
export async function setMemberHomeBranch(serviceId: string, userId: string, branchId: string | null): Promise<{ error?: string }> {
  if (!supabase) return { error: "Supabase není k dispozici" };
  const { error } = await (supabase as any).rpc("set_member_home_branch", {
    p_service_id: serviceId,
    p_user_id: userId,
    p_branch_id: branchId,
  });
  return error ? { error: error.message } : {};
}

export async function loadMyHomeBranch(serviceId: string, userId: string): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await (supabase.from("service_memberships") as any)
    .select("home_branch_id")
    .eq("service_id", serviceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return typeof data.home_branch_id === "string" ? data.home_branch_id : null;
}

export function subscribeBranches(serviceId: string, onChange: () => void): () => void {
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`branches:${serviceId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "branches", filter: `service_id=eq.${serviceId}` }, () => onChange())
    .subscribe();
  return () => {
    try { supabase?.removeChannel(channel); } catch { /* ignore */ }
  };
}

function humanizeBranchError(msg: string): string {
  if (/uq_branches_code/.test(msg)) return "Tuhle zkratku už má jiná pobočka.";
  if (/branches_code_check/.test(msg)) return "Zkratka smí mít jen velká písmena A–Z, nejvýš tři.";
  if (/Výchozí pobočku nelze smazat/.test(msg)) return "Výchozí pobočku nelze smazat. Nejdřív nastavte jako výchozí jinou pobočku.";
  if (/row-level security/i.test(msg)) return "Pobočky může měnit jen majitel nebo správce servisu.";
  return msg;
}

/**
 * Firemní údaje pro dokument dané pobočky: adresa, telefon, e-mail
 * pobočky mají přednost, zbytek (název, IČO, DIČ, banka) zůstává firemní.
 * Výchozí pobočka bez vyplněné adresy se chová jako dřív.
 */
export function companyDataForBranch<T extends CompanyData | Record<string, unknown>>(cd: T, branch: Branch | null | undefined): T {
  if (!branch) return cd;
  const out: Record<string, unknown> = { ...(cd as Record<string, unknown>) };
  const hasAddress = branch.addressStreet.trim() || branch.addressCity.trim() || branch.addressZip.trim();
  if (hasAddress) {
    out.addressStreet = branch.addressStreet;
    out.addressCity = branch.addressCity;
    out.addressZip = branch.addressZip;
  }
  if (branch.phone.trim()) out.phone = branch.phone;
  if (branch.email.trim()) out.email = branch.email;
  return out as T;
}

// ---------------------------------------------------------------------------
// Synchronní cache pro místa, která pobočky potřebují mimo React (tisk
// dokumentů v Orders.tsx pracuje se synchronním safeLoadCompanyData).
// Plní ji BranchContext při každém načtení.

let cachedByService = new Map<string, Branch[]>();

export function setCachedBranches(serviceId: string, branches: Branch[]): void {
  cachedByService = new Map(cachedByService);
  cachedByService.set(serviceId, branches);
}

export function getCachedBranch(serviceId: string | null | undefined, branchId: string | null | undefined): Branch | null {
  if (!serviceId || !branchId) return null;
  return cachedByService.get(serviceId)?.find((b) => b.id === branchId) ?? null;
}

export function getCachedBranches(serviceId: string | null | undefined): Branch[] {
  if (!serviceId) return [];
  return cachedByService.get(serviceId) ?? [];
}
