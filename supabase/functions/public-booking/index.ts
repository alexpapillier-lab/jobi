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
  // Styly jsou v jednom bloku s vlastní předponou, aby se nepotkaly se
  // stylem webu servisu. Barvy jdou přebít proměnnou --jobi-akcent.
  const styl = `
.jobi-rez{--jobi-akcent:#0e7c86;--jobi-ram:rgba(0,0,0,.14);--jobi-tlum:rgba(0,0,0,.55);--jobi-plocha:rgba(0,0,0,.02);font:inherit;color:inherit;max-width:640px;display:grid;gap:18px}
@media (prefers-color-scheme:dark){.jobi-rez{--jobi-ram:rgba(255,255,255,.18);--jobi-tlum:rgba(255,255,255,.65);--jobi-plocha:rgba(255,255,255,.04)}}
.jobi-rez *{box-sizing:border-box}
.jobi-rez__uvod{margin:0;color:var(--jobi-tlum);line-height:1.5}
.jobi-rez__blok{display:grid;gap:12px;padding:16px;border:1px solid var(--jobi-ram);border-radius:14px;background:var(--jobi-plocha)}
.jobi-rez__nadpis{font-weight:700;font-size:.95em;letter-spacing:.01em}
.jobi-rez__radek{display:grid;gap:12px;grid-template-columns:1fr 1fr}
@media (max-width:520px){.jobi-rez__radek{grid-template-columns:1fr}}
.jobi-rez__pole{display:grid;gap:6px;font-size:.9em}
.jobi-rez__pole>span{color:var(--jobi-tlum)}
.jobi-rez input[type=text],.jobi-rez input[type=tel],.jobi-rez input[type=email],.jobi-rez input[type=date],.jobi-rez select,.jobi-rez textarea{width:100%;padding:11px 12px;border:1px solid var(--jobi-ram);border-radius:10px;background:transparent;color:inherit;font:inherit;transition:border-color .15s,box-shadow .15s}
.jobi-rez input:focus,.jobi-rez select:focus,.jobi-rez textarea:focus{outline:none;border-color:var(--jobi-akcent);box-shadow:0 0 0 3px rgba(14,124,134,.18)}
.jobi-rez textarea{min-height:84px;resize:vertical}
.jobi-rez__opravy{display:grid;gap:8px}
.jobi-rez__oprava{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--jobi-ram);border-radius:10px;cursor:pointer}
.jobi-rez__oprava:hover{border-color:var(--jobi-akcent)}
.jobi-rez__oprava input{width:18px;height:18px;accent-color:var(--jobi-akcent);flex:0 0 auto}
.jobi-rez__oprava-nazev{flex:1;min-width:0}
.jobi-rez__oprava-cas{display:block;font-size:.82em;color:var(--jobi-tlum)}
.jobi-rez__oprava-cena{font-weight:700;white-space:nowrap}
.jobi-rez__souhrn{display:flex;justify-content:space-between;gap:12px;padding:12px;border-radius:10px;background:rgba(14,124,134,.1);font-size:.92em}
.jobi-rez__souhrn b{white-space:nowrap}
.jobi-rez__patka{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px}
.jobi-rez__odeslat{padding:13px 22px;border:none;border-radius:10px;background:var(--jobi-akcent);color:#fff;font:inherit;font-weight:700;cursor:pointer;transition:opacity .15s}
.jobi-rez__odeslat:disabled{opacity:.6;cursor:progress}
.jobi-rez__pozn{margin:0;font-size:.85em;color:var(--jobi-tlum);line-height:1.5}
.jobi-rez__chyba{color:#b91c1c;font-size:.9em}
.jobi-rez__hotovo{display:grid;gap:8px;padding:20px;border-radius:14px;background:rgba(14,124,134,.1)}
.jobi-rez__hotovo h3{margin:0;font-size:1.1em}
.jobi-rez__past{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}
`;
  return `(function () {
  "use strict";
  var SLUG = ${JSON.stringify(slug)};
  var API = ${JSON.stringify(api)};
  var cil = document.getElementById("jobi-rezervace");
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
    var obal = el("label", { class: "jobi-rez__pole" }, [el("span", { text: nazev + (povinne ? " *" : "") }), vstup]);
    return { obal: obal, vstup: vstup };
  }
  function blok(nadpis, deti) {
    return el("div", { class: "jobi-rez__blok" }, [el("div", { class: "jobi-rez__nadpis", text: nadpis })].concat(deti));
  }
  function fmt(c) {
    return (Math.round(c) === c ? c.toLocaleString("cs-CZ") : c.toLocaleString("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })) + " Kč";
  }
  function cas(minut) {
    if (!minut) { return ""; }
    if (minut < 60) { return minut + " min"; }
    var h = Math.floor(minut / 60), m = minut % 60;
    return h + " h" + (m ? " " + m + " min" : "");
  }

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
      var maCenik = cenik && cenik.models && cenik.models.length > 0 && cenik.repairs && cenik.repairs.length > 0;

      var form = el("form", { class: "jobi-rez", novalidate: "" });
      if (n.uvod) { form.appendChild(el("p", { class: "jobi-rez__uvod", text: n.uvod })); }

      // ── Kontakt ──────────────────────────────────────────────────────────
      var jmeno = pole("Jméno a příjmení", "text", "Jan Novák", true);
      var telefon = pole("Telefon", "tel", "+420 777 123 456", true);
      var email = pole("E-mail", "email", "jan@email.cz", false);
      form.appendChild(blok("Kontakt", [jmeno.obal, el("div", { class: "jobi-rez__radek" }, [telefon.obal, email.obal])]));

      // ── Zařízení a oprava ────────────────────────────────────────────────
      var zarizeni = pole("Zařízení", "text", "např. iPhone 13, notebook Lenovo", true);
      var popis = pole("Co je potřeba opravit", "text", "prasklý displej, nedrží baterie…", false);
      var modelSel = null, opravyBox = null, souhrn = null, vybrane = [];
      var deti = [];

      if (maCenik) {
        var znacky = {}; (cenik.brands || []).forEach(function (b) { znacky[b.id] = b.name; });
        var kategorie = {}; (cenik.categories || []).forEach(function (c) { kategorie[c.id] = c; });
        var m = pole("Model z ceníku", "select", "", false);
        modelSel = m.vstup;
        modelSel.appendChild(el("option", { value: "", text: "– vyberte model (nepovinné) –" }));
        cenik.models.slice().sort(function (a, b) {
          var ka = kategorie[a.category_id] || {}, kb = kategorie[b.category_id] || {};
          return ((znacky[ka.brand_id] || "") + a.name).localeCompare((znacky[kb.brand_id] || "") + b.name, "cs");
        }).forEach(function (mo) {
          var k = kategorie[mo.category_id] || {}; var z = znacky[k.brand_id];
          modelSel.appendChild(el("option", { value: mo.id, text: (z ? z + " " : "") + mo.name }));
        });
        opravyBox = el("div", { class: "jobi-rez__opravy" });
        souhrn = el("div", { class: "jobi-rez__souhrn" });
        souhrn.hidden = true;
        deti = [m.obal, opravyBox, souhrn, zarizeni.obal, popis.obal];
      } else {
        deti = [zarizeni.obal, popis.obal];
      }
      form.appendChild(blok("Zařízení a oprava", deti));

      // ── Termín ───────────────────────────────────────────────────────────
      var datum = pole("Kdy se vám to hodí", "date", "", false);
      var casSel = pole("Čas", "select", "", false);
      casSel.vstup.appendChild(el("option", { value: "", text: "Kdykoliv během otevírací doby" }));
      (function () {
        var od = n.od.split(":"), doo = n.do.split(":");
        var m2 = parseInt(od[0], 10) * 60 + parseInt(od[1], 10), konec = parseInt(doo[0], 10) * 60 + parseInt(doo[1], 10);
        for (; m2 < konec; m2 += n.krokMin) {
          var t = (Math.floor(m2 / 60) < 10 ? "0" : "") + Math.floor(m2 / 60) + ":" + (m2 % 60 < 10 ? "0" : "") + (m2 % 60);
          casSel.vstup.appendChild(el("option", { value: t, text: t }));
        }
      })();
      var hotovoInfo = el("p", { class: "jobi-rez__pozn" });
      var dnyTxt = ["", "Po", "Út", "St", "Čt", "Pá", "So", "Ne"];
      var oteviraci = el("p", { class: "jobi-rez__pozn", text: "Otevřeno: " + n.dny.map(function (d) { return dnyTxt[d]; }).join(", ") + " " + n.od + "–" + n.do + ". Rezervace je nezávazná, ozveme se vám s potvrzením." });
      form.appendChild(blok("Termín", [el("div", { class: "jobi-rez__radek" }, [datum.obal, casSel.obal]), hotovoInfo, oteviraci]));

      // ── Poznámka a odeslání ──────────────────────────────────────────────
      var poznVstup = el("textarea", { placeholder: "cokoliv, co bychom měli vědět dopředu", "aria-label": "Poznámka" });
      var pozn = { vstup: poznVstup };
      form.appendChild(blok("Poznámka", [poznVstup]));

      var past = el("input", { class: "jobi-rez__past", name: "web", type: "text", tabindex: "-1", autocomplete: "off" });
      var tlacitko = el("button", { type: "submit", class: "jobi-rez__odeslat", text: "Odeslat rezervaci" });
      var zprava = el("div", { class: "jobi-rez__chyba" });
      form.appendChild(el("div", { class: "jobi-rez__patka" }, [tlacitko, zprava]));
      form.appendChild(past);

      // ── Chování ceníku ───────────────────────────────────────────────────
      function opravyModelu(mid) {
        return cenik.repairs.filter(function (r) { return (r.model_ids || []).indexOf(mid) !== -1; });
      }
      function prepocitej() {
        var cena = 0, minut = 0;
        vybrane.forEach(function (r) { cena += typeof r.price === "number" ? r.price : 0; minut += typeof r.estimated_time === "number" ? r.estimated_time : 0; });
        souhrn.innerHTML = "";
        souhrn.hidden = vybrane.length === 0;
        if (vybrane.length > 0) {
          var levy = el("span", { text: vybrane.length === 1 ? "Vybraná oprava" : "Vybráno " + vybrane.length + " oprav" });
          var pravy = el("b", { text: (cena > 0 ? "cca " + fmt(cena) : "") + (minut ? (cena > 0 ? " · " : "") + cas(minut) : "") });
          souhrn.appendChild(levy); souhrn.appendChild(pravy);
        }
        if (!popis.vstup.value.trim() && vybrane.length > 0) {
          popis.vstup.placeholder = vybrane.map(function (r) { return r.name; }).join(" + ");
        }
        hotovo();
      }
      /* Odhad dokončení. Délka opravy se rozpočítá do otevírací doby: co se
         nevejde do dneška, pokračuje další otevřený den. Oprava na čtyři dny
         proto řekne konkrétní den, ne „další den“. Když u vybraných oprav
         není odhad délky, termín neslíbíme žádný. */
      function minuty(t) { var c = String(t || "").split(":"); return parseInt(c[0], 10) * 60 + parseInt(c[1], 10); }
      function hhmm(m) {
        var h = Math.floor(m / 60), mi = Math.round(m % 60);
        return (h < 10 ? "0" : "") + h + ":" + (mi < 10 ? "0" : "") + mi;
      }
      function jeOtevreno(d) {
        var iso = d.getDay() === 0 ? 7 : d.getDay();
        return n.dny.indexOf(iso) !== -1;
      }
      function hotovo() {
        hotovoInfo.textContent = "";
        if (vybrane.length === 0) { return; }
        var minut = 0, chybiOdhad = false;
        vybrane.forEach(function (r) {
          if (typeof r.estimated_time === "number" && r.estimated_time > 0) { minut += r.estimated_time; }
          else { chybiOdhad = true; }
        });
        if (!minut) {
          hotovoInfo.textContent = "U vybraných oprav nemáme odhad délky – termín dokončení potvrdíme, až zařízení uvidíme.";
          return;
        }
        if (!casSel.vstup.value || !datum.vstup.value) { return; }

        var odMin = minuty(n.od), doMin = minuty(n.do);
        var denKap = doMin - odMin;
        if (!(denKap > 0)) { return; }
        var zacatek = Math.max(minuty(casSel.vstup.value), odMin);
        var zbyva = minut;
        var den = new Date(datum.vstup.value + "T00:00:00");
        var konecMin = zacatek + zbyva;
        var dnuNavic = 0;
        var dnesVolno = doMin - zacatek;
        if (zbyva > dnesVolno) {
          zbyva -= Math.max(0, dnesVolno);
          var pojistka = 0;
          while (zbyva > 0 && pojistka < 400) {
            pojistka += 1;
            den.setDate(den.getDate() + 1);
            if (!jeOtevreno(den)) { continue; }
            dnuNavic += 1;
            if (zbyva <= denKap) { konecMin = odMin + zbyva; zbyva = 0; }
            else { zbyva -= denKap; }
          }
          if (zbyva > 0) { hotovoInfo.textContent = "Práce je zhruba na " + cas(minut) + " – termín dokončení s vámi domluvíme."; return; }
        }

        var pozn = chybiOdhad ? " U některých vybraných oprav odhad délky nemáme, může to trvat dél." : "";
        if (dnuNavic === 0) {
          hotovoInfo.textContent = "Při příchodu v " + casSel.vstup.value + " počítáme s dokončením kolem " + hhmm(konecMin) + "." + pozn;
          return;
        }
        var kdy = den.toLocaleDateString("cs-CZ", { weekday: "long", day: "numeric", month: "numeric" });
        hotovoInfo.textContent = "Práce je zhruba na " + cas(minut) + ". Při příchodu v " + casSel.vstup.value
          + " počítáme s dokončením v " + kdy + " kolem " + hhmm(konecMin) + "." + pozn;
      }
      if (maCenik) {
        modelSel.addEventListener("change", function () {
          vybrane = [];
          opravyBox.innerHTML = "";
          var mid = modelSel.value;
          if (!mid) { prepocitej(); return; }
          var opr = opravyModelu(mid);
          if (opr.length === 0) {
            opravyBox.appendChild(el("p", { class: "jobi-rez__pozn", text: "K tomuto modelu zatím nemáme ceník – popište závadu níže." }));
          } else {
            opravyBox.appendChild(el("p", { class: "jobi-rez__pozn", text: "Vyberte, co je potřeba. Můžete zaškrtnout i víc oprav." }));
            opr.forEach(function (r) {
              var check = el("input", {});
              check.type = "checkbox";
              var text = el("span", { class: "jobi-rez__oprava-nazev" }, [el("span", { text: r.name })]);
              if (typeof r.estimated_time === "number" && r.estimated_time > 0) { text.appendChild(el("span", { class: "jobi-rez__oprava-cas", text: "trvá cca " + cas(r.estimated_time) })); }
              var radek = el("label", { class: "jobi-rez__oprava" }, [check, text, el("span", { class: "jobi-rez__oprava-cena", text: typeof r.price === "number" ? fmt(r.price) : "" })]);
              check.addEventListener("change", function () {
                if (check.checked) { vybrane.push(r); } else { vybrane = vybrane.filter(function (x) { return x.id !== r.id; }); }
                prepocitej();
              });
              opravyBox.appendChild(radek);
            });
          }
          var mo = cenik.models.filter(function (x) { return x.id === mid; })[0];
          if (mo && !zarizeni.vstup.value.trim()) {
            var k = (cenik.categories || []).filter(function (c) { return c.id === mo.category_id; })[0] || {};
            var zn = (cenik.brands || []).filter(function (b) { return b.id === k.brand_id; })[0];
            zarizeni.vstup.value = (zn ? zn.name + " " : "") + mo.name;
          }
          prepocitej();
        });
      }
      casSel.vstup.addEventListener("change", hotovo);
      datum.vstup.addEventListener("change", hotovo);

      form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        if (!jmeno.vstup.value.trim() || !telefon.vstup.value.trim() || !zarizeni.vstup.value.trim()) {
          zprava.textContent = "Vyplňte prosím jméno, telefon a zařízení.";
          return;
        }
        var preferred = null;
        if (datum.vstup.value) {
          var dt = new Date(datum.vstup.value + "T" + (casSel.vstup.value || n.od) + ":00");
          preferred = isNaN(dt.getTime()) ? null : dt.toISOString();
        }
        tlacitko.disabled = true;
        var puvodni = tlacitko.textContent;
        tlacitko.textContent = "Odesílám…";
        zprava.textContent = "";
        fetch(API + "/public-booking", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            service: SLUG,
            name: jmeno.vstup.value,
            phone: telefon.vstup.value,
            email: email.vstup.value,
            device: zarizeni.vstup.value,
            repair: popis.vstup.value,
            repair_ids: vybrane.map(function (r) { return r.id; }),
            model_id: modelSel ? modelSel.value : "",
            preferred_at: preferred,
            note: pozn.vstup.value,
            web: past.value,
          }),
        })
          .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, b: b }; }); })
          .then(function (res) {
            if (!res.ok) { throw new Error(res.b && res.b.error ? res.b.error : "Odeslání se nezdařilo"); }
            var kdy = datum.vstup.value
              ? new Date(datum.vstup.value + "T" + (casSel.vstup.value || n.od) + ":00").toLocaleString("cs-CZ", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })
              : null;
            form.innerHTML = "";
            form.appendChild(el("div", { class: "jobi-rez__hotovo" }, [
              el("h3", { text: "Děkujeme, rezervaci máme." }),
              el("p", { class: "jobi-rez__pozn", text: kdy ? "Termín " + kdy + " vám potvrdíme telefonicky nebo e-mailem." : "Ozveme se vám s potvrzením termínu." }),
            ]));
          })
          .catch(function (e) {
            tlacitko.disabled = false;
            tlacitko.textContent = puvodni;
            zprava.textContent = e.message;
          });
      });

      cil.innerHTML = "";
      cil.appendChild(form);
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
      // Kratší cache: po úpravě formuláře se změna projeví do minuty, ne za pět.
      return new Response(embedSkript(slug), { headers: { ...cors, "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=60" } });
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
  // Zákazník může vybrat víc oprav najednou (displej i baterie).
  const vstupOprav: string[] = Array.isArray(telo.repair_ids)
    ? (telo.repair_ids as unknown[]).map((x) => s(x, 40)).filter((x) => uuid.test(x))
    : [];
  const rid = s(telo.repair_id, 40);
  if (rid && uuid.test(rid) && !vstupOprav.includes(rid)) vstupOprav.unshift(rid);
  let repairIds: string[] = [];
  if (vstupOprav.length > 0) {
    const { data: opravy } = await svc.from("repairs").select("id, name, price, estimated_time").eq("service_id", servis.id).in("id", vstupOprav.slice(0, 10));
    const nalezene = (opravy ?? []) as Array<{ id: string; name: string; price: number | string | null; estimated_time: number | null }>;
    // Pořadí podle toho, jak je zákazník vybral.
    const serazene = vstupOprav.map((id) => nalezene.find((o) => o.id === id)).filter((o): o is typeof nalezene[number] => !!o);
    if (serazene.length > 0) {
      repairIds = serazene.map((o) => o.id);
      repairId = serazene[0].id;
      repairName = serazene.map((o) => o.name).join(" + ");
      const cena = serazene.reduce((a, o) => a + (Number(o.price) || 0), 0);
      priceEstimate = cena > 0 ? Math.round(cena * 100) / 100 : null;
      const minut = serazene.reduce((a, o) => a + (Number(o.estimated_time) || 0), 0);
      durationMin = minut > 0 ? minut : null;
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
    device_label: device, repair_name: repairName, repair_id: repairId, repair_ids: repairIds.length > 0 ? repairIds : null, model_name: modelName, price_estimate: priceEstimate, duration_min: durationMin,
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
