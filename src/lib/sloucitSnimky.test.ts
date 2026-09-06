import { describe, it, expect } from "vitest";
import { sloucSeznam, sloucData } from "./sloucitSnimky";

/**
 * Sklad a ceník se ukládají jako celý snímek, takže bez sloučení by zápis
 * jednoho člověka smazal, co mezitím přidal druhý. Tyhle testy popisují
 * přesně ty situace, které v servisu nastanou: dva technici u dvou pultů
 * a notebook, který se probral po výpadku.
 */
type P = { id: string; nazev: string; kusy?: number };

const p = (id: string, nazev: string, kusy?: number): P => ({ id, nazev, ...(kusy === undefined ? {} : { kusy }) });

describe("sloučení seznamů", () => {
  it("cizí přírůstek zůstane, i když o něm nevím", () => {
    const zaklad = [p("a", "A")];
    const moje = [p("a", "A")];
    const jejich = [p("a", "A"), p("b", "B")];
    expect(sloucSeznam(zaklad, moje, jejich).map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("moje změna přebije cizí verzi téhož řádku", () => {
    const zaklad = [p("a", "A", 1)];
    const moje = [p("a", "A", 5)];
    const jejich = [p("a", "A", 2)];
    expect(sloucSeznam(zaklad, moje, jejich)[0].kusy).toBe(5);
  });

  it("čeho jsem se nedotkl, to zůstane podle databáze", () => {
    const zaklad = [p("a", "A", 1)];
    const moje = [p("a", "A", 1)];
    const jejich = [p("a", "A", 9)];
    expect(sloucSeznam(zaklad, moje, jejich)[0].kusy).toBe(9);
  });

  it("co jsem smazal, zmizí", () => {
    const zaklad = [p("a", "A"), p("b", "B")];
    const moje = [p("a", "A")];
    const jejich = [p("a", "A"), p("b", "B")];
    expect(sloucSeznam(zaklad, moje, jejich).map((x) => x.id)).toEqual(["a"]);
  });

  it("můj přírůstek přibude k cizímu", () => {
    const zaklad = [p("a", "A")];
    const moje = [p("a", "A"), p("c", "C")];
    const jejich = [p("a", "A"), p("b", "B")];
    expect(sloucSeznam(zaklad, moje, jejich).map((x) => x.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("řádek, který mezitím někdo smazal, nekřísím", () => {
    const zaklad = [p("a", "A", 1)];
    const moje = [p("a", "A", 7)];
    const jejich: P[] = [];
    expect(sloucSeznam(zaklad, moje, jejich)).toEqual([]);
  });

  it("beze změn vrátí to, co je v databázi", () => {
    const stav = [p("a", "A"), p("b", "B")];
    expect(sloucSeznam(stav, stav, stav)).toEqual(stav);
  });

  it("prázdný základ znamená, že všechno moje je přírůstek", () => {
    expect(sloucSeznam([], [p("a", "A")], [p("b", "B")]).map((x) => x.id).sort()).toEqual(["a", "b"]);
  });
});

describe("sloučení celé struktury", () => {
  it("spojí každý seznam zvlášť a ostatní klíče vezme z databáze", () => {
    const zaklad = { produkty: [p("a", "A")], sklady: [p("s", "Hlavní")], verze: 1 };
    const moje = { produkty: [p("a", "A", 3)], sklady: [p("s", "Hlavní")], verze: 1 };
    const jejich = { produkty: [p("a", "A"), p("b", "B")], sklady: [p("s", "Hlavní"), p("t", "Pobočka")], verze: 2 };
    const out = sloucData(zaklad as any, moje as any, jejich as any) as any;
    expect(out.produkty.map((x: P) => x.id).sort()).toEqual(["a", "b"]);
    expect(out.produkty.find((x: P) => x.id === "a").kusy).toBe(3);
    expect(out.sklady.map((x: P) => x.id).sort()).toEqual(["s", "t"]);
    expect(out.verze).toBe(2);
  });
});
