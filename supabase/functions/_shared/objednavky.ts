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
};

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
  return { ok: true, polozka: { externiCislo: ext, hodnoty: h, ...(stav ? { stav } : {}) } };
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
};

export type ZakazkaApi = {
  code: string | null;
  status: { key: string; label: string; is_final: boolean };
  total: number | null;
  updated_at: string;
} | null;

/** Objednávka tak, jak ji vrací `GET /v1/orders`. */
export function objednavkaProApi(o: RadekObjednavky, zakazka: ZakazkaApi) {
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
    ticket_code: zakazka?.code ?? null,
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
