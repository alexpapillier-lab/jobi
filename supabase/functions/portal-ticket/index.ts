/**
 * Edge Function: portal-ticket
 * Zákaznický portál – veřejná stránka web/z/?t=<token> ji volá bez přihlášení.
 * Token je jediné oprávnění: tickets.portal_token (zakládá RPC ensure_portal_token z Jobi).
 *
 * GET  ?t=<token>                          → stav zakázky pro zákazníka
 * POST { t, action, note?, signature? }    → approve | reject | sign | pickup
 *
 * Nasazuje se s --no-verify-jwt. Vrací jen to, co zákazník smí vidět –
 * žádný telefon, e-mail, kód zařízení, IMEI, interní poznámky ani nákupní ceny.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { klientskaIp, otiskKlienta } from "../_shared/limity.ts";
import {
  odkazVyprsel,
  otiskAkce,
  sestavPayload,
  TICKET_COLUMNS,
  TICKET_COLUMNS_ZAKLAD,
  type PobockaRow,
  type StavRow,
  type TicketRow,
} from "../_shared/portalPayload.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const BUCKET = "diagnostic-photos";
const MAX_SIGNATURE_BYTES = 300 * 1024;
const OPENED_EVENT_INTERVAL_MS = 30 * 60 * 1000;
const RATE_LIMIT_PER_MIN = 60;

// ---------------------------------------------------------------------------
// Odpovědi

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

const neplatnyOdkaz = () => json({ error: "Odkaz není platný." }, 404);

// ---------------------------------------------------------------------------
// Limity.
//
// Per token to hlídá paměť instance – rychlé, ale instance ji nesdílejí a
// hlavně to nechrání před hádáním tokenů: každý pokus má jiný token, takže
// se limit na token nikdy nespustí. Proto je k tomu ještě trvalý limit na
// otisk volajícího, který se počítá v databázi a platí napříč instancemi.

const LIMIT_NA_KLIENTA_CTENI = 120;
const LIMIT_NA_KLIENTA_AKCE = 30;

const limity = new Map<string, { od: number; pocet: number }>();

function prekrocenLimit(token: string): boolean {
  const now = Date.now();
  const z = limity.get(token);
  if (!z || now - z.od > 60_000) {
    limity.set(token, { od: now, pocet: 1 });
    // úklid, ať mapa neroste donekonečna
    if (limity.size > 5000) {
      for (const [k, v] of limity) if (now - v.od > 60_000) limity.delete(k);
    }
    return false;
  }
  z.pocet += 1;
  return z.pocet > RATE_LIMIT_PER_MIN;
}

/** Trvalý limit na volajícího. IP se neukládá, jen otisk solený dnem. */
async function prekrocenLimitKlienta(
  svc: ReturnType<typeof createClient>,
  req: Request,
  strop: number,
): Promise<boolean> {
  try {
    const klic = await otiskKlienta(req);
    const { data, error } = await svc.rpc("zapocitej_udalost", { p_kanal: "portal-ticket", p_klic: klic });
    if (error) console.error("[portal-ticket] počítadlo limitu selhalo:", error.message);
    return typeof data === "number" && data > strop;
  } catch {
    // Když počítadlo selže, portál se kvůli tomu nezavře – zákazník by přišel
    // o jedinou cestu, jak se k zakázce dostat.
    return false;
  }
}

// ---------------------------------------------------------------------------
// Načtení zakázky podle tokenu

/**
 * Zakázka podle tokenu. Vrací null pro neznámý token, zakázku v koši
 * i pro odkaz, kterému vypršela platnost – volající pak odpoví stejným
 * „Odkaz není platný.“, aby se přes portál nedalo zjišťovat, co existuje.
 */
async function loadTicket(svc: SupabaseClient, token: string): Promise<TicketRow | null> {
  let { data, error } = await svc
    .from("tickets")
    .select(TICKET_COLUMNS)
    .eq("portal_token", token)
    .is("deleted_at", null)
    .maybeSingle();
  if (error && /portal_token_expires_at/.test(error.message ?? "")) {
    // Migrace s platností odkazu ještě není nasazená. Bez tohohle ústupu by
    // funkce nasazená dřív než migrace přestala vydávat cokoli a zákazník
    // by neměl jinou cestu ke své zakázce.
    ({ data, error } = await svc
      .from("tickets")
      .select(TICKET_COLUMNS_ZAKLAD)
      .eq("portal_token", token)
      .is("deleted_at", null)
      .maybeSingle());
  }
  if (error) {
    console.error("[portal-ticket] ticket lookup error:", error);
    return null;
  }
  const t = (data as TicketRow | null) ?? null;
  if (!t || odkazVyprsel(t)) return null;
  // Servis vypnutý majitelem aplikace nesmí přes portál vydávat data.
  // Edge funkce běží pod service_role, takže databázová hradba na ni neplatí
  // a kontrola musí být tady. Odpověď je stejná jako u neznámého tokenu –
  // navenek se nesmí poznat, který servis je vypnutý.
  const { data: servis } = await svc.from("services").select("active").eq("id", t.service_id).maybeSingle();
  if (servis && (servis as { active?: boolean }).active === false) return null;
  return t;
}

// ---------------------------------------------------------------------------
// Sestavení odpovědi pro zákazníka
//
// Co se do odpovědi smí dostat, rozhoduje `_shared/portalPayload.ts`; tady
// se jen dotahují řádky z databáze. Díky tomu hlídá obsah odpovědi vitest
// nad stejným kódem (src/lib/portalPayload.test.ts).

const POBOCKA_SLOUPCE =
  "name, phone, email, address_street, address_city, address_zip, opening_hours, is_default, company_name, ico, bank_account, iban";

async function buildPayload(svc: SupabaseClient, t: TicketRow) {
  const [statusRes, settingsRes, serviceRes, branchRes] = await Promise.all([
    svc
      .from("service_statuses")
      .select("key, label, bg, fg, is_final")
      .eq("service_id", t.service_id)
      .eq("key", t.status)
      .maybeSingle(),
    svc.from("service_settings").select("config").eq("service_id", t.service_id).maybeSingle(),
    svc.from("services").select("name").eq("id", t.service_id).maybeSingle(),
    // Pobočka zakázky: její adresa, telefon a e-mail mají v portálu přednost před firemními.
    t.branch_id
      ? svc.from("branches").select(POBOCKA_SLOUPCE).eq("id", t.branch_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  return sestavPayload({
    ticket: t,
    stav: (statusRes.data ?? null) as StavRow,
    config: (settingsRes.data?.config ?? {}) as Record<string, unknown>,
    nazevServisu: (serviceRes.data?.name ?? null) as string | null,
    pobocka: (branchRes?.data ?? null) as PobockaRow,
  });
}

// ---------------------------------------------------------------------------
// Události

async function insertEvent(svc: SupabaseClient, t: TicketRow, type: string, meta: Record<string, unknown> | null) {
  const { error } = await svc.from("ticket_portal_events").insert({
    ticket_id: t.id,
    service_id: t.service_id,
    type,
    meta,
  });
  if (error) console.error(`[portal-ticket] event ${type} insert error:`, error);
}

/** Otevření: portal_last_opened_at vždy, událost 'opened' nejvýš jednou za 30 minut. */
async function recordOpened(svc: SupabaseClient, t: TicketRow) {
  const nowIso = new Date().toISOString();
  const { error: updErr } = await svc.from("tickets").update({ portal_last_opened_at: nowIso }).eq("id", t.id);
  if (updErr) console.error("[portal-ticket] portal_last_opened_at update error:", updErr);

  const { data: last } = await svc
    .from("ticket_portal_events")
    .select("created_at")
    .eq("ticket_id", t.id)
    .eq("type", "opened")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const lastMs = last?.created_at ? new Date(last.created_at as string).getTime() : 0;
  if (Date.now() - lastMs >= OPENED_EVENT_INTERVAL_MS) {
    await insertEvent(svc, t, "opened", null);
  }
}

// ---------------------------------------------------------------------------
// Podpis: PNG data URL → Storage

function decodePngDataUrl(signature: unknown): Uint8Array | null {
  if (typeof signature !== "string") return null;
  const m = signature.match(/^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/);
  if (!m) return null;
  const b64 = m[1].replace(/\s/g, "");
  // base64 je ~4/3 velikosti – hrubá pojistka před dekódováním
  if (b64.length > MAX_SIGNATURE_BYTES * 1.4) return null;
  try {
    const binary = atob(b64);
    if (binary.length > MAX_SIGNATURE_BYTES) return null;
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    // PNG signatura
    if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) {
      return null;
    }
    return bytes;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Handler

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const svc = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // ----- GET -------------------------------------------------------------
    if (req.method === "GET") {
      const url = new URL(req.url);
      const token = (url.searchParams.get("t") ?? "").trim();
      if (!token || token.length > 64) return neplatnyOdkaz();
      if (prekrocenLimit(token)) return json({ error: "Příliš mnoho požadavků, zkuste to za chvíli." }, 429);
      if (await prekrocenLimitKlienta(svc, req, LIMIT_NA_KLIENTA_CTENI)) {
        return json({ error: "Příliš mnoho požadavků, zkuste to za chvíli." }, 429);
      }

      const ticket = await loadTicket(svc, token);
      if (!ticket) return neplatnyOdkaz();

      await recordOpened(svc, ticket);
      return json(await buildPayload(svc, ticket));
    }

    // ----- POST ------------------------------------------------------------
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return json({ error: "Neplatný požadavek." }, 400);
    }

    const token = typeof body?.t === "string" ? body.t.trim() : "";
    if (!token || token.length > 64) return neplatnyOdkaz();
    if (prekrocenLimit(token)) return json({ error: "Příliš mnoho požadavků, zkuste to za chvíli." }, 429);
    if (await prekrocenLimitKlienta(svc, req, LIMIT_NA_KLIENTA_AKCE)) {
      return json({ error: "Příliš mnoho požadavků, zkuste to za chvíli." }, 429);
    }

    const action = typeof body?.action === "string" ? body.action : "";
    if (!["approve", "reject", "sign", "pickup"].includes(action)) {
      return json({ error: "Neznámá akce." }, 400);
    }

    const ticket = await loadTicket(svc, token);
    if (!ticket) return neplatnyOdkaz();

    const note = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : null;
    const meta = {
      ip: clientIp(req),
      userAgent: req.headers.get("user-agent"),
      note: note || null,
    };

    if (action === "approve" || action === "reject") {
      if (ticket.quote_status !== "sent") {
        return json({ error: "Nabídka už není k rozhodnutí." }, 409);
      }
      const nextStatus = action === "approve" ? "approved" : "rejected";
      // `.select("id")` je tu podstatné: podmíněný UPDATE, který nechytil
      // žádný řádek, vrací error === null. Bez kontroly počtu řádků by portál
      // zákazníkovi odpověděl „ok“, přestože se nic neuložilo – a zapsal by
      // událost o rozhodnutí, které v zakázce není. Při dvojím odeslání
      // (přeposlaný odkaz, dvojklik) by tak vznikly quote_approved
      // i quote_rejected zároveň.
      const { data: updated, error: updErr } = await svc
        .from("tickets")
        .update({
          quote_status: nextStatus,
          quote_decided_at: new Date().toISOString(),
          quote_decision_meta: meta,
        })
        .eq("id", ticket.id)
        .eq("quote_status", "sent") // ochrana před dvojklikem / souběhem
        .select("id");
      if (updErr) {
        console.error("[portal-ticket] quote update error:", updErr);
        return json({ error: "Nepodařilo se uložit rozhodnutí." }, 500);
      }
      if (!updated || updated.length === 0) {
        // Mezitím rozhodl někdo jiný (nebo druhé odeslání téhož kliknutí).
        return json({ error: "Nabídka už není k rozhodnutí." }, 409);
      }
      await insertEvent(svc, ticket, action === "approve" ? "quote_approved" : "quote_rejected", meta);
    } else if (action === "sign") {
      if (ticket.intake_signed_at) {
        return json({ error: "Převzetí už bylo podepsáno." }, 409);
      }
      const bytes = decodePngDataUrl(body.signature);
      if (!bytes) {
        return json({ error: "Podpis musí být PNG do 300 kB." }, 400);
      }

      // Nejdřív rezervace, teprve pak nahrávání. Kdyby se nahrávalo první,
      // souběžný druhý pokus by nechal v úložišti soubor, na který se
      // v zakázce nikdo neodkáže – podpis zákazníka ležící bez vazby.
      const signedAt = new Date().toISOString();
      const { data: reserved, error: resErr } = await svc
        .from("tickets")
        .update({ intake_signed_at: signedAt })
        .eq("id", ticket.id)
        .is("intake_signed_at", null)
        .select("id");
      if (resErr) {
        console.error("[portal-ticket] signature reserve error:", resErr);
        return json({ error: "Nepodařilo se uložit podpis." }, 500);
      }
      if (!reserved || reserved.length === 0) {
        return json({ error: "Převzetí už bylo podepsáno." }, 409);
      }

      // Rezervaci uvolníme jen tehdy, když je pořád naše – jinak bychom
      // smazali podpis, který mezitím uložil někdo jiný.
      const uvolniRezervaci = async () => {
        const { error } = await svc
          .from("tickets")
          .update({ intake_signed_at: null })
          .eq("id", ticket.id)
          .eq("intake_signed_at", signedAt);
        if (error) console.error("[portal-ticket] signature reserve rollback error:", error);
      };

      const path = `signatures/${ticket.id}-${Date.now()}.png`;
      const { error: uploadErr } = await svc.storage
        .from(BUCKET)
        // Podpis se už nemění, ať se netahá při každém otevření portálu znovu.
        .upload(path, bytes, { contentType: "image/png", cacheControl: "31536000", upsert: false });
      if (uploadErr) {
        console.error("[portal-ticket] signature upload error:", uploadErr);
        await uvolniRezervaci();
        return json({ error: "Nepodařilo se uložit podpis." }, 500);
      }
      const { data: urlData } = svc.storage.from(BUCKET).getPublicUrl(path);
      const { data: linked, error: updErr } = await svc
        .from("tickets")
        .update({ intake_signature_url: urlData.publicUrl })
        .eq("id", ticket.id)
        .eq("intake_signed_at", signedAt)
        .select("id");
      if (updErr || !linked || linked.length === 0) {
        if (updErr) console.error("[portal-ticket] signature update error:", updErr);
        // Nahraný soubor by jinak zůstal v úložišti osiřelý.
        const { error: rmErr } = await svc.storage.from(BUCKET).remove([path]);
        if (rmErr) console.error("[portal-ticket] signature cleanup error:", rmErr);
        await uvolniRezervaci();
        return json({ error: "Nepodařilo se uložit podpis." }, 500);
      }
      await insertEvent(svc, ticket, "signed", { ...meta, url: urlData.publicUrl });
    } else if (action === "pickup") {
      // Bez pojistky by opakované odeslání založilo druhé potvrzení převzetí
      // a servis by v historii viděl dvě různá vyzvednutí téhož zařízení.
      const { data: jizPotvrzeno, error: pickupErr } = await svc
        .from("ticket_portal_events")
        .select("id")
        .eq("ticket_id", ticket.id)
        .eq("type", "pickup_confirmed")
        .limit(1);
      if (pickupErr) {
        console.error("[portal-ticket] pickup lookup error:", pickupErr);
        return json({ error: "Nepodařilo se uložit potvrzení." }, 500);
      }
      if (jizPotvrzeno && jizPotvrzeno.length > 0) {
        return json({ error: "Převzetí už bylo potvrzeno." }, 409);
      }
      await insertEvent(svc, ticket, "pickup_confirmed", meta);
    }

    const fresh = (await loadTicket(svc, token)) ?? ticket;
    return json(await buildPayload(svc, fresh));
  } catch (error) {
    console.error("[portal-ticket] error:", error);
    return json({ error: (error as Error)?.message || "Nastala chyba." }, 500);
  }
});
