import { describe, it, expect, vi } from "vitest";
import { pouzijMeritko, zpusobZvetseni, omezMeritko, MIN_MERITKO, MAX_MERITKO } from "./velikostRozhrani";

/**
 * Velikost rozhraní se dřív všude dělala CSS `zoom`em na `<html>`. Ten míchá
 * dvě soustavy souřadnic (rect vrací jiné jednotky, než jaké se zapisují do
 * CSS) a `vh`/`dvh` o něm nevědí – kvůli tomu je v kódu sedm obezliček
 * `calc(100dvh / var(--ui-scale))` a jedna chyba (nedosažitelná poslední
 * položka v Nastavení) stála dvě kola oprav. Na desktopu se proto zvětšuje
 * samotné webview, kde tenhle problém neexistuje.
 */

/** Nejmenší náhrada `<html>`, jaká pro test stačí. */
function falesnyKoren() {
  const styly = new Map<string, string>();
  return {
    styly,
    el: {
      style: {
        setProperty: (k: string, v: string) => styly.set(k, v),
        removeProperty: (k: string) => styly.delete(k),
      },
    } as unknown as HTMLElement,
  };
}

describe("velikost rozhraní", () => {
  it("na desktopu zvětšuje webview a rozvržení nechá na pokoji", async () => {
    const { el, styly } = falesnyKoren();
    const setZoom = vi.fn(async () => {});
    await pouzijMeritko(1.25, { dokument: el, desktop: true, nastavZoomWebview: setZoom });

    expect(setZoom).toHaveBeenCalledWith(1.25);
    expect(styly.has("zoom"), "na desktopu se CSS zoom nepoužívá").toBe(false);
    // 1, ne 1.25: webview zvětší i `vh`, takže `calc(100dvh / var(--ui-scale))`
    // nesmí dělit ještě jednou.
    expect(styly.get("--ui-scale")).toBe("1");
  });

  it("v prohlížeči zvětšuje CSS zoomem a řekne rozvržení měřítko", async () => {
    const { el, styly } = falesnyKoren();
    const setZoom = vi.fn(async () => {});
    await pouzijMeritko(1.25, { dokument: el, desktop: false, nastavZoomWebview: setZoom });

    expect(setZoom).not.toHaveBeenCalled();
    expect(styly.get("zoom")).toBe("1.25");
    expect(styly.get("--ui-scale")).toBe("1.25");
  });

  it("při 100 % se v prohlížeči zoom nenastavuje vůbec", async () => {
    // `zoom: 1` nic nezvětší, ale založí zoomovací kontejner a souřadnice
    // prvků pak nesedí s tím, kam se doopravdy kliká.
    const { el, styly } = falesnyKoren();
    await pouzijMeritko(1, { dokument: el, desktop: false });
    expect(styly.has("zoom")).toBe(false);
    expect(styly.get("--ui-scale")).toBe("1");
  });

  it("selhání zoomu webview nezvětší rozhraní napůl", async () => {
    const { el, styly } = falesnyKoren();
    const chyby: unknown[] = [];
    await pouzijMeritko(1.25, {
      dokument: el,
      desktop: true,
      nastavZoomWebview: async () => { throw new Error("stará verze Tauri"); },
      nahlasChybu: (e) => chyby.push(e),
    });
    expect(chyby).toHaveLength(1);
    expect(styly.has("zoom"), "nesmí se to zkusit dohnat CSS zoomem").toBe(false);
    expect(styly.get("--ui-scale")).toBe("1");
  });

  it("měřítko se drží v rozumných mezích", () => {
    expect(omezMeritko(3)).toBe(MAX_MERITKO);
    expect(omezMeritko(0.2)).toBe(MIN_MERITKO);
    expect(omezMeritko(0)).toBe(1);
    expect(omezMeritko(undefined)).toBe(1);
    expect(omezMeritko(Number.NaN)).toBe(1);
    expect(omezMeritko(1.1)).toBe(1.1);
  });

  it("rozhodnutí nezávisí na DOM, takže se dá otestovat samo", () => {
    expect(zpusobZvetseni(1.2, true)).toEqual({ druh: "webview", meritko: 1.2 });
    expect(zpusobZvetseni(1.2, false)).toEqual({ druh: "css", meritko: 1.2 });
    expect(zpusobZvetseni(1, false)).toEqual({ druh: "zadne" });
    // Na desktopu i 100 % projde přes webview: uživatel se mohl vracet
    // z většího měřítka a zoom je potřeba srovnat zpátky.
    expect(zpusobZvetseni(1, true)).toEqual({ druh: "webview", meritko: 1 });
  });
});
