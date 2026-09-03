import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

/**
 * Hotový kousek JavaScriptu, který vykreslí ceník na cizí web.
 *
 *   <div id="jobi-cenik"></div>
 *   <script src="…/functions/v1/public-embed?service=<slug>"></script>
 *
 * Smysl celého API je ceník na stránce. Bez tohohle by si každý servis
 * musel na to psát vlastní frontend, případně za to platit webaři.
 *
 * Skript nic nesbírá, nikam nic neposílá a nepoužívá cookies – jen si
 * stáhne veřejný JSON a vykreslí tabulku. Styly jsou schválně minimální
 * a přebírají barvu i písmo ze stránky, aby to nebilo do očí.
 *
 * Zadání: docs/ZADANI_API.md, kapitola 6.
 */

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = new URL(req.url);
  const slug = url.searchParams.get("service")?.trim().toLowerCase() ?? "";
  const zaklad = `${url.protocol}//${url.host}/functions/v1`;

  // Slug jde do JS řetězce – přes JSON.stringify, ať se z něj nedá vylomit.
  const skript = `(function () {
  "use strict";
  var SLUG = ${JSON.stringify(slug)};
  var API = ${JSON.stringify(zaklad)};
  var cil = document.getElementById("jobi-cenik");
  if (!cil) { return; }
  if (!SLUG) { cil.textContent = "Chybí parametr service v adrese skriptu."; return; }

  function text(el, t) { el.textContent = t; return el; }
  function prvek(tag, trida) {
    var e = document.createElement(tag);
    if (trida) { e.className = trida; }
    return e;
  }

  var styl = document.createElement("style");
  styl.textContent = [
    ".jobi-cenik{font:inherit;color:inherit}",
    ".jobi-cenik table{width:100%;border-collapse:collapse}",
    ".jobi-cenik th,.jobi-cenik td{padding:8px 10px;text-align:left;border-bottom:1px solid rgba(128,128,128,.25);vertical-align:top}",
    ".jobi-cenik td.cena{text-align:right;white-space:nowrap;font-weight:600}",
    ".jobi-cenik .popis{font-size:.85em;opacity:.75;margin-top:2px}",
    ".jobi-cenik h3{margin:18px 0 6px;font-size:1.05em}",
    ".jobi-cenik .cas{font-size:.85em;opacity:.75;white-space:nowrap}"
  ].join("");
  document.head.appendChild(styl);

  cil.className = (cil.className ? cil.className + " " : "") + "jobi-cenik";
  text(cil, "Načítám ceník…");

  fetch(API + "/public-catalog?service=" + encodeURIComponent(SLUG))
    .then(function (r) {
      if (!r.ok) { throw new Error("Ceník se nepodařilo načíst (" + r.status + ")."); }
      return r.json();
    })
    .then(function (data) {
      cil.textContent = "";
      var podleModelu = {};
      data.models.forEach(function (m) { podleModelu[m.id] = m.name; });

      // Opravy se seskupí podle modelu; oprava platná pro víc modelů
      // se objeví u každého z nich, což je pro návštěvníka to podstatné.
      var skupiny = {};
      data.repairs.forEach(function (o) {
        (o.model_ids.length ? o.model_ids : ["_"]).forEach(function (mid) {
          (skupiny[mid] = skupiny[mid] || []).push(o);
        });
      });

      var poradi = data.models.map(function (m) { return m.id; }).filter(function (id) { return skupiny[id]; });
      if (skupiny["_"]) { poradi.push("_"); }
      if (!poradi.length) { text(cil, "Ceník je zatím prázdný."); return; }

      poradi.forEach(function (mid) {
        cil.appendChild(text(prvek("h3"), mid === "_" ? "Ostatní" : podleModelu[mid] || "Ostatní"));
        var tabulka = prvek("table");
        skupiny[mid].forEach(function (o) {
          var r = prvek("tr");
          var bunka = prvek("td");
          bunka.appendChild(text(prvek("div"), o.name));
          if (o.details) { bunka.appendChild(text(prvek("div", "popis"), o.details)); }
          r.appendChild(bunka);
          r.appendChild(text(prvek("td", "cas"), o.estimated_time_label || ""));
          r.appendChild(text(prvek("td", "cena"), new Intl.NumberFormat("cs-CZ").format(o.price_incl_vat) + " Kč"));
          tabulka.appendChild(r);
        });
        cil.appendChild(tabulka);
      });
    })
    .catch(function (e) { text(cil, e.message || "Ceník se nepodařilo načíst."); });
})();
`;

  return new Response(skript, {
    headers: {
      ...cors,
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
});
