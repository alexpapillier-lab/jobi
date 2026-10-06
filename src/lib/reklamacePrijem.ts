/**
 * Příjem reklamace a převod reklamace na zakázku – čistá logika bez Reactu.
 *
 * Okno „Nová reklamace“ (src/pages/Orders/NovaReklamacePanel.tsx) drží
 * rozepsanou reklamaci jako koncept (KonceptReklamace) v localStorage –
 * stejně jako příjem zakázky. Tady je:
 *  - výchozí koncept a předvyplnění ze zdrojové zakázky,
 *  - ověření povinných polí (stejná pravidla jako u příjmu zakázky tam,
 *    kde pole existuje i u reklamace) a krátký důvod k tlačítku,
 *  - zákonná lhůta 30 dní na vyřízení (§ 2173 OZ / § 19 ZOS) jako výchozí termín,
 *  - převod konceptu na řádek warranty_claims,
 *  - převod reklamace na koncept zakázky („Není to reklamace → založit zakázku“).
 *
 * Systémový stav STAV_PREVEDENO není ve stavech servisu (service_statuses
 * jsou sdílené se zakázkami – nový stav by se nabízel i u zakázek). Detail
 * a seznam ho znají přes META_PREVEDENO; viz Orders.tsx (getByKey / isFinal).
 */
import type { StatusMeta } from "../state/StatusesStore";
import type { WarrantyClaimInsert, WarrantyClaimRow } from "../pages/Orders/hooks/useWarrantyClaims";
import type { DeviceRow, NewOrderDraft } from "../pages/Orders/typy";
import type { ClaimResolutionItem } from "../pages/Orders/reklamaceZakroky";
import { isEmailValid, isIcoValid, isPhoneValid, isZipValid } from "../pages/Orders/formatovani";

/** Zákonná lhůta na vyřízení reklamace spotřebitele (dny). */
export const LHUTA_VYRIZENI_DNI = 30;

/** Systémový koncový stav reklamace převedené na zakázku. */
export const STAV_PREVEDENO = "prevedeno_na_zakazku";

export const META_PREVEDENO: StatusMeta = {
  key: STAV_PREVEDENO,
  label: "Převedeno na zakázku",
  bg: "#64748b",
  fg: "#ffffff",
  isFinal: true,
};

/** Klíč konceptu v localStorage (jiný než u zakázky, ať se nepřepisují). */
export const NOVA_REKLAMACE_KONCEPT_KEY = "jobi_nova_reklamace_koncept_v1";

/** Oprava zdrojové zakázky, kterou zákazník může reklamovat. */
export type ReklamovanaOprava = { id: string; name: string; price?: number };

/** Co si koncept pamatuje ze zdrojové zakázky (přežije i přenačtení aplikace). */
export type ZdrojReklamace = {
  ticketId: string;
  kod: string | null;
  /** tickets.warranty_until (RRRR-MM-DD) – záruka na opravu. */
  zarukaDo: string | null;
  /** Provedené opravy zdrojové zakázky – nabídka k zaškrtnutí. */
  opravy: ReklamovanaOprava[];
  deviceBrand: string | null;
  deviceModel: string | null;
  deviceImei: string | null;
  customerAddressCountry: string | null;
};

export type KonceptReklamace = {
  zdroj: ZdrojReklamace | null;
  /** Uživatel zvolil „Reklamace bez propojení na zakázku“ (oprava odjinud). */
  bezZakazky: boolean;
  branchId: string | null;
  customerId: string | null;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  addressStreet: string;
  addressCity: string;
  addressZip: string;
  company: string;
  ico: string;
  customerInfo: string;
  deviceLabel: string;
  serialOrImei: string;
  devicePasscode: string;
  deviceCondition: string;
  deviceAccessories: string;
  handoffMethod: string;
  /** Popis reklamované závady – povinný (warranty_claims.notes). */
  popisZavady: string;
  /** Poznámka pro technika (warranty_claims.device_note). */
  poznamkaTechnik: string;
  /** Předpokládaný termín vyřízení (ISO); null = zákonná lhůta od přijetí. */
  terminVyrizeni: string | null;
  /** Id oprav ze `zdroj.opravy`, které zákazník reklamuje. */
  reklamovaneOpravy: string[];
  /** Přijímací fotky jako data URL – nahrají se po založení reklamace. */
  fotky: string[];
};

export function vychoziKoncept(handoffMethod = ""): KonceptReklamace {
  return {
    zdroj: null,
    bezZakazky: false,
    branchId: null,
    customerId: null,
    customerName: "",
    customerPhone: "",
    customerEmail: "",
    addressStreet: "",
    addressCity: "",
    addressZip: "",
    company: "",
    ico: "",
    customerInfo: "",
    deviceLabel: "",
    serialOrImei: "",
    devicePasscode: "",
    deviceCondition: "",
    deviceAccessories: "",
    handoffMethod,
    popisZavady: "",
    poznamkaTechnik: "",
    terminVyrizeni: null,
    reklamovaneOpravy: [],
    fotky: [],
  };
}

/** Koncept načtený z localStorage – doplní pole, která starší uložení nemělo. */
export function nactiKoncept(raw: unknown, handoffMethod = ""): KonceptReklamace | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<KonceptReklamace>;
  const v = vychoziKoncept(handoffMethod);
  const text = (x: unknown, d: string) => (typeof x === "string" ? x : d);
  return {
    ...v,
    zdroj: r.zdroj && typeof r.zdroj === "object" && typeof r.zdroj.ticketId === "string"
      ? { ...r.zdroj, opravy: Array.isArray(r.zdroj.opravy) ? r.zdroj.opravy : [] }
      : null,
    bezZakazky: r.bezZakazky === true,
    branchId: typeof r.branchId === "string" ? r.branchId : null,
    customerId: typeof r.customerId === "string" ? r.customerId : null,
    customerName: text(r.customerName, ""),
    customerPhone: text(r.customerPhone, ""),
    customerEmail: text(r.customerEmail, ""),
    addressStreet: text(r.addressStreet, ""),
    addressCity: text(r.addressCity, ""),
    addressZip: text(r.addressZip, ""),
    company: text(r.company, ""),
    ico: text(r.ico, ""),
    customerInfo: text(r.customerInfo, ""),
    deviceLabel: text(r.deviceLabel, ""),
    serialOrImei: text(r.serialOrImei, ""),
    devicePasscode: text(r.devicePasscode, ""),
    deviceCondition: text(r.deviceCondition, ""),
    deviceAccessories: text(r.deviceAccessories, ""),
    handoffMethod: text(r.handoffMethod, handoffMethod),
    popisZavady: text(r.popisZavady, ""),
    poznamkaTechnik: text(r.poznamkaTechnik, ""),
    terminVyrizeni: typeof r.terminVyrizeni === "string" ? r.terminVyrizeni : null,
    reklamovaneOpravy: Array.isArray(r.reklamovaneOpravy) ? r.reklamovaneOpravy.filter((x): x is string => typeof x === "string") : [],
    fotky: Array.isArray(r.fotky) ? r.fotky.filter((x): x is string => typeof x === "string") : [],
  };
}

/** Je v konceptu něco rozepsaného? (Výchozí způsob převzetí se nepočítá.) */
export function jeKonceptRozepsany(k: KonceptReklamace): boolean {
  const v = vychoziKoncept(k.handoffMethod);
  if (k.zdroj || k.bezZakazky || k.customerId || k.fotky.length > 0 || k.terminVyrizeni || k.reklamovaneOpravy.length > 0) return true;
  const pole: (keyof KonceptReklamace)[] = [
    "customerName", "customerPhone", "customerEmail", "addressStreet", "addressCity", "addressZip", "company", "ico", "customerInfo",
    "deviceLabel", "serialOrImei", "devicePasscode", "deviceCondition", "deviceAccessories", "popisZavady", "poznamkaTechnik",
  ];
  return pole.some((p) => String(k[p] ?? "").trim() !== String(v[p] ?? "").trim());
}

/** Zakázka, ze které se reklamace zakládá – stačí tvar TicketEx (bez Reactu). */
export type ZakazkaProReklamaci = {
  id: string;
  code?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  customerAddressStreet?: string | null;
  customerAddressCity?: string | null;
  customerAddressZip?: string | null;
  customerCompany?: string | null;
  customerIco?: string | null;
  customerInfo?: string | null;
  deviceLabel?: string | null;
  serialOrImei?: string | null;
  devicePasscode?: string | null;
  branchId?: string | null;
  warrantyUntil?: string | null;
  performedRepairs?: ReadonlyArray<{ id?: string | null; name?: string | null; price?: number | null }> | null;
  deviceBrand?: string | null;
  deviceModel?: string | null;
  deviceImei?: string | null;
  customerAddressCountry?: string | null;
};

/** Provedené opravy zakázky jako nabídka k reklamaci (bez prázdných názvů). */
export function opravyZakazky(t: ZakazkaProReklamaci): ReklamovanaOprava[] {
  // Náhradní id podle pořadí v zakázce (ne po vyfiltrování) – zůstane stejné i po přenačtení.
  return (t.performedRepairs ?? [])
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => (r?.name ?? "").trim())
    .map(({ r, i }) => ({
      id: (r.id ?? "").trim() || `oprava-${i}`,
      name: (r.name ?? "").trim(),
      ...(typeof r.price === "number" && Number.isFinite(r.price) ? { price: r.price } : {}),
    }));
}

/**
 * Předvyplní koncept ze zdrojové zakázky: zákazník, zařízení, SN/IMEI,
 * heslo, pobočka a provedené opravy k zaškrtnutí. Co se týká reklamace
 * samotné (popis závady, poznámka, fotky, termín), zůstává. Stav zařízení
 * a příslušenství se nepřebírají – popisují zařízení při příjmu reklamace,
 * ne při původní opravě (stará „prasklý displej“ by na protokolu lhala).
 * Jediná provedená oprava se rovnou zaškrtne; víc oprav vybere uživatel.
 */
export function predvyplnZeZakazky(k: KonceptReklamace, t: ZakazkaProReklamaci): KonceptReklamace {
  const opravy = opravyZakazky(t);
  const s = (v: string | null | undefined) => (v ?? "").trim();
  return {
    ...k,
    zdroj: {
      ticketId: t.id,
      kod: t.code ?? null,
      zarukaDo: t.warrantyUntil ?? null,
      opravy,
      deviceBrand: t.deviceBrand ?? null,
      deviceModel: t.deviceModel ?? null,
      deviceImei: t.deviceImei ?? null,
      customerAddressCountry: t.customerAddressCountry ?? null,
    },
    bezZakazky: false,
    branchId: t.branchId ?? k.branchId,
    customerId: t.customerId ?? null,
    customerName: s(t.customerName),
    customerPhone: s(t.customerPhone),
    customerEmail: s(t.customerEmail),
    addressStreet: s(t.customerAddressStreet),
    addressCity: s(t.customerAddressCity),
    addressZip: s(t.customerAddressZip).replace(/\D/g, ""),
    company: s(t.customerCompany),
    ico: s(t.customerIco).replace(/\D/g, ""),
    customerInfo: s(t.customerInfo),
    deviceLabel: s(t.deviceLabel),
    serialOrImei: s(t.serialOrImei),
    devicePasscode: s(t.devicePasscode),
    reklamovaneOpravy: opravy.length === 1 ? [opravy[0].id] : [],
  };
}

/** Odpojí zdrojovou zakázku; vyplněné údaje zůstanou k ruční úpravě. */
export function odpojZdroj(k: KonceptReklamace): KonceptReklamace {
  return { ...k, zdroj: null, reklamovaneOpravy: [] };
}

export type MoznostiOvereni = {
  /** Nastavení → Zakázky → Povinná pole: Telefon zákazníka povinný. */
  telefonPovinny: boolean;
};

/**
 * Chyby konceptu podle polí. Pravidla jako u příjmu zakázky
 * (useNovaZakazkaKoncept): zařízení povinné, telefon podle nastavení,
 * formát telefonu / e-mailu / PSČ / IČO; navíc povinný popis závady.
 */
export function chybyReklamace(k: KonceptReklamace, m: MoznostiOvereni): Record<string, string> {
  const e: Record<string, string> = {};
  if (m.telefonPovinny && !k.customerPhone.trim()) e.customerPhone = "Telefon je povinný.";
  else if (!isPhoneValid(k.customerPhone)) e.customerPhone = "Telefon vypadá neplatně.";
  if (!isEmailValid(k.customerEmail)) e.customerEmail = "E-mail vypadá neplatně.";
  if (!isZipValid(k.addressZip)) e.addressZip = "PSČ musí mít 5 číslic.";
  if (!isIcoValid(k.ico)) e.ico = "IČO musí mít 8 číslic.";
  if (!k.deviceLabel.trim()) e.deviceLabel = "Vyplňte zařízení.";
  if (!k.popisZavady.trim()) e.popisZavady = "Popište, co zákazník reklamuje.";
  return e;
}

/** Krátký důvod k tlačítku „Vytvořit reklamaci“ (pořadí jako ve formuláři). */
export function duvodBlokace(chyby: Record<string, string>): string | null {
  if (Object.keys(chyby).length === 0) return null;
  if (chyby.customerPhone) return chyby.customerPhone === "Telefon je povinný." ? "Chybí telefon" : "Neplatný telefon";
  if (chyby.customerEmail) return "Neplatný e-mail";
  if (chyby.addressZip) return "Neplatné PSČ";
  if (chyby.ico) return "Neplatné IČO";
  if (chyby.deviceLabel) return "Chybí zařízení";
  if (chyby.popisZavady) return "Chybí popis závady";
  return "Zkontrolujte vyplněné údaje";
}

/** Zákonný termín vyřízení: přijetí + 30 dní. */
export function vychoziTerminVyrizeni(prijato: Date): string {
  const d = new Date(prijato.getTime());
  d.setDate(d.getDate() + LHUTA_VYRIZENI_DNI);
  return d.toISOString();
}

const n = (v: string) => v.trim() || null;

/**
 * Koncept → řádek warranty_claims (bez service_id, kódu a stavu – ty
 * doplní useWarrantyClaims). Bez zadaného termínu se uloží zákonná lhůta.
 */
export function konceptNaReklamaci(k: KonceptReklamace, prijato: Date = new Date()): Omit<WarrantyClaimInsert, "service_id" | "code"> {
  const zdroj = k.zdroj;
  const vybrane = zdroj ? zdroj.opravy.filter((o) => k.reklamovaneOpravy.includes(o.id)) : [];
  return {
    source_ticket_id: zdroj?.ticketId ?? null,
    notes: k.popisZavady.trim(),
    received_at: prijato.toISOString(),
    expected_completion_at: k.terminVyrizeni || vychoziTerminVyrizeni(prijato),
    customer_id: k.customerId,
    customer_name: n(k.customerName),
    customer_phone: n(k.customerPhone),
    customer_email: n(k.customerEmail),
    customer_address_street: n(k.addressStreet),
    customer_address_city: n(k.addressCity),
    customer_address_zip: n(k.addressZip),
    customer_address_country: zdroj?.customerAddressCountry ?? null,
    customer_company: n(k.company),
    customer_ico: n(k.ico),
    customer_info: n(k.customerInfo),
    device_label: n(k.deviceLabel),
    device_brand: zdroj?.deviceBrand ?? null,
    device_model: zdroj?.deviceModel ?? null,
    device_serial: n(k.serialOrImei),
    device_imei: zdroj?.deviceImei ?? null,
    device_passcode: n(k.devicePasscode),
    device_condition: n(k.deviceCondition),
    device_accessories: n(k.deviceAccessories),
    device_note: n(k.poznamkaTechnik),
    handoff_method: n(k.handoffMethod),
    claimed_repairs: vybrane,
    ...(k.branchId ? { branch_id: k.branchId } : {}),
  };
}

/** Sloupce z migrace 20261006100000 – starší databáze je nezná. */
export const NOVE_SLOUPCE_REKLAMACE = ["claimed_repairs", "intake_photos", "handoff_method", "converted_ticket_id", "converted_at"] as const;

/** Reklamované opravy uložené u reklamace (sloupec claimed_repairs). */
export function reklamovaneOpravyReklamace(claim: Pick<WarrantyClaimRow, "claimed_repairs"> | Partial<WarrantyClaimRow>): ReklamovanaOprava[] {
  const raw = (claim as { claimed_repairs?: unknown }).claimed_repairs;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is { id?: unknown; name?: unknown; price?: unknown } => !!x && typeof x === "object")
    .filter((x) => typeof x.name === "string" && x.name.trim())
    .map((x, i) => ({
      id: typeof x.id === "string" ? x.id : `oprava-${i}`,
      name: String(x.name),
      ...(typeof x.price === "number" ? { price: x.price } : {}),
    }));
}

/** Přijímací fotky reklamace (sloupec intake_photos). */
export function fotkyReklamace(claim: Partial<WarrantyClaimRow>): string[] {
  const raw = (claim as { intake_photos?: unknown }).intake_photos;
  return Array.isArray(raw) ? raw.filter((u): u is string => typeof u === "string" && !!u.trim()) : [];
}

/** Lze reklamaci převést na zakázku? Jen jednou a jen z neuzavřené. */
export function lzePrevestNaZakazku(
  claim: Pick<WarrantyClaimRow, "status"> & { converted_ticket_id?: string | null },
  isFinal: (key: string) => boolean,
): { ok: true } | { ok: false; duvod: string } {
  if (claim.converted_ticket_id || claim.status === STAV_PREVEDENO) return { ok: false, duvod: "Reklamace už je převedená na zakázku." };
  if (claim.status && isFinal(claim.status)) return { ok: false, duvod: "Uzavřenou reklamaci nejde převést na zakázku." };
  return { ok: true };
}

export type PodkladyPrevodu = {
  /** Výchozí způsoby převzetí / předání (Nastavení → Zakázky). */
  handoffDefault?: string;
  handbackDefault?: string;
  /** Kód zdrojové zakázky a její diagnostika (diagnostika reklamace se píše do ní). */
  zdrojKod?: string | null;
  zdrojDiagnostika?: string | null;
  /** Zákroky zapsané v reklamaci (resolution_summary). */
  zakroky?: ClaimResolutionItem[];
};

/** Text diagnostiky nové zakázky: zákroky z reklamace a diagnostika zdrojové zakázky. */
export function diagnostikaZReklamace(claimCode: string, p: PodkladyPrevodu): string {
  const casti: string[] = [];
  const zakroky = (p.zakroky ?? []).filter((z) => z.name.trim());
  if (zakroky.length > 0) {
    casti.push(
      `Zákroky v reklamaci ${claimCode}:\n` +
        zakroky.map((z) => `- ${z.name.trim()}${typeof z.price === "number" ? ` (${z.price} Kč)` : ""}${z.description?.trim() ? ` – ${z.description.trim()}` : ""}`).join("\n"),
    );
  }
  const diag = (p.zdrojDiagnostika ?? "").trim();
  if (diag) {
    const odkud = p.zdrojKod?.trim() ? `Diagnostika ze zakázky ${p.zdrojKod.trim()}` : "Diagnostika původní zakázky";
    casti.push(`${odkud} (reklamace ${claimCode}):\n${diag}`);
  }
  return casti.join("\n\n");
}

/** Koncept zakázky vzniklé převodem reklamace – navíc text diagnostiky a hotové fotky. */
export type KonceptZakazkyZReklamace = NewOrderDraft & {
  /** Jde do tickets.diagnostic_text (createTicket čte newDraft.diagnosticText). */
  diagnosticText: string;
  /** Už nahrané přijímací fotky (odkazy), jdou rovnou do diagnostic_photos_before. */
  hotoveFotkyPred: string[];
};

/**
 * Reklamace → koncept nové zakázky (cesta useOrderActions.createTicket):
 * zákazník, zařízení, SN/IMEI, popis závady jako požadovaná oprava, stav
 * a příslušenství, poznámka pro technika s odkazem na reklamaci, přijímací
 * fotky, diagnostika (zákroky + diagnostika zdrojové zakázky) a pobočka.
 * Cena a opravy se nepřebírají – zakázka se teprve nacení.
 */
export function reklamaceNaZakazku(claim: WarrantyClaimRow, p: PodkladyPrevodu = {}): KonceptZakazkyZReklamace {
  const s = (v: string | null | undefined) => (v ?? "").trim();
  const nazev = s(claim.device_label) || [s(claim.device_brand), s(claim.device_model)].filter(Boolean).join(" ") || "Zařízení z reklamace";
  const zarizeni: DeviceRow = {
    deviceLabel: nazev,
    serialOrImei: s(claim.device_serial) || s(claim.device_imei),
    devicePasscode: s(claim.device_passcode),
    deviceCondition: s(claim.device_condition),
    deviceAccessories: s(claim.device_accessories),
    warrantyClaim: false,
    purchaseDate: "",
    purchaseProof: "",
    findMyOff: false,
    requestedRepair: s(claim.notes),
    handoffMethod: s((claim as { handoff_method?: string | null }).handoff_method) || (p.handoffDefault ?? ""),
    handbackMethod: p.handbackDefault ?? "",
    deviceNote: [s(claim.device_note), `Převedeno z reklamace ${claim.code} – nejde o reklamaci.`].filter(Boolean).join("\n"),
    externalId: "",
    estimatedPrice: undefined,
    expectedCompletionAt: undefined,
  };
  return {
    customerId: claim.customer_id ?? undefined,
    customerName: s(claim.customer_name),
    customerPhone: s(claim.customer_phone),
    customerEmail: s(claim.customer_email),
    addressStreet: s(claim.customer_address_street),
    addressCity: s(claim.customer_address_city),
    addressZip: s(claim.customer_address_zip).replace(/\D/g, ""),
    company: s(claim.customer_company),
    ico: s(claim.customer_ico).replace(/\D/g, ""),
    customerInfo: s(claim.customer_info),
    devices: [zarizeni],
    branchId: claim.branch_id ?? null,
    diagnosticText: diagnostikaZReklamace(claim.code, p),
    hotoveFotkyPred: fotkyReklamace(claim),
  };
}
