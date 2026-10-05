/**
 * Kdy lidé chodí: rozložení příjmů a výdejů zakázek podle dne v týdnu
 * a hodiny.
 *
 * Servis se podle toho rozhoduje, kdy mít na příjmu dva lidi a kdy stačí
 * jeden, a jestli má smysl otvírat v sobotu. Čas je v databázi v UTC;
 * hodina se bere v pásmu servisu (Praha), jinak by celý graf ujel o hodinu
 * a v létě o dvě.
 *
 * Příjem = založení zakázky (created_at), výdej = přepnutí do koncového
 * stavu (completed_at). Storno se do výdejů nepočítá – nikdo si nic
 * neodnesl.
 */

export type ZakazkaProHodiny = {
  createdAt: string;
  completedAt?: string | null;
  status?: string;
};

export type Udalost = "prijem" | "vydej";

export type RozlozeniHodin = {
  /** [den 0–6 od pondělí][hodina 0–23] */
  matice: number[][];
  podleHodiny: number[];
  podleDne: number[];
  celkem: number;
  /** Nejsilnější buňky, sestupně. */
  spicky: Array<{ den: number; hodina: number; pocet: number }>;
};

export const DNY_KRATCE = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];
export const DNY_DLOUZE = ["pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota", "neděle"];

const formatovace = new Map<string, Intl.DateTimeFormat>();

/** Den v týdnu (0 = pondělí) a hodina v daném pásmu. */
export function denAHodina(iso: string, timeZone = "Europe/Prague"): { den: number; hodina: number } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  let f = formatovace.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "numeric", hourCycle: "h23" });
    formatovace.set(timeZone, f);
  }
  let den = -1;
  let hodina = -1;
  for (const p of f.formatToParts(d)) {
    if (p.type === "weekday") den = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.value);
    if (p.type === "hour") hodina = Number(p.value) % 24;
  }
  if (den < 0 || hodina < 0) return null;
  return { den, hodina };
}

export function rozlozeniHodin(
  zakazky: ZakazkaProHodiny[],
  udalost: Udalost,
  volby: { jeStorno?: (status: string) => boolean; timeZone?: string } = {},
): RozlozeniHodin {
  const matice = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const z of zakazky) {
    let cas: string | null | undefined;
    if (udalost === "prijem") cas = z.createdAt;
    else {
      if (volby.jeStorno && z.status && volby.jeStorno(z.status)) continue;
      cas = z.completedAt;
    }
    if (!cas) continue;
    const dh = denAHodina(cas, volby.timeZone);
    if (!dh) continue;
    matice[dh.den][dh.hodina] += 1;
  }
  const podleHodiny = Array.from({ length: 24 }, (_, h) => matice.reduce((a, den) => a + den[h], 0));
  const podleDne = matice.map((den) => den.reduce((a, b) => a + b, 0));
  const celkem = podleDne.reduce((a, b) => a + b, 0);
  const spicky = matice
    .flatMap((den, d) => den.map((pocet, h) => ({ den: d, hodina: h, pocet })))
    .filter((x) => x.pocet > 0)
    .sort((a, b) => b.pocet - a.pocet || a.den - b.den || a.hodina - b.hodina);
  return { matice, podleHodiny, podleDne, celkem, spicky };
}

/**
 * Hodiny, které má smysl kreslit: od první s provozem do poslední, vždy
 * aspoň 8–18. Dvacet čtyři sloupců s dvaceti prázdnými by graf jen roztáhlo.
 */
export function rozsahHodin(r: RozlozeniHodin): { od: number; do: number } {
  let od = 8;
  let doH = 18;
  r.podleHodiny.forEach((n, h) => {
    if (n > 0) {
      od = Math.min(od, h);
      doH = Math.max(doH, h);
    }
  });
  return { od, do: doH };
}

/** „10–11 h“ */
export function popisHodiny(h: number): string {
  return `${h}–${(h + 1) % 24} h`;
}

/**
 * Krátké shrnutí pro majitele: nejsilnější den, nejsilnější hodiny a kolik
 * procent provozu se do nich vejde. Hodiny se berou souvisle od nejsilnější
 * (dvě až tři), ať věta nezní jako výčet.
 */
export function shrnutiHodin(r: RozlozeniHodin, udalost: Udalost): string | null {
  if (r.celkem < 5) return null;
  const slovo = udalost === "prijem" ? "příjmů" : "výdejů";
  const denMax = r.podleDne.indexOf(Math.max(...r.podleDne));
  const hodMax = r.podleHodiny.indexOf(Math.max(...r.podleHodiny));
  // Souvislý blok tří hodin kolem špičky, který pobere nejvíc.
  let nejlepsi = { od: hodMax, pocet: r.podleHodiny[hodMax] };
  for (const od of [hodMax - 2, hodMax - 1, hodMax]) {
    if (od < 0 || od + 2 > 23) continue;
    const pocet = r.podleHodiny[od] + r.podleHodiny[od + 1] + r.podleHodiny[od + 2];
    if (pocet > nejlepsi.pocet) nejlepsi = { od, pocet };
  }
  const blokDo = nejlepsi.od === hodMax && nejlepsi.pocet === r.podleHodiny[hodMax] ? hodMax + 1 : nejlepsi.od + 3;
  const procent = Math.round((nejlepsi.pocet / r.celkem) * 100);
  const procentDne = Math.round((r.podleDne[denMax] / r.celkem) * 100);
  return `Nejvíc ${slovo} je v ${DNY_DLOUZE[denMax] === "úterý" ? "úterý" : DNY_DLOUZE[denMax]} (${procentDne} %). ` +
    `Nejsilnější hodiny jsou ${nejlepsi.od}–${blokDo} h, připadá na ně ${procent} % ${slovo}.`;
}
