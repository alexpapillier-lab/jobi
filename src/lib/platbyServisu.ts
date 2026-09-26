/**
 * Platby servisů majiteli aplikace – jedno pravidlo pro stav platby.
 *
 * Používá ho Owner → Platby servisů, upozornění po přihlášení i e-mailová
 * připomínka (edge funkce platby-pripominka má stejnou logiku v Deno –
 * když se tu něco změní, změnit i tam).
 */

export type PlatbaServisu = {
  serviceId: string;
  nazev: string;
  aktivniServis: boolean;
  cenaMesicne: number;
  /** 1–28 */
  denPlatby: number;
  /** Servis platí (řádek v platby_nastaveni a zapnutý). */
  aktivni: boolean;
  poznamka: string | null;
  maNastaveni: boolean;
  /** „2026-09“ – měsíc, ke kterému se vztahuje `zaplacenoAt`. */
  obdobi: string;
  zaplacenoAt: string | null;
  zaplacenoCastka: number | null;
  posledniObdobi: string | null;
};

export type StavPlatby = "neaktivni" | "zaplaceno" | "ceka" | "splatne" | "po_splatnosti";

/** „2026-09“ z data v místním čase. */
export function obdobiZData(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Kolik dní je platba po dni platby v daném měsíci (záporně = ještě před). */
export function dniPoSplatnosti(denPlatby: number, obdobi: string, dnes: Date): number {
  const [r, m] = obdobi.split("-").map(Number);
  const splatnost = new Date(r, m - 1, Math.min(Math.max(denPlatby, 1), 28));
  const d0 = new Date(dnes.getFullYear(), dnes.getMonth(), dnes.getDate());
  return Math.round((d0.getTime() - splatnost.getTime()) / 86_400_000);
}

/**
 * Stav platby za měsíc `p.obdobi` k datu `dnes`.
 * - neaktivni: servis neplatí (nebo je servis vypnutý),
 * - zaplaceno: za měsíc je zapsaná platba,
 * - ceka: den platby ještě nenastal,
 * - splatne: dnes je den platby (nebo do 3 dnů po něm) a nezaplaceno,
 * - po_splatnosti: víc než 3 dny po dni platby a nezaplaceno.
 */
export function stavPlatby(p: PlatbaServisu, dnes: Date): StavPlatby {
  if (!p.aktivni || !p.aktivniServis || p.cenaMesicne <= 0) return "neaktivni";
  if (p.zaplacenoAt) return "zaplaceno";
  const dni = dniPoSplatnosti(p.denPlatby, p.obdobi, dnes);
  if (dni < 0) return "ceka";
  return dni > 3 ? "po_splatnosti" : "splatne";
}

export const POPIS_STAVU: Record<StavPlatby, string> = {
  neaktivni: "neplatí",
  zaplaceno: "zaplaceno",
  ceka: "čeká na den platby",
  splatne: "k zaplacení",
  po_splatnosti: "po splatnosti",
};

/** Součet měsíčních plateb aktivních servisů. */
export function mesicniPrijem(seznam: PlatbaServisu[]): number {
  return seznam.filter((p) => p.aktivni && p.aktivniServis).reduce((s, p) => s + (Number(p.cenaMesicne) || 0), 0);
}

/** Servisy, které mají dnes nebo už dřív zaplatit a nezaplatily. */
export function kPripomenuti(seznam: PlatbaServisu[], dnes: Date): Array<PlatbaServisu & { stav: StavPlatby; dni: number }> {
  return seznam
    .map((p) => ({ ...p, stav: stavPlatby(p, dnes), dni: dniPoSplatnosti(p.denPlatby, p.obdobi, dnes) }))
    .filter((p) => p.stav === "splatne" || p.stav === "po_splatnosti")
    .sort((a, b) => b.dni - a.dni);
}

/** Tolerantní převod řádku z RPC platby_prehled. */
export function prevedPlatbu(raw: unknown): PlatbaServisu {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const cislo = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  return {
    serviceId: String(o.serviceId ?? ""),
    nazev: typeof o.nazev === "string" && o.nazev ? o.nazev : "Servis",
    aktivniServis: o.aktivniServis !== false,
    cenaMesicne: cislo(o.cenaMesicne),
    denPlatby: Math.min(28, Math.max(1, cislo(o.denPlatby) || 1)),
    aktivni: o.aktivni === true,
    poznamka: typeof o.poznamka === "string" ? o.poznamka : null,
    maNastaveni: o.maNastaveni === true,
    obdobi: typeof o.obdobi === "string" ? o.obdobi : obdobiZData(new Date()),
    zaplacenoAt: typeof o.zaplacenoAt === "string" ? o.zaplacenoAt : null,
    zaplacenoCastka: o.zaplacenoCastka === null || o.zaplacenoCastka === undefined ? null : cislo(o.zaplacenoCastka),
    posledniObdobi: typeof o.posledniObdobi === "string" ? o.posledniObdobi : null,
  };
}
