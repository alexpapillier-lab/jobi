/**
 * Typy k `kontroly.mjs`, aby si ho mohl naimportovat test v TypeScriptu
 * (`src/lib/hlidac.test.ts`). Samotný hlídač je schválně čisté JS bez
 * závislostí – v GitHub Actions se spouští `node` bez `npm ci`, takže si
 * nemůže nic přeložit.
 *
 * Popsané je jen to, co potřebuje test. Kontroly jsou tu jako neprůhledné
 * objekty; jejich chování se testuje spuštěním hlídače, ne typem.
 */

export declare const SERVIS_ID: string;
export declare const SERVIS_SLUG: string;
export declare const UCET: string;
export declare const ZAKAZANE_SERVISY: string[];
export declare const PREFIX_KODU: string;

export type KontrolaSkriptu = {
  id: string;
  /** Id kontroly, bez které nemá smysl tuhle spouštět. */
  zavisiNa?: string;
  spust(stav: Record<string, unknown>): Promise<string | void>;
};

export declare const KONTROLY: KontrolaSkriptu[];
export declare function uklid(stav: Record<string, unknown>): Promise<string | null>;
