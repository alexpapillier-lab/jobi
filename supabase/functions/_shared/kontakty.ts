/**
 * Adresář zákazníků pro telefon (CardDAV, jen pro čtení) – čistá logika.
 *
 * Převzato z ověřené implementace na servis.iswap (functions/lib/carddav.js,
 * iPhone s ní synchronizuje): stejné cesty, sync-token, multiget s atributy
 * v <href> a odpověď „bez změn“ při aktuálním tokenu. Tady bez sítě a
 * databáze – vstupem jsou karty z RPC kontakty_karty, výstupem odpověď.
 *
 *   /.well-known/carddav → /carddav/            (řeší Worker)
 *   /carddav/            principal
 *   /carddav/home/       domovská složka
 *   /carddav/home/zakaznici/<uid>.vcf
 */

export const BASE = "/carddav/";
export const HOME = "/carddav/home/";
export const BOOK = "/carddav/home/zakaznici/";
const NS = 'xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav" xmlns:cs="http://calendarserver.org/ns/"';
const SYNC_PREFIX = "https://api.appjobi.com/carddav/sync/";

export type KartaZakaznika = {
  id: string;
  jmeno: string;
  telefon?: string | null;
  email?: string | null;
  firma?: string | null;
  ico?: string | null;
  ulice?: string | null;
  mesto?: string | null;
  psc?: string | null;
  zeme?: string | null;
  zakazky?: Array<{ kod?: string | null; zarizeni?: string | null; prijato?: string | null }>;
};

export type Vizitka = { uid: string; vcard: string; etag: string };
export type DavOdpoved = { status: number; headers: Record<string, string>; body: string | null };

export function hashStr(s: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Telefon v mezinárodním tvaru; české a slovenské bez předvolby doplní. */
export function normTelefon(p: string | null | undefined): string {
  let d = String(p ?? "").replace(/[^\d+]/g, "");
  if (!d) return "";
  if (d.startsWith("00")) d = `+${d.slice(2)}`;
  if (/^\d{9}$/.test(d)) d = `+420${d}`;
  if (/^42[01]\d{9}$/.test(d)) d = `+${d}`;
  return d;
}

/** Escapování hodnoty vCard 3.0 (RFC 2426): \ , ; a nový řádek. */
export function esc(s: string | null | undefined): string {
  return String(s ?? "").replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function datum(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("cs-CZ", { timeZone: "Europe/Prague" });
}

export function vizitka(k: KartaZakaznika, servis: string): Vizitka {
  const uid = `jobi-${k.id}`;
  const jmeno = k.jmeno.trim();
  const casti = jmeno.split(/\s+/);
  const prijmeni = casti.length > 1 ? casti.pop()! : "";
  const krestni = casti.join(" ") || jmeno;
  const tel = normTelefon(k.telefon);
  const email = String(k.email ?? "").trim().toLowerCase();
  const zakazky = (k.zakazky ?? []).filter((z) => z && (z.kod || z.zarizeni));
  const posledni = zakazky[0];
  const adresa = [k.ulice, k.mesto, k.psc, k.zeme].some((x) => String(x ?? "").trim());
  const poznamka = [
    k.ico ? `IČO: ${k.ico}` : "",
    zakazky.length ? `Zakázky ${servis}:\n${zakazky.map((z) => [z.kod, z.zarizeni, datum(z.prijato)].filter(Boolean).join(" · ")).join("\n")}` : "",
  ].filter(Boolean).join("\n");
  const radky = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `UID:${uid}`,
    `FN:${esc(jmeno)}`,
    `N:${esc(prijmeni)};${esc(krestni)};;;`,
    `ORG:${esc(k.firma?.trim() ? k.firma.trim() : `Zákazník ${servis}`)}`,
    posledni ? `TITLE:${esc([posledni.zarizeni, posledni.kod].filter(Boolean).join(" · "))}` : null,
    tel ? `TEL;TYPE=CELL:${tel}` : null,
    email ? `EMAIL;TYPE=INTERNET:${esc(email)}` : null,
    adresa ? `ADR;TYPE=HOME:;;${esc(k.ulice)};${esc(k.mesto)};;${esc(k.psc)};${esc(k.zeme)}` : null,
    poznamka ? `NOTE:${esc(poznamka)}` : null,
    `CATEGORIES:${esc(`Zákazníci ${servis}`)}`,
    "END:VCARD",
  ].filter((x): x is string => !!x);
  const vcard = radky.join("\r\n") + "\r\n";
  return { uid, vcard, etag: hashStr(vcard) };
}

export function vizitky(karty: KartaZakaznika[], servis: string): Vizitka[] {
  return karty.filter((k) => k && k.id && String(k.jmeno ?? "").trim()).map((k) => vizitka(k, servis));
}

const xml = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function davHlavicky(): Record<string, string> {
  return { DAV: "1, 3, addressbook", Allow: "OPTIONS, GET, HEAD, PROPFIND, REPORT" };
}

function resp(href: string, props: string): string {
  return `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
}

function multistatus(responses: string[], extra = ""): DavOdpoved {
  return {
    status: 207,
    headers: { "Content-Type": "application/xml; charset=utf-8", ...davHlavicky() },
    body: `<?xml version="1.0" encoding="utf-8"?>\n<d:multistatus ${NS}>${responses.join("")}${extra}</d:multistatus>`,
  };
}

function stitekSbirky(karty: Vizitka[]): string {
  return "v1-" + (karty.length ? hashStr(karty.map((c) => c.etag).join("|")) : "empty");
}

function vlastnostiAdresare(karty: Vizitka[], nazev: string): string {
  const ctag = stitekSbirky(karty);
  return `<d:resourcetype><d:collection/><card:addressbook/></d:resourcetype>
    <d:displayname>${xml(nazev)}</d:displayname>
    <cs:getctag>${ctag}</cs:getctag>
    <d:sync-token>${SYNC_PREFIX}${ctag}</d:sync-token>
    <d:current-user-principal><d:href>${BASE}</d:href></d:current-user-principal>
    <d:current-user-privilege-set><d:privilege><d:read/></d:privilege></d:current-user-privilege-set>
    <card:supported-address-data><card:address-data-type content-type="text/vcard" version="3.0"/></card:supported-address-data>
    <d:supported-report-set><d:supported-report><d:report><d:sync-collection/></d:report></d:supported-report><d:supported-report><d:report><card:addressbook-multiget/></d:report></d:supported-report><d:supported-report><d:report><card:addressbook-query/></d:report></d:supported-report></d:supported-report-set>`;
}

/**
 * Odpověď na požadavek CardDAV. `karty` jsou null, když požadavek data
 * nepotřebuje (principal) – volající je pak nemusí načítat.
 */
export function odpovezDav(p: { metoda: string; cesta: string; depth: string; telo: string; karty: Vizitka[]; nazevAdresare: string }): DavOdpoved {
  const metoda = p.metoda.toUpperCase();
  const cesta = p.cesta.endsWith("/") || p.cesta.endsWith(".vcf") ? p.cesta : `${p.cesta}/`;
  const karty = p.karty;

  if (metoda === "OPTIONS") return { status: 200, headers: davHlavicky(), body: null };
  if (["PUT", "DELETE", "MKCOL", "MOVE", "COPY", "PROPPATCH", "LOCK", "UNLOCK"].includes(metoda)) {
    return { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" }, body: "Adresář je jen pro čtení – zákazníky upravte v Jobi." };
  }

  if (metoda === "GET" && cesta.endsWith(".vcf")) {
    const c = karty.find((x) => `${BOOK}${x.uid}.vcf` === cesta);
    if (!c) return { status: 404, headers: {}, body: "Not found" };
    return { status: 200, headers: { "Content-Type": "text/vcard; charset=utf-8", ETag: `"${c.etag}"` }, body: c.vcard };
  }

  if (metoda === "PROPFIND") {
    if (cesta === BASE) {
      return multistatus([resp(BASE, `<d:resourcetype><d:collection/><d:principal/></d:resourcetype>
        <d:displayname>Jobi</d:displayname>
        <d:current-user-principal><d:href>${BASE}</d:href></d:current-user-principal>
        <d:principal-URL><d:href>${BASE}</d:href></d:principal-URL>
        <card:addressbook-home-set><d:href>${HOME}</d:href></card:addressbook-home-set>`)]);
    }
    if (cesta === HOME) {
      const out = [resp(HOME, `<d:resourcetype><d:collection/></d:resourcetype><d:displayname>Jobi</d:displayname>
        <d:current-user-principal><d:href>${BASE}</d:href></d:current-user-principal>`)];
      if (p.depth !== "0") out.push(resp(BOOK, vlastnostiAdresare(karty, p.nazevAdresare)));
      return multistatus(out);
    }
    if (cesta === BOOK) {
      const out = [resp(BOOK, vlastnostiAdresare(karty, p.nazevAdresare))];
      if (p.depth !== "0") {
        for (const c of karty) out.push(resp(`${BOOK}${c.uid}.vcf`, `<d:getetag>"${c.etag}"</d:getetag><d:getcontenttype>text/vcard; charset=utf-8</d:getcontenttype><d:resourcetype/>`));
      }
      return multistatus(out);
    }
    if (cesta.startsWith(BOOK) && cesta.endsWith(".vcf")) {
      const c = karty.find((x) => `${BOOK}${x.uid}.vcf` === cesta);
      if (!c) return { status: 404, headers: {}, body: "Not found" };
      return multistatus([resp(cesta, `<d:getetag>"${c.etag}"</d:getetag><d:getcontenttype>text/vcard; charset=utf-8</d:getcontenttype><d:resourcetype/>`)]);
    }
    return { status: 404, headers: {}, body: "Not found" };
  }

  if (metoda === "REPORT" && cesta === BOOK) {
    const telo = p.telo;
    if (/sync-collection/i.test(telo)) {
      const sData = /address-data/i.test(telo);
      // Klient má aktuální stav (stejný token) → bez změn; jinak celý seznam (iPhone si porovná etagy).
      const token = (telo.match(/<(?:[a-zA-Z0-9]+:)?sync-token(?:\s[^>]*)?>([^<]*)</) || [])[1] || "";
      const aktualni = `${SYNC_PREFIX}${stitekSbirky(karty)}`;
      const polozky = token.trim() === aktualni ? [] : karty.map((c) =>
        `<d:response><d:href>${BOOK}${c.uid}.vcf</d:href><d:propstat><d:prop><d:getetag>"${c.etag}"</d:getetag>${sData ? `<card:address-data>${xml(c.vcard)}</card:address-data>` : ""}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`);
      return multistatus(polozky, `<d:sync-token>${aktualni}</d:sync-token>`);
    }
    let seznam = karty;
    if (/addressbook-multiget/i.test(telo)) {
      // iPhone posílá <A:href xmlns:A="DAV:">…</A:href> – tag může mít atributy.
      const hrefs = [...telo.matchAll(/<(?:[a-zA-Z0-9]+:)?href(?:\s[^>]*)?>([^<]+)<\/(?:[a-zA-Z0-9]+:)?href>/g)]
        .map((m) => decodeURIComponent(m[1].trim()).replace(/^https?:\/\/[^/]+/, ""));
      seznam = karty.filter((c) => hrefs.includes(`${BOOK}${c.uid}.vcf`));
    }
    return multistatus(seznam.map((c) => resp(`${BOOK}${c.uid}.vcf`, `<d:getetag>"${c.etag}"</d:getetag><card:address-data>${xml(c.vcard)}</card:address-data>`)));
  }

  if (metoda === "GET" || metoda === "HEAD") return { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", ...davHlavicky() }, body: "Jobi CardDAV" };
  return { status: 405, headers: davHlavicky(), body: "Method not allowed" };
}

/** Jméno a heslo z hlavičky Basic; null = chybí nebo je poškozená. */
export function prihlaseni(hlavicka: string | null | undefined): { login: string; heslo: string } | null {
  const h = String(hlavicka ?? "");
  if (!h.startsWith("Basic ")) return null;
  try {
    const text = new TextDecoder().decode(Uint8Array.from(atob(h.slice(6).trim()), (c) => c.charCodeAt(0)));
    const i = text.indexOf(":");
    if (i < 0) return null;
    return { login: text.slice(0, i).trim().toLowerCase(), heslo: text.slice(i + 1) };
  } catch {
    return null;
  }
}
