import { describe, it, expect } from "vitest";
import { formatCZ, formatCZDate, formatPhone } from "./types";

/**
 * Čas u komentářů v zakázce.
 *
 * Podle něj se v servisu dohledává, kdo co kdy zapsal – typicky když se
 * zákazník ptá, kdy mu kdo volal, nebo když se řeší, jestli byla závada
 * nahlášená před předáním. Musí být vidět i hodina a minuta, ne jen datum,
 * a musí být ve dvacetičtyřhodinovém tvaru, jak se v Česku píše.
 */
describe("čas u komentáře v zakázce", () => {
  it("ukazuje datum i hodinu s minutou, ne jen datum", () => {
    expect(formatCZ("2026-01-05T14:03:00")).toMatch(/^05\.\s01\.\s2026\s14:03$/);
  });

  it("používá dvacetičtyřhodinový čas, ne dopoledne/odpoledne", () => {
    const vecer = formatCZ("2026-01-05T21:30:00");
    expect(vecer).toContain("21:30");
    expect(vecer.toLowerCase()).not.toContain("pm");
    expect(vecer.toLowerCase()).not.toContain("odp");
  });

  it("čas krátce po půlnoci je 00:05, ne 12:05", () => {
    expect(formatCZ("2026-01-05T00:05:00")).toContain("00:05");
  });

  it("den a měsíc mají vedoucí nulu, aby komentáře pod sebou lícovaly", () => {
    expect(formatCZ("2026-03-07T09:08:00")).toMatch(/^07\.\s03\.\s2026\s09:08$/);
  });

  it("píše se den před měsícem, ne americky měsíc první", () => {
    // 31. prosince nemůže být měsíc na prvním místě – rozpozná se pořadí.
    expect(formatCZ("2026-12-31T23:59:00")).toMatch(/^31\.\s12\.\s2026\s23:59$/);
  });

  it("poškozené datum z databáze nesmí shodit vykreslení komentáře", () => {
    expect(() => formatCZ("nesmysl")).not.toThrow();
    expect(() => formatCZ("")).not.toThrow();
  });
});

/**
 * Telefon na kartě zakázky se formátuje pokaždé, když se karta překreslí –
 * i z hodnoty, která už jednou naformátovaná je. Kdyby formátování nebylo
 * opakovatelné, číslo by se s každým překreslením rozpadalo.
 */
describe("telefon na kartě – opakované formátování a nečistý zápis", () => {
  it("už naformátované číslo zůstane stejné", () => {
    const jednou = formatPhone("777123456");
    expect(formatPhone(jednou)).toBe(jednou);
    expect(formatPhone(formatPhone(jednou))).toBe(jednou);
  });

  it("číslo s předvolbou se opakovaným formátováním nerozpadne", () => {
    const jednou = formatPhone("+420777123456");
    expect(formatPhone(jednou)).toBe("+420 777 123 456");
  });

  it("pomlčky, závorky a lomítka z ručního zápisu se srovnají", () => {
    expect(formatPhone("777-123-456")).toBe("777 123 456");
    expect(formatPhone("(777) 123/456")).toBe("777 123 456");
  });

  it("popisek u čísla zmizí – zůstane jen samotné číslo", () => {
    // Do políčka se běžně napíše „mobil: 777 123 456“.
    expect(formatPhone("mobil: 777 123 456")).toBe("777 123 456");
  });

  it("čísla, která do českého tvaru nepasují, se nechají tak, jak jsou", () => {
    expect(formatPhone("00420777123456")).toBe("00420777123456");
    expect(formatPhone("353123456789012")).toBe("353123456789012");
    expect(formatPhone("neuvedeno")).toBe("neuvedeno");
  });
});

/**
 * Datum přijetí na kartě. Zakázky se podle něj hledají („přinesl to
 * v úterý“), takže musí sedět den, ne jen měsíc a rok.
 */
describe("datum přijetí na kartě – hraniční dny", () => {
  it("první den měsíce se píše bez vedoucí nuly", () => {
    expect(formatCZDate("2026-02-01T08:00:00")).toBe("1. 2. 2026");
  });

  it("přestupný den existuje a nepřeteče na březen", () => {
    expect(formatCZDate("2024-02-29T10:00:00")).toBe("29. 2. 2024");
  });

  it("silvestrovská zakázka nespadne do dalšího roku", () => {
    expect(formatCZDate("2025-12-31T23:30:00")).toBe("31. 12. 2025");
  });

  it("chybějící datum se vypíše, jak přišlo, místo NaN", () => {
    expect(formatCZDate("0000-00-00")).toBe("0000-00-00");
  });
});
