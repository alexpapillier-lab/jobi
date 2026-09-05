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
