/**
 * Podepsané odkazy na fotky – skládání cest, obnova a chování při chybě.
 *
 * Proč zrovna tohle: po přepnutí bucketu na neveřejný stojí zobrazení každé
 * fotky na tom, že se z uložené URL trefí cesta v úložišti a že se odkaz
 * včas obnoví. Když se v tom udělá chyba, nikdo si nevšimne hned – fotka se
 * pořád ukazuje z cache prohlížeče a přestane až za hodinu.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PLATNOST_SEKUND,
  REZERVA_MS,
  cestaFotky,
  fotkyDoDokumentu,
  jeOdkazNaFotku,
  podepsFotku,
  podepsFotky,
  servisZCesty,
  zapomenPodpisy,
} from "./podepsaneFotky";

const ZAKLAD = "https://abcd.supabase.co/storage/v1/object";
const SERVIS = "882beee7-4564-4d10-8ac6-16dc19240b57";
const CESTA = `${SERVIS}/1111-2222/foto.jpg`;
const VEREJNA = `${ZAKLAD}/public/diagnostic-photos/${CESTA}`;

/** Falešné Storage API. Počítá volání, ať je vidět, co se ušetřilo cachí. */
function falesnySupabase(prepis?: {
  createSignedUrl?: (cesta: string, s: number) => Promise<unknown>;
  createSignedUrls?: (cesty: string[], s: number) => Promise<unknown>;
}) {
  const pocty = { jedna: 0, vic: 0 };
  const storage = {
    from: () => ({
      createSignedUrl: async (cesta: string, s: number) => {
        pocty.jedna++;
        if (prepis?.createSignedUrl) return prepis.createSignedUrl(cesta, s);
        return { data: { signedUrl: `${ZAKLAD}/sign/diagnostic-photos/${cesta}?token=t${pocty.jedna}` }, error: null };
      },
      createSignedUrls: async (cesty: string[], s: number) => {
        pocty.vic++;
        if (prepis?.createSignedUrls) return prepis.createSignedUrls(cesty, s);
        return {
          data: cesty.map((c) => ({ path: c, signedUrl: `${ZAKLAD}/sign/diagnostic-photos/${c}?token=t${pocty.vic}`, error: null })),
          error: null,
        };
      },
    }),
  };
  // Testovaný kód sahá jen na `storage`; celý klient tu není potřeba.
  return { klient: { storage } as never, pocty };
}

beforeEach(() => {
  zapomenPodpisy();
  vi.useRealTimers();
});

describe("cesta k souboru z uložené URL", () => {
  it("pozná veřejný tvar, jak je uložený v databázi", () => {
    expect(cestaFotky(VEREJNA)).toBe(CESTA);
  });

  it("pozná i tvar, který už jednou prošel podepsáním", () => {
    // Bez tohohle by se nedala smazat fotka, kterou má uživatel zrovna na očích.
    expect(cestaFotky(`${ZAKLAD}/sign/diagnostic-photos/${CESTA}?token=abc`)).toBe(CESTA);
  });

  it("pozná holou cestu bez domény", () => {
    expect(cestaFotky(CESTA)).toBe(CESTA);
  });

  it("dekóduje mezery a diakritiku v názvu souboru", () => {
    const nazev = `${SERVIS}/1111/můj obrázek.jpg`;
    expect(cestaFotky(`${ZAKLAD}/public/diagnostic-photos/${encodeURI(nazev)}`)).toBe(nazev);
  });

  it("stará base64 fotka není odkaz do úložiště", () => {
    // Zakázky založené před přechodem na Storage mají fotky přímo v datech.
    expect(cestaFotky("data:image/jpeg;base64,AAAA")).toBeNull();
    expect(jeOdkazNaFotku("data:image/jpeg;base64,AAAA")).toBe(false);
  });

  it("cizí bucket ani cizí doména se nepodepisují", () => {
    expect(cestaFotky(`${ZAKLAD}/public/product-images/${CESTA}`)).toBeNull();
    expect(cestaFotky("https://priklad.cz/foto.jpg")).toBeNull();
    expect(cestaFotky("")).toBeNull();
    expect(cestaFotky("nesmysl")).toBeNull();
  });

  it("id servisu je první složka; podpisy servis v cestě nemají", () => {
    expect(servisZCesty(CESTA)).toBe(SERVIS);
    expect(servisZCesty("signatures/1111-2222-3333.png")).toBeNull();
  });
});

describe("podepisování", () => {
  it("z uložené URL udělá podepsaný odkaz", async () => {
    const { klient } = falesnySupabase();
    const odkaz = await podepsFotku(klient, VEREJNA);
    expect(odkaz).toContain("/object/sign/diagnostic-photos/");
    expect(odkaz).toContain("token=");
  });

  it("odkaz mimo náš bucket vrací beze změny a nikam nechodí", async () => {
    const { klient, pocty } = falesnySupabase();
    const data = "data:image/png;base64,AAAA";
    expect(await podepsFotku(klient, data)).toBe(data);
    expect(pocty.jedna).toBe(0);
  });

  it("bez klienta (offline start) vrací původní odkazy", async () => {
    expect(await podepsFotku(null, VEREJNA)).toBe(VEREJNA);
    expect(await podepsFotky(null, [VEREJNA])).toEqual([VEREJNA]);
  });

  it("víc fotek podepíše jedním požadavkem a zachová pořadí", async () => {
    const { klient, pocty } = falesnySupabase();
    const a = `${ZAKLAD}/public/diagnostic-photos/${SERVIS}/t/a.jpg`;
    const b = `${ZAKLAD}/public/diagnostic-photos/${SERVIS}/t/b.jpg`;
    const vysledek = await podepsFotky(klient, [a, "data:image/png;base64,X", b]);
    expect(pocty.vic).toBe(1);
    expect(vysledek[0]).toContain(`${SERVIS}/t/a.jpg`);
    expect(vysledek[1]).toBe("data:image/png;base64,X");
    expect(vysledek[2]).toContain(`${SERVIS}/t/b.jpg`);
  });

  it("stejnou fotku podruhé nepodepisuje", async () => {
    const { klient, pocty } = falesnySupabase();
    const prvni = await podepsFotku(klient, VEREJNA);
    const druhy = await podepsFotku(klient, VEREJNA);
    expect(druhy).toBe(prvni);
    expect(pocty.jedna).toBe(1);
  });

  it("souběžné náhledy téže fotky pošlou jeden požadavek", async () => {
    // Detail zakázky vykreslí všechny náhledy naráz; bez sdílení rozdělaného
    // podpisu by šlo tolik požadavků, kolik je fotek.
    const { klient, pocty } = falesnySupabase();
    const vsechny = await Promise.all([podepsFotku(klient, VEREJNA), podepsFotku(klient, VEREJNA), podepsFotku(klient, VEREJNA)]);
    expect(new Set(vsechny).size).toBe(1);
    expect(pocty.jedna).toBe(1);
  });
});

describe("obnova před vypršením", () => {
  it("odkaz, kterému zbývá míň než rezerva, se podepíše znovu", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T08:00:00Z"));
    const { klient, pocty } = falesnySupabase();
    const prvni = await podepsFotku(klient, VEREJNA);

    // Těsně před koncem rezervy ještě platí ten starý.
    vi.setSystemTime(Date.now() + PLATNOST_SEKUND * 1000 - REZERVA_MS - 1000);
    expect(await podepsFotku(klient, VEREJNA)).toBe(prvni);
    expect(pocty.jedna).toBe(1);

    // Uvnitř rezervy se podepisuje nanovo, ať se nedostane do <img src>
    // odkaz, který vyprší dřív, než ho prohlížeč stihne stáhnout.
    vi.setSystemTime(Date.now() + 2000);
    const druhy = await podepsFotku(klient, VEREJNA);
    expect(druhy).not.toBe(prvni);
    expect(pocty.jedna).toBe(2);
    vi.useRealTimers();
  });

  it("dávkové podepsání si taky hlídá platnost", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T08:00:00Z"));
    const { klient, pocty } = falesnySupabase();
    const [prvni] = await podepsFotky(klient, [VEREJNA]);
    vi.setSystemTime(Date.now() + PLATNOST_SEKUND * 1000);
    const [druhy] = await podepsFotky(klient, [VEREJNA]);
    expect(druhy).not.toBe(prvni);
    expect(pocty.vic).toBe(2);
    vi.useRealTimers();
  });
});

describe("když se podepsat nepovede", () => {
  it("vrací původní odkaz místo výjimky", async () => {
    const { klient } = falesnySupabase({
      createSignedUrl: async () => ({ data: null, error: { message: "Object not found" } }),
    });
    expect(await podepsFotku(klient, VEREJNA)).toBe(VEREJNA);
  });

  it("výpadek sítě nezhodí vykreslování", async () => {
    const { klient } = falesnySupabase({
      createSignedUrls: async () => {
        throw new Error("Failed to fetch");
      },
    });
    expect(await podepsFotky(klient, [VEREJNA])).toEqual([VEREJNA]);
  });

  it("neúspěšná položka v dávce ostatní nezablokuje", async () => {
    const dobra = `${ZAKLAD}/public/diagnostic-photos/${SERVIS}/t/dobra.jpg`;
    const { klient } = falesnySupabase({
      createSignedUrls: async (cesty) => ({
        data: cesty.map((c) =>
          c.endsWith("dobra.jpg")
            ? { path: c, signedUrl: `${ZAKLAD}/sign/diagnostic-photos/${c}?token=ok`, error: null }
            : { path: null, signedUrl: null, error: "Object not found" }
        ),
        error: null,
      }),
    });
    const [chybejici, ok] = await podepsFotky(klient, [VEREJNA, dobra]);
    expect(chybejici).toBe(VEREJNA);
    expect(ok).toContain("token=ok");
  });

  it("neúspěch se neuloží do cache – příště se zkusí znovu", async () => {
    let selze = true;
    const { klient, pocty } = falesnySupabase({
      createSignedUrl: async (cesta) =>
        selze
          ? { data: null, error: { message: "network" } }
          : { data: { signedUrl: `${ZAKLAD}/sign/diagnostic-photos/${cesta}?token=pozdeji` }, error: null },
    });
    expect(await podepsFotku(klient, VEREJNA)).toBe(VEREJNA);
    selze = false;
    expect(await podepsFotku(klient, VEREJNA)).toContain("token=pozdeji");
    expect(pocty.jedna).toBe(2);
  });
});

describe("fotky do dokumentu", () => {
  it("vloží obrázek dovnitř dokumentu, ne jako odkaz", async () => {
    // Uložené PDF si obsah odkazu nedotáhne – obrázek v něm musí být.
    const { klient } = falesnySupabase();
    const stazene: string[] = [];
    const nacti = async (u: string) => {
      stazene.push(u);
      return new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
    };
    const vysledek = await fotkyDoDokumentu(klient, [VEREJNA], nacti);
    expect(vysledek).toHaveLength(1);
    expect(vysledek[0].startsWith("data:image/jpeg;base64,")).toBe(true);
    // Stahovalo se z podepsaného odkazu, ne z veřejné adresy.
    expect(stazene[0]).toContain("/object/sign/");
  });

  it("fotku, která se nestáhne, z dokumentu vynechá", async () => {
    // Rozbitý odkaz by se v tisku tvářil jako prázdná stránka a nikdo by
    // nepoznal, že tam měla být fotka.
    const { klient } = falesnySupabase();
    const nacti = async () => {
      throw new Error("HTTP 400");
    };
    expect(await fotkyDoDokumentu(klient, [VEREJNA], nacti)).toEqual([]);
  });

  it("base64 fotka ze starých zakázek projde beze změny", async () => {
    const { klient } = falesnySupabase();
    const data = "data:image/png;base64,AAAA";
    expect(await fotkyDoDokumentu(klient, [data])).toEqual([data]);
  });

  it("prázdný seznam nikam nechodí", async () => {
    const { klient, pocty } = falesnySupabase();
    expect(await fotkyDoDokumentu(klient, [])).toEqual([]);
    expect(pocty.jedna + pocty.vic).toBe(0);
  });
});
