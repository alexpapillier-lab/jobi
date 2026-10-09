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
 *
 * Ruční odměny (migrace 20261009100000): zaměstnanec si na stránce Odměny
 * přidá odměnu podle pravidla s poznámkou; čeká na schválení správcem
 * (nebo se schválí automaticky, má-li to zapnuté). Částku počítá server
 * (`odmeny_rucni_pridat`), tady je jen stejný výpočet pro náhled a čtení
 * odpovědi `odmeny_prehled` (pole `rucni`, `cekajici`, `pravidla`).
 *
 * Kdy se odměna připočítá (migrace 20261009120000, `config.odmeny.kdy`):
 * po vydání zakázky (výchozí), hned po přidání opravy, nebo až zakázka
 * poprvé dosáhne vybraného stavu. Ruční odměny se řídí svým měsícem.
 */

import { jeStornoStav } from "./stornoStav";

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

/**
 * Kdy se odměna za opravu připočítá (a do kterého měsíce):
 * - vydani – zakázka vydaná (koncový stav, ne storno), měsíc vydání;
 * - pridani – hned, jak je oprava s příznakem na zakázce, měsíc přidání;
 * - stav – zakázka poprvé dosáhla vybraného stavu (nebo stavu dál v pořadí).
 * Storno se nepočítá nikdy.
 */
export type RezimOdmen = "vydani" | "pridani" | "stav";

export type KdyOdmeny = {
  rezim: RezimOdmen;
  /** Klíč stavu ze service_statuses – jen u režimu „stav“. */
  stav?: string;
};

export const VYCHOZI_KDY_ODMENY: KdyOdmeny = { rezim: "vydani" };

export type NastaveniOdmen = {
  pravidla: PravidloOdmeny[];
  /** Kolegové vidí i cizí odměny a žebříček (zaměstnanec měsíce). */
  verejny_zebricek: boolean;
  /**
   * Stránka Odměny v navigaci celého týmu. Chybí-li v configu, řídí se tím,
   * jestli existuje aktivní pravidlo – majitel ji tak může ukázat i dřív
   * (třeba na zkoušku) nebo naopak schovat, i když pravidla platí.
   */
  zobrazit_v_navigaci: boolean;
  /** Kdy se odměna připočítá; chybí = po vydání (chování do 9. 10. 2026). */
  kdy: KdyOdmeny;
};

export const VYCHOZI_NASTAVENI_ODMEN: NastaveniOdmen = { pravidla: [], verejny_zebricek: true, zobrazit_v_navigaci: false, kdy: VYCHOZI_KDY_ODMENY };

export const MAX_PRAVIDEL_ODMEN = 50;

export function noveIdPravidla(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const textNeboNull = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

function cislo(v: unknown): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Tolerantní čtení `config.odmeny.kdy`. Neznámý režim nebo „stav“ bez klíče
 * stavu = po vydání – stejně to vyhodnotí databáze (`odmeny_prehled`).
 */
export function normalizujKdy(raw: unknown): KdyOdmeny {
  const o = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  if (o.rezim === "pridani") return { rezim: "pridani" };
  if (o.rezim === "stav") {
    const stav = typeof o.stav === "string" ? o.stav.trim() : "";
    return stav ? { rezim: "stav", stav } : { rezim: "vydani" };
  }
  return { rezim: "vydani" };
}

/** Krátké popisky voleb v Nastavení (radio) – název a vysvětlení. */
export const VOLBY_KDY_ODMENY: { rezim: RezimOdmen; nazev: string; popis: string }[] = [
  { rezim: "vydani", nazev: "Po vydání zakázky", popis: "Odměna přibude, až je zakázka vydaná (koncový stav, ne storno), v měsíci vydání. Nejjistější – za nevyzvednutou nebo stornovanou zakázku nic." },
  { rezim: "pridani", nazev: "Po přidání opravy", popis: "Odměna se počítá hned, jak je oprava s příznakem Nabídnuto navíc na zakázce, v měsíci přidání. Kdyby zakázka skončila ve stornu, odměna zmizí." },
  { rezim: "stav", nazev: "Když zakázka dosáhne stavu", popis: "Odměna přibude, až zakázka poprvé přejde do vybraného stavu (nebo ho přeskočí do stavu dál v pořadí), v měsíci toho přechodu. Storno se nepočítá." },
];

/**
 * Věta pod nadpisem stránky Odměny – odkud se odměny berou.
 * `stavNazev` = název stavu u režimu „stav“ (z odpovědi serveru).
 */
export function vetaKdyOdmeny(rezim: RezimOdmen, stavNazev?: string | null): string {
  if (rezim === "pridani") return "Počítá se z oprav přidaných na zakázky v měsíci; storno nic nedostane.";
  if (rezim === "stav") {
    const s = stavNazev?.trim();
    return s ? `Počítá se ze zakázek, které v měsíci poprvé dosáhly stavu „${s}“ (nebo stavu dál); storno nic nedostane.` : "Počítá se ze zakázek, které v měsíci dosáhly vybraného stavu; storno nic nedostane.";
  }
  return "Počítá se ze zakázek vydaných v měsíci; storno nic nedostane.";
}

type StavServisu = { key: string; label: string; isFinal: boolean };

/** Stavy, které jde vybrat u režimu „stav“: všechny v pořadí servisu kromě storna. */
export function stavyProOdmeny<T extends StavServisu>(stavy: readonly T[]): T[] {
  return stavy.filter((s) => !jeStornoStav(s.key, s.label));
}

/**
 * Předvybraný stav, když správce přepne na „Když zakázka dosáhne stavu“:
 * poslední nekoncový stav v pořadí (typicky „Připraveno k vyzvednutí“),
 * jinak první koncový, který není storno.
 */
export function vychoziStavOdmen(stavy: readonly StavServisu[]): string | null {
  const mozne = stavyProOdmeny(stavy);
  const nekoncove = mozne.filter((s) => !s.isFinal);
  return nekoncove[nekoncove.length - 1]?.key ?? mozne[0]?.key ?? null;
}

/** Nadpis sloupce s datem, podle kterého se odměna počítá (Vydáno / Přidáno / Započteno). */
export function sloupecKdyOdmeny(rezim: RezimOdmen): string {
  if (rezim === "pridani") return "Přidáno";
  if (rezim === "stav") return "Započteno";
  return "Vydáno";
}

/** Tolerantní čtení pole `kdy` z odpovědi `odmeny_prehled` (platný režim po kontrole stavu). */
export function normalizujKdyOdpovedi(raw: unknown): { rezim: RezimOdmen; stav: string | null; stavNazev: string | null } {
  const o = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const rezim: RezimOdmen = o.rezim === "pridani" || o.rezim === "stav" ? o.rezim : "vydani";
  return { rezim, stav: textNeboNull(o.stav), stavNazev: textNeboNull(o.stavNazev) };
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
  const maAktivni = pravidla.some((p) => p.aktivni);
  return {
    pravidla,
    verejny_zebricek: o.verejny_zebricek !== false,
    zobrazit_v_navigaci: typeof o.zobrazit_v_navigaci === "boolean" ? o.zobrazit_v_navigaci : maAktivni,
    kdy: normalizujKdy(o.kdy),
  };
}

/** Sedí pravidlo na opravu? Stejné pravidlo jako v SQL: `lower(name) like '%hledat%'`. */
export function pravidloSedi(pravidlo: PravidloOdmeny, nazevOpravy: string): boolean {
  const h = pravidlo.hledat.trim().toLowerCase();
  return h.length > 0 && nazevOpravy.toLowerCase().includes(h);
}

/** Odměna za jednu opravu podle pravidla; procenta z ceny opravy, na haléře. */
export function castkaOdmeny(pravidlo: Pick<PravidloOdmeny, "typ" | "hodnota">, cenaOpravy: number): number {
  if (pravidlo.typ === "procento") return Math.round(cenaOpravy * pravidlo.hodnota) / 100;
  return Math.round(pravidlo.hodnota * 100) / 100;
}

/** První aktivní pravidlo v pořadí, které na opravu sedí (nejvýš jedno na opravu). */
export function najdiPravidlo(pravidla: PravidloOdmeny[], nazevOpravy: string): PravidloOdmeny | null {
  return pravidla.find((p) => p.aktivni && pravidloSedi(p, nazevOpravy)) ?? null;
}

/** Je oprava zmíněná v textu požadované opravy z příjmu (podle názvu nebo hledaného textu pravidla)? */
export function opravaVPozadavku(pozadovana: string | null | undefined, nazevOpravy: string, pravidlo?: PravidloOdmeny | null): boolean {
  const text = (pozadovana ?? "").toLowerCase();
  if (!text.trim()) return false;
  const n = nazevOpravy.trim().toLowerCase();
  if (n && text.includes(n)) return true;
  const h = pravidlo?.hledat.trim().toLowerCase() ?? "";
  return h.length > 0 && text.includes(h);
}

/**
 * Výchozí příznak „nabídnuto navíc“ pro opravu přidávanou na zakázku:
 * undefined = žádné pravidlo odměn na ni nesedí (příznak se neukazuje),
 * false = sedí – oprava se ukáže s přepínačem „Nabídnuto navíc?“ a čeká,
 * až ho technik ručně zapne.
 *
 * Do 9. 10. 2026 se příznak odhadoval z požadované opravy z příjmu (není-li
 * v ní, bylo to nabídnuté). Majitel chce rozhodovat ručně: odhad dával
 * odměny i za čištění, o které si zákazník řekl jen ústně. Parametr
 * `pozadovana` zůstává kvůli volajícím, odhad dělá dál `opravaVPozadavku`.
 */
export function vychoziNabidnuto(nazevOpravy: string, _pozadovana: string | null | undefined, pravidla: PravidloOdmeny[]): boolean | undefined {
  const p = najdiPravidlo(pravidla, nazevOpravy);
  if (!p) return undefined;
  return false;
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

// ---------------------------------------------------------------------------
// Ruční odměny
// ---------------------------------------------------------------------------

export type StavRucniOdmeny = "ceka" | "schvaleno" | "zamitnuto";

/** Aktivní pravidlo, jak ho vrací `odmeny_prehled` (pole `pravidla`) – výběr v dialogu Přidat odměnu. */
export type PravidloRucni = { id: string; nazev: string; typ: TypOdmeny; hodnota: number };

export type RucniOdmena = {
  id: string;
  /** Příjemce. */
  userId: string;
  jmeno: string;
  pravidloId: string;
  /** Snímek názvu pravidla v okamžiku přidání. */
  pravidlo: string;
  /** Snímek spočtené odměny (Kč). */
  castka: number;
  /** U procentního pravidla cena, ze které se počítalo. */
  zaklad: number | null;
  poznamka: string;
  /** „2026-10“ */
  obdobi: string;
  stav: StavRucniOdmeny;
  duvodZamitnuti: string | null;
  /** Schváleno automaticky (správce to členovi zapnul), ne ručně. */
  automaticky: boolean;
  vytvoril: string | null;
  vytvorilJmeno: string | null;
  /** Kdo schválil nebo zamítl. */
  schvalil: string | null;
  schvalilJmeno: string | null;
  schvalenoAt: string | null;
  createdAt: string;
  /** Jen když zakázku volající vidí. */
  ticketId: string | null;
  kod: string | null;
  /** Jen správci a u vlastních odměn. */
  zakaznik: string | null;
  zarizeni: string | null;
};


function cisloNeboNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Tolerantní čtení pole `rucni` / `cekajici` z odpovědi `odmeny_prehled`. Řádky bez id se zahodí. */
export function normalizujRucni(raw: unknown): RucniOdmena[] {
  if (!Array.isArray(raw)) return [];
  const vysledek: RucniOdmena[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const r = x as Record<string, unknown>;
    const id = textNeboNull(r.id);
    const userId = textNeboNull(r.userId);
    if (!id || !userId) continue;
    vysledek.push({
      id,
      userId,
      jmeno: textNeboNull(r.jmeno) ?? "Kolega",
      pravidloId: String(r.pravidloId ?? ""),
      pravidlo: String(r.pravidlo ?? ""),
      castka: cislo(r.castka),
      zaklad: cisloNeboNull(r.zaklad),
      poznamka: String(r.poznamka ?? ""),
      obdobi: String(r.obdobi ?? ""),
      stav: r.stav === "schvaleno" || r.stav === "zamitnuto" ? r.stav : "ceka",
      duvodZamitnuti: textNeboNull(r.duvodZamitnuti),
      automaticky: r.automaticky === true,
      vytvoril: textNeboNull(r.vytvoril),
      vytvorilJmeno: textNeboNull(r.vytvorilJmeno),
      schvalil: textNeboNull(r.schvalil),
      schvalilJmeno: textNeboNull(r.schvalilJmeno),
      schvalenoAt: textNeboNull(r.schvalenoAt),
      createdAt: String(r.createdAt ?? ""),
      ticketId: textNeboNull(r.ticketId),
      kod: textNeboNull(r.kod),
      zakaznik: textNeboNull(r.zakaznik),
      zarizeni: textNeboNull(r.zarizeni),
    });
  }
  return vysledek;
}

/** Pole `pravidla` z `odmeny_prehled` (jen aktivní pravidla servisu). */
export function normalizujPravidlaRucni(raw: unknown): PravidloRucni[] {
  if (!Array.isArray(raw)) return [];
  const vysledek: PravidloRucni[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const r = x as Record<string, unknown>;
    const id = textNeboNull(r.id);
    if (!id) continue;
    vysledek.push({ id, nazev: String(r.nazev ?? id), typ: r.typ === "procento" ? "procento" : "castka", hodnota: Math.max(0, cislo(r.hodnota)) });
  }
  return vysledek;
}

/**
 * Náhled ruční odměny – stejný vzorec jako server (`odmeny_rucni_vypocet`).
 * Procentní pravidlo bez kladné ceny = null (nejde spočítat).
 */
export function castkaRucniOdmeny(pravidlo: Pick<PravidloRucni, "typ" | "hodnota">, zaklad: number | null): number | null {
  if (pravidlo.typ === "procento") {
    if (zaklad === null || !Number.isFinite(zaklad) || zaklad <= 0) return null;
    return castkaOdmeny(pravidlo, zaklad);
  }
  return castkaOdmeny(pravidlo, 0);
}

/** „100 Kč“ nebo „12,5 % z ceny“ – popisek pravidla v selectu. */
export function popisPravidla(pravidlo: Pick<PravidloRucni, "typ" | "hodnota">): string {
  const n = pravidlo.hodnota.toLocaleString("cs-CZ", { maximumFractionDigits: 2 });
  return pravidlo.typ === "procento" ? `${n} % z ceny` : `${n} Kč`;
}

/** Cena zadaná uživatelem („1 290,50“) → číslo, prázdné nebo nesmysl = null. */
export function prectiCenu(text: string): number | null {
  const t = text.replace(/\s/g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Kontrola formuláře Přidat odměnu před odesláním (server kontroluje znovu).
 * Vrací text chyby, nebo null když je vše v pořádku.
 */
export function chybaRucniOdmeny(v: { pravidlo: PravidloRucni | null; poznamka: string; zaklad: number | null; obdobi: string }): string | null {
  if (!v.pravidlo) return "Vyberte pravidlo.";
  if (v.pravidlo.typ === "procento" && (v.zaklad === null || v.zaklad <= 0)) return "Zadejte cenu, ze které se odměna počítá.";
  if (v.poznamka.trim().length > 1000) return "Poznámka je moc dlouhá (nejvýš 1000 znaků).";
  if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(v.obdobi)) return "Vyberte měsíc.";
  return null;
}

export const POPIS_STAVU_RUCNI: Record<StavRucniOdmeny, string> = {
  ceka: "čeká na schválení",
  schvaleno: "schváleno",
  zamitnuto: "zamítnuto",
};
