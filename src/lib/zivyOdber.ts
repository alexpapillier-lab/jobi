/**
 * Realtime odběr, který po výpadku sám dotáhne, co mezitím uteklo.
 *
 * Majitel 27. 10. 2026: karta s Jobi, která chvíli ležela nepoužívaná, neukázala
 * zakázky přidané odjinud, dokud ji nikdo neobnovil. Supabase Realtime posílá
 * jen změny, které se stanou, *když je kanál přihlášený*. Spojení přitom padá
 * běžně – uspaný notebook, přepnutá Wi-Fi, prohlížeč přiškrtí kartu na pozadí,
 * server zavře kanál po vypršení tokenu. Knihovna se sama připojí znovu, ale
 * zmeškané události už nikdy nepošle, a aplikace nic nedotahovala. Seznam pak
 * zůstal pozadu až do ručního obnovení (ověřeno E2E: e2e/obnova-dat.spec.ts).
 *
 * `odebirejZmeny` proto zavolá `dotahni`:
 *   - když se kanál přihlásí znovu po výpadku (ne při prvním přihlášení),
 *   - po návratu do okna, které bylo aspoň NAVRAT_PO_MS skryté,
 *   - po obnovení sítě (`online`) a po probuzení počítače (časovač se opozdí),
 *   - jednou za POJISTKA_MS, když je okno vidět – pro spojení, které je
 *     „tiše mrtvé“ a knihovna o tom ještě neví.
 * Volání `dotahni` jsou u jednoho odběru od sebe aspoň MIN_ROZESTUP_MS, ať
 * shluk událostí (návrat do okna + online + znovupřihlášení) nedělá tři dotazy.
 *
 * Kanál, který server zavře (CLOSED, který jsme si nevyžádali), se založí znovu.
 * Každý kanál má vlastní název: `supabase.channel(topic)` vrací pro stejný název
 * existující kanál, i když se zrovna odhlašuje – nový odběr by se přilepil ke
 * kanálu, který se za chvíli zavře.
 *
 * Presence kanály (src/lib/presence.ts, useEditaceZakazky) sem nepatří: ty
 * název sdílet musí, jinak by se klienti neviděli.
 */
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";
import { devLog } from "./devLog";

/** Okno skryté aspoň takhle dlouho se po návratu dotáhne. */
export const NAVRAT_PO_MS = 10_000;
/** Záložní dotažení, když je okno vidět a spojení se tváří živé. */
export const POJISTKA_MS = 5 * 60_000;
/** Nejkratší rozestup dvou dotažení jednoho odběru. */
export const MIN_ROZESTUP_MS = 5_000;
/** Zavřený kanál se zakládá znovu po téhle pauze. */
const ZNOVU_ZALOZIT_PO_MS = 3_000;
/** Kontrola probuzení: časovač, který se opozdí o víc než PROBUZENI_PO_MS, znamená uspání. */
const KONTROLA_SPANKU_MS = 15_000;
const PROBUZENI_PO_MS = 45_000;

export type DuvodDotazeni = "znovupripojeni" | "navrat" | "sit" | "probuzeni" | "pojistka";

type Odber = {
  dotahni: (duvod: DuvodDotazeni) => void;
  /** Kanál není přihlášený (chyba, timeout, zavřený) – po návratu ho rovnou založit znovu. */
  nemocny: () => boolean;
  zalozZnovu: () => void;
};

const odbery = new Set<Odber>();
let poradi = 0;

/**
 * Přihlásí odběr změn a vrátí funkci, která ho zruší.
 *
 * @param nazev    základ názvu kanálu (doplní se pořadové číslo)
 * @param nastav   přidá na kanál `.on("postgres_changes", …)`
 * @param dotahni  dočte z databáze, co mohlo během výpadku utéct; musí být
 *                 levné (jen změny, ne celý seznam), volá se i jako pojistka
 */
export function odebirejZmeny(
  nazev: string,
  nastav: (kanal: RealtimeChannel) => RealtimeChannel,
  dotahni?: (duvod: DuvodDotazeni) => void,
): () => void {
  const klient = supabase;
  if (!klient) return () => {};

  let zruseno = false;
  let kanal: RealtimeChannel | null = null;
  let prihlasen = false;
  /** Kanál už byl aspoň jednou přihlášený – další SUBSCRIBED je znovupřipojení. */
  let bylPrihlasen = false;
  let casovac: ReturnType<typeof setTimeout> | null = null;
  let naposledyDotazeno = 0;

  const zavolejDotahni = (duvod: DuvodDotazeni) => {
    if (zruseno || !dotahni) return;
    const ted = Date.now();
    if (ted - naposledyDotazeno < MIN_ROZESTUP_MS) return;
    naposledyDotazeno = ted;
    devLog("[RT] dotahuji", nazev, duvod);
    try {
      dotahni(duvod);
    } catch (e) {
      console.warn("[RT] dotažení selhalo", nazev, e);
    }
  };

  const zahod = (k: RealtimeChannel) => {
    void klient.removeChannel(k).catch(() => undefined);
  };

  const zaloz = () => {
    if (zruseno) return;
    const topic = `${nazev}#${++poradi}`;
    const k = nastav(klient.channel(topic));
    kanal = k;
    prihlasen = false;
    k.subscribe((status) => {
      if (zruseno || kanal !== k) return;
      if (status === "SUBSCRIBED") {
        prihlasen = true;
        if (bylPrihlasen) zavolejDotahni("znovupripojeni");
        bylPrihlasen = true;
      } else if (status === "CLOSED") {
        // Zavřel ho server (vypršený token, nesoulad filtrů) – knihovna sama
        // znovu nepřihlásí, kanál je z klienta pryč. Založit nový.
        prihlasen = false;
        naplanujZnovu(ZNOVU_ZALOZIT_PO_MS);
      } else {
        // CHANNEL_ERROR / TIMED_OUT: knihovna to zkouší sama znovu.
        prihlasen = false;
      }
    });
  };

  const naplanujZnovu = (poMs: number) => {
    if (zruseno || casovac) return;
    casovac = setTimeout(() => {
      casovac = null;
      if (zruseno) return;
      const stary = kanal;
      kanal = null;
      if (stary) zahod(stary);
      zaloz();
    }, poMs);
  };

  const odber: Odber = {
    dotahni: zavolejDotahni,
    nemocny: () => !prihlasen,
    zalozZnovu: () => naplanujZnovu(0),
  };
  odbery.add(odber);
  zajistiHlidace();
  zaloz();

  return () => {
    zruseno = true;
    odbery.delete(odber);
    if (casovac) clearTimeout(casovac);
    casovac = null;
    if (kanal) zahod(kanal);
    kanal = null;
  };
}

/** Všem odběrům: dotáhnout, a kanál, který není přihlášený, založit znovu. */
function probudVse(duvod: DuvodDotazeni) {
  devLog("[RT] probuzení", duvod, odbery.size);
  for (const o of odbery) {
    if (duvod !== "pojistka" && o.nemocny()) o.zalozZnovu();
    o.dotahni(duvod);
  }
}

let hlidaceBezi = false;

/** Jedny posluchače pro celou aplikaci, ne pro každý odběr zvlášť. */
function zajistiHlidace() {
  if (hlidaceBezi || typeof window === "undefined" || typeof document === "undefined") return;
  hlidaceBezi = true;

  let skrytoOd: number | null = document.visibilityState === "hidden" ? Date.now() : null;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      if (skrytoOd === null) skrytoOd = Date.now();
      return;
    }
    const skryto = skrytoOd === null ? 0 : Date.now() - skrytoOd;
    skrytoOd = null;
    if (skryto >= NAVRAT_PO_MS) probudVse("navrat");
  });

  // Desktop (Tauri) a okno vedle jiné aplikace: visibilitychange nepřijde,
  // když okno jen ztratí fokus. Návrat fokusu po delší době = taky návrat.
  let fokusPryc: number | null = null;
  window.addEventListener("blur", () => {
    fokusPryc = Date.now();
  });
  window.addEventListener("focus", () => {
    const pryc = fokusPryc === null ? 0 : Date.now() - fokusPryc;
    fokusPryc = null;
    if (pryc >= NAVRAT_PO_MS) probudVse("navrat");
  });

  window.addEventListener("online", () => probudVse("sit"));

  // Uspaný počítač: časovače stojí, po probuzení se interval ozve s velkým
  // zpožděním. Na pozadí prohlížeč intervaly přiškrcuje (až na minutu),
  // proto se kontroluje jen při viditelném okně.
  let posledniTik = Date.now();
  let posledniPojistka = Date.now();
  setInterval(() => {
    const ted = Date.now();
    const zpozdeni = ted - posledniTik - KONTROLA_SPANKU_MS;
    posledniTik = ted;
    if (document.visibilityState !== "visible") return;
    if (zpozdeni > PROBUZENI_PO_MS) {
      posledniPojistka = ted;
      probudVse("probuzeni");
    } else if (ted - posledniPojistka >= POJISTKA_MS) {
      posledniPojistka = ted;
      probudVse("pojistka");
    }
  }, KONTROLA_SPANKU_MS);
}
