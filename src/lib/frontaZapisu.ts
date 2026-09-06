import { supabase } from "./supabaseClient";
import { logError } from "./errorLog";

/**
 * Fronta neuložených zápisů do databáze.
 *
 * Proč to existuje: dokud tohle nebylo, každý zápis měl jen jeden pokus.
 * Když v tu vteřinu vypadla síť (uspaný notebook, přepnutá wifi, zaseknutý
 * HTTP klient v Tauri), změna zůstala jen v paměti prohlížeče a při zavření
 * detailu nebo aplikace se ztratila. Uživatel viděl nanejvýš toast, který
 * mezitím zmizel – a druhý den se divil, proč v zakázce chybí oprava.
 *
 * Fronta drží **cílový stav** řádku, ne rozdíl. Opakovaný zápis je proto
 * bezpečný: pošle se `update` podle `id` a poslední stav vyhraje. Vkládání
 * nových řádků sem nepatří – to by opakování mohlo zdvojit.
 *
 * Fronta se ukládá do localStorage, takže přežije i zavření aplikace.
 * Odesílá se při startu, po návratu sítě, při návratu do okna a jednou za
 * půl minuty, dokud v ní něco je.
 */

const KLIC = "jobi_neulozene_zmeny_v1";
/** Víc než tolik položek fronta nedrží – nejstarší se zahodí (a nahlásí). */
const MAX_POLOZEK = 200;
/** Po tolika dnech se položka vzdá; to už je stav v aplikaci dávno jiný. */
const MAX_STARI_MS = 7 * 24 * 60 * 60 * 1000;
/** Po tolika marných pokusech se položka označí za zaseknutou a sama se už nezkouší. */
const POKUSU_DO_ZASEKNUTI = 12;
const INTERVAL_MS = 30_000;
/** Odstupy mezi pokusy. Poslední hodnota platí pro všechny další pokusy. */
const ODSTUPY_MS = [0, 30_000, 60_000, 300_000, 900_000, 1_800_000];

function dalsiOdstup(pokusy: number): number {
  return ODSTUPY_MS[Math.min(pokusy, ODSTUPY_MS.length - 1)];
}

export type PolozkaFronty = {
  /** Stejný klíč = stejný cíl; novější zápis ten starší nahradí. */
  klic: string;
  tabulka: string;
  /** Hodnota sloupce `id` řádku, který se má přepsat. */
  id: string;
  /** Cílový stav sloupců. */
  data: Record<string, unknown>;
  /** Co to je lidsky, do výpisu neuložených změn: „Provedené opravy · E2E250001“. */
  popis: string;
  serviceId: string | null;
  vlozeno: number;
  /** Rozlišení dvou zápisů téhož klíče. `vlozeno` na to nestačí – dva zápisy
   *  ve stejné milisekundě by byly nerozlišitelné a novější by se smazal. */
  poradi?: string;
  pokusy: number;
  posledniChyba?: string;
  /** Opakování nepomáhá (chybí právo, řádek zmizel). Zůstává vidět, ať se to neztratí potichu. */
  zaseknuto?: boolean;
  /** Dřív se nezkouší. Roste s počtem marných pokusů, ať fronta nemlátí do sítě a baterie. */
  dalsiPokusOd?: number;
};

type Posluchac = (polozky: PolozkaFronty[]) => void;

const posluchaci = new Set<Posluchac>();
/**
 * Čekání, které se nedá popsat jedním `update` řádku – typicky sklad, který
 * se ukládá jako několik závislých požadavků proti snímku z databáze.
 * Do localStorage se neukládá (opakovat by šlo jen s aktuálním snímkem),
 * ale v ukazateli je vidět stejně jako zbytek fronty, aby uživatel nevypnul
 * počítač s tím, že je hotovo.
 */
const mimoFrontu = new Map<string, PolozkaFronty>();
let odesilaSe = false;
let casovac: ReturnType<typeof setInterval> | null = null;
let hlidacSpusten = false;

function nacti(): PolozkaFronty[] {
  try {
    const raw = localStorage.getItem(KLIC);
    if (!raw) return [];
    const p = JSON.parse(raw);
    if (!Array.isArray(p)) return [];
    return p.filter((x): x is PolozkaFronty => !!x && typeof x.klic === "string" && typeof x.tabulka === "string" && typeof x.id === "string");
  } catch {
    return [];
  }
}

function zapis(polozky: PolozkaFronty[]): void {
  try {
    localStorage.setItem(KLIC, JSON.stringify(polozky));
  } catch (error) {
    // Plný localStorage je sám o sobě problém, ale fronta kvůli tomu nesmí spadnout.
    void logError({ code: "fronta.ulozeni_selhalo", error, source: "frontaZapisu.zapis" });
  }
  for (const p of posluchaci) {
    try {
      p([...polozky, ...mimoFrontu.values()]);
    } catch {
      /* posluchač si za svoje chyby může sám */
    }
  }
}

/** Vyhodí, co je staré nebo přeteklo. Vrací pročištěný seznam. */
function proberStare(polozky: PolozkaFronty[]): PolozkaFronty[] {
  const ted = Date.now();
  let zbyva = polozky.filter((p) => ted - p.vlozeno < MAX_STARI_MS);
  if (zbyva.length !== polozky.length) {
    void logError({
      code: "fronta.polozka_vyprsela",
      error: new Error(`Neuložených změn starších než 7 dní: ${polozky.length - zbyva.length}`),
      source: "frontaZapisu.proberStare",
    });
  }
  if (zbyva.length > MAX_POLOZEK) {
    const prebytek = zbyva.length - MAX_POLOZEK;
    zbyva = zbyva.slice(prebytek);
    void logError({
      code: "fronta.pretekla",
      error: new Error(`Fronta neuložených změn přetekla, zahozeno ${prebytek} nejstarších.`),
      source: "frontaZapisu.proberStare",
    });
  }
  return zbyva;
}

/**
 * Zařadí zápis, který se nepovedl, k pozdějšímu odeslání.
 *
 * Volá se z místa, kde `update` selhal. Stejný `klic` přepíše starší
 * záznam – ve frontě má být poslední známý cílový stav, ne jeho historie.
 */
export function ulozNaPozdeji(vstup: {
  klic: string;
  tabulka: string;
  id: string;
  data: Record<string, unknown>;
  popis: string;
  serviceId?: string | null;
  chyba?: unknown;
}): void {
  const polozky = proberStare(nacti()).filter((p) => p.klic !== vstup.klic);
  polozky.push({
    klic: vstup.klic,
    tabulka: vstup.tabulka,
    id: vstup.id,
    data: vstup.data,
    popis: vstup.popis,
    serviceId: vstup.serviceId ?? null,
    vlozeno: Date.now(),
    poradi: novePoradi(),
    pokusy: 0,
    posledniChyba: vstup.chyba ? textChyby(vstup.chyba) : undefined,
  });
  zapis(polozky);
  naplanujOdeslani();
}

let citac = 0;
function novePoradi(): string {
  citac += 1;
  return `${Date.now().toString(36)}-${citac.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function textChyby(err: unknown): string {
  if (!err) return "";
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) return String((err as { message: unknown }).message);
  return String(err);
}

/** Chyba, kterou opakování nespraví: chybí právo, řádek už neexistuje, data neprojdou kontrolou. */
export function jeTrvalaChyba(err: unknown): boolean {
  const kod = typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : "";
  if (["42501", "PGRST116", "23503", "23514", "23505", "22P02"].includes(kod)) return true;
  const t = textChyby(err).toLowerCase();
  return t.includes("row-level security") || t.includes("not authorized") || t.includes("violates");
}

/** Kolik změn čeká na uložení (včetně čekání mimo frontu). */
export function neulozeneZmeny(): PolozkaFronty[] {
  return [...nacti(), ...mimoFrontu.values()];
}

/**
 * Ohlásí (nebo odvolá) čekání, které si opakování řídí samo – volající má
 * vlastní smyčku a jen chce, aby o něm uživatel věděl. `popis: null` čekání
 * odvolá, jakmile se uložení povede.
 */
export function nahlasCekani(klic: string, popis: string | null, chyba?: unknown): void {
  if (popis === null) {
    if (!mimoFrontu.delete(klic)) return;
  } else {
    mimoFrontu.set(klic, {
      klic,
      tabulka: "",
      id: "",
      data: {},
      popis,
      serviceId: null,
      vlozeno: mimoFrontu.get(klic)?.vlozeno ?? Date.now(),
      pokusy: (mimoFrontu.get(klic)?.pokusy ?? 0) + 1,
      posledniChyba: chyba ? textChyby(chyba) : undefined,
    });
  }
  for (const p of posluchaci) {
    try {
      p(neulozeneZmeny());
    } catch {
      /* posluchač si za svoje chyby může sám */
    }
  }
}

/** Přihlásí se k odběru změn fronty; vrací odhlášení. */
export function naFrontu(cb: Posluchac): () => void {
  posluchaci.add(cb);
  cb(neulozeneZmeny());
  return () => posluchaci.delete(cb);
}

/**
 * Pošle, co ve frontě je. Položky jdou po jedné a v pořadí vložení, ať se
 * dva zápisy do stejného řádku nepřetlačí.
 */
export async function odesliFrontu(vcetneZaseknutych = false): Promise<{ odeslano: number; zbyva: number }> {
  if (odesilaSe) return { odeslano: 0, zbyva: nacti().length };
  const klient = supabase;
  if (!klient) return { odeslano: 0, zbyva: nacti().length };
  /*
   * Bez přihlášení se neodesílá. Odhlášený klient posílá zápis jen s anonym
   * klíčem, RLS ho zahodí a čekající změny by se spálily proti cizímu (nebo
   * žádnému) účtu. Fronta počká, až se přihlásí ten, komu data patří.
   */
  try {
    const { data } = await klient.auth.getSession();
    if (!data?.session) return { odeslano: 0, zbyva: nacti().length };
  } catch {
    return { odeslano: 0, zbyva: nacti().length };
  }
  odesilaSe = true;
  let odeslano = 0;
  try {
    let fronta = proberStare(nacti());
    if (fronta.length === 0) {
      zapis(fronta);
      return { odeslano: 0, zbyva: 0 };
    }
    const ted = Date.now();
    for (const polozka of [...fronta]) {
      // Zaseknutou položku sama od sebe nezkoušíme – opakování jí nepomůže
      // a uživatel ji vidí v ukazateli. Pustí ji tlačítkem „Zkusit hned“.
      if (polozka.zaseknuto && !vcetneZaseknutych) continue;
      if (!vcetneZaseknutych && polozka.dalsiPokusOd && polozka.dalsiPokusOd > ted) continue;
      let chyba: unknown = null;
      try {
        /*
         * `.select("id")` tu není pro data, ale pro důkaz.
         *
         * PostgREST na `update`, který nesedí na žádný řádek, odpoví 204 bez
         * chyby – tedy stejně jako na povedený zápis. Fronta pak položku
         * smazala jako uloženou, i když se nezapsalo nic: po odhlášení
         * (RLS nepustí anonyma), po přepnutí na účet bez práv k tomu servisu
         * nebo když zakázku mezitím někdo smazal. Přesně ta tichá ztráta,
         * kvůli které fronta vznikla. Vrácený řádek to rozhodne: když se
         * nevrátí, zápis se nekonal a položka zůstává (a je vidět).
         */
        const { data, error } = await (klient.from(polozka.tabulka) as any)
          .update(polozka.data)
          .eq("id", polozka.id)
          .select("id");
        chyba = error ?? null;
        if (!chyba && (!Array.isArray(data) || data.length === 0)) {
          chyba = { code: "PGRST116", message: "Řádek se nezapsal – chybí právo, nebo už neexistuje." };
        }
      } catch (err) {
        chyba = err;
      }

      // Mezitím mohl přibýt novější stav téhož řádku – ten se zahodit nesmí.
      const aktualni = nacti();
      const idx = aktualni.findIndex((p) => p.klic === polozka.klic);
      if (idx < 0) continue;
      // Mezitím mohl přibýt novější stav téhož řádku – ten se zahodit nesmí.
      const stejnaPolozka = polozka.poradi
        ? aktualni[idx].poradi === polozka.poradi
        : aktualni[idx].vlozeno === polozka.vlozeno;
      if (!stejnaPolozka) continue;

      if (!chyba) {
        aktualni.splice(idx, 1);
        odeslano += 1;
        zapis(aktualni);
        continue;
      }

      const pokusy = aktualni[idx].pokusy + 1;
      aktualni[idx] = {
        ...aktualni[idx],
        pokusy,
        posledniChyba: textChyby(chyba),
        zaseknuto: jeTrvalaChyba(chyba) || pokusy >= POKUSU_DO_ZASEKNUTI,
        dalsiPokusOd: Date.now() + dalsiOdstup(pokusy),
      };
      zapis(aktualni);
      if (jeTrvalaChyba(chyba)) {
        void logError({
          code: "fronta.trvala_chyba",
          error: chyba,
          source: "frontaZapisu.odesliFrontu",
          serviceId: polozka.serviceId,
          context: { tabulka: polozka.tabulka, pokusy },
        });
        continue;
      }
      // Síť je zjevně pořád pryč; zbytek fronty čeká na další kolo.
      break;
    }
    fronta = nacti();
    return { odeslano, zbyva: fronta.length };
  } finally {
    odesilaSe = false;
  }
}

let naplanovano: ReturnType<typeof setTimeout> | null = null;
function naplanujOdeslani(zpozdeniMs = 3000): void {
  if (naplanovano) return;
  naplanovano = setTimeout(() => {
    naplanovano = null;
    void odesliFrontu();
  }, zpozdeniMs);
}

/**
 * Spustí hlídač fronty. Volá se jednou při startu aplikace.
 *
 * Zkusí odeslat hned (po startu tam může být, co nestihl minulý běh), pak
 * po návratu sítě, po návratu do okna a v intervalu, dokud fronta není
 * prázdná.
 */
export function spustHlidacFronty(): void {
  if (hlidacSpusten || typeof window === "undefined") return;
  hlidacSpusten = true;

  naplanujOdeslani(1500);

  window.addEventListener("online", () => naplanujOdeslani(500));
  /*
   * Zavírané okno: odeslat, co ve frontě je, hned – naplánovaný `setTimeout`
   * by se už nespustil. Dokončit se to nemusí (odcházející stránka požadavek
   * utne), proto fronta zůstává v localStorage a dopíše se při dalším startu.
   */
  window.addEventListener("pagehide", () => {
    if (nacti().some((p) => !p.zaseknuto)) void odesliFrontu();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") naplanujOdeslani(500);
  });
  casovac = setInterval(() => {
    // Když je prohlížeč offline, nemá smysl budit síť; návrat řeší událost výš.
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    if (nacti().some((p) => !p.zaseknuto)) void odesliFrontu();
  }, INTERVAL_MS);
}

/** Jen pro testy a nouzové vyčištění z konzole. */
export function vycistiFrontu(): void {
  if (casovac) {
    clearInterval(casovac);
    casovac = null;
  }
  hlidacSpusten = false;
  mimoFrontu.clear();
  zapis([]);
}
