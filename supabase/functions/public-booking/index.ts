import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { otiskKlienta } from "../_shared/limity.ts";

/**
 * Online rezervace z webu servisu.
 *
 *   GET  /v1/booking?service=<slug>      → nastavení formuláře (otevírací doba, text)
 *   POST /v1/booking                      → nová rezervace {service, name, phone, email?, device, repair?, preferred_at?, note?}
 *   GET  /v1/booking.js?service=<slug>    → hotový formulář k vložení na web
 *
 * Rezervace má každý tarif (Nastavení → Zakázky → Online rezervace);
 * výběr opravy z ceníku ve formuláři potřebuje modul veřejného API, protože
 * ceník jde ven přes /v1/catalog. Neexistující servis a vypnuté rezervace
 * vracejí totéž, aby se přes endpoint nedaly hádat slugy.
 *
 * Ochrana: limit 10 rezervací za hodinu z jedné adresy (otisk IP solený
 * dnem, viz limity.ts), 60 za hodinu na servis, skryté pole proti robotům.
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

type Nastaveni = {
  zapnuto: boolean;
  /** Dny v týdnu 1 = pondělí … 7 = neděle. */
  dny: number[];
  od: string;
  do: string;
  krokMin: number;
  uvod: string;
};

const VYCHOZI: Nastaveni = { zapnuto: false, dny: [1, 2, 3, 4, 5], od: "09:00", do: "17:00", krokMin: 30, uvod: "" };

function nastaveniZConfigu(raw: unknown): Nastaveni {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const cas = (v: unknown, def: string) => (typeof v === "string" && /^\d{1,2}:\d{2}$/.test(v) ? v.padStart(5, "0") : def);
  return {
    zapnuto: r.zapnuto === true,
    dny: Array.isArray(r.dny) ? r.dny.filter((d): d is number => typeof d === "number" && d >= 1 && d <= 7) : VYCHOZI.dny,
    od: cas(r.od, VYCHOZI.od),
    do: cas(r.do, VYCHOZI.do),
    krokMin: typeof r.krokMin === "number" && r.krokMin >= 10 && r.krokMin <= 120 ? r.krokMin : VYCHOZI.krokMin,
    uvod: typeof r.uvod === "string" ? r.uvod.slice(0, 400) : "",
  };
}

type Servis = { id: string; name: string | null; nastaveni: Nastaveni; email: string | null; telefon: string | null; adresa: string | null };

/** Servis podle slugu, včetně kontroly modulu a zapnutých rezervací. */
async function najdiServis(svc: ReturnType<typeof createClient>, slug: string): Promise<Servis | null> {
  if (!slug) return null;
  const { data: servis } = await svc.from("services").select("id, name").eq("public_slug", slug).maybeSingle();
  if (!servis) return null;
  const { data: nast } = await svc.from("service_settings").select("config").eq("service_id", servis.id).maybeSingle();
  const config = (nast?.config ?? {}) as Record<string, unknown>;
  const nastaveni = nastaveniZConfigu(config.rezervace);
  if (!nastaveni.zapnuto) return null;
  const firma = (config.companyData ?? {}) as Record<string, unknown>;
  const t = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const adresa = [t(firma.addressStreet), [t(firma.addressZip), t(firma.addressCity)].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null;
  return {
    id: servis.id,
    name: t(firma.name) ?? servis.name,
    nastaveni,
    email: typeof firma.email === "string" && firma.email.includes("@") ? firma.email : null,
    telefon: t(firma.phone),
    adresa,
  };
}

const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

async function pocet(svc: ReturnType<typeof createClient>, kanal: string, klic: string, minut: number): Promise<number> {
  const { data } = await svc.rpc("pocet_udalosti", { p_kanal: kanal, p_klic: klic, p_minut: minut });
  return typeof data === "number" ? data : 0;
}

/** Oznámení servisu e-mailem – best effort, rezervace v Jobi je i bez něj. */
async function oznamServisu(servis: Servis, r: { customer_name: string; customer_phone: string; customer_email: string | null; device_label: string; repair_name: string | null; model_name: string | null; price_estimate: number | null; preferred_at: string | null; note: string | null }) {
  const key = Deno.env.get("RESEND_API_KEY")?.trim();
  if (!key || !servis.email) return;
  const from = Deno.env.get("RESEND_FROM_EMAIL")?.trim() || "Jobi <onboarding@resend.dev>";
  const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const kdy = r.preferred_at ? new Date(r.preferred_at).toLocaleString("cs-CZ", { timeZone: "Europe/Prague", dateStyle: "medium", timeStyle: "short" }) : "kdykoliv";
  const radky = [
    ["Zákazník", r.customer_name], ["Telefon", r.customer_phone], ["E-mail", r.customer_email ?? "—"],
    ["Zařízení", r.model_name ? `${r.device_label} (${r.model_name})` : r.device_label],
    ["Oprava", r.repair_name ? `${r.repair_name}${r.price_estimate ? ` – cca ${r.price_estimate.toLocaleString("cs-CZ")} Kč` : ""}` : "—"],
    ["Termín", kdy], ["Poznámka", r.note ?? "—"],
  ];
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:14px;color:#111"><h2 style="margin:0 0 12px">Nová rezervace z webu</h2><table cellpadding="6">${radky.map(([k, v]) => `<tr><td style="color:#666">${esc(k)}</td><td><b>${esc(v)}</b></td></tr>`).join("")}</table><p style="color:#666;margin-top:16px">Rezervaci najdete v Jobi v Kalendáři – tam ji potvrdíte nebo z ní jedním kliknutím založíte zakázku.</p></div>`;
  try {
    const odp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [servis.email], subject: `Nová rezervace: ${r.customer_name} – ${r.device_label}`, html }),
    });
    if (!odp.ok) console.warn("[public-booking] e-mail servisu odmítnut", odp.status, await odp.text().catch(() => ""));
  } catch (e) {
    console.warn("[public-booking] e-mail servisu se neposlal", e);
  }
}

/** Potvrzení zákazníkovi – ať ví, že rezervace dorazila, a má kontakt na servis. */
async function potvrdZakaznikovi(servis: Servis, r: { customer_name: string; customer_email: string | null; device_label: string; repair_name: string | null; price_estimate: number | null; preferred_at: string | null }) {
  const key = Deno.env.get("RESEND_API_KEY")?.trim();
  if (!key || !r.customer_email) return;
  const from = Deno.env.get("RESEND_FROM_EMAIL")?.trim() || "Jobi <onboarding@resend.dev>";
  const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const kdy = r.preferred_at ? new Date(r.preferred_at).toLocaleString("cs-CZ", { timeZone: "Europe/Prague", dateStyle: "full", timeStyle: "short" }) : "termín upřesníme po telefonu";
  const nazev = servis.name ?? "servis";
  const oprava = r.repair_name ? `${r.repair_name}${r.price_estimate ? ` (předběžně cca ${r.price_estimate.toLocaleString("cs-CZ")} Kč, konečnou cenu potvrdíme po prohlídce)` : ""}` : null;
  const kontakt = [servis.telefon ? `tel. ${servis.telefon}` : "", servis.adresa ?? "", servis.email ?? ""].filter(Boolean).join(" · ");
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;color:#111;line-height:1.5">
<p>Dobrý den, ${esc(r.customer_name)},</p>
<p>děkujeme, vaši rezervaci máme. Ozveme se vám s potvrzením termínu.</p>
<table cellpadding="6" style="border-collapse:collapse">
<tr><td style="color:#666">Zařízení</td><td><b>${esc(r.device_label)}</b></td></tr>
${oprava ? `<tr><td style="color:#666">Oprava</td><td><b>${esc(oprava)}</b></td></tr>` : ""}
<tr><td style="color:#666">Termín</td><td><b>${esc(kdy)}</b></td></tr>
</table>
<p>Kdybyste se nemohli dostavit, dejte nám prosím vědět.</p>
<p style="margin-top:20px"><b>${esc(nazev)}</b>${kontakt ? `<br>${esc(kontakt)}` : ""}</p>
<p style="color:#888;font-size:12px;margin-top:24px">Tento e-mail byl odeslán automaticky po vyplnění rezervačního formuláře na webu servisu.</p>
</div>`;
  try {
    const odp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [r.customer_email], reply_to: servis.email ?? undefined, subject: `${nazev}: rezervace přijata`, html }),
    });
    if (!odp.ok) console.warn("[public-booking] potvrzení zákazníkovi odmítnuto", odp.status, await odp.text().catch(() => ""));
  } catch (e) {
    console.warn("[public-booking] potvrzení zákazníkovi se neposlalo", e);
  }
}

function embedSkript(slug: string): string {
  // Přímo edge funkce, ne api.appjobi.com: rezervací je pár denně, cache
  // Workeru tu nic nepřinese a formulář funguje, i když Worker nemá cestu.
  const api = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;
  return `(function () {
  "use strict";
  var SLUG = ${JSON.stringify(slug)};
  var API = ${JSON.stringify(api)};
  var cil = document.getElementById("jobi-rezervace");
  if (!cil) { return; }
  function el(tag, attrs, deti) {
    var e = document.createElement(tag);
    for (var k in (attrs || {})) { if (k === "text") { e.textContent = attrs[k]; } else { e.setAttribute(k, attrs[k]); } }
    (deti || []).forEach(function (d) { e.appendChild(d); });
    return e;
  }
  function pole(nazev, name, typ, povinne, placeholder) {
    var input = el(typ === "textarea" ? "textarea" : "input", { name: name, placeholder: placeholder || "" });
    if (typ !== "textarea") { input.type = typ; }
    if (povinne) { input.required = true; }
    input.style.cssText = "width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid rgba(0,0,0,.2);border-radius:8px;font:inherit;background:transparent;color:inherit";
    var lab = el("label", {}, [el("span", { text: nazev + (povinne ? " *" : "") }), input]);
    lab.style.cssText = "display:grid;gap:4px;font-size:.9em";
    return { lab: lab, input: input };
  }
  // Ceník přes api.appjobi.com (cache); když není, napřímo. Bez ceníku formulář funguje s volným textem.
  function nactiCenik() {
    return fetch("https://api.appjobi.com/v1/catalog?service=" + encodeURIComponent(SLUG))
      .then(function (r) { if (!r.ok) { throw new Error(); } return r.json(); })
      .catch(function () {
        return fetch(API + "/public-catalog?service=" + encodeURIComponent(SLUG)).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
      });
  }
  Promise.all([
    fetch(API + "/public-booking?service=" + encodeURIComponent(SLUG)).then(function (r) { if (!r.ok) { throw new Error("nedostupné"); } return r.json(); }),
    nactiCenik(),
  ])
    .then(function (vysledky) {
      var n = vysledky[0];
      var cenik = vysledky[1];
      var form = el("form", { novalidate: "" });
      form.style.cssText = "display:grid;gap:12px;max-width:560px;font:inherit;color:inherit";
      if (n.uvod) { var p = el("p", { text: n.uvod }); p.style.margin = "0"; form.appendChild(p); }
      var jmeno = pole("Jméno a příjmení", "name", "text", true, "Jan Novák");
      var telefon = pole("Telefon", "phone", "tel", true, "+420 777 123 456");
      var email = pole("E-mail", "email", "email", false, "jan@email.cz");
      var zarizeni = pole("Zařízení", "device", "text", true, "např. iPhone 13, notebook Lenovo");
      var oprava = pole("Co je potřeba opravit", "repair", "text", false, "prasklý displej, nedrží baterie…");
      // Výběr z ceníku: model → opravy s cenou. Volný text zůstává, kdo model v ceníku nenajde.
      var modelSel = null, opravaSel = null, cenaInfo = null;
      var maCenik = cenik && cenik.models && cenik.models.length > 0 && cenik.repairs && cenik.repairs.length > 0;
      if (maCenik) {
        var znacky = {}; (cenik.brands || []).forEach(function (b) { znacky[b.id] = b.name; });
        var kategorie = {}; (cenik.categories || []).forEach(function (c) { kategorie[c.id] = c; });
        modelSel = el("select", { name: "model_id" }); modelSel.style.cssText = zarizeni.input.style.cssText;
        modelSel.appendChild(el("option", { value: "", text: "– vyberte model z ceníku (nepovinné) –" }));
        cenik.models.slice().sort(function (a, b) {
          var ka = kategorie[a.category_id] || {}, kb = kategorie[b.category_id] || {};
          return ((znacky[ka.brand_id] || "") + a.name).localeCompare((znacky[kb.brand_id] || "") + b.name, "cs");
        }).forEach(function (m) {
          var k = kategorie[m.category_id] || {}; var z = znacky[k.brand_id];
          modelSel.appendChild(el("option", { value: m.id, text: (z ? z + " " : "") + m.name }));
        });
        opravaSel = el("select", { name: "repair_id" }); opravaSel.style.cssText = zarizeni.input.style.cssText;
        opravaSel.disabled = true;
        opravaSel.appendChild(el("option", { value: "", text: "– nejdřív vyberte model –" }));
        cenaInfo = el("div", {}); cenaInfo.style.cssText = "font-size:.9em;opacity:.8";
        function fmt(c) { return (Math.round(c) === c ? c.toLocaleString("cs-CZ") : c.toLocaleString("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })) + " Kč"; }
        modelSel.addEventListener("change", function () {
          var mid = modelSel.value;
          while (opravaSel.firstChild) { opravaSel.removeChild(opravaSel.firstChild); }
          cenaInfo.textContent = "";
          if (!mid) { opravaSel.disabled = true; opravaSel.appendChild(el("option", { value: "", text: "– nejdřív vyberte model –" })); return; }
          var opr = cenik.repairs.filter(function (r) { return (r.model_ids || []).indexOf(mid) !== -1; });
          opravaSel.disabled = opr.length === 0;
          opravaSel.appendChild(el("option", { value: "", text: opr.length ? "– vyberte opravu (nepovinné) –" : "K tomuto modelu zatím nemáme ceník – popište závadu níže" }));
          opr.forEach(function (r) { opravaSel.appendChild(el("option", { value: r.id, text: r.name + (typeof r.price === "number" ? " – " + fmt(r.price) : "") })); });
          var m = cenik.models.filter(function (x) { return x.id === mid; })[0];
          if (m && !zarizeni.input.value.trim()) { var k = kategorie[m.category_id] || {}; zarizeni.input.value = (znacky[k.brand_id] ? znacky[k.brand_id] + " " : "") + m.name; }
        });
        opravaSel.addEventListener("change", function () {
          var r = cenik.repairs.filter(function (x) { return x.id === opravaSel.value; })[0];
          var casText = r && r.estimated_time_label ? " Oprava trvá cca " + r.estimated_time_label + "." : "";
          cenaInfo.textContent = r && typeof r.price === "number" ? "Předběžná cena podle ceníku: " + fmt(r.price) + (cenik.vat && cenik.vat.payer ? (cenik.vat.prices_include_vat ? " s DPH" : " bez DPH") : "") + "." + casText + " Konečnou cenu potvrdí servis po prohlídce." : (r ? casText.trim() : "");
          aktualizujHotovo();
          if (r && !oprava.input.value.trim()) { oprava.input.value = r.name; }
        });
      }
      var datum = pole("Kdy byste chtěli přijít", "date", "date", false, "");
      var cas = el("select", { name: "time" });
      cas.style.cssText = zarizeni.input.style.cssText;
      cas.appendChild(el("option", { value: "", text: "Kdykoliv během otevírací doby" }));
      (function () {
        var od = n.od.split(":"), doo = n.do.split(":");
        var m = parseInt(od[0], 10) * 60 + parseInt(od[1], 10), konec = parseInt(doo[0], 10) * 60 + parseInt(doo[1], 10);
        for (; m < konec; m += n.krokMin) {
          var t = (Math.floor(m / 60) < 10 ? "0" : "") + Math.floor(m / 60) + ":" + (m % 60 < 10 ? "0" : "") + (m % 60);
          cas.appendChild(el("option", { value: t, text: t }));
        }
      })();
      // Podle délky opravy z ceníku řekne, kdy bude zhruba hotovo – zákazník se rozhodne, jestli počká.
      var hotovoInfo = el("div", {}); hotovoInfo.style.cssText = "font-size:.85em;opacity:.75";
      function aktualizujHotovo() {
        hotovoInfo.textContent = "";
        if (!opravaSel || !opravaSel.value || !cas.value) { return; }
        var r = cenik.repairs.filter(function (x) { return x.id === opravaSel.value; })[0];
        var minut = r && typeof r.estimated_time === "number" ? r.estimated_time : 0;
        if (!minut) { return; }
        var casti = cas.value.split(":"); var m = parseInt(casti[0], 10) * 60 + parseInt(casti[1], 10) + minut;
        var konec = n.do.split(":"); var konecMin = parseInt(konec[0], 10) * 60 + parseInt(konec[1], 10);
        if (m > konecMin) { hotovoInfo.textContent = "Oprava by přesáhla otevírací dobu – zařízení bude k vyzvednutí další den, nebo zvolte dřívější čas."; return; }
        hotovoInfo.textContent = "Při příchodu v " + cas.value + " bude hotovo cca v " + (Math.floor(m / 60) < 10 ? "0" : "") + Math.floor(m / 60) + ":" + (m % 60 < 10 ? "0" : "") + (m % 60) + ".";
      }
      cas.addEventListener("change", aktualizujHotovo);
      var casLab = el("label", {}, [el("span", { text: "Čas" }), cas, hotovoInfo]);
      casLab.style.cssText = "display:grid;gap:4px;font-size:.9em";
      var pozn = pole("Poznámka", "note", "textarea", false, "");
      var past = el("input", { name: "web", type: "text", tabindex: "-1", autocomplete: "off" });
      past.style.cssText = "position:absolute;left:-9999px;width:1px;height:1px;opacity:0";
      var radek = el("div", {}, [datum.lab, casLab]);
      radek.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:12px";
      var tlacitko = el("button", { type: "submit", text: "Odeslat rezervaci" });
      tlacitko.style.cssText = "padding:12px 18px;border:none;border-radius:8px;background:#0e7c86;color:#fff;font:inherit;font-weight:700;cursor:pointer";
      var zprava = el("div", {}); zprava.style.cssText = "font-size:.9em";
      var poradi = [jmeno.lab, telefon.lab, email.lab];
      if (maCenik) {
        var modelLab = el("label", {}, [el("span", { text: "Model z ceníku" }), modelSel]); modelLab.style.cssText = "display:grid;gap:4px;font-size:.9em";
        var opravaLab = el("label", {}, [el("span", { text: "Oprava z ceníku" }), opravaSel]); opravaLab.style.cssText = "display:grid;gap:4px;font-size:.9em";
        poradi = poradi.concat([modelLab, opravaLab, cenaInfo]);
      }
      poradi.concat([zarizeni.lab, oprava.lab, radek, pozn.lab, past, tlacitko, zprava]).forEach(function (x) { form.appendChild(x); });
      var dnyTxt = ["", "Po", "Út", "St", "Čt", "Pá", "So", "Ne"];
      var info = el("p", { text: "Otevřeno: " + n.dny.map(function (d) { return dnyTxt[d]; }).join(", ") + " " + n.od + "–" + n.do + ". Rezervace je nezávazná, ozveme se vám s potvrzením." });
      info.style.cssText = "margin:0;font-size:.85em;opacity:.75";
      form.appendChild(info);
      form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        if (!jmeno.input.value.trim() || !telefon.input.value.trim() || !zarizeni.input.value.trim()) { zprava.textContent = "Vyplňte prosím jméno, telefon a zařízení."; zprava.style.color = "#b91c1c"; return; }
        var preferred = null;
        // Místní čas návštěvníka → ISO s časovou zónou, ať se termín neposune o offset.
        if (datum.input.value) { var dt = new Date(datum.input.value + "T" + (cas.value || n.od) + ":00"); preferred = isNaN(dt.getTime()) ? null : dt.toISOString(); }
        tlacitko.disabled = true; zprava.textContent = "Odesílám…"; zprava.style.color = "";
        fetch(API + "/public-booking", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          service: SLUG, name: jmeno.input.value, phone: telefon.input.value, email: email.input.value, device: zarizeni.input.value,
          repair: oprava.input.value, repair_id: opravaSel ? opravaSel.value : "", model_id: modelSel ? modelSel.value : "",
          preferred_at: preferred, note: pozn.input.value, web: past.value }) })
          .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, b: b }; }); })
          .then(function (res) {
            if (!res.ok) { throw new Error(res.b && res.b.error ? res.b.error : "Odeslání se nezdařilo"); }
            form.innerHTML = "";
            var ok = el("p", { text: "Děkujeme, rezervaci máme. Ozveme se vám na uvedený telefon nebo e-mail s potvrzením termínu." });
            ok.style.cssText = "margin:0;padding:12px 14px;border-radius:8px;background:rgba(14,124,134,.1)";
            form.appendChild(ok);
          })
          .catch(function (e) { tlacitko.disabled = false; zprava.textContent = e.message; zprava.style.color = "#b91c1c"; });
      });
      cil.innerHTML = ""; cil.appendChild(form);
    })
    .catch(function () { cil.textContent = "Online rezervace momentálně není dostupná. Zavolejte nám prosím."; });
})();`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  if (req.method === "GET") {
    const slug = (url.searchParams.get("service")?.trim().toLowerCase() ?? "").slice(0, 80);
    if (url.pathname.endsWith("/embed.js")) {
      return new Response(embedSkript(slug), { headers: { ...cors, "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=300" } });
    }
    const servis = await najdiServis(svc, slug);
    if (!servis) return json({ error: "Rezervace nejsou k dispozici" }, 404);
    const n = servis.nastaveni;
    return json({ service: servis.name, dny: n.dny, od: n.od, do: n.do, krokMin: n.krokMin, uvod: n.uvod }, 200, { "Cache-Control": "public, max-age=300" });
  }

  if (req.method !== "POST") return json({ error: "Podporováno je GET a POST" }, 405);

  let telo: Record<string, unknown>;
  try {
    telo = await req.json();
  } catch {
    return json({ error: "Tělo musí být JSON" }, 400);
  }
  // Skryté pole vyplní jen robot; odpovíme jako by se povedlo, ať nezkouší dál.
  if (s(telo.web, 10)) return json({ ok: true }, 201);

  const slug = s(telo.service, 80).toLowerCase();
  const servis = await najdiServis(svc, slug);
  if (!servis) return json({ error: "Rezervace nejsou k dispozici" }, 404);

  // Limit se započítá hned – i nevalidní pokusy stojí dotazy do databáze.
  const klic = await otiskKlienta(req);
  await Promise.all([svc.rpc("zapocitej_udalost", { p_kanal: "booking", p_klic: klic }), svc.rpc("zapocitej_udalost", { p_kanal: "booking", p_klic: `servis:${servis.id}` })]);
  const [zaKlic, zaServis] = await Promise.all([
    pocet(svc, "booking", klic, 60),
    pocet(svc, "booking", `servis:${servis.id}`, 60),
  ]);
  if (zaKlic > LIMIT_NA_KLIENTA_HOD || zaServis > LIMIT_NA_SERVIS_HOD) {
    return json({ error: "Příliš mnoho rezervací, zkuste to prosím později." }, 429, { "Retry-After": "3600" });
  }

  const name = s(telo.name, 120);
  const phone = s(telo.phone, 40);
  const email = s(telo.email, 160);
  const device = s(telo.device, 160);
  const repair = s(telo.repair, 200);
  const note = s(telo.note, 1000);
  if (name.length < 2) return json({ error: "Vyplňte jméno" }, 400);
  if (phone.replace(/\D/g, "").length < 9) return json({ error: "Vyplňte platný telefon" }, 400);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "E-mail nevypadá platně" }, 400);
  if (device.length < 2 && !s(telo.model_id, 40)) return json({ error: "Vyplňte zařízení" }, 400);
  // Oprava a model z ceníku – ověřují se v databázi, cena se bere odtud.
  let repairId: string | null = null;
  let repairName: string | null = repair || null;
  let priceEstimate: number | null = null;
  let durationMin: number | null = null;
  let modelName: string | null = null;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const rid = s(telo.repair_id, 40);
  if (rid && uuid.test(rid)) {
    const { data: r } = await svc.from("repairs").select("id, name, price, estimated_time").eq("id", rid).eq("service_id", servis.id).maybeSingle();
    if (r) {
      repairId = r.id;
      repairName = r.name;
      priceEstimate = typeof r.price === "number" ? r.price : Number(r.price) || null;
      durationMin = Number(r.estimated_time) > 0 ? Math.round(Number(r.estimated_time)) : null;
    }
  }
  const mid = s(telo.model_id, 40);
  if (mid && uuid.test(mid)) {
    const { data: m } = await svc.from("device_models").select("name").eq("id", mid).eq("service_id", servis.id).maybeSingle();
    if (m?.name) modelName = String(m.name);
  }
  let preferred: string | null = null;
  const p = s(telo.preferred_at, 40);
  if (p) {
    const d = new Date(p);
    if (Number.isNaN(d.getTime())) return json({ error: "Termín nevypadá platně" }, 400);
    // Minulost a víc než rok dopředu nedávají smysl (překlep v roce).
    if (d.getTime() < Date.now() - 60 * 60 * 1000) return json({ error: "Termín je v minulosti" }, 400);
    if (d.getTime() > Date.now() + 366 * 24 * 60 * 60 * 1000) return json({ error: "Termín je příliš daleko" }, 400);
    preferred = d.toISOString();
  }

  const radek = {
    service_id: servis.id, customer_name: name, customer_phone: phone, customer_email: email || null,
    device_label: device, repair_name: repairName, repair_id: repairId, model_name: modelName, price_estimate: priceEstimate, duration_min: durationMin,
    note: note || null, preferred_at: preferred, source: "web",
  };
  const { error } = await svc.from("bookings").insert(radek);
  if (error) {
    console.error("[public-booking] insert", error);
    return json({ error: "Rezervaci se nepodařilo uložit" }, 500);
  }
  await Promise.all([oznamServisu(servis, radek), potvrdZakaznikovi(servis, radek)]);
  return json({ ok: true }, 201);
});
