/**
 * Záruka na provedenou opravu (tickets.warranty_until).
 *
 * Datum zapisuje databáze při vydání zakázky (trigger
 * tickets_zaruka_opravy_pri_vydani, migrace 20260927150000); tady je
 * zrcadlo výpočtu pro testy a náhled a všechno, co se kolem záruky
 * zobrazuje – řádek v detailu, upozornění při zakládání reklamace.
 *
 * Výchozí délky: spotřebitel 24 měsíců (zákonná lhůta), firma 12. Firma se
 * pozná podle IČO na zakázce – stejně jako v triggeru. Servis si obojí
 * nastaví v Nastavení → Zakázky → Reklamace, jednotlivá oprava z ceníku
 * může mít vlastní délku (repairs.warranty_months; 0 = bez záruky).
 */

export const VYCHOZI_ZARUKA_SPOTREBITEL = 24;
export const VYCHOZI_ZARUKA_FIRMA = 12;
/** Strop jako v kontrole sloupce repairs.warranty_months. */
export const MAX_ZARUKA_MESICU = 120;

export type NastaveniZarukyOpravy = { spotrebitel: number; firma: number };

/** Počet měsíců 0–120 (celé číslo), jinak null. Prázdný text = null. */
export function normalizujMesice(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && !v.trim()) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return Math.min(MAX_ZARUKA_MESICU, Math.max(0, Math.round(n)));
}

/** Výchozí záruky ze service_settings.config (klíče jako v triggeru). */
export function nastaveniZarukyZConfigu(config: Record<string, unknown> | null | undefined): NastaveniZarukyOpravy {
  const c = config ?? {};
  const s = typeof c.zaruka_opravy_mesice === "number" ? normalizujMesice(c.zaruka_opravy_mesice) : null;
  const f = typeof c.zaruka_opravy_mesice_firma === "number" ? normalizujMesice(c.zaruka_opravy_mesice_firma) : null;
  return { spotrebitel: s ?? VYCHOZI_ZARUKA_SPOTREBITEL, firma: f ?? VYCHOZI_ZARUKA_FIRMA };
}

/** Zákazník zakázky je firma = na zakázce je IČO. */
export function jeZakazkaFirmy(ico: string | null | undefined): boolean {
  return !!(ico ?? "").replace(/\s+/g, "");
}

/**
 * Délka záruky zakázky v měsících – nejdelší z provedených oprav. Oprava bez
 * vazby na ceník nebo bez vlastní délky má výchozí; bez oprav výchozí.
 * 0 = bez záruky.
 */
export function delkaZarukyOpravy(
  opravy: ReadonlyArray<{ name?: string | null; repairId?: string | null }> | null | undefined,
  zarukaZCeniku: (repairId: string) => number | null | undefined,
  firma: boolean,
  nastaveni: NastaveniZarukyOpravy,
): number {
  const vychozi = firma ? nastaveni.firma : nastaveni.spotrebitel;
  const delky = (opravy ?? [])
    .filter((o) => (o.name ?? "").trim())
    .map((o) => {
      const vlastni = o.repairId ? zarukaZCeniku(o.repairId) : null;
      return vlastni ?? vychozi;
    });
  return delky.length > 0 ? Math.max(...delky) : vychozi;
}

/** ISO datum „RRRR-MM-DD“ z místního data. */
function isoDatum(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const den = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${den}`;
}

/** „RRRR-MM-DD…“ → místní půlnoc toho dne; nečitelné → null. */
function denZIso(iso: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((iso ?? "").trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Konec záruky: den vydání + měsíce, bez přetečení (31. 1. + 1 = 28./29. 2.),
 * stejně jako `date + interval 'n months'` v Postgresu. 0 měsíců = null.
 */
export function zarukaDo(vydano: Date, mesicu: number): string | null {
  if (!(mesicu > 0)) return null;
  const den = vydano.getDate();
  const x = new Date(vydano.getFullYear(), vydano.getMonth(), 1);
  x.setMonth(x.getMonth() + mesicu);
  const posledni = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
  x.setDate(Math.min(den, posledni));
  return isoDatum(x);
}

/** „2028-03-12“ → „12. 3. 2028“ (bez posunu časovým pásmem). */
export function formatDatumZaruky(iso: string | null | undefined): string {
  const d = denZIso(iso);
  return d ? `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}` : "";
}

export type StavZarukyOpravy = {
  /** Záruka ještě platí (poslední den včetně). */
  platna: boolean;
  /** Datum konce záruky, naformátované („12. 3. 2028“). */
  datum: string;
};

/** Stav záruky k dnešku; bez data (nevydáno, bez záruky) null. */
export function stavZarukyOpravy(warrantyUntil: string | null | undefined, dnes: Date = new Date()): StavZarukyOpravy | null {
  const konec = denZIso(warrantyUntil);
  if (!konec) return null;
  const dnesDen = new Date(dnes.getFullYear(), dnes.getMonth(), dnes.getDate());
  return { platna: dnesDen.getTime() <= konec.getTime(), datum: formatDatumZaruky(warrantyUntil) };
}

/** Text řádku v detailu zakázky. */
export function textZarukyOpravy(stav: StavZarukyOpravy): string {
  return stav.platna ? `Záruka na opravu do ${stav.datum}` : `Záruka na opravu do ${stav.datum} – prošla`;
}
