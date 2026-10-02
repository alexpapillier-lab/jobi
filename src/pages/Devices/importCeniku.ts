/**
 * Aktualizace ceníku z upraveného sešitu (protějšek exportCeniku.ts).
 *
 * Servis si ceník stáhne, v Excelu doplní náklady nebo přepíše ceny
 * a nahraje ho zpátky. Opravy se párují přes ID opravy z prvního
 * sloupce – název není jedinečný („Výměna displeje“ má servis u každého
 * modelu jinou). Mění se jen pole, která v sešitu jsou a liší se;
 * prázdná buňka znamená „nechat“, ne „smazat“ – jinak by sešit, ve
 * kterém někdo doplnil jen pár nákladů, vymazal popisy u všeho ostatního.
 *
 * Značka, kategorie a modely se z sešitu neberou: jsou tam pro orientaci
 * a struktura ceníku se mění ve stromu, ne v tabulce.
 */
import type { DevicesData, Repair } from "./types";
import type { HodnotaBunky } from "../../lib/xlsxCteni";

export type PoleOpravy = Pick<Repair, "name" | "price" | "costs" | "estimatedTime" | "warrantyMonths" | "details" | "publicVisible">;

export type ZmenaOpravy = {
  id: string;
  nazev: string;
  nove: Partial<PoleOpravy>;
  puvodni: Partial<PoleOpravy>;
};

export type PlanAktualizace = {
  zmeny: ZmenaOpravy[];
  /** ID ze sešitu, která v ceníku nejsou (smazané opravy, cizí sešit). */
  neznama: string[];
  /** Řádky s nečitelnou hodnotou – ty se přeskočí celé. */
  chyby: string[];
  bezeZmeny: number;
};

/** Hlavičky sloupců, které se umí přečíst. Porovnává se bez diakritiky a velikosti písmen. */
const SLOUPCE: Record<keyof PoleOpravy | "id", string[]> = {
  id: ["id opravy", "id"],
  name: ["oprava", "nazev", "název"],
  price: ["cena (kc)", "cena"],
  costs: ["naklady (kc)", "naklady", "náklady"],
  estimatedTime: ["cas (min)", "cas", "čas"],
  warrantyMonths: ["zaruka (mes.)", "zaruka", "záruka"],
  details: ["popis"],
  publicVisible: ["v api", "api"],
};

function klic(s: unknown): string {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Čísla z Excelu přijdou jako čísla; z ručně psané buňky jako „1 490,50 Kč“ (i s pevnou mezerou). */
export function prectiCislo(h: HodnotaBunky | undefined): number | null | "chyba" {
  if (h === undefined || h === "") return null;
  if (typeof h === "number") return Number.isFinite(h) ? h : "chyba";
  const t = String(h).replace(/kč|czk/gi, "").replace(/\s/g, "").replace(",", ".");
  if (t === "" || t === "-" || t === "—") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : "chyba";
}

function prectiAnoNe(h: HodnotaBunky | undefined): boolean | null | "chyba" {
  const t = klic(h);
  if (t === "") return null;
  if (["ano", "a", "yes", "y", "true", "1"].includes(t)) return true;
  if (["ne", "n", "no", "false", "0"].includes(t)) return false;
  return "chyba";
}

function hodnota(radek: HodnotaBunky[], index: number | undefined): HodnotaBunky | undefined {
  if (index === undefined) return undefined;
  return radek[index];
}

/** Rozpozná sloupce podle hlavičky; chybí-li ID, sešit se nedá použít. */
function mapujSloupce(hlavicka: HodnotaBunky[]): Partial<Record<keyof PoleOpravy | "id", number>> {
  const out: Partial<Record<keyof PoleOpravy | "id", number>> = {};
  hlavicka.forEach((h, i) => {
    const k = klic(h);
    for (const [pole, nazvy] of Object.entries(SLOUPCE) as Array<[keyof PoleOpravy | "id", string[]]>) {
      if (out[pole] === undefined && nazvy.includes(k)) out[pole] = i;
    }
  });
  return out;
}

export function naplanujAktualizaci(data: DevicesData, radky: HodnotaBunky[][]): PlanAktualizace {
  const plan: PlanAktualizace = { zmeny: [], neznama: [], chyby: [], bezeZmeny: 0 };
  const hlavicka = radky[0] ?? [];
  const s = mapujSloupce(hlavicka);
  if (s.id === undefined) {
    plan.chyby.push("V prvním řádku chybí sloupec „ID opravy“. Použijte sešit z Exportu XLSX.");
    return plan;
  }
  const opravy = new Map(data.repairs.map((r) => [r.id, r]));

  radky.slice(1).forEach((radek, i) => {
    const cisloRadku = i + 2;
    const id = String(hodnota(radek, s.id) ?? "").trim();
    if (!id) return; // prázdný řádek
    const r = opravy.get(id);
    if (!r) { plan.neznama.push(id); return; }

    const nove: Partial<PoleOpravy> = {};
    const puvodni: Partial<PoleOpravy> = {};
    const chybyRadku: string[] = [];
    const nastav = <K extends keyof PoleOpravy>(pole: K, hodn: PoleOpravy[K]) => {
      if (hodn === r[pole] || (hodn == null && r[pole] == null)) return;
      nove[pole] = hodn;
      puvodni[pole] = r[pole];
    };

    const nazev = hodnota(radek, s.name);
    if (nazev !== undefined && String(nazev).trim() !== "") nastav("name", String(nazev).trim());

    for (const [pole, popis, cele, minimum] of [
      ["price", "cena", false, 0],
      ["costs", "náklady", false, 0],
      ["estimatedTime", "čas", true, 0],
      ["warrantyMonths", "záruka", true, 0],
    ] as Array<[keyof PoleOpravy, string, boolean, number]>) {
      const n = prectiCislo(hodnota(radek, s[pole]));
      if (n === "chyba") { chybyRadku.push(`${popis} „${String(hodnota(radek, s[pole]))}“ není číslo`); continue; }
      if (n === null) continue;
      if (n < minimum || (cele && !Number.isInteger(n))) { chybyRadku.push(`${popis} ${n} není ${cele ? "celé " : ""}nezáporné číslo`); continue; }
      nastav(pole, n as never);
    }

    const popis = hodnota(radek, s.details);
    if (popis !== undefined && String(popis).trim() !== "") nastav("details", String(popis).trim());

    const api = prectiAnoNe(hodnota(radek, s.publicVisible));
    if (api === "chyba") chybyRadku.push(`V API „${String(hodnota(radek, s.publicVisible))}“ má být ano nebo ne`);
    else if (api !== null && api !== (r.publicVisible !== false)) { nove.publicVisible = api; puvodni.publicVisible = r.publicVisible !== false; }

    if (chybyRadku.length > 0) {
      plan.chyby.push(`Řádek ${cisloRadku} (${r.name}): ${chybyRadku.join("; ")}`);
      return;
    }
    if (Object.keys(nove).length === 0) { plan.bezeZmeny += 1; return; }
    plan.zmeny.push({ id, nazev: r.name, nove, puvodni });
  });

  return plan;
}

export function aplikujAktualizaci(data: DevicesData, zmeny: ZmenaOpravy[]): DevicesData {
  const podleId = new Map(zmeny.map((z) => [z.id, z.nove]));
  return {
    ...data,
    repairs: data.repairs.map((r) => {
      const n = podleId.get(r.id);
      return n ? { ...r, ...n } : r;
    }),
  };
}

export const POPIS_POLE: Record<keyof PoleOpravy, string> = {
  name: "název",
  price: "cena",
  costs: "náklady",
  estimatedTime: "čas",
  warrantyMonths: "záruka",
  details: "popis",
  publicVisible: "v API",
};

export function popisHodnoty(pole: keyof PoleOpravy, h: unknown): string {
  if (h === undefined || h === null || h === "") return "—";
  if (pole === "publicVisible") return h === false ? "ne" : "ano";
  if (pole === "price" || pole === "costs") return `${Number(h).toLocaleString("cs-CZ")} Kč`;
  if (pole === "estimatedTime") return `${h} min`;
  if (pole === "warrantyMonths") return `${h} měs.`;
  return String(h);
}
