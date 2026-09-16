/**
 * Provize do Google Sheets – co poslat do tabulky, čistě z dat.
 *
 * Bez Deno API, aby se dalo testovat z Jobi (vitest), stejně jako `penize.ts`.
 * Pravidla jsou převzatá z bota zakazkovylist-bot (pushOrderResult), který
 * dělal totéž nad Zakázkovým listem – Apps Script nad tabulkou zůstal stejný,
 * takže i tvar řádků musí zůstat stejný:
 *
 *  - nová zakázka ve stavu Připraveno/Vydáno → řádek {id, cena, status};
 *  - v tabulce jako Připraveno, teď Vydáno → řádek {id, uložená cena,
 *    "Vydáno"} (Apps Script u existující zakázky cenu nemění, jen ji uzavře)
 *    a když je konečná cena vyšší, samostatný řádek `<id>-DOPLATEK` s rozdílem;
 *  - v tabulce s cenou 0, teď s cenou → {id, cena, status, correct: true}
 *    (Apps Script přepíše jen nevyúčtovaný řádek).
 *
 * Sazba provize (7,5 %) je v Apps Scriptu, tady se nepočítá.
 */

import { cenaZakazky, type TypSlevy } from "./penize.ts";

export const STATUS_PRIPRAVENO = "Připraveno k převzetí";
export const STATUS_VYDANO = "Vydáno";

export type RadekTabulky = { id: string; cena: number; status: string };

export type RadekKOdeslani = {
  zakazka_id: string;
  cena_czk: number;
  status: string;
  correct?: boolean;
};

export type ZakazkaProProvizi = {
  code: string | null;
  /** Název statusu v Jobi (label), ne klíč. */
  statusLabel: string;
  performed_repairs: unknown;
  discount_type: string | null;
  discount_value: number | null;
};

export type PlanProvizi = {
  radky: RadekKOdeslani[];
  nove: number;
  doplatky: number;
  opraveno: number;
  uzavreno: number;
};

function opravy(v: unknown): Array<{ price?: number | null }> {
  return Array.isArray(v) ? (v as Array<{ price?: number | null }>) : [];
}

/** Konečná cena zakázky – totéž číslo jako na kartě a na dokladu. */
export function cenaProProvizi(z: ZakazkaProProvizi): number {
  return cenaZakazky(opravy(z.performed_repairs), z.discount_type as TypSlevy, z.discount_value);
}

/**
 * Sestaví řádky k odeslání. `vTabulce` je aktuální obsah tabulky
 * (list_orders), včetně řádků `-DOPLATEK`. Zakázky bez kódu a mimo sledované
 * statusy se přeskočí.
 */
export function naplanujProvize(
  zakazky: ZakazkaProProvizi[],
  vTabulce: RadekTabulky[],
  statusy: { pripraveno: string; vydano: string } = { pripraveno: STATUS_PRIPRAVENO, vydano: STATUS_VYDANO },
): PlanProvizi {
  const tabulka = new Map<string, RadekTabulky>();
  for (const r of vTabulce) {
    const id = String(r.id ?? "").trim();
    if (id) tabulka.set(id, { id, cena: Number.isFinite(Number(r.cena)) ? Number(r.cena) : 0, status: String(r.status ?? "").trim() });
  }

  const plan: PlanProvizi = { radky: [], nove: 0, doplatky: 0, opraveno: 0, uzavreno: 0 };
  const videno = new Set<string>();

  for (const z of zakazky) {
    const id = (z.code ?? "").trim();
    if (!id || videno.has(id)) continue;
    videno.add(id);

    // Do tabulky jde vždy název z tabulky (ZL), i kdyby si servis status v Jobi přejmenoval.
    const status = z.statusLabel === statusy.vydano ? STATUS_VYDANO : z.statusLabel === statusy.pripraveno ? STATUS_PRIPRAVENO : null;
    if (!status) continue;

    const cena = cenaProProvizi(z);
    const existujici = tabulka.get(id);

    if (!existujici) {
      plan.radky.push({ zakazka_id: id, cena_czk: cena, status });
      plan.nove++;
      continue;
    }

    if (existujici.status === STATUS_PRIPRAVENO && status === STATUS_VYDANO) {
      plan.radky.push({ zakazka_id: id, cena_czk: existujici.cena, status: STATUS_VYDANO });
      plan.uzavreno++;
      const rozdil = Math.round((cena - existujici.cena) * 100) / 100;
      const doplatekId = `${id}-DOPLATEK`;
      if (rozdil > 0.005 && !tabulka.has(doplatekId)) {
        plan.radky.push({ zakazka_id: doplatekId, cena_czk: rozdil, status: STATUS_VYDANO });
        plan.doplatky++;
      }
      continue;
    }

    if (existujici.cena === 0 && cena > 0) {
      plan.radky.push({ zakazka_id: id, cena_czk: cena, status, correct: true });
      plan.opraveno++;
    }
  }

  return plan;
}
