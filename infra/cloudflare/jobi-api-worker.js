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
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, idempotency-key, if-none-match",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
  "Access-Control-Expose-Headers": "etag, retry-after, idempotency-replayed",
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
    // Klíč jen z adresy – hlavičky klienta by cache zbytečně tříštily.
    const klic = new Request(adresa.toString(), { method: "GET" });

    let odpoved = await cache.match(klic);

    if (!odpoved) {
      // If-None-Match se dál schválně NEposílá: původ by vrátil 304 bez těla
      // a do cache by se uložila prázdná odpověď.
      odpoved = await fetch(adresa.toString(), {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      // Chyby (404, 429, 503) se necachují – jinak by 429 z jednoho útoku
      // odstavilo ceník všem na pět minut.
      if (odpoved.ok) {
        ctx.waitUntil(cache.put(klic, odpoved.clone()));
      }
    }

    // Podmíněný dotaz vyřídíme z uložené odpovědi.
    const etag = odpoved.headers.get("ETag");
    const klientMa = request.headers.get("If-None-Match");
    if (etag && klientMa === etag) {
      return new Response(null, {
        status: 304,
        headers: { ...CORS, ETag: etag, "Cache-Control": odpoved.headers.get("Cache-Control") ?? "" },
      });
    }

    const hlavicky = new Headers(odpoved.headers);
    for (const [k, v] of Object.entries(CORS)) hlavicky.set(k, v);

    return new Response(request.method === "HEAD" ? null : odpoved.body, {
      status: odpoved.status,
      headers: hlavicky,
    });
  },
};
