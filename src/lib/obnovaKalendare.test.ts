/**
 * Obnova kalendáře.
 *
 * Nejdůležitější je první test: kalendář, na který se člověk kouká, se nesmí
 * přenačítat pořád dokola. Přesně to se dělo ve verzi 0.6.2.
 */
import { describe, it, expect } from "vitest";
import { maSeObnovit, STARE_PO_MS, POJISTKA_MS, type StavObnovy } from "./obnovaKalendare";

const zaklad: StavObnovy = { videt: true, bylVidet: true, zastarale: false, stari: 0, nacita: false };

describe("maSeObnovit", () => {
  it("otevřený kalendář se nepřenačítá dokola", () => {
    // Data zestárnou nad hranici pro návrat, ale kalendář byl vidět i minule.
    const zaChvili = { ...zaklad, stari: STARE_PO_MS + 1 };
    expect(maSeObnovit(zaChvili)).toBe(false);
    // Ani po minutě koukání.
    expect(maSeObnovit({ ...zaklad, stari: 60_000 })).toBe(false);
  });

  it("po návratu ke kalendáři dotáhne, co uteklo", () => {
    const navrat = { ...zaklad, bylVidet: false };
    expect(maSeObnovit({ ...navrat, stari: STARE_PO_MS + 1 })).toBe(true);
  });

  it("po krátkém odskočení se nenačítá znovu", () => {
    // Přepnutí na Zakázky a hned zpět: data jsou pořád čerstvá.
    expect(maSeObnovit({ ...zaklad, bylVidet: false, stari: 1_000 })).toBe(false);
  });

  it("zprávu z realtime vezme hned, i když jsou data čerstvá", () => {
    expect(maSeObnovit({ ...zaklad, zastarale: true, stari: 0 })).toBe(true);
  });

  it("pojistka zabere, když kalendář zůstane otevřený a realtime mlčí", () => {
    expect(maSeObnovit({ ...zaklad, stari: POJISTKA_MS + 1 })).toBe(true);
  });

  it("pojistka je řádově delší než hranice pro návrat", () => {
    // Kdyby se srovnaly, je z pojistky zase ta původní smyčka.
    expect(POJISTKA_MS).toBeGreaterThan(STARE_PO_MS * 10);
  });

  it("na skrytý kalendář se nesahá", () => {
    expect(maSeObnovit({ ...zaklad, videt: false, zastarale: true, stari: POJISTKA_MS + 1 })).toBe(false);
  });

  it("do rozběhnutého načítání nepustí druhé", () => {
    expect(maSeObnovit({ ...zaklad, nacita: true, zastarale: true, stari: POJISTKA_MS + 1 })).toBe(false);
  });
});
