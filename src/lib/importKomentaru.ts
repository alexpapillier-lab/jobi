/**
 * Import komentářů z jiného systému (CSV: kód zakázky nebo reklamace, druh,
 * autor, datum, text) do interních komentářů zakázek `ticket_comments`.
 * Čistá logika bez React a bez Supabase; zápis jde přes předaného klienta
 * (v aplikaci supabase, v testech atrapa). Soubor `komentare.csv` vyrábí
 * nástroj `scripts/migrace-zl` ze Zakázkového listu.
 *
 * Komentář k zakázce se připojí k zakázce podle čísla. Komentář k reklamaci
 * se připojí k zakázce, ze které reklamace vznikla – Jobi komentáře
 * reklamací nemá a detail reklamace ukazuje komentáře navázané zakázky.
 * Text dostane předponu s kódem reklamace, ať je v chatu zakázky poznat,
 * čeho se týká. Reklamace bez navázané zakázky se hlásí jako chyba.
 *
 * Autor z cizího systému není uživatel Jobi – ukládá se jen jako text
 * (`author`), bez `author_id`. Datum se přenáší do `created_at`, takže chat
 * zůstane v původním pořadí. Co už v zakázce je (stejná zakázka, datum a
 * text), se přeskočí – import jde spustit víckrát.
 */
import type { CsvTabulka } from "./csv";
import { normalizujText, parsujDatum } from "./importZakazek";

export type PoleKomentare = "code" | "kind" | "author" | "date" | "text";

export const POPIS_POLE_KOMENTARE: Record<PoleKomentare, string> = {
  code: "Číslo zakázky / reklamace",
  kind: "Druh (zakázka / reklamace)",
  author: "Autor",
  date: "Datum",
  text: "Text komentáře",
};

export const POLE_KOMENTARE: PoleKomentare[] = ["code", "kind", "author", "date", "text"];

/** Autor, když ho soubor neuvádí. */
export const VYCHOZI_AUTOR = "Import";

const VZORY: Array<[PoleKomentare, RegExp]> = [
  ["kind", /^(druh|typ|kind|type)$/i],
  ["date", /dat|vytvo[řr]en|created|time/i],
  ["author", /autor|author|kdo|u[žz]ivatel|user|technik/i],
  ["text", /text|koment|obsah|zpr[aá]v|content|message|pozn|note/i],
  ["code", /k[oó]d|[čc][ií]slo|zak[aá]zk|reklamac|code|number|order|ticket/i],
];

/** Odhadne význam sloupců podle hlavičky; každé pole nejvýš jednou. */
export function odhadniMapovaniKomentaru(hlavicka: string[]): Array<PoleKomentare | null> {
  const pouzito = new Set<PoleKomentare>();
  return hlavicka.map((h) => {
    const nazev = h.trim();
    if (!nazev) return null;
    for (const [pole, re] of VZORY) {
      if (!pouzito.has(pole) && re.test(nazev)) {
        pouzito.add(pole);
        return pole;
      }
    }
    return null;
  });
}

/** Kam se komentáře připojují: zakázky a reklamace servisu podle kódu. */
export type CileKomentaru = {
  /** číslo zakázky → id zakázky */
  zakazky: Map<string, string>;
  /** kód reklamace → id reklamace a zakázka, ze které vznikla */
  reklamace: Map<string, { id: string; sourceTicketId: string | null }>;
  /** Komentáře, které zakázky už mají – klíč z `klicKomentare`. */
  existujici: Set<string>;
};

export type RadekKomentare = {
  ticket_id: string;
  author: string;
  author_id: null;
  content: string;
  pinned: false;
  created_at: string;
};

export type PlanKomentaru = {
  radky: RadekKomentare[];
  /** Kolik komentářů patří k zakázkám a kolik k reklamacím (připojeným k jejich zakázkám). */
  zakazek: number;
  reklamaci: number;
  /** Stejný komentář už zakázka má (nebo byl v souboru dvakrát). */
  preskoceno: number;
  chyby: Array<{ radek: number; zprava: string }>;
};

/** Totožnost komentáře pro přeskočení duplicit: zakázka, datum a text. */
export function klicKomentare(ticketId: string, createdAt: string, content: string): string {
  const d = new Date(createdAt);
  const cas = Number.isNaN(d.getTime()) ? createdAt : d.toISOString();
  return `${ticketId}|${cas}|${normalizujText(content)}`;
}

/** Předpona textu komentáře z reklamace – v chatu zakázky je vidět, k čemu patří. */
export function textKomentareReklamace(kodReklamace: string, text: string): string {
  return `[Reklamace ${kodReklamace}] ${text}`;
}

function normalizujKod(kod: string): string {
  return kod.replace(/\s+/g, "").toUpperCase();
}

/**
 * Přeloží řádky CSV na komentáře k zápisu. Chyby nesou číslo řádku v souboru
 * (hlavička je řádek 1). Kódy se párují bez ohledu na velikost písmen a mezery.
 */
export function pripravKomentare(tabulka: CsvTabulka, mapovani: Array<PoleKomentare | null>, cile: CileKomentaru): PlanKomentaru {
  const idx = (pole: PoleKomentare) => mapovani.indexOf(pole);
  const plan: PlanKomentaru = { radky: [], zakazek: 0, reklamaci: 0, preskoceno: 0, chyby: [] };
  const zakazky = new Map<string, string>();
  for (const [kod, id] of cile.zakazky) zakazky.set(normalizujKod(kod), id);
  const reklamace = new Map<string, { id: string; sourceTicketId: string | null }>();
  for (const [kod, r] of cile.reklamace) reklamace.set(normalizujKod(kod), r);
  const videno = new Set(cile.existujici);

  tabulka.radky.forEach((r, i) => {
    const radek = i + 2;
    const hodnota = (pole: PoleKomentare) => {
      const j = idx(pole);
      const v = j >= 0 ? (r[j] ?? "").trim() : "";
      return v === "-" ? "" : v;
    };
    const chyba = (zprava: string) => plan.chyby.push({ radek, zprava });

    const kod = hodnota("code");
    const text = hodnota("text").replace(/\s+/g, " ").trim();
    if (!kod && !text) return;
    if (!kod) return chyba("chybí číslo zakázky nebo reklamace");
    if (!text) return chyba(`${kod}: prázdný komentář`);

    const datum = parsujDatum(hodnota("date"));
    if (datum === undefined) return chyba(`${kod}: nečitelné datum „${hodnota("date")}“`);
    if (datum === null) return chyba(`${kod}: chybí datum`);

    const druh = normalizujText(hodnota("kind"));
    const jeReklamace = /reklam|claim|complaint/.test(druh);
    const jeZakazka = /zak|order|ticket/.test(druh);
    const nk = normalizujKod(kod);

    let ticketId: string | undefined;
    let obsah = text;
    let typ: "zakazka" | "reklamace" | null = null;
    const rek = reklamace.get(nk);
    const zak = zakazky.get(nk);
    if (jeReklamace || (!jeZakazka && !zak && rek)) {
      if (!rek) return chyba(`${kod}: reklamace v servisu není`);
      if (!rek.sourceTicketId) return chyba(`${kod}: reklamace není napojená na zakázku, komentář nemá kam`);
      ticketId = rek.sourceTicketId;
      obsah = textKomentareReklamace(kod, text);
      typ = "reklamace";
    } else {
      if (!zak) return chyba(`${kod}: zakázka v servisu není`);
      ticketId = zak;
      typ = "zakazka";
    }

    const klic = klicKomentare(ticketId, datum, obsah);
    if (videno.has(klic)) { plan.preskoceno += 1; return; }
    videno.add(klic);

    plan.radky.push({ ticket_id: ticketId, author: hodnota("author") || VYCHOZI_AUTOR, author_id: null, content: obsah, pinned: false, created_at: datum });
    if (typ === "reklamace") plan.reklamaci += 1;
    else plan.zakazek += 1;
  });

  return plan;
}

type ChybaZapisu = { message?: string } | null;
/** Kousek supabase klienta, který zápis potřebuje – v testech ho nahradí atrapa. */
export type KlientKomentaru = {
  from: (tabulka: string) => { insert: (radky: unknown) => PromiseLike<{ error: ChybaZapisu }> };
};

export type VysledekKomentaru = { zapsano: number; chyb: number; chyby: string[] };

/**
 * Vloží komentáře po dávkách. Když dávka spadne, projde se po jednom, aby
 * jedna vadná řádka nezahodila zbylé.
 */
export async function zapisKomentare(klient: KlientKomentaru, serviceId: string, radky: RadekKomentare[], onPostup?: (procent: number) => void, velikostDavky = 200): Promise<VysledekKomentaru> {
  const v: VysledekKomentaru = { zapsano: 0, chyb: 0, chyby: [] };
  for (let i = 0; i < radky.length; i += velikostDavky) {
    const davka = radky.slice(i, i + velikostDavky).map((r) => ({ ...r, service_id: serviceId }));
    const { error } = await klient.from("ticket_comments").insert(davka);
    if (!error) {
      v.zapsano += davka.length;
    } else {
      for (const radek of davka) {
        const { error: e1 } = await klient.from("ticket_comments").insert(radek);
        if (!e1) v.zapsano += 1;
        else { v.chyb += 1; if (v.chyby.length < 20) v.chyby.push(e1.message ?? "zápis selhal"); }
      }
    }
    onPostup?.(Math.min(100, Math.round(((i + davka.length) / Math.max(1, radky.length)) * 100)));
  }
  return v;
}
