/**
 * Objednávky oprav z webu servisu – čistá logika sdílená edge funkcemi
 * (api-orders, api-webhooks, public-order-form) a aplikací.
 *
 *   - ověření a očištění položky z API (PATCH: mění se jen poslaná pole),
 *   - stav objednávky DB ↔ API,
 *   - sledovací čísla a odkazy na sledování zásilky,
 *   - tvar objednávky v odpovědi API,
 *   - podpis webhooku (HMAC-SHA256) a plán opakování,
 *   - výběr událostí při změně stavu zakázky (zrcadlo SQL triggeru).
 *
 * Bez Deno API (crypto.subtle je i v prohlížeči a v Node), aby to šlo
 * testovat z vitest – viz src/lib/objednavky.test.ts. Bez importů, ať se
 * soubor dá načíst z Dena i z Vite.
 */

// ── Stav ────────────────────────────────────────────────────────────────────

export type StavDb = "nova" | "na_ceste" | "dorazilo" | "prevedeno" | "zrusena";
export type StavApi = "new" | "in_transit" | "arrived" | "converted" | "cancelled";

/** Zrcadlo SQL funkce web_objednavka_stav_api. */
export const STAV_API: Record<StavDb, StavApi> = {
  nova: "new",
  na_ceste: "in_transit",
  dorazilo: "arrived",
  prevedeno: "converted",
  zrusena: "cancelled",
};

/** Stavy, které smí poslat API. „converted“ vzniká jen založením zakázky v Jobi. */
export const STAV_Z_API: Record<string, StavDb> = {
  new: "nova",
  in_transit: "na_ceste",
  arrived: "dorazilo",
  cancelled: "zrusena",
};

/** Objednávka, se kterou se ještě dá pracovat (není převedená ani zrušená). */
export const jeOtevrena = (stav: string): boolean => stav === "nova" || stav === "na_ceste" || stav === "dorazilo";

export const POPIS_STAVU: Record<StavDb, string> = {
  nova: "Nová",
  na_ceste: "Na cestě",
  dorazilo: "Dorazilo",
  prevedeno: "Zakázka založena",
  zrusena: "Zrušená",
};

// ── Události webhooku ───────────────────────────────────────────────────────

export const UDALOSTI = ["order.converted", "ticket.status_changed", "ticket.completed", "order.cancelled"] as const;
export type Udalost = (typeof UDALOSTI)[number];

export const POPIS_UDALOSTI: Record<Udalost, string> = {
  "order.converted": "Z objednávky vznikla zakázka",
  "ticket.status_changed": "Zakázka změnila stav",
  "ticket.completed": "Zakázka je hotová (koncový stav)",
  "order.cancelled": "Servis objednávku zrušil",
};

/**
 * Které události vzniknou při změně stavu zakázky navázané na objednávku.
 * Zrcadlo triggeru tickets_webhook_objednavky (migrace 20261013100000):
 * změna stavu vždy, „hotovo“ jen při přechodu z nekoncového do koncového.
 */
export function udalostiZmenyStavu(staryStav: string | null, novyStav: string | null, jeKoncovy: (klic: string) => boolean): Udalost[] {
  if (!novyStav || staryStav === novyStav) return [];
  const out: Udalost[] = ["ticket.status_changed"];
  if (jeKoncovy(novyStav) && !(staryStav && jeKoncovy(staryStav))) out.push("ticket.completed");
  return out;
}

/**
 * Poslat událost? Zkušební „ping“ vždy; ostatní jen při zapnutém webhooku,
 * který ji (pořád) odebírá – odběr se mohl změnit, než fronta došla na řadu.
 */
export function maOdeslat(udalost: string, odebirane: readonly string[] | null | undefined, aktivni: boolean | null | undefined): boolean {
  if (udalost === "ping") return true;
  return aktivni === true && Array.isArray(odebirane) && odebirane.includes(udalost);
}

/** Celkem pokusů (1 + 3 opakování) a pauzy po 1., 2. a 3. neúspěchu. */
export const MAX_POKUSU = 4;
export const PAUZY_OPAKOVANI_MIN = [1, 5, 30] as const;

/**
 * Kdy to zkusit znovu po neúspěšném pokusu číslo `pokus` (1 = první).
 * null = vzdát, víc pokusů nebude.
 */
export function naplanujOpakovani(pokus: number, ted: Date = new Date()): Date | null {
  if (!Number.isFinite(pokus) || pokus < 1 || pokus >= MAX_POKUSU) return null;
  const pauza = PAUZY_OPAKOVANI_MIN[Math.min(pokus, PAUZY_OPAKOVANI_MIN.length) - 1];
  return new Date(ted.getTime() + pauza * 60_000);
}

/**
 * Má smysl to zkoušet znovu? 4xx kromě 408/429 je chyba příjemce (špatná
 * adresa, odmítnutý podpis) a opakováním se nespraví.
 */
export function maSmyslOpakovat(httpStatus: number | null): boolean {
  if (!httpStatus) return true; // výpadek sítě, časový limit
  if (httpStatus === 408 || httpStatus === 429) return true;
  return httpStatus >= 500;
}

// ── Podpis ──────────────────────────────────────────────────────────────────

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Hodnota hlavičky X-Jobi-Signature: `sha256=<hex HMAC-SHA256 těla>`. */
export async function podpisWebhooku(tajemstvi: string, telo: string): Promise<string> {
  const enc = new TextEncoder();
  const klic = await crypto.subtle.importKey("raw", enc.encode(tajemstvi), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `sha256=${hex(await crypto.subtle.sign("HMAC", klic, enc.encode(telo)))}`;
}

/** Ověření na straně příjemce (stejný postup jako v dokumentaci), porovnání v konstantním čase. */
export async function overPodpisWebhooku(tajemstvi: string, telo: string, hlavicka: string | null | undefined): Promise<boolean> {
  if (!hlavicka) return false;
  const ocekavany = await podpisWebhooku(tajemstvi, telo);
  if (ocekavany.length !== hlavicka.length) return false;
  let rozdil = 0;
  for (let i = 0; i < ocekavany.length; i++) rozdil |= ocekavany.charCodeAt(i) ^ hlavicka.charCodeAt(i);
  return rozdil === 0;
}

// ── Sledování zásilek ───────────────────────────────────────────────────────

export type Dopravce = "dpd" | "zasilkovna" | "ppl" | "gls" | "ceska_posta" | "balikovna" | "jiny";

export type SledovaciCislo = {
  dopravce: Dopravce;
  cislo: string;
  /** „tam“ = zákazník → servis, „zpet“ = servis → zákazník. */
  smer: "tam" | "zpet" | null;
  url: string | null;
};

const bezDiakritiky = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** „DPD“, „Zásilkovna“, „Packeta“, „Česká pošta“… → klíč dopravce. */
export function normalizujDopravce(vstup: unknown): Dopravce {
  const s = typeof vstup === "string" ? bezDiakritiky(vstup).toLowerCase().trim() : "";
  if (!s) return "jiny";
  if (s.includes("dpd")) return "dpd";
  if (s.includes("zasilkovna") || s.includes("packeta") || s.includes("z-box") || s.includes("zbox")) return "zasilkovna";
  if (s.includes("ppl")) return "ppl";
  if (s.includes("gls")) return "gls";
  if (s.includes("balikovna")) return "balikovna";
  if (s.includes("posta") || s.includes("cpost")) return "ceska_posta";
  return "jiny";
}

export const NAZEV_DOPRAVCE: Record<Dopravce, string> = {
  dpd: "DPD",
  zasilkovna: "Zásilkovna",
  ppl: "PPL",
  gls: "GLS",
  ceska_posta: "Česká pošta",
  balikovna: "Balíkovna",
  jiny: "Doprava",
};

/** Odkaz na veřejné sledování zásilky; u neznámého dopravce null. */
export function odkazSledovani(dopravce: Dopravce, cislo: string): string | null {
  const c = encodeURIComponent(cislo.trim());
  if (!c) return null;
  switch (dopravce) {
    case "dpd": return `https://tracking.dpd.de/status/cs_CZ/parcel/${c}`;
    case "zasilkovna": return `https://tracking.packeta.com/cs/?id=${c}`;
    case "ppl": return `https://www.ppl.cz/vyhledat-zasilku?shipmentId=${c}`;
    case "gls": return `https://gls-group.eu/CZ/cs/sledovani-zasilek?match=${c}`;
    case "ceska_posta":
    case "balikovna": return `https://www.postaonline.cz/trackandtrace/-/zasilka/cislo?parcelNumbers=${c}`;
    default: return null;
  }
}

/** Odkaz pro řádek uloženého sledovacího čísla: vlastní https odkaz, jinak podle dopravce. */
export function odkazProCislo(s: Partial<SledovaciCislo> | null | undefined): string | null {
  if (!s || typeof s.cislo !== "string" || !s.cislo.trim()) return null;
  if (typeof s.url === "string" && /^https:\/\//i.test(s.url)) return s.url;
  return odkazSledovani((s.dopravce as Dopravce) ?? "jiny", s.cislo);
}

// ── Ověření položky z API ───────────────────────────────────────────────────

export const MAX_OBJEDNAVEK = 50;
export const MAX_TELO_BAJTU = 512 * 1024;
export const MAX_DATA_BAJTU = 20 * 1024;

const JE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Řídicí znaky (kromě tabulátoru a konce řádku) do textu nepatří.
// eslint-disable-next-line no-control-regex
const RIDICI = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

const jeObjekt = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

export type PolozkaObjednavky = {
  externiCislo: string;
  /** Sloupce web_objednavky k zápisu (jen poslaná pole; null = smazat hodnotu). */
  hodnoty: Record<string, unknown>;
  /** Požadovaný stav, když ho volající poslal. */
  stav?: StavDb;
  /** Obrázek podpisu ze `consent.signature_image` – nahrává ho edge funkce do úložiště. */
  podpis?: ObrazekPodpisu;
};

// ── Elektronické odsouhlasení (consent) ─────────────────────────────────────

export const METODY_SOUHLASU = ["checkbox", "drawn", "sms_code", "email_code", "bankid", "other"] as const;
export type MetodaSouhlasu = (typeof METODY_SOUHLASU)[number];

/** Jak zákazník souhlas projevil – do tisku a detailu zakázky. */
export const POPIS_METODY: Record<MetodaSouhlasu, string> = {
  checkbox: "zaškrtnutím souhlasu",
  drawn: "podpisem na displeji",
  sms_code: "kódem z SMS",
  email_code: "kódem z e-mailu",
  bankid: "přes BankID",
  other: "jiným způsobem",
};

export const MAX_PODPIS_BAJTU = 200 * 1024;

export type ObrazekPodpisu =
  | { typ: "data"; bajty: Uint8Array; mime: "image/png" | "image/jpeg" }
  | { typ: "url"; url: string };

/** Souhlas tak, jak se ukládá do web_objednavky.souhlas (a kopíruje na zakázku). */
export type Souhlas = {
  id: string;
  signed_at: string;
  method: MetodaSouhlasu;
  signer_name?: string;
  ip?: string;
  user_agent?: string;
  terms_version?: string;
  document_version?: string;
  text_hash?: string;
  terms_url?: string;
  /** Kdy souhlas přišel do Jobi (server). */
  received_at?: string;
  /** Identifikátor obrázku podpisu v úložišti (veřejný tvar URL, čte se přes podepsaný odkaz). */
  signature_url?: string;
};

/** PNG / JPEG podle prvních bajtů – přípona ani hlavička se nedají věřit. */
export function typObrazku(b: Uint8Array): "image/png" | "image/jpeg" | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  return null;
}

function base64NaBajty(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64.replace(/\s+/g, ""));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

const JE_IP = /^[0-9a-fA-F:.]{2,64}$/;

/**
 * Ověří `consent` z API. Vrací očištěný souhlas a případný obrázek podpisu,
 * nebo text chyby. Povinné je `id` (vaše ID odsouhlasení) a `signed_at`.
 */
export function overSouhlas(vstup: unknown, ted: Date = new Date()): { souhlas: Souhlas; podpis?: ObrazekPodpisu } | string {
  if (!jeObjekt(vstup)) return "musí být objekt";
  const c = vstup;
  const t = (klic: string, max: number): string | undefined | null => {
    const v = c[klic];
    if (v === undefined || v === null || v === "") return undefined;
    if (typeof v !== "string" && typeof v !== "number") return null;
    const s = String(v).trim();
    if (!s) return undefined;
    if (s.length > max || RIDICI.test(s)) return null;
    return s;
  };
  const id = t("id", 100);
  if (id === null) return "id je delší než 100 znaků nebo obsahuje neplatné znaky";
  if (!id) return "chybí id (vaše ID odsouhlasení)";
  const kdyText = t("signed_at", 40);
  if (!kdyText) return "chybí signed_at (čas odsouhlasení, ISO 8601)";
  const kdy = new Date(kdyText);
  if (Number.isNaN(kdy.getTime()) || !/^\d{4}-\d{2}-\d{2}T/.test(kdyText)) return "signed_at musí být čas ve formátu ISO 8601";
  if (kdy.getTime() > ted.getTime() + 24 * 3600_000) return "signed_at je v budoucnosti";

  let metoda: MetodaSouhlasu;
  const m = t("method", 30);
  if (m === null) return "method není platná";
  if (m) {
    if (!(METODY_SOUHLASU as readonly string[]).includes(m)) return `method musí být ${METODY_SOUHLASU.join(", ")}`;
    metoda = m as MetodaSouhlasu;
  } else {
    metoda = c.signature_image ? "drawn" : "checkbox";
  }

  const souhlas: Souhlas = { id, signed_at: kdy.toISOString(), method: metoda };
  for (const [klic, max] of [["signer_name", 200], ["user_agent", 500], ["terms_version", 100], ["document_version", 100], ["text_hash", 200]] as const) {
    const v = t(klic, max);
    if (v === null) return `${klic} je delší než ${max} znaků nebo obsahuje neplatné znaky`;
    if (v) souhlas[klic] = v;
  }
  const ip = t("ip", 64);
  if (ip === null || (ip && !JE_IP.test(ip))) return "ip musí být adresa IPv4 nebo IPv6";
  if (ip) souhlas.ip = ip;
  const odkaz = t("terms_url", 500);
  if (odkaz === null || (odkaz && !/^https:\/\/\S+$/i.test(odkaz))) return "terms_url musí být https odkaz";
  if (odkaz) souhlas.terms_url = odkaz;

  const obr = c.signature_image;
  if (obr === undefined || obr === null || obr === "") return { souhlas };
  if (typeof obr !== "string") return "signature_image musí být data URL nebo https odkaz";
  const data = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=\s]+)$/.exec(obr);
  if (data) {
    const bajty = base64NaBajty(data[2]);
    if (!bajty) return "signature_image nejde přečíst (base64)";
    if (bajty.length > MAX_PODPIS_BAJTU) return `signature_image má ${Math.round(bajty.length / 1024)} kB, limit je 200 kB`;
    const mime = typObrazku(bajty);
    if (!mime) return "signature_image musí být PNG nebo JPEG";
    return { souhlas, podpis: { typ: "data", bajty, mime } };
  }
  if (/^https:\/\/\S+$/i.test(obr) && obr.length <= 1000) return { souhlas, podpis: { typ: "url", url: obr } };
  return "signature_image musí být data:image/png;base64,… / data:image/jpeg;base64,… nebo https odkaz";
}

/**
 * Souhlas k uložení vedle toho, co už objednávka má. Stejné ID = stejný
 * souhlas: zůstane čas přijetí i nahraný obrázek (opakované odeslání nic
 * nemění a obrázek se nenahrává znovu). Jiné ID = nový souhlas.
 */
export function slucSouhlas(stavajici: unknown, novy: Souhlas, ted: Date = new Date()): { souhlas: Souhlas; stejny: boolean } {
  const s = jeObjekt(stavajici) ? (stavajici as Souhlas) : null;
  if (s && s.id === novy.id) {
    return { souhlas: { ...novy, received_at: s.received_at ?? ted.toISOString(), ...(s.signature_url ? { signature_url: s.signature_url } : {}) }, stejny: true };
  }
  return { souhlas: { ...novy, received_at: ted.toISOString() }, stejny: false };
}

export type VysledekOvereni = { ok: true; polozka: PolozkaObjednavky } | { ok: false; chyba: string };

/**
 * Ověří a očistí jednu objednávku z těla `POST /v1/orders`.
 *
 * Do databáze jde jen to, co je tady vyjmenované (ne celý objekt od
 * klienta – jinak by šlo přepsat service_id nebo ticket_id). Vazby
 * (branch_id, model_id, repair_id) projdou jen tvarem; že patří servisu,
 * ověří edge funkce. Pole, které v těle chybí, se nemění; `null` hodnotu
 * smaže. Text se ořízne o mezery, prázdný text = null.
 */
export function overObjednavku(vstup: unknown, prefix: string): VysledekOvereni {
  if (!jeObjekt(vstup)) return { ok: false, chyba: `${prefix}: položka musí být objekt` };
  const r = vstup;
  const ext = typeof r.external_id === "string" ? r.external_id.trim() : typeof r.external_id === "number" ? String(r.external_id) : "";
  if (!ext) return { ok: false, chyba: `${prefix}: chybí external_id` };
  if (ext.length > 100) return { ok: false, chyba: `${prefix}: external_id je delší než 100 znaků` };
  if (RIDICI.test(ext)) return { ok: false, chyba: `${prefix}: external_id obsahuje neplatné znaky` };

  const h: Record<string, unknown> = {};
  let chyba: string | null = null;
  const fail = (msg: string) => { if (!chyba) chyba = `${prefix}: ${msg}`; };

  /** Text do sloupce; `undefined` v těle = beze změny. */
  const text = (obj: Record<string, unknown>, klic: string, cesta: string, sloupec: string, max: number) => {
    if (!(klic in obj)) return;
    const v = obj[klic];
    if (v === null) { h[sloupec] = null; return; }
    if (typeof v !== "string" && typeof v !== "number") { fail(`${cesta} musí být text`); return; }
    const s = String(v).trim();
    if (s.length > max) { fail(`${cesta} je delší než ${max} znaků`); return; }
    if (RIDICI.test(s)) { fail(`${cesta} obsahuje neplatné znaky`); return; }
    h[sloupec] = s || null;
  };
  const uuid = (obj: Record<string, unknown>, klic: string, cesta: string, sloupec: string) => {
    if (!(klic in obj)) return;
    const v = obj[klic];
    if (v === null || v === "") { h[sloupec] = null; return; }
    if (typeof v !== "string" || !JE_UUID.test(v)) { fail(`${cesta} musí být UUID`); return; }
    h[sloupec] = v.toLowerCase();
  };

  if ("status" in r && r.status !== undefined && r.status !== null) {
    const s = typeof r.status === "string" ? STAV_Z_API[r.status.trim()] : undefined;
    if (!s) fail(`status musí být new, in_transit, arrived nebo cancelled`);
  }
  text(r, "source", "source", "zdroj", 80);
  uuid(r, "branch_id", "branch_id", "branch_id");

  if ("customer" in r && r.customer !== null) {
    if (!jeObjekt(r.customer)) fail("customer musí být objekt");
    else {
      const c = r.customer;
      text(c, "name", "customer.name", "zakaznik_jmeno", 200);
      text(c, "phone", "customer.phone", "zakaznik_telefon", 40);
      text(c, "email", "customer.email", "zakaznik_email", 200);
      if (typeof h.zakaznik_email === "string" && !JE_EMAIL.test(h.zakaznik_email)) fail("customer.email nevypadá platně");
      text(c, "company", "customer.company", "zakaznik_firma", 200);
      text(c, "ico", "customer.ico", "zakaznik_ico", 20);
      text(c, "dic", "customer.dic", "zakaznik_dic", 20);
      if ("address" in c && c.address !== null) {
        if (typeof c.address === "string") text(c, "address", "customer.address", "zakaznik_ulice", 200);
        else if (!jeObjekt(c.address)) fail("customer.address musí být objekt nebo text");
        else {
          text(c.address, "street", "customer.address.street", "zakaznik_ulice", 200);
          text(c.address, "city", "customer.address.city", "zakaznik_mesto", 120);
          text(c.address, "zip", "customer.address.zip", "zakaznik_psc", 20);
        }
      } else if ("address" in c) {
        h.zakaznik_ulice = null; h.zakaznik_mesto = null; h.zakaznik_psc = null;
      }
    }
  }

  if ("device" in r && r.device !== null) {
    if (typeof r.device === "string") text(r, "device", "device", "zarizeni", 200);
    else if (!jeObjekt(r.device)) fail("device musí být objekt nebo text");
    else {
      const d = r.device;
      text(d, "name", "device.name", "zarizeni", 200);
      uuid(d, "model_id", "device.model_id", "model_id");
      // `serial` i `imei` – formuláře to pojmenovávají různě.
      if ("serial" in d) text(d, "serial", "device.serial", "sn_imei", 100);
      else text(d, "imei", "device.imei", "sn_imei", 100);
      text(d, "passcode", "device.passcode", "heslo_zarizeni", 100);
      text(d, "accessories", "device.accessories", "prislusenstvi", 500);
    }
  }

  text(r, "issue", "issue", "popis_zavady", 4000);
  text(r, "requested_repair", "requested_repair", "pozadovana_oprava", 1000);
  uuid(r, "repair_id", "repair_id", "repair_id");
  text(r, "note", "note", "poznamka", 4000);

  if ("shipping" in r && r.shipping !== null) {
    if (!jeObjekt(r.shipping)) fail("shipping musí být objekt");
    else {
      const s = r.shipping;
      text(s, "inbound", "shipping.inbound", "doprava_tam", 100);
      text(s, "outbound", "shipping.outbound", "doprava_zpet", 100);
      for (const [klic, sloupec] of [["pickup_point", "vydejni_misto"], ["return_address", "adresa_zpet"]] as const) {
        if (!(klic in s)) continue;
        const v = s[klic];
        if (jeObjekt(v)) {
          // { id, name, street, city, zip } → jeden řádek textu.
          const casti = ["name", "street", "city", "zip", "id"].map((k) => (typeof v[k] === "string" || typeof v[k] === "number" ? String(v[k]).trim() : "")).filter(Boolean);
          const t = casti.join(", ");
          if (t.length > 500) fail(`shipping.${klic} je moc dlouhé`);
          else h[sloupec] = t || null;
        } else text(s, klic, `shipping.${klic}`, sloupec, 500);
      }
      if ("tracking" in s) {
        const sc = overSledovaciCisla(s.tracking, s);
        if (typeof sc === "string") fail(`shipping.tracking: ${sc}`);
        else h.sledovaci_cisla = sc;
      }
    }
  }

  let podpis: ObrazekPodpisu | undefined;
  if ("consent" in r) {
    if (r.consent === null) h.souhlas = null;
    else {
      const v = overSouhlas(r.consent);
      if (typeof v === "string") fail(`consent: ${v}`);
      else {
        h.souhlas = v.souhlas;
        podpis = v.podpis;
      }
    }
  }

  if ("data" in r) {
    if (r.data === null) h.data = {};
    else if (!jeObjekt(r.data)) fail("data musí být objekt");
    else {
      const bajty = new TextEncoder().encode(JSON.stringify(r.data)).length;
      if (bajty > MAX_DATA_BAJTU) fail(`data má ${Math.round(bajty / 1024)} kB, limit je 20 kB`);
      else h.data = r.data;
    }
  }

  if (chyba) return { ok: false, chyba };
  const stav = typeof r.status === "string" ? STAV_Z_API[r.status.trim()] : undefined;
  return { ok: true, polozka: { externiCislo: ext, hodnoty: h, ...(stav ? { stav } : {}), ...(podpis ? { podpis } : {}) } };
}

/**
 * Sledovací čísla: pole `{ carrier, number, direction, url }` (nebo jen
 * řetězců). Dopravce bez `carrier` se odhadne podle směru z `inbound`
 * / `outbound`. Vrací text chyby, nebo očištěné pole.
 */
export function overSledovaciCisla(vstup: unknown, doprava?: Record<string, unknown>): SledovaciCislo[] | string {
  if (vstup === null) return [];
  if (!Array.isArray(vstup)) return "musí být pole";
  if (vstup.length > 20) return "nejvýš 20 čísel";
  const out: SledovaciCislo[] = [];
  for (const [i, x] of vstup.entries()) {
    const o = typeof x === "string" ? { number: x } : x;
    if (!jeObjekt(o)) return `[${i}] musí být objekt`;
    const cislo = typeof o.number === "string" || typeof o.number === "number" ? String(o.number).trim() : "";
    if (!cislo) return `[${i}] chybí number`;
    if (cislo.length > 60 || RIDICI.test(cislo)) return `[${i}] number není platné`;
    const smerVstup = typeof o.direction === "string" ? o.direction.trim().toLowerCase() : "";
    const smer: SledovaciCislo["smer"] = smerVstup === "inbound" || smerVstup === "tam" ? "tam" : smerVstup === "outbound" || smerVstup === "return" || smerVstup === "zpet" ? "zpet" : null;
    if (smerVstup && !smer) return `[${i}] direction musí být inbound nebo outbound`;
    const odhad = smer === "tam" ? doprava?.inbound : smer === "zpet" ? doprava?.outbound : undefined;
    const dopravce = normalizujDopravce(typeof o.carrier === "string" && o.carrier.trim() ? o.carrier : odhad);
    let url: string | null = null;
    if (typeof o.url === "string" && o.url.trim()) {
      const u = o.url.trim();
      if (!/^https:\/\/[^\s]+$/i.test(u) || u.length > 500) return `[${i}] url musí být https odkaz`;
      url = u;
    }
    out.push({ dopravce, cislo, smer, url: url ?? odkazSledovani(dopravce, cislo) });
  }
  return out;
}

// ── Odpověď API ─────────────────────────────────────────────────────────────

export type RadekObjednavky = {
  externi_cislo: string;
  stav: string;
  zdroj: string | null;
  zakaznik_jmeno?: string | null;
  zarizeni?: string | null;
  sledovaci_cisla?: unknown;
  created_at: string;
  updated_at: string;
  dorazilo_at?: string | null;
  prevedeno_at?: string | null;
  souhlas?: unknown;
};

export type ZakazkaApi = {
  code: string | null;
  status: { key: string; label: string; is_final: boolean };
  total: number | null;
  updated_at: string;
} | null;

/** Reklamace, na kterou se objednávka převedla (místo zakázky). */
export type ReklamaceApi = { code: string | null } | null;

/** Objednávka tak, jak ji vrací `GET /v1/orders`. */
export function objednavkaProApi(o: RadekObjednavky, zakazka: ZakazkaApi, reklamace: ReklamaceApi = null) {
  const sc = Array.isArray(o.sledovaci_cisla) ? (o.sledovaci_cisla as SledovaciCislo[]) : [];
  return {
    external_id: o.externi_cislo,
    status: STAV_API[o.stav as StavDb] ?? o.stav,
    source: o.zdroj,
    customer: { name: o.zakaznik_jmeno ?? null },
    device: { name: o.zarizeni ?? null },
    tracking: sc.map((s) => ({
      carrier: s.dopravce,
      number: s.cislo,
      direction: s.smer === "tam" ? "inbound" : s.smer === "zpet" ? "outbound" : null,
      url: odkazProCislo(s),
    })),
    created_at: o.created_at,
    updated_at: o.updated_at,
    arrived_at: o.dorazilo_at ?? null,
    converted_at: o.prevedeno_at ?? null,
    consent: jeObjekt(o.souhlas)
      ? { id: (o.souhlas as Souhlas).id, signed_at: (o.souhlas as Souhlas).signed_at, method: (o.souhlas as Souhlas).method, has_signature_image: !!(o.souhlas as Souhlas).signature_url }
      : null,
    converted_to: zakazka ? "ticket" : reklamace ? "claim" : null,
    // Kód v Jobi – zakázky, nebo reklamace, když se objednávka převedla na ni.
    ticket_code: zakazka?.code ?? reklamace?.code ?? null,
    claim: reklamace ? { code: reklamace.code } : null,
    ticket: zakazka
      ? { code: zakazka.code, status: zakazka.status, total: zakazka.total === null ? null : Number(zakazka.total), updated_at: zakazka.updated_at }
      : null,
  };
}

/**
 * Co z položky smí změnit API podle stavu objednávky.
 *  - otevřená: vše,
 *  - převedená: jen sledovací čísla, poznámka a data (zbytek už žije v zakázce),
 *  - zrušená: nic.
 * Vrací povolené hodnoty a případnou chybu (pak se nezmění nic).
 */
export function povoleneZmeny(stavNyni: string, p: PolozkaObjednavky): { hodnoty: Record<string, unknown>; stav?: StavDb; chyba?: string } {
  if (jeOtevrena(stavNyni)) return { hodnoty: p.hodnoty, ...(p.stav ? { stav: p.stav } : {}) };
  if (stavNyni === "zrusena") {
    return { hodnoty: {}, chyba: "objednávka je zrušená, měnit ji nejde" };
  }
  // prevedeno
  if (p.stav && p.stav !== "dorazilo") {
    return { hodnoty: {}, chyba: p.stav === "zrusena" ? "objednávka už je zakázka – zrušte ji v Jobi" : "objednávka už je zakázka, stav se řídí zakázkou" };
  }
  const hodnoty: Record<string, unknown> = {};
  for (const k of ["sledovaci_cisla", "poznamka", "data"]) if (k in p.hodnoty) hodnoty[k] = p.hodnoty[k];
  return { hodnoty };
}

/** Došlo k nějaké změně oproti uloženému řádku? (Pro výsledek „unchanged“.) */
export function lisiSe(radek: Record<string, unknown>, hodnoty: Record<string, unknown>): boolean {
  return Object.entries(hodnoty).some(([k, v]) => stabilniJson(radek[k]) !== stabilniJson(v));
}

/** JSON se seřazenými klíči – jsonb z databáze vrací klíče v jiném pořadí, než je klient poslal. */
function stabilniJson(v: unknown): string {
  if (v === undefined || v === null) return "null";
  if (Array.isArray(v)) return `[${v.map(stabilniJson).join(",")}]`;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stabilniJson(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

// ── Vložitelný formulář Jobi (public-order-form) ────────────────────────────

/** Nastavení formuláře v service_settings.config.objednavky.formular. */
export type NastaveniFormulare = { zapnuto: boolean; uvod: string; podminkyUrl: string | null };

export function nastaveniFormulare(raw: unknown): NastaveniFormulare {
  const r = jeObjekt(raw) ? raw : {};
  const url = typeof r.podminkyUrl === "string" && /^https:\/\/\S+$/i.test(r.podminkyUrl.trim()) ? r.podminkyUrl.trim().slice(0, 500) : null;
  return {
    zapnuto: r.zapnuto === true,
    uvod: typeof r.uvod === "string" ? r.uvod.trim().slice(0, 400) : "",
    podminkyUrl: url,
  };
}

/** Číslo objednávky z formuláře: JOBI-RRMMDD-XXXXXX (bez 0/O/1/I, ať se dá nadiktovat). */
export function novyKodObjednavky(ted: Date = new Date()): string {
  const abeceda = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bajty = new Uint8Array(6);
  crypto.getRandomValues(bajty);
  const nahodne = [...bajty].map((b) => abeceda[b % abeceda.length]).join("");
  const d = ted.toISOString().slice(2, 10).replace(/-/g, "");
  return `JOBI-${d}-${nahodne}`;
}

/**
 * Tělo formuláře → sloupce web_objednavky (bez service_id a čísla).
 * Povinné: jméno, telefon, zařízení, závada a zaškrtnutý souhlas; při
 * předání poštou i adresa pro vrácení. Souhlas se uloží jako elektronické
 * odsouhlasení (checkbox, čas, IP, prohlížeč, odkaz na podmínky).
 */
export function formularNaObjednavku(
  telo: Record<string, unknown>,
  kontext: { ip: string; userAgent: string; podminkyUrl: string | null },
  ted: Date = new Date(),
): { hodnoty: Record<string, unknown> } | string {
  const t = (k: string, max: number) => (typeof telo[k] === "string" ? (telo[k] as string).replace(new RegExp(RIDICI.source, "g"), "").trim().slice(0, max) : "");
  const jmeno = t("name", 200);
  const telefon = t("phone", 40);
  const email = t("email", 200);
  const zarizeni = t("device", 200);
  const zavada = t("issue", 4000);
  if (jmeno.length < 2) return "Vyplňte jméno";
  if (telefon.replace(/\D/g, "").length < 9) return "Vyplňte platný telefon";
  if (email && !JE_EMAIL.test(email)) return "E-mail nevypadá platně";
  if (zarizeni.length < 2) return "Vyplňte zařízení";
  if (zavada.length < 2) return "Popište, co je potřeba opravit";
  if (telo.consent !== true) return "Bez souhlasu s podmínkami objednávku odeslat nejde";
  const postou = telo.handoff === "postou";
  const ulice = t("street", 200);
  const mesto = t("city", 120);
  const psc = t("zip", 20);
  if (postou && (!ulice || !mesto)) return "Vyplňte adresu pro vrácení";
  const uuid = (k: string) => (typeof telo[k] === "string" && JE_UUID.test(telo[k] as string) ? (telo[k] as string).toLowerCase() : null);
  const adresa = [ulice, [psc, mesto].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const ip = JE_IP.test(kontext.ip) ? kontext.ip : undefined;
  const souhlas: Souhlas = {
    id: "", // doplní edge funkce podle čísla objednávky
    signed_at: ted.toISOString(),
    method: "checkbox",
    signer_name: jmeno,
    ...(ip ? { ip } : {}),
    ...(kontext.userAgent ? { user_agent: kontext.userAgent.slice(0, 500) } : {}),
    ...(kontext.podminkyUrl ? { terms_url: kontext.podminkyUrl } : {}),
    document_version: "formulář Jobi",
    received_at: ted.toISOString(),
  };
  return {
    hodnoty: {
      zakaznik_jmeno: jmeno,
      zakaznik_telefon: telefon,
      zakaznik_email: email || null,
      zakaznik_ulice: postou ? ulice : null,
      zakaznik_mesto: postou ? mesto : null,
      zakaznik_psc: postou ? psc || null : null,
      zarizeni,
      sn_imei: t("serial", 100) || null,
      popis_zavady: zavada,
      model_id: uuid("model_id"),
      repair_id: uuid("repair_id"),
      doprava_tam: postou ? "Poštou" : "Osobně",
      doprava_zpet: postou ? "Poštou" : "Osobně",
      adresa_zpet: postou ? adresa : null,
      poznamka: t("note", 4000) || null,
      souhlas,
    },
  };
}
