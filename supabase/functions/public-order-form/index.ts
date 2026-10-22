import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { klientskaIp, otiskKlienta } from "../_shared/limity.ts";
import { formularNaObjednavku, nastaveniFormulare, novyKodObjednavky, type NastaveniFormulare } from "../_shared/objednavky.ts";

/**
 * Vložitelný formulář objednávky opravy – pro servisy bez vlastního
 * formuláře na webu (vzor: online rezervace, public-booking).
 *
 *   GET  /v1/order-form?service=<slug>       → nastavení formuláře (název, úvod, podmínky)
 *   POST /v1/order-form                       → nová objednávka { service, name, phone, email?,
 *                                               device, model_id?, repair_id?, serial?, issue,
 *                                               handoff: "osobne"|"postou", street?, city?, zip?,
 *                                               note?, consent: true, web: "" }
 *   GET  /v1/order-form.js?service=<slug>    → hotový formulář do <div id="jobi-objednavka">
 *
 * Bez tokenu. Objednávka vznikne se zdrojem „formulář Jobi“ a číslem
 * JOBI-RRMMDD-XXXXXX; zaškrtnutý souhlas s podmínkami se uloží jako
 * elektronické odsouhlasení (čas, IP, prohlížeč) a vytiskne se na
 * zakázkovém listu. Zapíná se v Nastavení → API → Objednávky z webu
 * (service_settings.config.objednavky.formular) a potřebuje modul
 * veřejného API (api_catalog). Neexistující servis a vypnutý formulář
 * vracejí totéž, aby se nedaly hádat slugy.
 *
 * Ochrana: 10 objednávek za hodinu z jedné adresy, 60 za hodinu na servis,
 * skryté pole proti robotům.
 */

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (telo: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(telo), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", ...extra } });

const LIMIT_NA_KLIENTA_HOD = 10;
const LIMIT_NA_SERVIS_HOD = 60;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tabulky nejsou v typech klienta
type Svc = SupabaseClient<any, any, any>;
type Servis = { id: string; nazev: string | null; nastaveni: NastaveniFormulare };

async function najdiServis(svc: Svc, slug: string): Promise<Servis | null> {
  if (!slug) return null;
  const { data: servis } = await svc.from("services").select("id, name, active").eq("public_slug", slug).maybeSingle();
  if (!servis || servis.active === false) return null;
  const { data: narok } = await svc.rpc("has_entitlement", { p_service_id: servis.id, p_module: "api_catalog" });
  if (narok !== true) return null;
  const { data: nast } = await svc.from("service_settings").select("config").eq("service_id", servis.id).maybeSingle();
  const config = (nast?.config ?? {}) as Record<string, unknown>;
  const nastaveni = nastaveniFormulare((config.objednavky as Record<string, unknown> | undefined)?.formular);
  if (!nastaveni.zapnuto) return null;
  const firma = (config.companyData ?? {}) as Record<string, unknown>;
  const nazev = typeof firma.name === "string" && firma.name.trim() ? firma.name.trim() : (servis.name as string | null);
  return { id: servis.id as string, nazev, nastaveni };
}

async function pocet(svc: Svc, klic: string): Promise<number> {
  const { data, error } = await svc.rpc("pocet_udalosti", { p_kanal: "order-form", p_klic: klic, p_minut: 60 });
  if (error) console.error("[public-order-form] počítadlo limitu selhalo:", error.message);
  return typeof data === "number" ? data : 0;
}

function embedSkript(slug: string): string {
  const api = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;
  const styl = `
.jobi-obj{--jobi-akcent:#0e7c86;--jobi-ram:rgba(0,0,0,.14);--jobi-tlum:rgba(0,0,0,.55);--jobi-plocha:rgba(0,0,0,.02);font:inherit;color:inherit;max-width:640px;display:grid;gap:18px}
@media (prefers-color-scheme:dark){.jobi-obj{--jobi-ram:rgba(255,255,255,.18);--jobi-tlum:rgba(255,255,255,.65);--jobi-plocha:rgba(255,255,255,.04)}}
.jobi-obj *{box-sizing:border-box}
.jobi-obj__uvod,.jobi-obj__pozn{margin:0;color:var(--jobi-tlum);line-height:1.5;font-size:.9em}
.jobi-obj__blok{display:grid;gap:12px;padding:16px;border:1px solid var(--jobi-ram);border-radius:14px;background:var(--jobi-plocha)}
.jobi-obj__nadpis{font-weight:700;font-size:.95em}
.jobi-obj__radek{display:grid;gap:12px;grid-template-columns:1fr 1fr}
@media (max-width:520px){.jobi-obj__radek{grid-template-columns:1fr}}
.jobi-obj__pole{display:grid;gap:6px;font-size:.9em}
.jobi-obj__pole>span{color:var(--jobi-tlum)}
.jobi-obj input[type=text],.jobi-obj input[type=tel],.jobi-obj input[type=email],.jobi-obj select,.jobi-obj textarea{width:100%;padding:11px 12px;border:1px solid var(--jobi-ram);border-radius:10px;background:transparent;color:inherit;font:inherit}
.jobi-obj input:focus,.jobi-obj select:focus,.jobi-obj textarea:focus{outline:none;border-color:var(--jobi-akcent);box-shadow:0 0 0 3px rgba(14,124,134,.18)}
.jobi-obj textarea{min-height:84px;resize:vertical}
.jobi-obj__volba{display:flex;gap:10px;align-items:flex-start;cursor:pointer;font-size:.92em;line-height:1.45}
.jobi-obj__volba input{width:18px;height:18px;accent-color:var(--jobi-akcent);flex:0 0 auto;margin-top:1px}
.jobi-obj__odeslat{padding:13px 22px;border:none;border-radius:10px;background:var(--jobi-akcent);color:#fff;font:inherit;font-weight:700;cursor:pointer}
.jobi-obj__odeslat:disabled{opacity:.6;cursor:progress}
.jobi-obj__chyba{color:#b91c1c;font-size:.9em}
.jobi-obj__hotovo{display:grid;gap:8px;padding:20px;border-radius:14px;background:rgba(14,124,134,.1)}
.jobi-obj__hotovo h3{margin:0;font-size:1.1em}
.jobi-obj__past{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}
`;
  return `(function () {
  "use strict";
  var SLUG = ${JSON.stringify(slug)};
  var API = ${JSON.stringify(api)};
  var cil = document.getElementById("jobi-objednavka");
  if (!cil) { return; }
  var styl = document.createElement("style");
  styl.textContent = ${JSON.stringify(styl)};
  document.head.appendChild(styl);

  function el(tag, attrs, deti) {
    var e = document.createElement(tag);
    for (var k in (attrs || {})) { if (k === "text") { e.textContent = attrs[k]; } else { e.setAttribute(k, attrs[k]); } }
    (deti || []).forEach(function (d) { e.appendChild(d); });
    return e;
  }
  function pole(nazev, typ, placeholder, povinne) {
    var vstup = el(typ === "textarea" ? "textarea" : (typ === "select" ? "select" : "input"), { placeholder: placeholder || "" });
    if (typ !== "textarea" && typ !== "select") { vstup.type = typ; }
    if (povinne) { vstup.required = true; }
    return { obal: el("label", { class: "jobi-obj__pole" }, [el("span", { text: nazev + (povinne ? " *" : "") }), vstup]), vstup: vstup };
  }
  function blok(nadpis, deti) {
    return el("div", { class: "jobi-obj__blok" }, [el("div", { class: "jobi-obj__nadpis", text: nadpis })].concat(deti));
  }
  function volba(typ, name, text, checked) {
    var i = el("input", { name: name }); i.type = typ; if (checked) { i.checked = true; }
    return { obal: el("label", { class: "jobi-obj__volba" }, [i, el("span", { text: text })]), vstup: i };
  }
  function nactiCenik() {
    return fetch(API + "/public-catalog?service=" + encodeURIComponent(SLUG)).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }

  Promise.all([
    fetch(API + "/public-order-form?service=" + encodeURIComponent(SLUG)).then(function (r) { if (!r.ok) { throw new Error(); } return r.json(); }),
    nactiCenik(),
  ]).then(function (v) {
    var n = v[0], cenik = v[1];
    var form = el("form", { class: "jobi-obj", novalidate: "" });
    if (n.uvod) { form.appendChild(el("p", { class: "jobi-obj__uvod", text: n.uvod })); }

    var jmeno = pole("Jméno a příjmení", "text", "Jan Novák", true);
    var telefon = pole("Telefon", "tel", "+420 777 123 456", true);
    var email = pole("E-mail", "email", "jan@email.cz", false);
    form.appendChild(blok("Kontakt", [jmeno.obal, el("div", { class: "jobi-obj__radek" }, [telefon.obal, email.obal])]));

    var zarizeni = pole("Zařízení", "text", "např. iPhone 13, notebook Lenovo", true);
    var seriove = pole("Sériové číslo / IMEI", "text", "nepovinné", false);
    var zavada = pole("Co je potřeba opravit", "textarea", "popište závadu", true);
    var modelSel = null, opravaSel = null, deti = [];
    if (cenik && cenik.models && cenik.models.length) {
      var znacky = {}; (cenik.brands || []).forEach(function (b) { znacky[b.id] = b.name; });
      var kat = {}; (cenik.categories || []).forEach(function (c) { kat[c.id] = c; });
      var m = pole("Model z ceníku", "select", "", false); modelSel = m.vstup;
      modelSel.appendChild(el("option", { value: "", text: "– vyberte model (nepovinné) –" }));
      cenik.models.forEach(function (mo) { var k = kat[mo.category_id] || {}; var z = znacky[k.brand_id]; modelSel.appendChild(el("option", { value: mo.id, text: (z ? z + " " : "") + mo.name })); });
      var o = pole("Oprava z ceníku", "select", "", false); opravaSel = o.vstup;
      o.obal.hidden = true;
      modelSel.addEventListener("change", function () {
        opravaSel.innerHTML = "";
        opravaSel.appendChild(el("option", { value: "", text: "– nevím / jiná –" }));
        var opr = (cenik.repairs || []).filter(function (r) { return (r.model_ids || []).indexOf(modelSel.value) !== -1; });
        opr.forEach(function (r) { opravaSel.appendChild(el("option", { value: r.id, text: r.name + (typeof r.price === "number" ? " – " + r.price.toLocaleString("cs-CZ") + " Kč" : "") })); });
        o.obal.hidden = opr.length === 0;
        var vybrany = modelSel.options[modelSel.selectedIndex];
        if (modelSel.value && !zarizeni.vstup.value.trim()) { zarizeni.vstup.value = vybrany.textContent; }
      });
      deti = [m.obal, o.obal];
    }
    form.appendChild(blok("Zařízení", deti.concat([zarizeni.obal, seriove.obal, zavada.obal])));

    var osobne = volba("radio", "predani", "Přinesu osobně", true);
    var postou = volba("radio", "predani", "Pošlu poštou / přepravcem", false);
    var ulice = pole("Ulice a číslo", "text", "", false);
    var mesto = pole("Město", "text", "", false);
    var psc = pole("PSČ", "text", "", false);
    var adresa = el("div", { class: "jobi-obj__radek" }, [ulice.obal, el("div", { class: "jobi-obj__radek" }, [mesto.obal, psc.obal])]);
    var adresaPozn = el("p", { class: "jobi-obj__pozn", text: "Adresa, kam zařízení po opravě vrátíme." });
    adresa.hidden = true; adresaPozn.hidden = true;
    function prepni() { adresa.hidden = !postou.vstup.checked; adresaPozn.hidden = !postou.vstup.checked; }
    osobne.vstup.addEventListener("change", prepni); postou.vstup.addEventListener("change", prepni);
    form.appendChild(blok("Předání zařízení", [osobne.obal, postou.obal, adresaPozn, adresa]));

    var pozn = el("textarea", { placeholder: "cokoliv, co bychom měli vědět", "aria-label": "Poznámka" });
    form.appendChild(blok("Poznámka", [pozn]));

    var souhlasText = "Souhlasím se zakázkovým listem a podmínkami servisu" + (n.service ? " " + n.service : "") + ".";
    var souhlas = volba("checkbox", "souhlas", souhlasText, false);
    var souhlasDeti = [souhlas.obal];
    if (n.podminky) { var a = el("a", { href: n.podminky, target: "_blank", rel: "noopener", text: "Přečíst podmínky" }); souhlasDeti.push(el("p", { class: "jobi-obj__pozn" }, [a])); }
    souhlasDeti.push(el("p", { class: "jobi-obj__pozn", text: "Uložíme čas odsouhlasení, IP adresu a prohlížeč – vytisknou se na zakázkovém listu místo podpisu." }));
    form.appendChild(blok("Souhlas", souhlasDeti));

    var past = el("input", { class: "jobi-obj__past", name: "web", type: "text", tabindex: "-1", autocomplete: "off" });
    var tlacitko = el("button", { type: "submit", class: "jobi-obj__odeslat", text: "Odeslat objednávku" });
    var zprava = el("div", { class: "jobi-obj__chyba" });
    form.appendChild(el("div", {}, [tlacitko, zprava]));
    form.appendChild(past);

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (!jmeno.vstup.value.trim() || !telefon.vstup.value.trim() || !zarizeni.vstup.value.trim() || !zavada.vstup.value.trim()) { zprava.textContent = "Vyplňte prosím jméno, telefon, zařízení a závadu."; return; }
      if (postou.vstup.checked && (!ulice.vstup.value.trim() || !mesto.vstup.value.trim())) { zprava.textContent = "Vyplňte prosím adresu pro vrácení."; return; }
      if (!souhlas.vstup.checked) { zprava.textContent = "Bez souhlasu s podmínkami objednávku odeslat nejde."; return; }
      tlacitko.disabled = true; zprava.textContent = "";
      fetch(API + "/public-order-form", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service: SLUG, name: jmeno.vstup.value, phone: telefon.vstup.value, email: email.vstup.value,
          device: zarizeni.vstup.value, serial: seriove.vstup.value, issue: zavada.vstup.value,
          model_id: modelSel ? modelSel.value : "", repair_id: opravaSel ? opravaSel.value : "",
          handoff: postou.vstup.checked ? "postou" : "osobne", street: ulice.vstup.value, city: mesto.vstup.value, zip: psc.vstup.value,
          note: pozn.value, consent: souhlas.vstup.checked, consent_text: souhlasText, web: past.value,
        }),
      })
        .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, b: b }; }); })
        .then(function (res) {
          if (!res.ok) { throw new Error(res.b && res.b.error ? res.b.error : "Odeslání se nezdařilo"); }
          form.innerHTML = "";
          form.appendChild(el("div", { class: "jobi-obj__hotovo" }, [
            el("h3", { text: "Děkujeme, objednávku máme." }),
            el("p", { class: "jobi-obj__pozn", text: "Číslo objednávky: " + (res.b.number || "") + ". Ozveme se vám s dalším postupem." }),
          ]));
        })
        .catch(function (e) { tlacitko.disabled = false; zprava.textContent = e.message; });
    });
    cil.innerHTML = "";
    cil.appendChild(form);
  }).catch(function () { cil.textContent = "Objednávka opravy momentálně není dostupná. Zavolejte nám prosím."; });
})();`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  const svc: Svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  if (req.method === "GET") {
    const slug = (url.searchParams.get("service")?.trim().toLowerCase() ?? "").slice(0, 80);
    if (url.pathname.endsWith("/embed.js")) {
      return new Response(embedSkript(slug), { headers: { ...cors, "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=60" } });
    }
    const servis = await najdiServis(svc, slug);
    if (!servis) return json({ error: "Formulář není k dispozici" }, 404);
    return json({ service: servis.nazev, uvod: servis.nastaveni.uvod, podminky: servis.nastaveni.podminkyUrl }, 200, { "Cache-Control": "public, max-age=300" });
  }
  if (req.method !== "POST") return json({ error: "Podporováno je GET a POST" }, 405);

  let telo: Record<string, unknown>;
  try {
    const text = await req.text();
    if (text.length > 32 * 1024) return json({ error: "Příliš velký požadavek" }, 413);
    telo = JSON.parse(text);
  } catch {
    return json({ error: "Tělo musí být JSON" }, 400);
  }
  // Skryté pole vyplní jen robot – odpovíme jako by se povedlo, ať nezkouší dál.
  if (typeof telo.web === "string" && telo.web.trim()) return json({ ok: true, number: novyKodObjednavky() }, 201);

  const slug = (typeof telo.service === "string" ? telo.service.trim().toLowerCase() : "").slice(0, 80);
  const servis = await najdiServis(svc, slug);
  if (!servis) return json({ error: "Formulář není k dispozici" }, 404);

  const klic = await otiskKlienta(req);
  await Promise.all([
    svc.rpc("zapocitej_udalost", { p_kanal: "order-form", p_klic: klic }),
    svc.rpc("zapocitej_udalost", { p_kanal: "order-form", p_klic: `servis:${servis.id}` }),
  ]);
  const [zaKlic, zaServis] = await Promise.all([pocet(svc, klic), pocet(svc, `servis:${servis.id}`)]);
  if (zaKlic > LIMIT_NA_KLIENTA_HOD || zaServis > LIMIT_NA_SERVIS_HOD) {
    return json({ error: "Příliš mnoho objednávek, zkuste to prosím později." }, 429, { "Retry-After": "3600" });
  }

  const v = formularNaObjednavku(telo, {
    ip: klientskaIp(req),
    userAgent: req.headers.get("User-Agent") ?? "",
    podminkyUrl: servis.nastaveni.podminkyUrl,
  });
  if (typeof v === "string") return json({ error: v }, 400);

  // Model a oprava z ceníku jen tohoto servisu; cizí id se tiše vynechá.
  for (const [klicSloupce, tabulka] of [["model_id", "device_models"], ["repair_id", "repairs"]] as const) {
    const id = v.hodnoty[klicSloupce];
    if (typeof id !== "string") continue;
    const { data } = await svc.from(tabulka).select("id").eq("service_id", servis.id).eq("id", id).maybeSingle();
    if (!data) delete v.hodnoty[klicSloupce];
  }

  // Číslo je náhodné; srážka je nepravděpodobná, ale zkusí se ještě jednou.
  for (let pokus = 0; pokus < 2; pokus++) {
    const cislo = novyKodObjednavky();
    const { error } = await svc.from("web_objednavky").insert({
      ...v.hodnoty,
      service_id: servis.id,
      externi_cislo: cislo,
      zdroj: "formulář Jobi",
      stav: "nova",
      souhlas: v.hodnoty.souhlas ? { ...(v.hodnoty.souhlas as Record<string, unknown>), id: `${cislo}-S` } : null,
    });
    if (!error) return json({ ok: true, number: cislo }, 201);
    if (!/duplicate key|unique/i.test(error.message)) {
      console.error("[public-order-form] insert", error);
      break;
    }
  }
  return json({ error: "Objednávku se nepodařilo uložit" }, 500);
});
