/**
 * Proxy pro veřejné API Jobi na api.appjobi.com.
 *
 * Dělá dvě věci:
 *   1. Překládá hezké cesty (/v1/catalog) na adresy edge funkcí
 *      (/functions/v1/public-catalog), aby se adresa dala do budoucna
 *      změnit bez zásahu do webů zákazníků.
 *   2. Cachuje čtení na hraně. Cache Rule z ovládacího panelu se sem
 *      použít nedá – poddotaz míří na cizí doménu (supabase.co), na kterou
 *      se pravidla téhle zóny nevztahují. Proto Cache API přímo tady.
 *
 * Zápis (/v1/write) se nikdy necachuje a jde rovnou dál i s tokenem.
 */

const PUVOD = "https://ijtvcgolsdsrquqbvjrz.supabase.co";

const MAPA = {
  "/v1/catalog": "/functions/v1/public-catalog",
  "/v1/inventory": "/functions/v1/public-inventory",
  "/v1/embed.js": "/functions/v1/public-embed",
  "/v1/write": "/functions/v1/api-write",
  "/v1/openapi.json": "/functions/v1/public-docs",
};

/**
 * Vykreslená dokumentace. Servíruje ji Worker, ne edge funkce: Supabase
 * přepisuje edge funkcím Content-Type text/html na text/plain, aby na
 * *.supabase.co nešlo hostovat cizí stránky.
 *
 * Redoc, ne Swagger UI – Redoc nemá tlačítko „vyzkoušet“. U čtení by
 * nevadilo, je veřejné, ale u zápisu by lidi vkládali svůj token do
 * cizí stránky.
 */
const STRANKA_DOKUMENTACE = `<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>API Jobi</title>
  <link rel="icon" href="data:,">
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
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
        expandResponses: "200",
        nativeScrollbars: true,
        theme: { colors: { primary: { main: "#0E7C6B" } } },
      },
      document.getElementById("redoc"),
      function () { var c = document.getElementById("cekam"); if (c) { c.remove(); } }
    );
  </script>
</body>
</html>`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, idempotency-key, if-none-match",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
  "Access-Control-Expose-Headers": "etag, retry-after, idempotency-replayed, x-jobi-cache",
};

function json(telo, status) {
  return new Response(JSON.stringify(telo), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cesta = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (cesta === "/v1/docs") {
      return new Response(STRANKA_DOKUMENTACE, {
        headers: {
          ...CORS,
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    const cil = MAPA[cesta];
    if (!cil) {
      return json({ error: "Neznámá cesta", known: Object.keys(MAPA) }, 404);
    }

    const adresa = new URL(PUVOD + cil);
    adresa.search = url.search;

    // Zápis: proxy beze změny, i s hlavičkami Authorization a Idempotency-Key.
    if (request.method === "POST") {
      return fetch(new Request(adresa.toString(), request));
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return json({ error: "Podporováno je jen GET, HEAD a POST" }, 405);
    }

    const cache = caches.default;
    // Klíč MUSÍ být adresa z vlastní zóny (api.appjobi.com), ne ta na
    // supabase.co. Cache API klíčuje jen v rámci zóny a cizí doménu tiše
    // neuloží – projevilo se to tak, že X-Jobi-Cache hlásilo pořád MISS.
    // Hlavičky klienta se do klíče neberou, jinak by se cache tříštila.
    const klic = new Request(url.toString(), { method: "GET" });

    let potiz = "";
    let odpoved = await cache.match(klic);
    // cf-cache-status na to nestačí – ten mluví o edge cache Cloudflare,
    // ne o téhle. Vlastní hlavička je jediný způsob, jak zvenku poznat,
    // jestli Worker odpověděl z paměti, nebo si došel k původu.
    let zCache = Boolean(odpoved);

    if (!odpoved) {
      // If-None-Match se dál schválně NEposílá: původ by vrátil 304 bez těla
      // a do cache by se uložila prázdná odpověď.
      const puvodni = await fetch(adresa.toString(), {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      // Supabase sám sedí za Cloudflare, takže jeho odpovědi nesou cookie
      // __cf_bm. Cache API odpověď se Set-Cookie tiše neuloží – put projde
      // bez chyby, ale match ji pak nikdy nenajde. Do ceníku ta cookie
      // stejně nepatří: platí pro doménu supabase.co, takže by ji prohlížeč
      // návštěvníka cizího webu zahodil, a sledovací cookie posílat lidem
      // na cizí web není v pořádku ani tak.
      const hlavickyPuvodu = new Headers(puvodni.headers);
      hlavickyPuvodu.delete("Set-Cookie");
      odpoved = new Response(puvodni.body, {
        status: puvodni.status,
        statusText: puvodni.statusText,
        headers: hlavickyPuvodu,
      });
      // Chyby (404, 429, 503) se necachují – jinak by 429 z jednoho útoku
      // odstavilo ceník všem na pět minut.
      if (odpoved.ok) {
        // Zápis se čeká schválně a jeho výsledek jde do hlavičky – jinak
        // se nepozná, jestli cache tiše nezahazuje. Selhání nesmí shodit
        // odpověď, nanejvýš přijdeme o zrychlení.
        try {
          await cache.put(klic, odpoved.clone());
        } catch (e) {
          potiz = String(e && e.message ? e.message : e).slice(0, 120);
        }
      }
    }

    // Podmíněný dotaz vyřídíme z uložené odpovědi.
    const etag = odpoved.headers.get("ETag");
    const klientMa = request.headers.get("If-None-Match");
    if (etag && klientMa === etag) {
      return new Response(null, {
        status: 304,
        headers: {
          ...CORS,
          ETag: etag,
          "Cache-Control": odpoved.headers.get("Cache-Control") ?? "",
          "X-Jobi-Cache": zCache ? "HIT" : "MISS",
        },
      });
    }

    const hlavicky = new Headers(odpoved.headers);
    for (const [k, v] of Object.entries(CORS)) hlavicky.set(k, v);
    hlavicky.set("X-Jobi-Cache", zCache ? "HIT" : "MISS");
    hlavicky.set("X-Jobi-Verze", "6");
    hlavicky.set("X-Jobi-Zapis", potiz || (zCache ? "-" : "ok"));

    return new Response(request.method === "HEAD" ? null : odpoved.body, {
      status: odpoved.status,
      headers: hlavicky,
    });
  },
};
