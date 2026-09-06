import { describe, expect, it } from "vitest";
import { VYCHOZI_SABLONY, normalizujSablony, shrnutiKontroly, vyberSablonu, zalozKontrolu } from "./kontrolniSeznamy";

describe("kontrolní seznamy", () => {
  it("vybere šablonu podle názvu zařízení, jinak obecnou", () => {
    expect(vyberSablonu(VYCHOZI_SABLONY, "iPhone 13 Pro")?.id).toBe("telefon");
    expect(vyberSablonu(VYCHOZI_SABLONY, "Lenovo ThinkPad T14")?.id).toBe("pocitac");
    expect(vyberSablonu(VYCHOZI_SABLONY, "Kávovar DeLonghi")?.id).toBe("obecne");
    expect(vyberSablonu(VYCHOZI_SABLONY, "")?.id).toBe("obecne");
  });

  it("špatný nebo prázdný config znamená výchozí šablony", () => {
    expect(normalizujSablony(undefined)).toBe(VYCHOZI_SABLONY);
    expect(normalizujSablony([{ nazev: "Bez položek", polozky: [] }])).toBe(VYCHOZI_SABLONY);
    const vlastni = normalizujSablony([{ id: "x", nazev: " Hodinky ", klicovaSlova: ["Watch"], polozky: ["Jde", " "] }]);
    expect(vlastni).toEqual([{ id: "x", nazev: "Hodinky", klicovaSlova: ["watch"], polozky: ["Jde"] }]);
  });

  it("shrnutí počítá hotové a chybné položky", () => {
    const k = zalozKontrolu(VYCHOZI_SABLONY[2]);
    expect(shrnutiKontroly(k)).toEqual({ hotovo: 0, celkem: 4, chyb: 0, dokonceno: false });
    k.polozky[0].stav = "ok";
    k.polozky[1].stav = "chyba";
    expect(shrnutiKontroly(k)).toMatchObject({ hotovo: 2, chyb: 1, dokonceno: false });
    k.polozky.forEach((p) => { if (p.stav === null) p.stav = "neoverovano"; });
    expect(shrnutiKontroly(k).dokonceno).toBe(true);
    expect(shrnutiKontroly(undefined).celkem).toBe(0);
  });
});

describe("kontrolní seznamy – hraniční případy", () => {
  it("klíčové slovo je celé slovo; při více shodách vyhrává první šablona v pořadí", () => {
    expect(vyberSablonu(VYCHOZI_SABLONY, "Samsung notebook")?.id).toBe("telefon");
    expect(vyberSablonu(VYCHOZI_SABLONY, "IPHONE 15")?.id).toBe("telefon");
    // „hp“ uvnitř slova se nepočítá – Techphone spadne na obecnou šablonu.
    expect(vyberSablonu(VYCHOZI_SABLONY, "Techphone X")?.id).toBe("obecne");
    expect(vyberSablonu(VYCHOZI_SABLONY, "HP EliteBook")?.id).toBe("pocitac");
  });

  it("bez obecné šablony vrátí první, prázdný seznam undefined, null název obecnou", () => {
    expect(vyberSablonu([VYCHOZI_SABLONY[0], VYCHOZI_SABLONY[1]], "Kávovar")?.id).toBe("telefon");
    expect(vyberSablonu([], "iPhone")).toBeUndefined();
    expect(vyberSablonu(VYCHOZI_SABLONY, null)?.id).toBe("obecne");
    expect(vyberSablonu(VYCHOZI_SABLONY, "   ")?.id).toBe("obecne");
  });

  it("normalizace: nesmysly se vynechají, chybějící id je pořadové, klíčová slova a položky se čistí", () => {
    const v = normalizujSablony([
      null, "text", { nazev: "  ", polozky: ["a"] },
      { nazev: "A", polozky: [1, "  b  ", ""] },
      { nazev: "B", polozky: ["x"], klicovaSlova: [" HP ", "", 3] },
    ]);
    expect(v).toEqual([
      { id: "s_0", nazev: "A", klicovaSlova: [], polozky: ["b"] },
      { id: "s_1", nazev: "B", klicovaSlova: ["hp"], polozky: ["x"] },
    ]);
    expect(normalizujSablony("nic")).toBe(VYCHOZI_SABLONY);
    expect(normalizujSablony([])).toBe(VYCHOZI_SABLONY);
    expect(normalizujSablony([{ nazev: "Jen mezery", polozky: ["  ", ""] }])).toBe(VYCHOZI_SABLONY);
  });

  it("duplicitní id se rozliší – explicitní „s_1“ a pořadové „s_1“ se nesejdou", () => {
    const v = normalizujSablony([{ id: "s_1", nazev: "A", polozky: ["a"] }, { nazev: "B", polozky: ["b"] }]);
    expect(v.map((s) => s.id)).toEqual(["s_1", "s_1_1"]);
  });

  it("shrnutí: null, prázdné položky a „neověřováno“ se počítá jako vyřízené", () => {
    expect(shrnutiKontroly(null)).toEqual({ hotovo: 0, celkem: 0, chyb: 0, dokonceno: false });
    expect(shrnutiKontroly({ sablonaId: "x", sablonaNazev: "x", polozky: [], upraveno: "" }).dokonceno).toBe(false);
    expect(shrnutiKontroly({ sablonaId: "x", sablonaNazev: "x", polozky: [{ text: "a", stav: "neoverovano" }], upraveno: "" }))
      .toEqual({ hotovo: 1, celkem: 1, chyb: 0, dokonceno: true });
  });
});
