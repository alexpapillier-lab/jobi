/**
 * Přeprava DPD ze Zásilek (přesuny zakázek mezi pobočkami).
 *
 * Akce (přihlášený člen servisu, token v Authorization):
 *   { action: "create", shipmentId, mode: "label"|"courier", parcels, pickupDate?: "asap"|"YYYY-MM-DD" }
 *   { action: "label",  shipmentId }   → PDF štítek (base64)
 *   { action: "track",  shipmentId }   → stav z DPD trackingu
 *   { action: "cancel", shipmentId }   → zruší svoz u DPD (kurýr) a objednávku
 * Z cronu (preprava_dpd_tick, tajemství z Vaultu):
 *   { secret, action: "track_all" }    → projde rozjeté balíky
 *
 * Kdo smí: zasilka_dpd_smi (člen servisu, servis smí pracovat, pobočka
 * odeslání nebo cíle). Přeprava musí mít servis zapnutou v preprava_dpd
 * (zapíná majitel aplikace v Owner) a klíč DPD ve Vaultu.
 *
 * Postup a pasti DPD převzaté z ověřeného zákaznického toku servis.iswap
 * (audit docs/dpd-preprava-audit.md tamtéž, 23. 10. 2026) – viz _shared/dpd.ts.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  adresaPobocky,
  cislaBaliku,
  coChybiPobocce,
  dnySvozu,
  DPD_URL,
  idSvozu,
  jdeTisknoutStitek,
  predaniText,
  registrovanaAdresa,
  stavZTrackingu,
  teloStitku,
  variantyZasilky,
  teloZasilky,
  vyberAdresuPlatce,
  type AdresaDpd,
  type RezimDpd,
  type VariantaDpd,
} from "../_shared/dpd.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type Svc = SupabaseClient<any, any, any>;
type Dpd = { base: string; key: string; dsw: string; testovaci: boolean };

class Chyba extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const SLOUPCE = "id, service_id, shipment_id, mode, varianta, parcels, testovaci, dpd_shipment_id, parcel_numbers, pickup_order_id, pickup_date, status, status_text, delivered_at, tracking_at, created_at, cancelled_at";

function dpdFetch(dpd: Dpd, path: string, opts: { method?: string; body?: unknown } = {}): Promise<Response> {
  return fetch(`${dpd.base}${path}`, {
    method: opts.method ?? "GET",
    headers: { "x-api-key": dpd.key, "Content-Type": "application/json", Accept: "application/json" },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

/** Chyba DPD lidsky: JSON { code, message }, jinak text. */
async function textChybyDpd(res: Response): Promise<string> {
  const t = await res.text().catch(() => "");
  try {
    const j = JSON.parse(t);
    const m = j?.message || j?.detail || j?.title;
    if (m) return `${j?.code ? `${j.code}: ` : ""}${m}`.slice(0, 400);
  } catch { /* text */ }
  return (t || `HTTP ${res.status}`).slice(0, 400);
}

function base64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function overitTajemstvi(svc: Svc, secret: string): Promise<boolean> {
  const { data } = await svc.rpc("preprava_dpd_cron_secret");
  const ocekavane = typeof data === "string" ? data : "";
  if (!ocekavane || secret.length !== ocekavane.length) return false;
  let rozdil = 0;
  for (let i = 0; i < secret.length; i++) rozdil |= secret.charCodeAt(i) ^ ocekavane.charCodeAt(i);
  return rozdil === 0;
}

async function ucetDpd(svc: Svc, serviceId: string): Promise<Dpd> {
  const { data: n } = await svc.from("preprava_dpd").select("zapnuto, dsw, testovaci").eq("service_id", serviceId).maybeSingle();
  if (!n?.zapnuto) throw new Chyba("Přeprava DPD není pro tento servis zapnutá.", 403);
  if (!n.dsw) throw new Chyba("V nastavení přepravy chybí číslo zákazníka DPD (DSW).", 400);
  const { data: klic } = await svc.rpc("preprava_dpd_klic", { p_service_id: serviceId });
  if (typeof klic !== "string" || !klic) throw new Chyba("V nastavení přepravy chybí klíč DPD.", 400);
  return { base: n.testovaci ? DPD_URL.test : DPD_URL.ostre, key: klic, dsw: String(n.dsw), testovaci: !!n.testovaci };
}

async function zivaObjednavka(svc: Svc, shipmentId: string) {
  const { data } = await svc.from("ticket_shipment_dpd").select(SLOUPCE).eq("shipment_id", shipmentId).neq("status", "cancelled").maybeSingle();
  return data as Record<string, any> | null;
}

// ── create ──────────────────────────────────────────────────────────────────
async function vytvorit(svc: Svc, uid: string, body: Record<string, unknown>) {
  const shipmentId = String(body.shipmentId ?? "");
  const { data: z } = await svc.from("ticket_shipments").select("id, service_id, cislo, status, note, from_branch_id, to_branch_id").eq("id", shipmentId).maybeSingle();
  if (!z) throw new Chyba("Zásilka nenalezena.", 404);
  if (z.status !== "draft" && z.status !== "sent") throw new Chyba("Přepravu jde objednat jen ke konceptu nebo k odeslané zásilce.");
  if (await zivaObjednavka(svc, z.id)) throw new Chyba("Zásilka už má objednanou přepravu DPD.", 409);

  const rezim: RezimDpd = body.mode === "courier" ? "courier" : "label";
  const balicku = Math.min(Math.max(Number.parseInt(String(body.parcels ?? "1"), 10) || 1, 1), 10);
  let den = rezim === "courier" ? String(body.pickupDate || "asap") : null;
  if (den && den !== "asap" && !/^\d{4}-\d{2}-\d{2}$/.test(den)) throw new Chyba("Vyberte den svozu.");

  const dpd = await ucetDpd(svc, z.service_id);
  const [{ data: pobocky }, { data: servis }] = await Promise.all([
    svc.from("branches").select("id, name, company_name, address_street, address_city, address_zip, phone, email, is_default").eq("service_id", z.service_id),
    svc.from("services").select("name").eq("id", z.service_id).maybeSingle(),
  ]);
  const pob = (id: string) => (pobocky ?? []).find((b: any) => b.id === id);
  const z1 = pob(z.from_branch_id), z2 = pob(z.to_branch_id);
  if (!z1 || !z2) throw new Chyba("Pobočka zásilky nenalezena.", 404);
  const nazev = String(servis?.name ?? "");
  const odesilatel = adresaPobocky(z1, nazev);
  const prijemce = adresaPobocky(z2, nazev);
  for (const [b, a] of [[z1, odesilatel], [z2, prijemce]] as const) {
    if (!a) throw new Chyba(`Pobočce ${b.name} chybí ${coChybiPobocce(b).join(", ")} (Nastavení → Firma → Pobočky).`);
  }
  const hlavni = (pobocky ?? []).find((b: any) => b.is_default) ?? z1;
  const zalohaPlatce = adresaPobocky(hlavni, nazev) ?? (odesilatel as AdresaDpd);
  const adresy = await dpdFetch(dpd, `/customers/${encodeURIComponent(dpd.dsw)}/addresses`);
  const seznamAdres = adresy.ok ? await adresy.json().catch(() => []) : [];
  const adresaPlatce = vyberAdresuPlatce(seznamAdres, hlavni.address_zip ?? undefined, zalohaPlatce);
  // Pobočka odeslání jako registrovaná adresa účtu → běžná zásilka Standard.
  const registrovana = registrovanaAdresa(seznamAdres, z1.address_zip);

  const reference = `Z-${String(z.cislo).padStart(4, "0")}`;
  const poznamka = typeof body.note === "string" ? body.note : (z.note ?? "");
  let varianta: VariantaDpd | null = null;
  let sData: unknown = null;
  const chybyZasilky: string[] = [];
  for (const v of variantyZasilky(rezim, !!registrovana)) {
    const sRes = await dpdFetch(dpd, "/shipments", {
      method: "POST",
      body: teloZasilky({ dsw: dpd.dsw, varianta: v, balicku, reference, poznamka, odesilatel: odesilatel!, prijemce: prijemce!, registrovana, adresaPlatce }),
    });
    if (sRes.ok) { sData = await sRes.json().catch(() => null); varianta = v; break; }
    chybyZasilky.push(`${v}: ${await textChybyDpd(sRes)}`);
  }
  if (!varianta) throw new Chyba(`DPD zásilku nepřijalo – ${chybyZasilky.join(" | ")}`.slice(0, 900), 502);
  const { shipmentId: dpdShipmentId, parcelNumbers } = cislaBaliku(sData);
  if (parcelNumbers.length === 0) throw new Chyba("DPD nevrátilo číslo balíku – zkontrolujte MojeDPD, než to zkusíte znovu.", 502);

  // U svozu z cizí adresy (Collection) štítek přiveze kurýr – DPD tisk
  // odmítá (ShipmentLabelsDisallowed, ověřeno 23. 10. 2026).
  let label: string | null = null;
  if (jdeTisknoutStitek(varianta)) {
    const lRes = await dpdFetch(dpd, "/parcels/labels", {
      method: "POST",
      body: teloStitku(parcelNumbers),
    });
    if (lRes.ok) label = base64(await lRes.arrayBuffer());
  }

  let pickupOrderId: string | null = null;
  let chybaSvozu: string | null = null;
  if (rezim === "courier") {
    const dny = den === "asap" ? dnySvozu() : [den!];
    const chyby: string[] = [];
    for (const d of dny) {
      // Standard: svoz na registrovanou adresu (kurýr vezme všechny balíky se štítkem);
      // Collection: svoz konkrétního balíku z adresy pobočky.
      const kde = varianta === "standard" && registrovana ? { customerAddress: registrovana } : { parcel: { parcelNumber: parcelNumbers[0] } };
      const res = await dpdFetch(dpd, "/pickup-orders", { method: "POST", body: [{ ...kde, date: d, ...(poznamka ? { note: poznamka.slice(0, 35) } : {}) }] });
      if (!res.ok) { chyby.push(`${d}: ${await textChybyDpd(res)}`); continue; }
      const id = idSvozu(await res.json().catch(() => null), res.headers.get("Location"));
      if (!id) { chybaSvozu = `Svoz na ${d} odeslán, ale DPD nevrátilo jeho číslo – ověřte v MojeDPD.`; den = d; break; }
      pickupOrderId = id;
      den = d;
      break;
    }
    if (!pickupOrderId && !chybaSvozu) chybaSvozu = `Svoz se objednat nepodařilo: ${chyby.join(" | ")}`.slice(0, 600);
  }

  // Zásilka u DPD vznikla – uložit vždycky, i když svoz nebo štítek nevyšel.
  const radek = {
    service_id: z.service_id,
    shipment_id: z.id,
    mode: rezim,
    parcels: balicku,
    testovaci: dpd.testovaci,
    dpd_shipment_id: dpdShipmentId || null,
    parcel_numbers: parcelNumbers,
    pickup_order_id: pickupOrderId,
    pickup_date: rezim === "courier" && pickupOrderId ? den : null,
    status: pickupOrderId ? "pickup_ordered" : "created",
    varianta,
    status_text: chybaSvozu ?? predaniText(varianta, rezim),
    label_pdf: label,
    created_by: uid,
  };
  const { data: ulozeno, error } = await svc.from("ticket_shipment_dpd").insert(radek).select(SLOUPCE).single();
  if (error) throw new Chyba(`Zásilka u DPD vznikla (balík ${parcelNumbers.join(", ")}), ale nepodařilo se ji uložit: ${error.message}`, 500);
  await svc.from("ticket_shipments").update({ carrier: "DPD", tracking_number: parcelNumbers.join(", ") }).eq("id", z.id);
  return json({ ok: true, objednavka: ulozeno, labelBase64: label, varovani: chybaSvozu ?? (label || !jdeTisknoutStitek(varianta) ? null : "Štítek se nepodařilo stáhnout – zkuste Tisk štítku.") });
}

// ── label ───────────────────────────────────────────────────────────────────
async function stitek(svc: Svc, shipmentId: string) {
  const { data } = await svc.from("ticket_shipment_dpd").select("id, service_id, mode, varianta, parcel_numbers, label_pdf").eq("shipment_id", shipmentId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) throw new Chyba("K zásilce není objednaná přeprava.", 404);
  if (!jdeTisknoutStitek(data.varianta ?? (data.mode === "courier" ? "collection" : "return"))) throw new Chyba("U svozu z adresy pobočky se štítek netiskne – přiveze ho kurýr.");
  if (data.label_pdf) return json({ ok: true, labelBase64: data.label_pdf });
  const dpd = await ucetDpd(svc, data.service_id);
  const res = await dpdFetch(dpd, "/parcels/labels", {
    method: "POST",
    body: teloStitku(data.parcel_numbers ?? []),
  });
  if (!res.ok) throw new Chyba(`Štítek se nepodařilo stáhnout – ${await textChybyDpd(res)}`, 502);
  const label = base64(await res.arrayBuffer());
  await svc.from("ticket_shipment_dpd").update({ label_pdf: label }).eq("id", data.id);
  return json({ ok: true, labelBase64: label });
}

// ── track ───────────────────────────────────────────────────────────────────
async function sledovat(svc: Svc, o: Record<string, any>, dpd?: Dpd): Promise<Record<string, any>> {
  const ucet = dpd ?? (await ucetDpd(svc, o.service_id));
  const balik = o.parcel_numbers?.[0];
  if (!balik) return o;
  const res = await dpdFetch(ucet, `/parcels/${encodeURIComponent(balik)}/tracking`);
  const patch: Record<string, unknown> = { tracking_at: new Date().toISOString() };
  if (res.ok) {
    const s = stavZTrackingu(await res.json().catch(() => null));
    if (s.text) patch.status_text = s.text;
    if (s.status === "delivered") { patch.status = "delivered"; patch.delivered_at = s.at || new Date().toISOString(); }
    else if (s.status === "in_transit") patch.status = "in_transit";
  } else if (res.status !== 404) {
    // 404 = ParcelTrackingEventsNotFound: balík ještě nemá události, není to chyba.
    throw new Chyba(`DPD sledování – ${await textChybyDpd(res)}`, 502);
  }
  const { data } = await svc.from("ticket_shipment_dpd").update(patch).eq("id", o.id).select(SLOUPCE).single();
  return data ?? o;
}

async function sledovatVse(svc: Svc) {
  const { data } = await svc.from("ticket_shipment_dpd").select(SLOUPCE).in("status", ["created", "pickup_ordered", "in_transit"]).limit(200);
  const ucty = new Map<string, Dpd | null>();
  let hotovo = 0, doruceno = 0;
  const chyby: string[] = [];
  for (const o of data ?? []) {
    // Štítek bez pohybu víc než 30 dní už se sledovat nemusí (nepodaný).
    if (o.status === "created" && Date.now() - new Date(o.created_at).getTime() > 30 * 86_400_000) continue;
    try {
      if (!ucty.has(o.service_id)) ucty.set(o.service_id, await ucetDpd(svc, o.service_id).catch(() => null));
      const ucet = ucty.get(o.service_id);
      if (!ucet) continue;
      const nove = await sledovat(svc, o, ucet);
      hotovo++;
      if (nove.status === "delivered" && o.status !== "delivered") doruceno++;
    } catch (e) {
      chyby.push(`${o.id}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200));
    }
  }
  return json({ ok: true, sledovano: hotovo, doruceno, chyby });
}

// ── cancel ──────────────────────────────────────────────────────────────────
async function zrusit(svc: Svc, uid: string, shipmentId: string) {
  const o = await zivaObjednavka(svc, shipmentId);
  if (!o) throw new Chyba("K zásilce není objednaná přeprava.", 404);
  if (o.status === "delivered") throw new Chyba("Balík je už doručený – přepravu nejde zrušit.");
  if (o.status === "in_transit") throw new Chyba("Balík už je na cestě – zrušení řešte s DPD.");
  if (o.pickup_order_id) {
    const dpd = await ucetDpd(svc, o.service_id);
    const res = await dpdFetch(dpd, `/pickup-orders/${encodeURIComponent(o.pickup_order_id)}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw new Chyba(`Svoz se u DPD zrušit nepodařilo – ${await textChybyDpd(res)}`, 502);
  }
  const { data } = await svc.from("ticket_shipment_dpd")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancelled_by: uid })
    .eq("id", o.id).select(SLOUPCE).single();
  await svc.from("ticket_shipments").update({ tracking_number: null }).eq("id", shipmentId);
  return json({ ok: true, objednavka: data });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const svc: Svc = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    if (typeof body.secret === "string" && body.secret) {
      if (!(await overitTajemstvi(svc, body.secret))) return json({ error: "Unauthorized" }, 401);
      if (body.action === "track_all") return await sledovatVse(svc);
      return json({ error: "Neznámá akce" }, 400);
    }

    const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const shipmentId = String(body.shipmentId ?? "");
    if (!shipmentId) return json({ error: "Chybí zásilka." }, 400);
    const { data: smi, error: chybaSmi } = await userClient.rpc("zasilka_dpd_smi", { p_shipment_id: shipmentId });
    if (chybaSmi || !smi?.user_id) return json({ error: chybaSmi?.message ?? "Nemáte oprávnění." }, chybaSmi?.code === "P0002" ? 404 : 403);
    const uid = String(smi.user_id);

    switch (body.action) {
      case "create": return await vytvorit(svc, uid, body);
      case "label": return await stitek(svc, shipmentId);
      case "track": {
        const o = await zivaObjednavka(svc, shipmentId);
        if (!o) throw new Chyba("K zásilce není objednaná přeprava.", 404);
        return json({ ok: true, objednavka: await sledovat(svc, o) });
      }
      case "cancel": return await zrusit(svc, uid, shipmentId);
      default: return json({ error: "Neznámá akce" }, 400);
    }
  } catch (e) {
    if (e instanceof Chyba) return json({ error: e.message }, e.status);
    console.error("[zasilka-dpd]", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
