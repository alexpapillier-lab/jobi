/**
 * Souhrnná faktura – jedna faktura za víc zakázek firemního zákazníka.
 *
 * Čistá logika bez Reactu a bez databáze, aby šla otestovat: výběr zakázek
 * (vydané v období, nevyfakturované, stejný zákazník nebo IČO), položky
 * faktury, součty. Načtení z databáze a zápis dělá stránka Faktury
 * (`src/pages/Invoices.tsx`, dialog `Invoices/SouhrnnaFakturaDialog.tsx`),
 * vazbu faktura ↔ zakázky drží tabulka `invoice_tickets` (migrace
 * 20260927130000).
 *
 * Co se přebírá, ne kopíruje:
 *   - konečná cena zakázky po slevě: `konecnaCena` / `castkaSlevy` (slevaZakazky)
 *   - součty a DPH: `computeTotals` (invoiceMath), stejné jako v editoru
 *   - sazba nové položky: `sazbaProNovouPolozku` (neplátce má 0)
 *   - období: `parseDatum` / `startOfDay` / `endOfDay` ze Statistik
 *   - storno: `jeStornoStav` (stornoStav) – stejné pravidlo jako Statistiky
 *   - datum vydání: koncový stav + `completed_at`, jinak poslední změna
 *     (stejné pravidlo jako `datumVydani` ve Statistikách a na serveru)
 */

import { computeTotals, naHalere, type InvoiceLineItem, type InvoiceTotals } from "./invoiceMath";
import { castkaSlevy, hrubaCena, konecnaCena, type TypSlevy } from "./slevaZakazky";
import { endOfDay, parseDatum, startOfDay, vObdobi, type DateRange } from "../pages/Statistics/obdobi";
import { technikPrace } from "./rootOwner";

/** Délka názvu položky – iDoklad i Fakturoid berou 200 znaků, víc se při exportu ořízne. */
export const MAX_NAZEV_POLOZKY = 200;

/** Oprava z `tickets.performed_repairs` – jen to, co faktura potřebuje. */
export type OpravaZakazky = {
  name: string;
  type?: "selected" | "manual" | "hourly" | string;
  price?: number | null;
  hodiny?: number | null;
  sazba?: number | null;
  technik?: string | null;
};

/** Zakázka pro souhrnnou fakturu (z řádku `tickets`). */
export type ZakazkaProSouhrn = {
  id: string;
  code: string | null;
  status: string;
  createdAt: string;
  updatedAt: string | null;
  completedAt: string | null;
  customerId: string | null;
  customerName: string | null;
  customerCompany: string | null;
  customerIco: string | null;
  deviceLabel: string | null;
  opravy: OpravaZakazky[];
  discountType: TypSlevy;
  discountValue: number | null;
  branchId: string | null;
};

/** Sloupce `tickets`, které dialog načítá – jedno místo pro select i mapování. */
export const SLOUPCE_ZAKAZKY =
  "id, code, status, created_at, updated_at, completed_at, customer_id, customer_name, customer_company, customer_ico, device_label, device_brand, device_model, performed_repairs, discount_type, discount_value, branch_id";

type RadekZakazky = {
  id: string;
  code: string | null;
  status: string | null;
  created_at: string;
  updated_at: string | null;
  completed_at: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_company: string | null;
  customer_ico: string | null;
  device_label: string | null;
  device_brand?: string | null;
  device_model?: string | null;
  performed_repairs: unknown;
  discount_type: string | null;
  discount_value: number | null;
  branch_id: string | null;
};

function cislo(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Provedené opravy z JSONu zakázky; nesmysly (bez názvu, ne-objekty) se zahodí. */
export function opravyZJsonu(json: unknown): OpravaZakazky[] {
  if (!Array.isArray(json)) return [];
  const out: OpravaZakazky[] = [];
  for (const r of json) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim() : "";
    if (!name) continue;
    out.push({
      name,
      type: typeof o.type === "string" ? o.type : undefined,
      price: cislo(o.price),
      hodiny: cislo(o.hodiny),
      sazba: cislo(o.sazba),
      // Práce majitele aplikace jde na fakturu bez jména (je neviditelný).
      technik: typeof o.technik === "string" ? technikPrace({ technik: o.technik, technikUserId: typeof o.technikUserId === "string" ? o.technikUserId : null }) : null,
    });
  }
  return out;
}

export function zakazkaZRadku(r: RadekZakazky): ZakazkaProSouhrn {
  const zarizeni = r.device_label?.trim() || [r.device_brand, r.device_model].filter((x) => x && x.trim()).join(" ") || null;
  const typ = r.discount_type === "percentage" || r.discount_type === "amount" ? r.discount_type : null;
  return {
    id: r.id,
    code: r.code,
    status: r.status || "received",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    completedAt: r.completed_at,
    customerId: r.customer_id,
    customerName: r.customer_name,
    customerCompany: r.customer_company,
    customerIco: r.customer_ico,
    deviceLabel: zarizeni,
    opravy: opravyZJsonu(r.performed_repairs),
    discountType: typ,
    discountValue: r.discount_value,
    branchId: r.branch_id,
  };
}

// ─── Zákazník ────────────────────────────────────────────────

/** IČO bez mezer; prázdné → null. */
export function normalizujIco(ico: string | null | undefined): string | null {
  const s = (ico ?? "").replace(/\s+/g, "");
  return s ? s : null;
}

/**
 * Firemní (B2B) zákazník: má IČO nebo firmu, případně si ho servis označil
 * v názvu („Alza (B2B)“). Jen pro napovídání v dialogu – souhrnnou fakturu
 * lze vystavit komukoli.
 */
export function jeFiremniZakaznik(c: { name?: string | null; company?: string | null; ico?: string | null }): boolean {
  if (normalizujIco(c.ico)) return true;
  if ((c.company ?? "").trim()) return true;
  return /\bB2B\b/i.test(c.name ?? "");
}

/**
 * Patří zakázka zákazníkovi? Podle karty zákazníka, nebo podle IČO – jedna
 * firma mívá víc kontaktních osob, každá se svou kartou.
 */
export function patriZakaznikovi(z: Pick<ZakazkaProSouhrn, "customerId" | "customerIco">, zakaznik: { id: string | null; ico: string | null }): boolean {
  if (zakaznik.id && z.customerId === zakaznik.id) return true;
  const ico = normalizujIco(zakaznik.ico);
  return !!ico && normalizujIco(z.customerIco) === ico;
}

// ─── Období ──────────────────────────────────────────────────

/** „RRRR-MM“ → celý měsíc v místním čase. */
export function obdobiZMesice(mesic: string): DateRange | null {
  const m = /^(\d{4})-(\d{2})$/.exec(mesic.trim());
  if (!m) return null;
  const rok = Number(m[1]);
  const mes = Number(m[2]) - 1;
  if (mes < 0 || mes > 11) return null;
  return { start: new Date(rok, mes, 1, 0, 0, 0, 0), end: endOfDay(new Date(rok, mes + 1, 0)) };
}

/** Od–do (RRRR-MM-DD, oba dny včetně). Obrácené pořadí se prohodí. */
export function obdobiOdDo(od: string, doDne: string): DateRange | null {
  const a = parseDatum(od);
  const b = parseDatum(doDne);
  if (!a || !b) return null;
  const [z, k] = a <= b ? [a, b] : [b, a];
  return { start: startOfDay(z), end: endOfDay(k) };
}

/**
 * Výchozí měsíc dialogu. Firmy se fakturují po skončení měsíce, takže
 * v prvních dnech měsíce (do 10.) se nabídne ten minulý, jinak běžící.
 */
export function vychoziMesic(now: Date): string {
  const d = now.getDate() <= 10 ? new Date(now.getFullYear(), now.getMonth() - 1, 1) : now;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function datumCesky(d: Date): string {
  return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`;
}

/** „1. 9. 2026 – 30. 9. 2026“. */
export function popisObdobi(r: DateRange): string {
  return `${datumCesky(r.start)} – ${datumCesky(r.end)}`;
}

/** Poznámka na faktuře – odkud položky jsou. */
export function poznamkaSouhrnu(r: DateRange, pocet: number): string {
  return `Souhrnná faktura za ${pluralZakazky(pocet)} vydané v období ${popisObdobi(r)}.`;
}

/** „1 zakázka“, „3 zakázky“, „12 zakázek“. */
export function pocetZakazek(n: number): string {
  if (n === 1) return "1 zakázka";
  if (n >= 2 && n <= 4) return `${n} zakázky`;
  return `${n} zakázek`;
}

/** „1 zakázku“, „3 zakázky“, „12 zakázek“ (4. pád – „za …“). */
export function pluralZakazky(n: number): string {
  if (n === 1) return "1 zakázku";
  if (n >= 2 && n <= 4) return `${n} zakázky`;
  return `${n} zakázek`;
}

// ─── Výběr kandidátů ─────────────────────────────────────────

/** Datum vydání: koncový stav a přepnutí do něj (completed_at), jinak poslední změna. */
export function datumVydaniZakazky(z: Pick<ZakazkaProSouhrn, "status" | "completedAt" | "updatedAt">, jeKoncovy: (status: string) => boolean): string | null {
  if (!jeKoncovy(z.status)) return null;
  return z.completedAt || z.updatedAt || null;
}

export type Kandidat = {
  zakazka: ZakazkaProSouhrn;
  /** Součet oprav před slevou. */
  hruba: number;
  sleva: number;
  /** Konečná cena po slevě – to, co zákazník za zakázku platí. */
  cena: number;
  vydano: string;
  /** Číslo dokladu, na kterém už zakázka je (nestornovaném). */
  vyfakturovanoV: string | null;
};

export type VyberKandidatu = {
  /** Lze vyfakturovat – nabídnou se k zaškrtnutí. */
  kandidati: Kandidat[];
  /** Už jsou na jiné faktuře – jen pro informaci, zaškrtnout nejdou. */
  vyfakturovane: Kandidat[];
};

export function kandidatZeZakazky(z: ZakazkaProSouhrn, vydano: string, vyfakturovanoV: string | null = null): Kandidat {
  const hruba = hrubaCena(z.opravy);
  return {
    zakazka: z,
    hruba,
    sleva: castkaSlevy(hruba, z.discountType, z.discountValue),
    cena: konecnaCena(hruba, z.discountType, z.discountValue),
    vydano,
    vyfakturovanoV,
  };
}

/**
 * Zakázky pro souhrnnou fakturu: zákazníkovy (karta nebo IČO), vydané
 * v období (koncový stav, ne storno), bez smazaných. Vyfakturované
 * (`vyfakturovano`: id zakázky → číslo dokladu) jdou zvlášť. Řazeno podle
 * data vydání, ať faktura čte jako měsíční výpis.
 */
export function vyberKandidaty(
  zakazky: ZakazkaProSouhrn[],
  volby: {
    zakaznik: { id: string | null; ico: string | null };
    obdobi: DateRange;
    jeKoncovy: (status: string) => boolean;
    jeStorno: (status: string) => boolean;
    vyfakturovano: ReadonlyMap<string, string>;
  },
): VyberKandidatu {
  const kandidati: Kandidat[] = [];
  const vyfakturovane: Kandidat[] = [];
  for (const z of zakazky) {
    if (!patriZakaznikovi(z, volby.zakaznik)) continue;
    if (volby.jeStorno(z.status)) continue;
    const vydano = datumVydaniZakazky(z, volby.jeKoncovy);
    if (!vydano || !vObdobi(vydano, volby.obdobi)) continue;
    const faktura = volby.vyfakturovano.get(z.id) ?? null;
    const k = kandidatZeZakazky(z, vydano, faktura);
    (faktura !== null ? vyfakturovane : kandidati).push(k);
  }
  const podleData = (a: Kandidat, b: Kandidat) => a.vydano.localeCompare(b.vydano) || (a.zakazka.code ?? "").localeCompare(b.zakazka.code ?? "");
  kandidati.sort(podleData);
  vyfakturovane.sort(podleData);
  return { kandidati, vyfakturovane };
}

/** Výchozí zaškrtnutí: vše, co má cenu. Zakázka za 0 Kč (reklamace, záruka) se nabídne, ale nezaškrtne. */
export function vychoziVyber(kandidati: Kandidat[]): Set<string> {
  return new Set(kandidati.filter((k) => k.cena > 0).map((k) => k.zakazka.id));
}

// ─── Položky faktury ─────────────────────────────────────────

export type NastaveniDph = {
  /** Sazba nové položky – `sazbaProNovouPolozku(dph)`, neplátce 0. */
  sazba: number;
  /** Ceny oprav jsou zadané včetně DPH (Nastavení → Fakturace a DPH). */
  cenySDph: boolean;
};

/**
 * Jednotková cena na fakturu. Faktura drží ceny bez DPH (DPH přičte
 * computeTotals, iDoklad dostává PriceType „bez DPH“). Když má servis ceny
 * oprav s DPH, daň se z ceny vyjme, aby faktura zněla na stejnou částku,
 * jakou zákazník vidí u zakázky.
 */
export function cenaBezDph(cena: number, dph: NastaveniDph): number {
  if (!dph.cenySDph || !(dph.sazba > 0)) return naHalere(cena);
  return naHalere(cena / (1 + dph.sazba / 100));
}

function oriznout(text: string, max = MAX_NAZEV_POLOZKY): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/** „Zakázka SRV26000123“ – bez čísla jen „Zakázka“. */
export function oznaceniZakazky(z: Pick<ZakazkaProSouhrn, "code">): string {
  return z.code?.trim() ? `Zakázka ${z.code.trim()}` : "Zakázka";
}

/** Řádek za celou zakázku: „Zakázka SRV… · iPhone 13 · Výměna displeje, Baterie“. */
export function nazevRadkuZakazky(z: ZakazkaProSouhrn): string {
  const opravy = z.opravy.map((o) => o.name).join(", ");
  return oriznout([oznaceniZakazky(z), z.deviceLabel?.trim(), opravy].filter(Boolean).join(" · "));
}

/**
 * Položka za jednu opravu – stejně jako faktura z detailu zakázky: hodinová
 * práce jde jako hodiny × sazba (jednotka h), ostatní 1 ks za cenu opravy.
 */
export function polozkaZOpravy(o: OpravaZakazky, predpona: string, dph: NastaveniDph): InvoiceLineItem {
  const hodinova = o.type === "hourly" && (o.hodiny ?? 0) > 0;
  const nazev = o.type === "hourly" && o.technik ? `${o.name} (${o.technik})` : o.name;
  return {
    name: oriznout(`${predpona} · ${nazev}`),
    qty: hodinova ? o.hodiny! : 1,
    unit: o.type === "hourly" ? "h" : "ks",
    unit_price: cenaBezDph(hodinova ? o.sazba ?? 0 : o.price ?? 0, dph),
    vat_rate: dph.sazba,
  };
}

/**
 * Položky souhrnné faktury.
 *
 * Výchozí: jeden řádek za zakázku s cenou po slevě. S `rozpad` jde každá
 * oprava zvlášť a sleva zakázky jako záporný řádek pod ní – součet za
 * zakázku je stejný, jen je vidět, z čeho se skládá.
 */
export function sestavPolozky(vybrane: Kandidat[], dph: NastaveniDph, rozpad = false): InvoiceLineItem[] {
  const out: InvoiceLineItem[] = [];
  for (const k of vybrane) {
    const z = k.zakazka;
    if (!rozpad || z.opravy.length === 0) {
      out.push({ name: nazevRadkuZakazky(z), qty: 1, unit: "ks", unit_price: cenaBezDph(k.cena, dph), vat_rate: dph.sazba });
      continue;
    }
    const predpona = [oznaceniZakazky(z), z.deviceLabel?.trim()].filter(Boolean).join(" · ");
    for (const o of z.opravy) out.push(polozkaZOpravy(o, predpona, dph));
    if (k.sleva > 0) {
      out.push({ name: oriznout(`${oznaceniZakazky(z)} · Sleva`), qty: 1, unit: "ks", unit_price: -cenaBezDph(k.sleva, dph), vat_rate: dph.sazba });
    }
  }
  return out;
}

/** Vazby pro `invoice_tickets`: zakázka a její konečná cena. */
export function vazbyZVyberu(vybrane: Kandidat[]): { ticket_id: string; castka: number }[] {
  return vybrane.map((k) => ({ ticket_id: k.zakazka.id, castka: k.cena }));
}

export type SouhrnVyberu = {
  pocet: number;
  /** Součet konečných cen zakázek (co zákazník vidí u zakázek). */
  soucetZakazek: number;
  /** Součty faktury z položek – stejný výpočet jako editor. */
  faktura: InvoiceTotals;
};

export function souhrnVyberu(vybrane: Kandidat[], polozky: InvoiceLineItem[], mena = "CZK"): SouhrnVyberu {
  return {
    pocet: vybrane.length,
    soucetZakazek: naHalere(vybrane.reduce((s, k) => s + k.cena, 0)),
    faktura: computeTotals(polozky, mena),
  };
}
