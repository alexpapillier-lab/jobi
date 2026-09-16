import { describe, expect, it } from "vitest";
import { hodnotaSlevy, jeSlevaAktivni, normalizujSlevy, popisSlevy } from "./prednastaveneSlevy";

describe("normalizujSlevy", () => {
  it("bez configu vrátí prázdný seznam", () => {
    expect(normalizujSlevy(undefined)).toEqual([]);
    expect(normalizujSlevy(null)).toEqual([]);
    expect(normalizujSlevy("10")).toEqual([]);
  });

  it("nechá jen platné položky a doplní id", () => {
    expect(
      normalizujSlevy([
        { id: "a", typ: "percentage", hodnota: 10, nazev: " Stálý zákazník " },
        { typ: "amount", hodnota: 200 },
        { typ: "percentage", hodnota: 0 },
        { typ: "percentage", hodnota: 150 },
        { typ: "amount", hodnota: -5 },
        { typ: "jine", hodnota: 5 },
        { typ: "amount", hodnota: "20" },
        null,
      ]),
    ).toEqual([
      { id: "a", typ: "percentage", hodnota: 10, nazev: "Stálý zákazník" },
      { id: "s_1", typ: "amount", hodnota: 200, nazev: undefined },
    ]);
  });

  it("zaokrouhlí na haléře a omezí počet", () => {
    const moc = Array.from({ length: 12 }, (_, i) => ({ typ: "amount", hodnota: i + 1.006 }));
    const out = normalizujSlevy(moc);
    expect(out).toHaveLength(8);
    expect(out[0].hodnota).toBe(1.01);
  });
});

describe("popis slevy", () => {
  it("formátuje procenta i koruny", () => {
    expect(hodnotaSlevy({ typ: "percentage", hodnota: 10 })).toBe("10 %");
    expect(hodnotaSlevy({ typ: "amount", hodnota: 200 })).toBe("200 Kč");
    expect(hodnotaSlevy({ typ: "percentage", hodnota: 12.5 })).toBe("12,5 %");
  });

  it("s názvem dá název a hodnotu", () => {
    expect(popisSlevy({ id: "x", typ: "percentage", hodnota: 10, nazev: "Stálý zákazník" })).toBe("Stálý zákazník · 10 %");
    expect(popisSlevy({ id: "x", typ: "amount", hodnota: 200 })).toBe("200 Kč");
  });
});

describe("jeSlevaAktivni", () => {
  it("porovná typ i hodnotu", () => {
    const s = { typ: "percentage" as const, hodnota: 10 };
    expect(jeSlevaAktivni(s, "percentage", 10)).toBe(true);
    expect(jeSlevaAktivni(s, "amount", 10)).toBe(false);
    expect(jeSlevaAktivni(s, "percentage", 15)).toBe(false);
    expect(jeSlevaAktivni(s, null, undefined)).toBe(false);
  });
});
