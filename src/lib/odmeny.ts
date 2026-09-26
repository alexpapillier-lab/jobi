/**
 * Odměny týmu – prémie za nabídnuté opravy.
 *
 * Kdo zákazníkovi nabídne servisní čištění, dostane 100 Kč; za aplikaci
 * ochranného skla 50 Kč, za výměnu těsnění 30 Kč. Pravidla si servis
 * nastaví (Nastavení → Tým → Odměny za opravy), počítá je databáze
 * (`odmeny_prehled`, migrace 20260926190000) z vydaných zakázek a stránka
 * Odměny ukáže, kdo má za měsíc kolik a kdo je zaměstnanec měsíce.
 *
 * Tady je jen to, co potřebuje prohlížeč: tvar nastavení, jeho čtení
 * z configu servisu (tolerantní – config píše i starší aplikace), výpočet
 * jedné odměny pro náhled v nastavení (stejný vzorec jako v SQL) a
 * pomocníci pro měsíce a zaměstnance měsíce.
 */

export type TypOdmeny = "castka" | "procento";
export type KomuOdmena = "pridal" | "technik";

export type PravidloOdmeny = {
  id: string;
  /** Popisek v přehledu; prázdný = hledaný text. */
  nazev: string;
  /** Text v názvu opravy (bez ohledu na velikost písmen), např. „servisní čištění“. */
  hledat: string;
  typ: TypOdmeny;
  /** Kč, nebo procento z ceny opravy. */
  hodnota: number;
  /** Komu: kdo opravu na zakázku přidal (nabídl), nebo přidělený technik. */
  komu: KomuOdmena;
  aktivni: boolean;
};

export type NastaveniOdmen = {
  pravidla: PravidloOdmeny[];
  /** Kolegové vidí i cizí odměny a žebříček (zaměstnanec měsíce). */
  verejny_zebricek: boolean;
};

export const VYCHOZI_NASTAVENI_ODMEN: NastaveniOdmen = { pravidla: [], verejny_zebricek: true };

export const MAX_PRAVIDEL_ODMEN = 50;

export function noveIdPravidla(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function cislo(v: unknown): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/** Tolerantní čtení `service_settings.config.odmeny`. Cokoli rozbitého se přeskočí. */
export function normalizujOdmeny(raw: unknown): NastaveniOdmen {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pravidla: PravidloOdmeny[] = [];
  const seznam = Array.isArray(o.pravidla) ? o.pravidla : [];
  for (const r of seznam) {
    if (!r || typeof r !== "object") continue;
    const p = r as Record<string, unknown>;
    const hledat = typeof p.hledat === "string" ? p.hledat.trim() : "";
    if (!hledat) continue;
    pravidla.push({
      id: typeof p.id === "string" && p.id ? p.id : noveIdPravidla(),
      nazev: typeof p.nazev === "string" ? p.nazev.trim() : "",
      hledat,
      typ: p.typ === "procento" ? "procento" : "castka",
      hodnota: Math.max(0, cislo(p.hodnota)),
      komu: p.komu === "technik" ? "technik" : "pridal",
      aktivni: p.aktivni !== false,
    });
    if (pravidla.length >= MAX_PRAVIDEL_ODMEN) break;
  }
  return { pravidla, verejny_zebricek: o.verejny_zebricek !== false };
}

/** Sedí pravidlo na opravu? Stejné pravidlo jako v SQL: `lower(name) like '%hledat%'`. */
export function pravidloSedi(pravidlo: PravidloOdmeny, nazevOpravy: string): boolean {
  const h = pravidlo.hledat.trim().toLowerCase();
  return h.length > 0 && nazevOpravy.toLowerCase().includes(h);
}

/** Odměna za jednu opravu podle pravidla; procenta z ceny opravy, na haléře. */
export function castkaOdmeny(pravidlo: PravidloOdmeny, cenaOpravy: number): number {
  if (pravidlo.typ === "procento") return Math.round(cenaOpravy * pravidlo.hodnota) / 100;
  return Math.round(pravidlo.hodnota * 100) / 100;
}

/** První aktivní pravidlo v pořadí, které na opravu sedí (nejvýš jedno na opravu). */
export function najdiPravidlo(pravidla: PravidloOdmeny[], nazevOpravy: string): PravidloOdmeny | null {
  return pravidla.find((p) => p.aktivni && pravidloSedi(p, nazevOpravy)) ?? null;
}

// ---------------------------------------------------------------------------
// Měsíce
// ---------------------------------------------------------------------------

/** „2026-09“ z data (v místním čase). */
export function klicMesice(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function posunKlicMesice(klic: string, delta: number): string {
  const [r, m] = klic.split("-").map(Number);
  const idx = r * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

const MESICE = ["leden", "únor", "březen", "duben", "květen", "červen", "červenec", "srpen", "září", "říjen", "listopad", "prosinec"];

/** „Září 2026“ */
export function nazevMesice(klic: string): string {
  const [r, m] = klic.split("-").map(Number);
  const n = MESICE[(m ?? 1) - 1] ?? klic;
  return `${n.charAt(0).toUpperCase()}${n.slice(1)} ${r}`;
}

/** Hranice měsíce v místním čase – začátek včetně, konec = poslední milisekunda. */
export function hraniceMesice(klic: string): { od: Date; do: Date } {
  const [r, m] = klic.split("-").map(Number);
  const od = new Date(r, m - 1, 1, 0, 0, 0, 0);
  const konec = new Date(r, m, 1, 0, 0, 0, 0);
  return { od, do: new Date(konec.getTime() - 1) };
}

// ---------------------------------------------------------------------------
// Zaměstnanec měsíce
// ---------------------------------------------------------------------------

export type ClovekOdmeny = { userId: string | null; jmeno: string; pocet: number; castka: number };

/**
 * Kdo vede: nejvyšší součet, při shodě víc oprav. Nepřiřazené řádky (bez
 * člověka) se nikdy nestanou zaměstnancem měsíce. Remíza = víc vítězů.
 */
export function zamestnanecMesice(lide: ClovekOdmeny[]): ClovekOdmeny[] {
  const kandidati = lide.filter((l) => l.userId && l.castka > 0);
  if (kandidati.length === 0) return [];
  const max = Math.max(...kandidati.map((l) => l.castka));
  const nejvic = kandidati.filter((l) => l.castka === max);
  const maxPocet = Math.max(...nejvic.map((l) => l.pocet));
  return nejvic.filter((l) => l.pocet === maxPocet);
}
