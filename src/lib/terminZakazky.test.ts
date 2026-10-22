import { describe, it, expect } from "vitest";
import { hlasiTermin, podleTerminu, stavTerminu, textTerminu } from "./terminZakazky";

// Čtvrtek 2026-10-22 14:00 místního času.
const TED = new Date(2026, 9, 22, 14, 0, 0);
const iso = (den: number, hodina = 10) => new Date(2026, 9, den, hodina, 0, 0).toISOString();

describe("stavTerminu", () => {
  it("bez termínu, u koncové a u připravené zakázky nic nehlásí", () => {
    expect(stavTerminu(null, { ted: TED })).toBeNull();
    expect(stavTerminu("", { ted: TED })).toBeNull();
    expect(stavTerminu(iso(20), { ted: TED, koncovy: true })).toBeNull();
    expect(stavTerminu(iso(20), { ted: TED, pripraveno: true })).toBeNull();
    expect(stavTerminu("nesmysl", { ted: TED })).toBeNull();
  });

  it("po termínu: minulé dny i dnešní termín, který už minul", () => {
    expect(stavTerminu(iso(19), { ted: TED })).toMatchObject({ druh: "po", dni: -3 });
    expect(stavTerminu(iso(22, 9), { ted: TED })).toMatchObject({ druh: "po", dni: 0 });
  });

  it("dnes: termín později dnes", () => {
    expect(stavTerminu(iso(22, 17), { ted: TED })).toMatchObject({ druh: "dnes", dni: 0 });
  });

  it("blíží se: zítra a pozítří; dál je v pořádku", () => {
    // Zítra ráno je „zítra“ i odpoledne – počítají se kalendářní dny.
    expect(stavTerminu(iso(23, 8), { ted: TED })).toMatchObject({ druh: "blizi", dni: 1 });
    expect(stavTerminu(iso(24), { ted: TED })).toMatchObject({ druh: "blizi", dni: 2 });
    expect(stavTerminu(iso(25), { ted: TED })).toMatchObject({ druh: "ok", dni: 3 });
    expect(stavTerminu(iso(25), { ted: TED, prahDni: 5 })).toMatchObject({ druh: "blizi", dni: 3 });
  });
});

describe("textTerminu a hlasiTermin", () => {
  it("texty štítku", () => {
    expect(textTerminu(stavTerminu(iso(19), { ted: TED }))).toBe("po termínu · 3 d");
    expect(textTerminu(stavTerminu(iso(22, 9), { ted: TED }))).toBe("po termínu");
    expect(textTerminu(stavTerminu(iso(22, 17), { ted: TED }))).toBe("termín dnes");
    expect(textTerminu(stavTerminu(iso(23), { ted: TED }))).toBe("termín zítra");
    expect(textTerminu(stavTerminu(iso(24), { ted: TED }))).toBe("termín za 2 dny");
    expect(textTerminu(stavTerminu(iso(30), { ted: TED }))).toBeNull();
    expect(textTerminu(null)).toBeNull();
  });

  it("do záložky Termíny patří vše kromě „v pořádku“", () => {
    expect(hlasiTermin(stavTerminu(iso(19), { ted: TED }))).toBe(true);
    expect(hlasiTermin(stavTerminu(iso(22, 17), { ted: TED }))).toBe(true);
    expect(hlasiTermin(stavTerminu(iso(23), { ted: TED }))).toBe(true);
    expect(hlasiTermin(stavTerminu(iso(30), { ted: TED }))).toBe(false);
    expect(hlasiTermin(null)).toBe(false);
  });
});

describe("podleTerminu", () => {
  it("nejdřívější termín nahoře, bez termínu na konec, při shodě starší přijetí", () => {
    const z = (den: number | null, prijato: number) => ({
      termin: den === null ? null : stavTerminu(iso(den), { ted: TED }),
      createdAt: iso(prijato),
      den,
    });
    const serazene = [z(null, 1), z(24, 5), z(19, 10), z(24, 2)].sort(podleTerminu);
    expect(serazene.map((x) => [x.den, new Date(x.createdAt).getDate()])).toEqual([[19, 10], [24, 2], [24, 5], [null, 1]]);
  });
});
