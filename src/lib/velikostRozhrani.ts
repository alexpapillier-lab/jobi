import { isDesktop } from "./platform";

/**
 * Velikost rozhraní (zvětšení celé aplikace).
 *
 * Dřív se to všude dělalo `zoom`em na `<html>`. Funguje to, ale je to past:
 * `zoom` míchá dvě soustavy souřadnic, takže `getBoundingClientRect()` vrací
 * jiné jednotky, než jaké se zapisují do CSS, a jednotky `vh`/`dvh` o zoomu
 * vůbec nevědí. Kvůli tomu je v kódu na sedmi místech `calc(100dvh /
 * var(--ui-scale))` a každé nové místo, které měří výšku, na to musí znovu
 * myslet – jedna taková chyba (nedosažitelná poslední položka v Nastavení)
 * stála dvě kola oprav.
 *
 * V desktopu se proto zvětšuje **samotné webview** (`setZoom`), tedy totéž,
 * co dělá ⌘+ v prohlížeči: zvětší se všechno včetně `vh` i souřadnic a žádný
 * přepočet není potřeba. V prohlížeči taková možnost není (stránka si vlastní
 * zoom nastavit nesmí), tam zůstává CSS `zoom` i s proměnnou `--ui-scale`.
 *
 * `--ui-scale` se nastavuje vždy, ale na desktopu je 1 – rozvržení tak nemá
 * co přepočítávat a stará `calc()` se chovají jako by tam nebyla.
 */

/** Co se má pro dané měřítko udělat. Oddělené od DOM, aby to šlo otestovat. */
export type ZpusobZvetseni =
  | { druh: "webview"; meritko: number }
  | { druh: "css"; meritko: number }
  | { druh: "zadne" };

/** Rozumné meze: pod 80 % je text nečitelný, nad 150 % se rozbíjí rozvržení. */
export const MIN_MERITKO = 0.8;
export const MAX_MERITKO = 1.5;

export function omezMeritko(meritko: number | undefined | null): number {
  const m = Number(meritko);
  if (!Number.isFinite(m) || m <= 0) return 1;
  return Math.min(MAX_MERITKO, Math.max(MIN_MERITKO, m));
}

/**
 * Jak zvětšit rozhraní na téhle platformě.
 *
 * Měřítko 1 na webu znamená „nedělej nic“: `zoom: 1` sice nic nezvětší, ale
 * založí zoomovací kontejner a souřadnice prvků pak nesedí s tím, kam se
 * doopravdy kliká (matlo to i automatické testy).
 */
export function zpusobZvetseni(meritko: number, desktop: boolean = isDesktop()): ZpusobZvetseni {
  const m = omezMeritko(meritko);
  if (desktop) return { druh: "webview", meritko: m };
  if (m === 1) return { druh: "zadne" };
  return { druh: "css", meritko: m };
}

/**
 * Použije měřítko na dokument.
 *
 * `nastavZoomWebview` se předává zvenčí, aby se `@tauri-apps/api` netahal do
 * webového balíčku a šlo to otestovat bez Tauri.
 */
export async function pouzijMeritko(
  meritko: number,
  moznosti: {
    dokument?: HTMLElement | null;
    desktop?: boolean;
    nastavZoomWebview?: (meritko: number) => Promise<void>;
    nahlasChybu?: (e: unknown) => void;
  } = {},
): Promise<ZpusobZvetseni> {
  const korenElement = moznosti.dokument ?? (typeof document !== "undefined" ? document.documentElement : null);
  const zpusob = zpusobZvetseni(meritko, moznosti.desktop ?? isDesktop());
  if (!korenElement) return zpusob;

  if (zpusob.druh === "webview") {
    // Rozvržení nemá co přepočítávat: webview zvětší i `vh`.
    korenElement.style.removeProperty("zoom");
    korenElement.style.setProperty("--ui-scale", "1");
    try {
      await moznosti.nastavZoomWebview?.(zpusob.meritko);
    } catch (e) {
      /*
       * Když zoom webview selže (starší verze, jiná platforma), radši se
       * nezvětší nic, než aby se rozhraní zvětšilo napůl. Uživatel to pozná
       * a hláška je v logu.
       */
      moznosti.nahlasChybu?.(e);
    }
    return zpusob;
  }

  if (zpusob.druh === "css") {
    korenElement.style.setProperty("zoom", String(zpusob.meritko));
    korenElement.style.setProperty("--ui-scale", String(zpusob.meritko));
    return zpusob;
  }

  korenElement.style.removeProperty("zoom");
  korenElement.style.setProperty("--ui-scale", "1");
  return zpusob;
}
