/**
 * Export ceníku oprav do sešitu .xlsx.
 *
 * Vznikl kvůli doplňování nákladů: servis má stovky oprav a u řady z nich
 * náklady chybí, takže marže ve statistikách nesedí. V tabulce se to
 * doplní za chvíli, v aplikaci po jedné opravě ne. Řádek je jedna oprava
 * (náklady jsou na opravě, ne na dvojici oprava–model), modely se vypisují
 * do jedné buňky. ID opravy je v prvním sloupci – přes ně jde hodnoty
 * poslat zpátky zápisem přes veřejné API (`/v1/write`, pole `costs`).
 */
import type { DevicesData, Repair } from "./types";
import type { List } from "../../lib/xlsx";

export const HLAVICKA_CENIKU = [
  "ID opravy", "Značka", "Kategorie", "Modely", "Oprava",
  "Cena (Kč)", "Náklady (Kč)", "Marže (Kč)", "Čas (min)", "Záruka (měs.)", "Popis", "V API",
] as const;

const SIRKY = [38, 14, 16, 36, 32, 11, 13, 11, 10, 13, 40, 7];

type Radek = {
  id: string;
  znacka: string;
  kategorie: string;
  modely: string;
  oprava: Repair;
};

function spojUnikatni(hodnoty: string[]): string {
  return [...new Set(hodnoty.filter(Boolean))].join(", ");
}

/** Řádky v pořadí značka › kategorie › název opravy (česky řazeno). */
export function radkyCeniku(data: DevicesData): Radek[] {
  const modely = new Map(data.models.map((m) => [m.id, m]));
  const kategorie = new Map(data.categories.map((c) => [c.id, c]));
  const znacky = new Map(data.brands.map((b) => [b.id, b]));
  const porovnej = new Intl.Collator("cs").compare;

  const radky: Radek[] = data.repairs.map((r) => {
    const jeho = (r.modelIds ?? []).map((id) => modely.get(id)).filter((m): m is NonNullable<typeof m> => !!m);
    const kat = jeho.map((m) => kategorie.get(m.categoryId)).filter((c): c is NonNullable<typeof c> => !!c);
    const zn = kat.map((c) => znacky.get(c.brandId)).filter((b): b is NonNullable<typeof b> => !!b);
    return {
      id: r.id,
      znacka: spojUnikatni(zn.map((b) => b.name)),
      kategorie: spojUnikatni(kat.map((c) => c.name)),
      modely: spojUnikatni(jeho.map((m) => m.name)),
      oprava: r,
    };
  });

  return radky.sort((a, b) =>
    porovnej(a.znacka, b.znacka) || porovnej(a.kategorie, b.kategorie) || porovnej(a.oprava.name, b.oprava.name),
  );
}

/** List sešitu s ceníkem – vstup pro vytvorXlsx. */
export function listCeniku(data: DevicesData): List {
  return {
    nazev: "Ceník oprav",
    hlavicka: [...HLAVICKA_CENIKU],
    sirky: SIRKY,
    radky: radkyCeniku(data).map(({ id, znacka, kategorie, modely, oprava: r }) => {
      const naklady = typeof r.costs === "number" ? r.costs : null;
      return [
        id,
        znacka,
        kategorie,
        modely,
        r.name,
        r.price,
        naklady,
        naklady === null ? null : Math.round((r.price - naklady) * 100) / 100,
        r.estimatedTime,
        r.warrantyMonths ?? null,
        r.details || null,
        r.publicVisible === false ? "ne" : "ano",
      ];
    }),
  };
}

export function nazevSouboruCeniku(ted = new Date()): string {
  return `cenik-oprav-${ted.toISOString().slice(0, 10)}.xlsx`;
}
