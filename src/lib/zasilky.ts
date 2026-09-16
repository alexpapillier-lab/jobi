/**
 * Zásilky zakázek mezi pobočkami (modul „Přesuny mezi pobočkami“).
 *
 * Servis přijímá na jedné pobočce, opravuje na druhé a vydává zase na
 * první. Místo stavů typu „Posláno do Prahy“ vede aplikace místo zakázky
 * jako druhou osu vedle stavu opravy:
 *
 *   branchId          – pobočka přijetí a výdeje (nemění se)
 *   locationBranchId  – kde zařízení fyzicky je; null = na své pobočce
 *   transitShipmentId – zásilka, ve které právě cestuje
 *
 * Zásilka je krabice s několika zakázkami: koncept → odesláno → převzato.
 * Stavové přechody dělá databáze (RPC zasilka_odeslat / zasilka_prevzit),
 * ať se zakázky z druhé pobočky přehodí i bez práva na ně zapisovat.
 * Schéma: supabase/migrations/20260916120000_zasilky_mezi_pobockami.sql.
 */
import { supabase } from "./supabaseClient";

export type StavZasilky = "draft" | "sent" | "received";

export type Zasilka = {
  id: string;
  serviceId: string;
  cislo: number;
  fromBranchId: string;
  toBranchId: string;
  status: StavZasilky;
  carrier: string;
  trackingNumber: string;
  note: string;
  createdBy: string | null;
  createdAt: string;
  sentBy: string | null;
  sentAt: string | null;
  receivedBy: string | null;
  receivedAt: string | null;
  polozky: ZasilkaPolozka[];
};

export type ZasilkaPolozka = {
  id: string;
  shipmentId: string;
  ticketId: string;
  addedAt: string;
  receivedAt: string | null;
  note: string;
};

/** Kde zakázka je – z pohledu modulu. */
export type UmisteniZakazky =
  | { druh: "doma" }
  | { druh: "jinde"; branchId: string }
  | { druh: "na_ceste"; doBranchId: string; shipmentId: string };

export function umisteniZakazky(t: { branchId?: string | null; locationBranchId?: string | null; transitShipmentId?: string | null }): UmisteniZakazky {
  if (t.transitShipmentId && t.locationBranchId) return { druh: "na_ceste", doBranchId: t.locationBranchId, shipmentId: t.transitShipmentId };
  if (t.transitShipmentId && t.branchId) return { druh: "na_ceste", doBranchId: t.branchId, shipmentId: t.transitShipmentId };
  if (t.locationBranchId && t.locationBranchId !== t.branchId) return { druh: "jinde", branchId: t.locationBranchId };
  return { druh: "doma" };
}

/** Krátký štítek do seznamu: „Praha“, „→ Praha“; doma nic. */
export function stitekUmisteni(u: UmisteniZakazky, nazevPobocky: (id: string) => string): string | null {
  if (u.druh === "doma") return null;
  if (u.druh === "na_ceste") return `→ ${nazevPobocky(u.doBranchId)}`;
  return nazevPobocky(u.branchId);
}

/** Delší popis do detailu. */
export function popisUmisteni(u: UmisteniZakazky, nazevPobocky: (id: string) => string, domaci: string): string {
  if (u.druh === "doma") return `Na své pobočce (${domaci})`;
  if (u.druh === "na_ceste") return `Na cestě do pobočky ${nazevPobocky(u.doBranchId)}`;
  return `Na pobočce ${nazevPobocky(u.branchId)}`;
}

export function stavZasilkyText(s: StavZasilky): string {
  return s === "draft" ? "Koncept" : s === "sent" ? "Na cestě" : "Převzato";
}

export function cisloZasilky(z: Pick<Zasilka, "cislo">): string {
  return `Z-${String(z.cislo).padStart(4, "0")}`;
}

/** Kolik položek zásilky chybí (odeslána, ale nepřevzatá). */
export function nepreveztePolozky(z: Zasilka): ZasilkaPolozka[] {
  return z.status === "draft" ? [] : z.polozky.filter((p) => !p.receivedAt);
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

function mapPolozka(r: Record<string, unknown>): ZasilkaPolozka {
  return {
    id: str(r.id),
    shipmentId: str(r.shipment_id),
    ticketId: str(r.ticket_id),
    addedAt: str(r.added_at),
    receivedAt: typeof r.received_at === "string" ? r.received_at : null,
    note: str(r.note),
  };
}

export function mapZasilka(r: Record<string, unknown>): Zasilka {
  const polozky = Array.isArray(r.ticket_shipment_items) ? (r.ticket_shipment_items as Record<string, unknown>[]).map(mapPolozka) : [];
  polozky.sort((a, b) => a.addedAt.localeCompare(b.addedAt));
  return {
    id: str(r.id),
    serviceId: str(r.service_id),
    cislo: typeof r.cislo === "number" ? r.cislo : Number(r.cislo) || 0,
    fromBranchId: str(r.from_branch_id),
    toBranchId: str(r.to_branch_id),
    status: r.status === "sent" || r.status === "received" ? r.status : "draft",
    carrier: str(r.carrier),
    trackingNumber: str(r.tracking_number),
    note: str(r.note),
    createdBy: typeof r.created_by === "string" ? r.created_by : null,
    createdAt: str(r.created_at),
    sentBy: typeof r.sent_by === "string" ? r.sent_by : null,
    sentAt: typeof r.sent_at === "string" ? r.sent_at : null,
    receivedBy: typeof r.received_by === "string" ? r.received_by : null,
    receivedAt: typeof r.received_at === "string" ? r.received_at : null,
    polozky,
  };
}

const SELECT = "id, service_id, cislo, from_branch_id, to_branch_id, status, carrier, tracking_number, note, created_by, created_at, sent_by, sent_at, received_by, received_at, ticket_shipment_items(id, shipment_id, ticket_id, added_at, received_at, note)";

export async function nactiZasilky(serviceId: string): Promise<Zasilka[]> {
  if (!supabase) return [];
  const { data, error } = await (supabase.from("ticket_shipments") as any)
    .select(SELECT)
    .eq("service_id", serviceId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(mapZasilka);
}

export async function nactiZasilku(id: string): Promise<Zasilka | null> {
  if (!supabase) return null;
  const { data, error } = await (supabase.from("ticket_shipments") as any).select(SELECT).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapZasilka(data as Record<string, unknown>) : null;
}

export async function vytvorZasilku(vstup: { serviceId: string; fromBranchId: string; toBranchId: string; carrier?: string; trackingNumber?: string; note?: string }): Promise<Zasilka> {
  if (!supabase) throw new Error("Supabase není k dispozici");
  const { data, error } = await (supabase.from("ticket_shipments") as any)
    .insert({
      service_id: vstup.serviceId,
      from_branch_id: vstup.fromBranchId,
      to_branch_id: vstup.toBranchId,
      carrier: vstup.carrier?.trim() || null,
      tracking_number: vstup.trackingNumber?.trim() || null,
      note: vstup.note?.trim() || null,
    })
    .select(SELECT)
    .single();
  if (error) throw new Error(error.message);
  return mapZasilka(data as Record<string, unknown>);
}

export async function ulozHlavickuZasilky(id: string, patch: { carrier?: string; trackingNumber?: string; note?: string }): Promise<void> {
  if (!supabase) throw new Error("Supabase není k dispozici");
  const row: Record<string, unknown> = {};
  if (patch.carrier !== undefined) row.carrier = patch.carrier.trim() || null;
  if (patch.trackingNumber !== undefined) row.tracking_number = patch.trackingNumber.trim() || null;
  if (patch.note !== undefined) row.note = patch.note.trim() || null;
  const { error } = await (supabase.from("ticket_shipments") as any).update(row).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function pridejDoZasilky(shipmentId: string, ticketId: string): Promise<void> {
  if (!supabase) throw new Error("Supabase není k dispozici");
  const { error } = await (supabase.from("ticket_shipment_items") as any).insert({ shipment_id: shipmentId, ticket_id: ticketId });
  if (error) {
    if (error.code === "23505") throw new Error("Zakázka už v zásilce je, nebo právě cestuje jinou.");
    throw new Error(error.message);
  }
}

export async function odeberZeZasilky(shipmentId: string, ticketId: string): Promise<void> {
  if (!supabase) throw new Error("Supabase není k dispozici");
  const { error } = await (supabase.from("ticket_shipment_items") as any).delete().eq("shipment_id", shipmentId).eq("ticket_id", ticketId);
  if (error) throw new Error(error.message);
}

export async function smazKoncept(id: string): Promise<void> {
  if (!supabase) throw new Error("Supabase není k dispozici");
  const { error } = await (supabase.from("ticket_shipments") as any).delete().eq("id", id).eq("status", "draft");
  if (error) throw new Error(error.message);
}

export async function odesliZasilku(id: string): Promise<void> {
  if (!supabase) throw new Error("Supabase není k dispozici");
  const { error } = await (supabase as any).rpc("zasilka_odeslat", { p_shipment_id: id });
  if (error) throw new Error(error.message);
}

export async function prevezmiZasilku(id: string, ticketIds: string[]): Promise<void> {
  if (!supabase) throw new Error("Supabase není k dispozici");
  const { error } = await (supabase as any).rpc("zasilka_prevzit", { p_shipment_id: id, p_ticket_ids: ticketIds });
  if (error) throw new Error(error.message);
}

/** Realtime: cokoli na zásilkách nebo položkách servisu. Vrací odhlášení. */
export function subscribeZasilky(serviceId: string, onChange: () => void): () => void {
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`ticket_shipments:${serviceId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "ticket_shipments", filter: `service_id=eq.${serviceId}` }, () => onChange())
    .on("postgres_changes", { event: "*", schema: "public", table: "ticket_shipment_items" }, () => onChange())
    .subscribe();
  return () => { void supabase!.removeChannel(channel); };
}

/**
 * Otevřený koncept z dané pobočky na druhou – ten, do kterého se přidává
 * z detailu zakázky. Nejnovější, když je jich víc.
 */
export function otevrenyKoncept(zasilky: Zasilka[], fromBranchId: string, toBranchId: string): Zasilka | null {
  return zasilky.find((z) => z.status === "draft" && z.fromBranchId === fromBranchId && z.toBranchId === toBranchId) ?? null;
}

/**
 * Kam se zakázka z místa `odkud` posílá, když má servis právě dvě pobočky:
 * na tu druhou. S více pobočkami si cíl vybírá člověk.
 */
export function druhaPobocka(branches: Array<{ id: string }>, odkud: string): string | null {
  if (branches.length !== 2) return null;
  const jina = branches.find((b) => b.id !== odkud);
  return jina?.id ?? null;
}

/** HTML předávacího protokolu do krabice – tiskne se dialogem prohlížeče. */
export function htmlProtokolu(z: Zasilka, ctx: {
  nazevPobocky: (id: string) => string;
  zakazky: Array<{ ticketId: string; code: string; device: string; customer: string; serial?: string }>;
  servis?: string;
}): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
  const datum = (iso: string | null) => (iso ? new Date(iso).toLocaleString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
  const radky = ctx.zakazky
    .map((t, i) => `<tr><td>${i + 1}</td><td><b>${esc(t.code)}</b></td><td>${esc(t.device)}${t.serial ? `<br><small>${esc(t.serial)}</small>` : ""}</td><td>${esc(t.customer)}</td><td class="box"></td></tr>`)
    .join("");
  return `<!doctype html><html lang="cs"><head><meta charset="utf-8"><title>Předávací protokol ${esc(cisloZasilky(z))}</title>
<style>
  body{font-family:-apple-system,system-ui,Segoe UI,Roboto,Arial,sans-serif;color:#111;margin:24mm 18mm;font-size:12pt}
  h1{font-size:18pt;margin:0 0 4mm} .meta{color:#444;margin-bottom:8mm;line-height:1.5}
  table{width:100%;border-collapse:collapse;font-size:11pt} th,td{border:1px solid #999;padding:6px 8px;text-align:left;vertical-align:top}
  th{background:#eee} td.box{width:14mm} small{color:#555}
  .podpisy{display:flex;gap:20mm;margin-top:16mm} .podpisy div{flex:1;border-top:1px solid #333;padding-top:3mm;font-size:10pt;color:#444}
  @media print{body{margin:0}}
</style></head><body>
<h1>Předávací protokol ${esc(cisloZasilky(z))}</h1>
<div class="meta">
  ${ctx.servis ? `<div>${esc(ctx.servis)}</div>` : ""}
  <div><b>Z pobočky:</b> ${esc(ctx.nazevPobocky(z.fromBranchId))} &nbsp;→&nbsp; <b>Na pobočku:</b> ${esc(ctx.nazevPobocky(z.toBranchId))}</div>
  <div><b>Odesláno:</b> ${esc(datum(z.sentAt) || "—")}${z.carrier ? ` &nbsp;·&nbsp; <b>Dopravce:</b> ${esc(z.carrier)}` : ""}${z.trackingNumber ? ` &nbsp;·&nbsp; <b>Sledovací číslo:</b> ${esc(z.trackingNumber)}` : ""}</div>
  ${z.note ? `<div><b>Poznámka:</b> ${esc(z.note)}</div>` : ""}
  <div><b>Počet zakázek:</b> ${ctx.zakazky.length}</div>
</div>
<table><thead><tr><th>#</th><th>Zakázka</th><th>Zařízení</th><th>Zákazník</th><th>Převzato</th></tr></thead><tbody>${radky}</tbody></table>
<div class="podpisy"><div>Odeslal (jméno, podpis)</div><div>Převzal (jméno, podpis, datum)</div></div>
</body></html>`;
}
