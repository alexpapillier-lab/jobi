/**
 * Sekce v detailu zakázky: které jdou skrýt a jakou mají barvu.
 *
 * Detail má přes deset karet a všechny vypadaly stejně – šedý rámeček,
 * tučný nadpis. Při scrollování se pak hledalo podle textu. Každá sekce
 * má proto svou barvu (proužek vlevo a podbarvená ikona), ať se pozná
 * na první pohled, kde člověk je.
 *
 * A servis, který zákaznický portál, zápůjčky nebo kontrolu po opravě
 * nepoužívá, si je vypne v Nastavení (service_settings.config.skryte_sekce_detailu)
 * – sdílené pro celý servis, stejně jako přidělování technika.
 */

export type SekceDetailu =
  | "zakaznik"
  | "zarizeni"
  | "opravy"
  | "portal"
  | "diagnostika"
  | "nahradni"
  | "technik"
  | "cas"
  | "kontrola";

/** Barva sekce – proužek vlevo a ikona v hlavičce. Sytější odstíny, ať jdou vidět i na tmavém motivu. */
export const BARVA_SEKCE: Record<SekceDetailu, string> = {
  zakaznik: "#2563eb",
  zarizeni: "#7c3aed",
  opravy: "#16a34a",
  portal: "#0891b2",
  diagnostika: "#d97706",
  nahradni: "#4f46e5",
  technik: "#db2777",
  cas: "#0d9488",
  kontrola: "#059669",
};

/** Které sekce jde v Nastavení skrýt. Technik se řídí přidělováním technika (config.pridelovani_technika). */
export type SkrytelnaSekce = Extract<SekceDetailu, "portal" | "nahradni" | "kontrola">;

export const SKRYTELNE_SEKCE: ReadonlyArray<{ klic: SkrytelnaSekce; nazev: string; popis: string }> = [
  { klic: "portal", nazev: "Zákaznický portál", popis: "Odkaz pro zákazníka, cenová nabídka ke schválení, podpis převzetí. Bez portálu zmizí i krok „Nabídka zákazníkovi“ z postupu zakázky." },
  { klic: "nahradni", nazev: "Náhradní zařízení", popis: "Zápůjčka zařízení na dobu opravy a smlouva k ní." },
  { klic: "kontrola", nazev: "Kontrola po opravě", popis: "Kontrolní seznam před předáním. Bez něj zmizí i krok „Kontrola po opravě“ z postupu zakázky." },
];

const SKRYTELNE = new Set<string>(SKRYTELNE_SEKCE.map((s) => s.klic));

/** Z configu (cokoli) na množinu skrytých sekcí. Neznámé klíče se ignorují. */
export function normalizujSkryteSekce(raw: unknown): Set<SkrytelnaSekce> {
  const out = new Set<SkrytelnaSekce>();
  if (!Array.isArray(raw)) return out;
  for (const k of raw) if (typeof k === "string" && SKRYTELNE.has(k)) out.add(k as SkrytelnaSekce);
  return out;
}

/** Styl karty sekce: barevný proužek vlevo. Přidává se k běžnému stylu karty. */
export function stylSekce(sekce: SekceDetailu): React.CSSProperties {
  return { borderLeft: `4px solid ${BARVA_SEKCE[sekce]}` };
}
