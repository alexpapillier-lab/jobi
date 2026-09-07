/**
 * Podepsané odkazy na fotky a podpisy pro edge funkce.
 *
 * Bucket `diagnostic-photos` obsahuje fotky zařízení a podpisy převzetí, tedy
 * osobní údaje zákazníků cizí dílny. Dokud byl veřejný, stačil k nim odkaz –
 * a odkaz z portálu si zákazník (nebo kdokoli, komu ho přeposlal) odnesl
 * natrvalo, i po vypršení portálového tokenu.
 *
 * Edge funkce běží pod `service_role`, takže podepisují až po tom, co samy
 * ověří oprávnění: portál token zakázky, export členství v servisu. V databázi
 * zůstává URL ve veřejném tvaru jako identifikátor souboru – převod na cestu
 * dělá `cestaFotky`.
 *
 * Protějšek v aplikaci: src/lib/podepsaneFotky.ts. Sdílet jeden soubor nejde,
 * edge funkce běží v Denu a nevidí do `src/`.
 */

/**
 * Jen ta část klienta, kterou tenhle modul potřebuje.
 *
 * Typ se schválně neimportuje z esm.sh – tsc v Jobi ho neumí stáhnout a modul
 * se testuje vitestem odsud (src/lib/podepsaneFotkyEdge.test.ts). Skutečný
 * SupabaseClient tomuhle tvaru vyhovuje.
 */
export type UlozisteKlient = {
  storage: {
    from: (bucket: string) => {
      createSignedUrls: (
        cesty: string[],
        platnostSekund: number,
      ) => Promise<{ data: ({ path?: string | null; signedUrl?: string | null } | null)[] | null; error: unknown }>;
    };
  };
};

export const BUCKET_FOTEK = "diagnostic-photos";

/**
 * Platnost odkazu v portálu.
 *
 * Portál si data sám obnovuje jednou za minutu, dokud je karta vidět, takže
 * mu delší platnost k ničemu není. Hodina je rezerva pro zákazníka, který
 * stránku nechá otevřenou a vrátí se k ní – ne aby odkaz přežil návštěvu.
 */
export const PLATNOST_PORTAL_S = 3600;

/**
 * Platnost odkazů v exportu dat.
 *
 * Export je soubor, který si majitel stáhne a někam uloží; kdyby odkazy
 * platily minutu, byla by v něm k fotkám nepoužitelná cesta. Týden stačí na
 * to, aby si je stáhl, a zároveň z exportu nedělá trvalý veřejný archiv.
 */
export const PLATNOST_EXPORT_S = 7 * 24 * 3600;

/**
 * Cesta v bucketu, nebo `null` když odkaz nevede do našeho úložiště.
 * Poznává veřejný i podepsaný tvar a holou cestu.
 */
export function cestaFotky(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const s = url.trim();
  if (!s || s.startsWith("data:")) return null;

  if (!/^https?:\/\//i.test(s)) {
    const cista = s.replace(/^\/+/, "").split("?")[0];
    return cista.includes("/") ? decodeURIComponent(cista) : null;
  }
  try {
    const u = new URL(s);
    const m = u.pathname.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/diagnostic-photos\/(.+)$/);
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

/**
 * Podepíše seznam odkazů. Vrací pole stejné délky a pořadí.
 *
 * Když se podepsat nepovede, zůstane původní odkaz. Fotka se sice po přepnutí
 * bucketu nezobrazí, ale portál kvůli tomu neshodí celou odpověď – zákazník
 * uvidí stav zakázky i bez obrázku.
 */
export async function podepsFotky(
  svc: UlozisteKlient,
  urls: readonly string[],
  platnostSekund: number,
): Promise<string[]> {
  const vysledek = [...urls];
  const cesty: string[] = [];
  const indexy = new Map<string, number[]>();

  urls.forEach((url, i) => {
    const cesta = cestaFotky(url);
    if (!cesta) return;
    if (!indexy.has(cesta)) {
      indexy.set(cesta, []);
      cesty.push(cesta);
    }
    indexy.get(cesta)!.push(i);
  });
  if (cesty.length === 0) return vysledek;

  try {
    const { data, error } = await svc.storage.from(BUCKET_FOTEK).createSignedUrls(cesty, platnostSekund);
    if (error || !data) {
      console.error("[podepsaneFotky] createSignedUrls:", error);
      return vysledek;
    }
    for (const p of data) {
      const cesta = p?.path ?? null;
      const podepsana = p?.signedUrl ?? null;
      if (!cesta || !podepsana) continue;
      for (const i of indexy.get(cesta) ?? []) vysledek[i] = podepsana;
    }
  } catch (e) {
    console.error("[podepsaneFotky] createSignedUrls výjimka:", e);
  }
  return vysledek;
}

/** Podepíše jeden odkaz (podpis převzetí). `null` zůstává `null`. */
export async function podepsFotku(
  svc: UlozisteKlient,
  url: string | null | undefined,
  platnostSekund: number,
): Promise<string | null> {
  if (!url) return url ?? null;
  const [podepsana] = await podepsFotky(svc, [url], platnostSekund);
  return podepsana ?? url;
}
