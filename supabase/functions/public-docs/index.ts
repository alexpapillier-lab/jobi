import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { POPIS } from "./openapi.ts";

/**
 * Dokumentace veřejného API.
 *
 *   GET https://api.appjobi.com/v1/docs          – stránka k prolistování
 *   GET https://api.appjobi.com/v1/openapi.json  – strojový popis
 *
 * Z popisu si integrátor vygeneruje klienta nebo ho naimportuje do Postmanu.
 *
 * Vykresluje se Redocem schválně, ne Swagger UI: Redoc nemá tlačítko
 * „vyzkoušet“. U čtení by nevadilo, je veřejné, ale u zápisu by lidi
 * vkládali svůj token do cizí stránky. Zkoušet zápis patří do vlastního
 * nástroje, ne do dokumentace.
 *
 * Zdrojem pravdy je docs/api/openapi.yaml, openapi.ts se z něj generuje
 * přes `npm run api:spec`.
 */

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const STRANKA = `<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>API Jobi</title>
  <link rel="icon" href="data:,">
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
    /* Redoc si písmo řídí sám, tohle je jen pro stav před načtením. */
    #cekam { padding: 40px; color: #667; font-size: 15px; }
  </style>
</head>
<body>
  <div id="cekam">Načítám dokumentaci…</div>
  <div id="redoc"></div>
  <script src="https://cdn.redoc.ly/redoc/v2.5.0/bundles/redoc.standalone.js"></script>
  <script>
    Redoc.init(
      "/v1/openapi.json",
      {
        hideDownloadButton: false,
        expandResponses: "200",
        nativeScrollbars: true,
        theme: { colors: { primary: { main: "#0E7C6B" } } },
      },
      document.getElementById("redoc"),
      function () { document.getElementById("cekam").remove(); }
    );
  </script>
</body>
</html>`;

serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response(JSON.stringify({ error: "Podporováno je jen GET" }), {
      status: 405,
      headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const cesta = new URL(req.url).pathname;

  if (cesta.endsWith("/openapi.json")) {
    return new Response(JSON.stringify(POPIS, null, 2), {
      headers: {
        ...cors,
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  }

  return new Response(STRANKA, {
    headers: {
      ...cors,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
});
