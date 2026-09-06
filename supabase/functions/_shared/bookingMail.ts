/**
 * E-maily kolem online rezervace: oznámení servisu a potvrzení zákazníkovi.
 *
 * Obojí se skládá z toho, co do formuláře na webu napsal někdo cizí – bez
 * přihlášení, bez omezení. Jméno „<img src=x onerror=…>“ se pak servisu
 * otevře v poště. Proto tyhle šablony žijí v `_shared`: je to jediná část
 * edge funkcí, kterou umí spustit i vitest, takže escapování hlídá test
 * nad **stejným** kódem, jaký e-maily opravdu skládá.
 *
 * Odesílání (Resend, klíče, síť) zůstává v public-booking – sem se nesmí
 * dostat nic, co by šlo poslat ven.
 */
import { escapeHtml as esc } from "./html.ts";

export type KontaktServisu = {
  name: string | null;
  email: string | null;
  telefon: string | null;
  adresa: string | null;
};

export type RezervaceMail = {
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  device_label: string;
  repair_name: string | null;
  model_name: string | null;
  price_estimate: number | null;
  preferred_at: string | null;
  note: string | null;
};

/** Termín v pražském čase; bez termínu se řekne, že si zákazník žádný nevybral. */
function kdyProServis(preferredAt: string | null): string {
  return preferredAt
    ? new Date(preferredAt).toLocaleString("cs-CZ", { timeZone: "Europe/Prague", dateStyle: "medium", timeStyle: "short" })
    : "kdykoliv";
}

function kdyProZakaznika(preferredAt: string | null): string {
  return preferredAt
    ? new Date(preferredAt).toLocaleString("cs-CZ", { timeZone: "Europe/Prague", dateStyle: "full", timeStyle: "short" })
    : "termín upřesníme po telefonu";
}

export function predmetServisu(r: RezervaceMail): string {
  return `Nová rezervace: ${r.customer_name} – ${r.device_label}`;
}

export function mailServisuHtml(r: RezervaceMail): string {
  const radky: Array<[string, string]> = [
    ["Zákazník", r.customer_name],
    ["Telefon", r.customer_phone],
    ["E-mail", r.customer_email ?? "—"],
    ["Zařízení", r.model_name ? `${r.device_label} (${r.model_name})` : r.device_label],
    ["Oprava", r.repair_name ? `${r.repair_name}${r.price_estimate ? ` – cca ${r.price_estimate.toLocaleString("cs-CZ")} Kč` : ""}` : "—"],
    ["Termín", kdyProServis(r.preferred_at)],
    ["Poznámka", r.note ?? "—"],
  ];
  const bunky = radky
    .map(([k, v]) => `<tr><td style="color:#666">${esc(k)}</td><td><b>${esc(v)}</b></td></tr>`)
    .join("");
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:14px;color:#111"><h2 style="margin:0 0 12px">Nová rezervace z webu</h2><table cellpadding="6">${bunky}</table><p style="color:#666;margin-top:16px">Rezervaci najdete v Jobi v Kalendáři – tam ji potvrdíte nebo z ní jedním kliknutím založíte zakázku.</p></div>`;
}

export function predmetZakaznikovi(servis: KontaktServisu): string {
  return `${servis.name ?? "servis"}: rezervace přijata`;
}

export function mailZakaznikoviHtml(servis: KontaktServisu, r: RezervaceMail): string {
  const nazev = servis.name ?? "servis";
  const oprava = r.repair_name
    ? `${r.repair_name}${r.price_estimate ? ` (předběžně cca ${r.price_estimate.toLocaleString("cs-CZ")} Kč, konečnou cenu potvrdíme po prohlídce)` : ""}`
    : null;
  const kontakt = [servis.telefon ? `tel. ${servis.telefon}` : "", servis.adresa ?? "", servis.email ?? ""]
    .filter(Boolean)
    .join(" · ");
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;color:#111;line-height:1.5">
<p>Dobrý den, ${esc(r.customer_name)},</p>
<p>děkujeme, vaši rezervaci máme. Ozveme se vám s potvrzením termínu.</p>
<table cellpadding="6" style="border-collapse:collapse">
<tr><td style="color:#666">Zařízení</td><td><b>${esc(r.device_label)}</b></td></tr>
${oprava ? `<tr><td style="color:#666">Oprava</td><td><b>${esc(oprava)}</b></td></tr>` : ""}
<tr><td style="color:#666">Termín</td><td><b>${esc(kdyProZakaznika(r.preferred_at))}</b></td></tr>
</table>
<p>Kdybyste se nemohli dostavit, dejte nám prosím vědět.</p>
<p style="margin-top:20px"><b>${esc(nazev)}</b>${kontakt ? `<br>${esc(kontakt)}` : ""}</p>
<p style="color:#888;font-size:12px;margin-top:24px">Tento e-mail byl odeslán automaticky po vyplnění rezervačního formuláře na webu servisu.</p>
</div>`;
}
