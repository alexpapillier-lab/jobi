/**
 * Typy k `poznamky-vydani.mjs`.
 *
 * Skript je .mjs, protože ho volá bash při vydání; test si ho ale importuje,
 * a bez téhle deklarace by `tsc` hlásil implicitní `any` (stejně jako
 * u hlídače v `scripts/hlidac/kontroly.d.mts`).
 */
export declare const VYCHOZI_MAX: number;
export declare function poznamkyZTitulku(titulky: readonly unknown[], max?: number): string[];
export declare function predchoziZnacka(spust?: (prikaz: string) => string): string | null;
export declare function titulkyCommitu(od: string | null, doRef?: string, spust?: (prikaz: string) => string): string[];
export declare function sestavPoznamky(titulky: readonly unknown[], max?: number): string;
