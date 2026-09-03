import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { POPIS } from "./openapi.ts";

/**
 * Dokumentace veřejného API.
 *
 *   GET https://api.appjobi.com/v1/openapi.json
 *
 * Z popisu si integrátor vygeneruje klienta nebo ho naimportuje do Postmanu.
 *
 * Servíruje jen popis, ne stránku: Supabase edge funkcím přepisuje
 * Content-Type text/html na text/plain, aby na *.supabase.co nešlo
 * hostovat cizí stránky. Vykreslená dokumentace proto sedí v Cloudflare
 * Workeru (infra/cloudflare/jobi-api-worker.js).
 *
 * Zdrojem pravdy je docs/api/openapi.yaml, openapi.ts se z něj generuje
 * přes `npm run api:spec`.
 */

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};



serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response(JSON.stringify({ error: "Podporováno je jen GET" }), {
      status: 405,
      headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
    });
  }

  return new Response(JSON.stringify(POPIS, null, 2), {
    headers: {
      ...cors,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
});
