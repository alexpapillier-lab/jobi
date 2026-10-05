import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * PDF z dokumentu pro webovou verzi – bez tiskového dialogu.
 *
 *   POST { serviceId, html, fileName }   – z aplikace, s přihlášením
 *   → application/pdf
 *
 * Na desktopu dělá PDF JobiDocs (Electron na počítači zákazníka). V
 * prohlížeči nic takového není a jediná cesta k PDF byl tiskový dialog,
 * ve kterém si uživatel musel zvolit „Uložit jako PDF“. Tady se HTML
 * dokumentu – stejné, jaké se tiskne, i s fotkami vloženými jako data –
 * pošle do Cloudflare Browser Rendering (headless Chromium) a zpátky
 * přijde hotové PDF. Vzhled je tím pádem stejný jako z tiskového dialogu
 * Chromu, jen bez dialogu.
 *
 * Nastavení (Supabase → Edge Functions → Secrets):
 *   CF_ACCOUNT_ID                 účet Cloudflare (ten s Workerem jobi-api)
 *   CF_BROWSER_RENDERING_TOKEN    API token s oprávněním Browser Rendering: Edit
 * Bez nich funkce vrací 503 not_configured a aplikace spadne zpátky na
 * tiskový dialog – nic se nerozbije, jen není pohodlí navíc.
 *
 * Postup zřízení: docs/PDF_NA_SERVERU.md
 */

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "content-disposition",
};

const json = (telo: unknown, status = 200) =>
  new Response(JSON.stringify(telo), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });

/** HTML i s fotkami jako data: – nad tohle už to není dokument, ale útok. */
const MAX_HTML_BAJTU = 12 * 1024 * 1024;

/** Jen bezpečné znaky do hlavičky; diakritiku už odstranil klient. */
function bezpecnyNazev(s: unknown): string {
  const t = String(s ?? "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
  return (t || "dokument").replace(/\.pdf$/i, "") + ".pdf";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Podporováno je jen POST" }, 405);

  const hlavicka = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!hlavicka) return json({ error: "Chybí přihlášení" }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const uzivatel = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: hlavicka } },
  });
  const { data: kdo } = await uzivatel.auth.getUser();
  if (!kdo?.user) return json({ error: "Nepřihlášený" }, 401);

  const ucet = Deno.env.get("CF_ACCOUNT_ID") ?? "";
  const token = Deno.env.get("CF_BROWSER_RENDERING_TOKEN") ?? "";
  // Kontrola nastavení až po přihlášení – nepřihlášený nemá vědět ani to,
  // jestli je funkce zapnutá.
  if (!ucet || !token) return json({ error: "not_configured" }, 503);

  const telo = await req.json().catch(() => null) as { serviceId?: unknown; html?: unknown; fileName?: unknown } | null;
  const serviceId = typeof telo?.serviceId === "string" ? telo.serviceId : "";
  const html = typeof telo?.html === "string" ? telo.html : "";
  if (!serviceId || !html) return json({ error: "Chybí serviceId nebo html" }, 400);
  if (html.length > MAX_HTML_BAJTU) return json({ error: "Dokument je příliš velký" }, 413);

  // Členství se ověřuje tady – funkce běží pod service_role a RLS by ji pustila všude.
  const svc = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: clenstvi } = await svc
    .from("service_memberships")
    .select("role")
    .eq("service_id", serviceId)
    .eq("user_id", kdo.user.id)
    .maybeSingle();
  if (!clenstvi) return json({ error: "Nejsi členem tohohle servisu" }, 403);

  let odpoved: Response;
  try {
    odpoved = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ucet}/browser-rendering/pdf`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        html,
        // Dokument sám hlásí, že doměřil stránku a načetl obrázky i písma
        // (fitScript v jobidocs/core nastaví data-fit="done"). Čekat jen
        // na síť nestačí – fotky jsou data:, ty se nestahují.
        waitForSelector: { selector: 'html[data-fit="done"]', timeout: 10000 },
        gotoOptions: { waitUntil: "networkidle0", timeout: 20000 },
        pdfOptions: { format: "A4", printBackground: true, preferCSSPageSize: true },
      }),
      signal: AbortSignal.timeout(40000),
    });
  } catch (e) {
    return json({ error: `Převod na PDF se nezdařil: ${String(e).slice(0, 200)}` }, 502);
  }

  const typ = odpoved.headers.get("content-type") ?? "";
  if (!odpoved.ok || !typ.includes("application/pdf")) {
    // Cloudflare při chybě vrací JSON { success: false, errors: [{ message }] }.
    const text = await odpoved.text().catch(() => "");
    let zprava = text.slice(0, 300);
    try {
      const j = JSON.parse(text) as { errors?: Array<{ message?: string }> };
      if (j?.errors?.[0]?.message) zprava = j.errors[0].message;
    } catch { /* není JSON */ }
    console.error("[document-pdf] Cloudflare", odpoved.status, zprava);
    return json({ error: `Převod na PDF se nezdařil (${odpoved.status}): ${zprava}` }, 502);
  }

  const nazev = bezpecnyNazev(telo?.fileName);
  return new Response(odpoved.body, {
    status: 200,
    headers: {
      ...cors,
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${nazev}"`,
      "Cache-Control": "no-store",
    },
  });
});
