/**
 * DPD GeoAPI v1 – čistá logika pro přepravu mezi pobočkami (Zásilky).
 *
 * Převzato z ověřené „Přepravy Praha ↔ Brno“ na servis.iswap
 * (functions/api/admin/internal-shipments.js): stejné typy zásilek,
 * stejný plátce i postup objednání svozu. Tady jen to, co jde testovat bez
 * sítě; volání DPD dělá edge funkce zasilka-dpd.
 *
 * Varianta podle toho, jestli je pobočka odeslání registrovaná adresa DPD
 * účtu (u iSwapu Praha ano, Brno ne – zjištěno na servis.iswap 23. 10.):
 *
 *   registrovaná, štítek  = „Standard“ + shopToHome (podání ve výdejně i
 *                           předání kurýrovi); když DPD Shop to Home odmítne,
 *                           čistý „Standard“ (jen předat kurýrovi)
 *   registrovaná, kurýr   = „Standard“ + svoz na registrovanou adresu
 *   jiná, štítek          = „Return“ + dpdReturn (jen výdejní místo)
 *   jiná, kurýr           = „Collection“ + svoz z adresy pobočky (štítek
 *                           přiveze kurýr, tisk DPD odmítá)
 */

export type RezimDpd = "label" | "courier";
export type VariantaDpd = "standard_shop" | "standard" | "return" | "collection";

/** Identifikace registrované adresy DPD účtu ({ it4emId } nebo { id }). */
export type RegistrovanaAdresa = { it4emId: string | number } | { id: string | number };

/** Varianty v pořadí, ve kterém se zkouší (další jen když DPD předchozí odmítne). */
export function variantyZasilky(rezim: RezimDpd, registrovana: boolean): VariantaDpd[] {
  if (registrovana) return rezim === "label" ? ["standard_shop", "standard"] : ["standard"];
  return [rezim === "label" ? "return" : "collection"];
}

/** Jde k variantě vytisknout štítek? U Collection ho přiveze kurýr (DPD tisk odmítá). */
export function jdeTisknoutStitek(varianta: VariantaDpd | null | undefined): boolean {
  return varianta !== "collection";
}

/** Co s balíkem udělat – ukáže se u objednávky, dokud DPD nepošle první pohyb. */
export function predaniText(varianta: VariantaDpd, rezim: RezimDpd): string {
  switch (varianta) {
    case "standard_shop": return "Štítek předejte kurýrovi, nebo podejte na výdejním místě DPD.";
    case "standard": return rezim === "label" ? "Štítek předejte kurýrovi (Shop to Home DPD odmítlo – ve výdejně nepodávat)." : "Kurýr vyzvedne na pobočce, štítek nalepte na krabici.";
    case "return": return "Štítek podejte na výdejním místě DPD (kurýr ho nenačte).";
    case "collection": return "Kurýr vyzvedne na pobočce a štítek přiveze.";
  }
}

export type PobockaProDpd = {
  name: string;
  company_name?: string | null;
  address_street?: string | null;
  address_city?: string | null;
  address_zip?: string | null;
  phone?: string | null;
  email?: string | null;
};

export type AdresaDpd = {
  info: { name1: string; contact: { phone?: string; email?: string } };
  address: { street: string; houseNumber: string; city: string; postalCode: string; country: { isoAlpha2: "CZ" } };
};

export const DPD_URL = { ostre: "https://geoapi.dpd.cz/v1", test: "https://geoapi-test.dpd.cz/v1" } as const;

/**
 * Tisk štítků: arch A4 se čtyřmi pozicemi A6, štítek začíná v levém horním
 * rohu – tiskne se na štítkový papír 4×A6 (jako na servis.iswap, 7753e77).
 * Samotné A6 se z běžné tiskárny vytisklo zvětšené přes celou A4.
 */
export const TISK_STITKU = { printType: "PDF", printProperties: { pageSize: "A4", labelsPerPage: 4 } } as const;

export function teloStitku(parcelNumbers: string[]) {
  return { ...TISK_STITKU, parcels: parcelNumbers.map((parcelNumber) => ({ parcelNumber })) };
}

/** „U Vokovické školy 299/4“ → ulice + číslo popisné. Bez čísla celé jako ulice. */
export function rozdelUlici(s: string): { street: string; houseNumber: string } {
  const t = s.trim().replace(/\s+/g, " ");
  const m = /^(.*?)[\s,]+(\d+[a-zA-Z]?(?:\/\d+[a-zA-Z]?)?)$/.exec(t);
  return m ? { street: m[1].trim(), houseNumber: m[2] } : { street: t, houseNumber: "" };
}

/** Město bez městské části: „Praha 6“ → „Praha“, „Brno - Černá Pole“ → „Brno“. */
export function mestoProDpd(s: string): string {
  return s.trim().split(/\s+[-–]\s+|,/)[0].replace(/\s+\d+$/, "").trim();
}

export function telefonProDpd(s: string | null | undefined): string | undefined {
  const t = String(s ?? "").replace(/[^\d+]/g, "");
  if (!t) return undefined;
  if (t.startsWith("+")) return t;
  if (t.startsWith("00")) return `+${t.slice(2)}`;
  if (t.length === 9) return `+420${t}`;
  return t;
}

/** Adresa pobočky pro DPD; null = chybí něco, bez čeho DPD zásilku nevezme. */
export function adresaPobocky(b: PobockaProDpd, nazevServisu: string): AdresaDpd | null {
  const ulice = rozdelUlici(b.address_street ?? "");
  const mesto = mestoProDpd(b.address_city ?? "");
  const psc = String(b.address_zip ?? "").replace(/\s/g, "");
  const telefon = telefonProDpd(b.phone);
  if (!ulice.street || !ulice.houseNumber || !mesto || !/^\d{5}$/.test(psc) || !telefon) return null;
  const email = b.email?.trim() || undefined;
  return {
    info: { name1: (b.company_name?.trim() || nazevServisu.trim() || b.name).slice(0, 35), contact: { phone: telefon, ...(email ? { email } : {}) } },
    address: { street: ulice.street, houseNumber: ulice.houseNumber, city: mesto, postalCode: psc, country: { isoAlpha2: "CZ" } },
  };
}

/** Co pobočce chybí, aby šla přeprava objednat (pro hlášku uživateli). */
export function coChybiPobocce(b: PobockaProDpd): string[] {
  const chybi: string[] = [];
  const ulice = rozdelUlici(b.address_street ?? "");
  if (!ulice.street) chybi.push("ulice");
  else if (!ulice.houseNumber) chybi.push("číslo popisné v ulici");
  if (!mestoProDpd(b.address_city ?? "")) chybi.push("město");
  if (!/^\d{5}$/.test(String(b.address_zip ?? "").replace(/\s/g, ""))) chybi.push("PSČ");
  if (!telefonProDpd(b.phone)) chybi.push("telefon");
  return chybi;
}

export function teloZasilky(p: {
  dsw: string;
  varianta: VariantaDpd;
  balicku: number;
  reference: string;
  poznamka?: string;
  odesilatel: AdresaDpd;
  prijemce: AdresaDpd;
  /** Registrovaná adresa účtu – odesílatel u Standard zásilek. */
  registrovana?: RegistrovanaAdresa | null;
  /** Plátce u Return/Collection (příjemce není adresa účtu). */
  adresaPlatce: AdresaPlatce;
}): unknown[] {
  const poznamka = (p.poznamka ?? "").trim().slice(0, 35);
  const zaklad = {
    customer: { dsw: p.dsw },
    deliveryOptions: { completeness: "CompleteOnly" },
    references: { ref1: p.reference, ...(poznamka ? { ref2: poznamka } : {}) },
    receiver: p.prijemce,
    // Váhu DPD nevyžaduje – 1 kg na balík jako na servis.iswap.
    parcels: Array.from({ length: p.balicku }, () => ({ references: { ref1: p.reference }, weightGrams: 1000 })),
  };
  if (p.varianta === "standard_shop" || p.varianta === "standard") {
    if (!p.registrovana) throw new Error("Standard zásilka potřebuje registrovanou adresu DPD účtu.");
    return [{
      ...zaklad,
      shipmentType: "Standard",
      sender: p.registrovana,
      payer: { customer: { dsw: p.dsw } },
      ...(p.varianta === "standard_shop" ? { services: { shopToHome: true } } : {}),
    }];
  }
  return [{
    ...zaklad,
    shipmentType: p.varianta === "collection" ? "Collection" : "Return",
    sender: p.odesilatel,
    // Příjemce (druhá pobočka) není adresa DPD účtu → plátce s registrovanou adresou.
    payer: { customer: { dsw: p.dsw }, customerAddress: p.adresaPlatce },
    ...(p.varianta === "return" ? { services: { dpdReturn: true } } : {}),
  }];
}

/** Čísla balíků z odpovědi na POST /shipments. */
export function cislaBaliku(odpoved: unknown): { shipmentId: string; parcelNumbers: string[] } {
  const s = (Array.isArray(odpoved) ? odpoved[0] : odpoved) as Record<string, any> | null;
  const parcelNumbers = ((s?.parcels ?? []) as any[])
    .map((p) => p?.parcelNumbers?.main || p?.parcelNumber || "")
    .filter((x: unknown): x is string => typeof x === "string" && x !== "");
  return { shipmentId: String(s?.id ?? s?.shipmentId ?? ""), parcelNumbers };
}

/** Adresa plátce: registrovaná adresa DPD účtu (it4emId, jinak id), nebo fyzická adresa. */
export type AdresaPlatce = RegistrovanaAdresa | AdresaDpd;

function aktivniAdresy(seznam: unknown): any[] {
  return ((Array.isArray(seznam) ? seznam : (seznam as any)?.items ?? []) as any[]).filter((a) => a?.isActive !== false);
}

function identAdresy(a: any): RegistrovanaAdresa | null {
  if (a?.it4emId != null) return { it4emId: a.it4emId };
  if (a?.id != null) return { id: a.id };
  return null;
}

/** Je pobočka (podle PSČ) registrovaná adresa DPD účtu? Vrací její identifikaci. */
export function registrovanaAdresa(seznam: unknown, psc: string | null | undefined): RegistrovanaAdresa | null {
  const p = String(psc ?? "").replace(/\s/g, "");
  if (!/^\d{5}$/.test(p)) return null;
  const a = aktivniAdresy(seznam).find((x) => JSON.stringify(x).replace(/\s/g, "").includes(p));
  return a ? identAdresy(a) : null;
}

/**
 * Plátce z GET /customers/{dsw}/addresses. Bez registrované adresy vrací DPD
 * u interní zásilky ShipmentSpecificationError (audit servis.iswap 23. 10.).
 * Přednost má adresa s PSČ hlavní pobočky; když API nic nevrátí, pošle se
 * fyzická adresa (schéma Payer Specs to dovoluje).
 */
export function vyberAdresuPlatce(seznam: unknown, preferovanePsc: string | undefined, zaloha: AdresaDpd): AdresaPlatce {
  const arr = aktivniAdresy(seznam);
  return registrovanaAdresa(arr, preferovanePsc) ?? identAdresy(arr[0]) ?? zaloha;
}

/**
 * Dny pro svoz „co nejdřív“: dnešek a další pracovní dny (pražský čas).
 * DPD nevrací nejbližší možný den, zkouší se postupně.
 */
export function dnySvozu(ted: Date = new Date(), pocet = 4): string[] {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit" });
  const d = new Date(`${fmt.format(ted)}T12:00:00Z`);
  const out: string[] = [];
  while (out.length < pocet) {
    const den = d.getUTCDay();
    if (den !== 0 && den !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** ID svozu z odpovědi /pickup-orders (DPD ho vrací na různých místech). */
export function idSvozu(data: unknown, location: string | null): string {
  const first = (Array.isArray(data) ? data[0] : data) as Record<string, any> | null;
  const id = first?.id || first?.pickupOrderId || first?.pickupOrder?.id || (data as any)?.pickupOrders?.[0]?.id || "";
  if (id) return String(id);
  const m = /\/pickup-orders\/([^/?#]+)/.exec(location ?? "");
  return m ? m[1] : "";
}

export type StavZTrackingu = { status?: "in_transit" | "delivered"; text?: string; at?: string };

/* Kód 18 („additional information“) zapisuje DPD už při vytvoření štítku a 91
   je administrativní – nejsou to pohyby balíku. Stejně jako dpd-delivery-sync
   na servis.iswap se bere poslední jiná událost, 18/91 jen když nic jiného není. */
const INFORMACNI_KODY = new Set(["18", "91"]);

function jeDoruceni(code: string, text: string): boolean {
  if (code === "13") return true;
  if (/(DELIVER|DORUCEN|DORUČEN)/.test(code.toUpperCase())) return true;
  const s = `${code} ${text}`.toLowerCase();
  if (/nedoručen|nedorucen|not delivered|undeliver/.test(s)) return false;
  return /doručen|dorucen|delivered/.test(s);
}

/** Události z /parcels/{n}/tracking → stav objednávky. Bez událostí (404) = {}. */
export function stavZTrackingu(data: unknown): StavZTrackingu {
  const udalosti = (((data as any)?.parcelEvents ?? []) as any[])
    .map((ev) => ({ at: String(ev?.createdAt ?? ""), code: String(ev?.status?.statusCode ?? ""), text: String(ev?.status?.description ?? "") }))
    .sort((a, b) => b.at.localeCompare(a.at));
  const posledni = udalosti.find((e) => !INFORMACNI_KODY.has(e.code)) ?? udalosti[0];
  if (!posledni) return {};
  // Jen informační událost = štítek je vytvořený, balík se ještě nehnul.
  if (INFORMACNI_KODY.has(posledni.code)) return { text: posledni.text || posledni.code, at: posledni.at || undefined };
  return {
    status: jeDoruceni(posledni.code, posledni.text) ? "delivered" : "in_transit",
    text: posledni.text || posledni.code,
    at: posledni.at || undefined,
  };
}

/** Odkaz na veřejné sledování balíku. */
export function odkazSledovani(cisloBaliku: string): string {
  return `https://tracking.dpd.de/status/cs_CZ/parcel/${encodeURIComponent(cisloBaliku)}`;
}
