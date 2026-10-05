import { describe, it, expect } from "vitest";
import { NEUVEDENO, denAHodina, podleZpusobu, popisHodiny, rozlozeniHodin, rozsahHodin, shrnutiHodin, zpusobUdalosti, zpusobyPredani } from "./hodiny";

describe("denAHodina", () => {
  it("převádí UTC do pražského času včetně letního", () => {
    // 2026-07-06 je pondělí; 08:30 UTC = 10:30 SELČ
    expect(denAHodina("2026-07-06T08:30:00.000Z")).toEqual({ den: 0, hodina: 10 });
    // 2026-01-11 je neděle; 23:30 UTC = pondělí 00:30 SEČ
    expect(denAHodina("2026-01-11T23:30:00.000Z")).toEqual({ den: 0, hodina: 0 });
    // sobota 2026-01-10 15:00 UTC = 16:00
    expect(denAHodina("2026-01-10T15:00:00.000Z")).toEqual({ den: 5, hodina: 16 });
  });

  it("neplatné datum vrátí null", () => {
    expect(denAHodina("nic")).toBeNull();
  });
});

const z = (createdAt: string, completedAt?: string, status = "received") => ({ createdAt, completedAt, status });

describe("rozlozeniHodin", () => {
  const zakazky = [
    z("2026-07-06T08:30:00.000Z", "2026-07-08T13:10:00.000Z"),          // Po 10 h → St 15 h
    z("2026-07-06T08:45:00.000Z", "2026-07-08T13:40:00.000Z"),          // Po 10 h → St 15 h
    z("2026-07-07T14:05:00.000Z", undefined),                           // Út 16 h, nevydáno
    z("2026-07-11T07:59:00.000Z", "2026-07-11T09:00:00.000Z", "storno"), // So 9 h → storno
  ];

  it("příjem počítá všechny zakázky podle created_at", () => {
    const r = rozlozeniHodin(zakazky, "prijem");
    expect(r.celkem).toBe(4);
    expect(r.matice[0][10]).toBe(2);
    expect(r.matice[1][16]).toBe(1);
    expect(r.matice[5][9]).toBe(1);
    expect(r.podleHodiny[10]).toBe(2);
    expect(r.podleDne[0]).toBe(2);
    expect(r.spicky[0]).toEqual({ den: 0, hodina: 10, pocet: 2 });
  });

  it("výdej bere completed_at a storno vynechá", () => {
    const r = rozlozeniHodin(zakazky, "vydej", { jeStorno: (s) => s === "storno" });
    expect(r.celkem).toBe(2);
    expect(r.matice[2][15]).toBe(2);
    expect(r.matice[5][11]).toBe(0);
  });

  it("bez filtru storna se do výdejů počítá i storno", () => {
    expect(rozlozeniHodin(zakazky, "vydej").celkem).toBe(3);
  });
});

describe("rozsahHodin", () => {
  it("drží aspoň 8–18 a roztáhne se podle provozu", () => {
    const prazdne = rozlozeniHodin([], "prijem");
    expect(rozsahHodin(prazdne)).toEqual({ od: 8, do: 18 });
    const vecer = rozlozeniHodin([z("2026-07-06T19:30:00.000Z")], "prijem"); // 21 h
    expect(rozsahHodin(vecer)).toEqual({ od: 8, do: 21 });
    const rano = rozlozeniHodin([z("2026-07-06T04:30:00.000Z")], "prijem"); // 6 h
    expect(rozsahHodin(rano)).toEqual({ od: 6, do: 18 });
  });
});

describe("shrnutiHodin", () => {
  it("pod pět zakázek nic neříká", () => {
    expect(shrnutiHodin(rozlozeniHodin([z("2026-07-06T08:30:00.000Z")], "prijem"), "prijem")).toBeNull();
  });

  it("najde nejsilnější den a souvislý blok hodin", () => {
    const zakazky = [
      ...Array.from({ length: 6 }, () => z("2026-07-07T08:10:00.000Z")), // Út 10 h
      ...Array.from({ length: 3 }, () => z("2026-07-07T09:10:00.000Z")), // Út 11 h
      ...Array.from({ length: 1 }, () => z("2026-07-08T12:10:00.000Z")), // St 14 h
    ];
    const s = shrnutiHodin(rozlozeniHodin(zakazky, "prijem"), "prijem");
    expect(s).toBe("Nejvíc příjmů je v úterý (90 %). Nejsilnější hodiny jsou 9–12 h, připadá na ně 90 % příjmů.");
  });
});

describe("způsob předání", () => {
  const zakazky = [
    { createdAt: "2026-07-06T08:30:00.000Z", prevzeti: "Osobně", predani: "Poštou" },
    { createdAt: "2026-07-06T08:30:00.000Z", prevzeti: "Osobně", predani: "Osobně" },
    { createdAt: "2026-07-06T08:30:00.000Z", prevzeti: "Poštou", predani: " " },
    { createdAt: "2026-07-06T08:30:00.000Z", prevzeti: null, predani: "Kurýr" },
  ];

  it("u příjmu bere převzetí, u výdeje předání zpět, prázdné je neuvedeno", () => {
    expect(zpusobUdalosti(zakazky[2], "prijem")).toBe("Poštou");
    expect(zpusobUdalosti(zakazky[2], "vydej")).toBe(NEUVEDENO);
    expect(zpusobUdalosti(zakazky[3], "prijem")).toBe(NEUVEDENO);
  });

  it("nabídka je od nejčastějšího, neuvedeno poslední", () => {
    expect(zpusobyPredani(zakazky, "prijem")).toEqual([
      { zpusob: "Osobně", pocet: 2 },
      { zpusob: "Poštou", pocet: 1 },
      { zpusob: NEUVEDENO, pocet: 1 },
    ]);
    expect(zpusobyPredani(zakazky, "vydej").map((x) => x.zpusob)).toEqual(["Kurýr", "Osobně", "Poštou", NEUVEDENO]);
  });

  it("filtr vybere jen daný způsob; null = vše", () => {
    expect(podleZpusobu(zakazky, "prijem", "Osobně")).toHaveLength(2);
    expect(podleZpusobu(zakazky, "vydej", NEUVEDENO)).toHaveLength(1);
    expect(podleZpusobu(zakazky, "prijem", null)).toHaveLength(4);
  });
});

describe("popisHodiny", () => {
  it("formátuje interval", () => {
    expect(popisHodiny(10)).toBe("10–11 h");
    expect(popisHodiny(23)).toBe("23–0 h");
  });
});
