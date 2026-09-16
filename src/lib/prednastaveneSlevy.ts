/**
 * Přednastavené slevy servisu (service_settings.config.prednastavene_slevy).
 *
 * V detailu zakázky se sleva zadávala pokaždé ručně: vybrat typ, napsat
 * hodnotu. Servis přitom dává pořád ty samé – 10 % stálému zákazníkovi,
 * 200 Kč za dlouhé čekání. Tady se jednou nastaví a v zakázce se pak jen
 * klepne na tlačítko.
 */

export type PrednastavenaSleva = {
  id: string;
  typ: "percentage" | "amount";
  hodnota: number;
  /** Volitelný popisek, např. „Stálý zákazník“. Bez něj se ukáže jen hodnota. */
  nazev?: string;
};

export const MAX_PREDNASTAVENYCH_SLEV = 8;

/** Z configu (cokoli) na bezpečný seznam. Nesmyslné položky se tiše vynechají. */
export function normalizujSlevy(raw: unknown): PrednastavenaSleva[] {
  if (!Array.isArray(raw)) return [];
  const out: PrednastavenaSleva[] = [];
  for (const s of raw as Array<Partial<PrednastavenaSleva>>) {
    if (!s || typeof s !== "object") continue;
    const typ = s.typ === "percentage" || s.typ === "amount" ? s.typ : null;
    const hodnota = typeof s.hodnota === "number" && Number.isFinite(s.hodnota) ? s.hodnota : NaN;
    if (!typ || !(hodnota > 0)) continue;
    if (typ === "percentage" && hodnota > 100) continue;
    out.push({
      id: typeof s.id === "string" && s.id ? s.id : `s_${out.length}`,
      typ,
      hodnota: Math.round(hodnota * 100) / 100,
      nazev: typeof s.nazev === "string" && s.nazev.trim() ? s.nazev.trim() : undefined,
    });
    if (out.length >= MAX_PREDNASTAVENYCH_SLEV) break;
  }
  return out;
}

/** „10 %“ nebo „200 Kč“ – text na tlačítko. */
export function hodnotaSlevy(s: Pick<PrednastavenaSleva, "typ" | "hodnota">): string {
  const cislo = Number.isInteger(s.hodnota) ? String(s.hodnota) : s.hodnota.toLocaleString("cs-CZ", { maximumFractionDigits: 2 });
  return s.typ === "percentage" ? `${cislo} %` : `${cislo} Kč`;
}

/** Popisek tlačítka: název a hodnota, nebo jen hodnota. */
export function popisSlevy(s: PrednastavenaSleva): string {
  return s.nazev ? `${s.nazev} · ${hodnotaSlevy(s)}` : hodnotaSlevy(s);
}

/** Je tahle přednastavená sleva právě na zakázce? */
export function jeSlevaAktivni(
  s: Pick<PrednastavenaSleva, "typ" | "hodnota">,
  typ: "percentage" | "amount" | null | undefined,
  hodnota: number | null | undefined,
): boolean {
  return typ === s.typ && Math.abs((hodnota ?? 0) - s.hodnota) < 0.005;
}
