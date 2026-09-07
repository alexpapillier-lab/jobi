/**
 * Hranice období ve Statistikách.
 *
 * Podle nich se rozhoduje, která zakázka spadne do „tohoto měsíce“. Když
 * hranice ujede o hodinu (UTC místo našeho času) nebo o den (datum z pole
 * „Od“ přečtené jako UTC půlnoc), majitel porovnává jiný měsíc, než si myslí.
 *
 * Testy schválně nepředpokládají žádné konkrétní pásmo – porovnávají se
 * s místními daty, takže platí i na stroji nastaveném na UTC.
 */
import { describe, it, expect } from "vitest";
import {
  endOfDay,
  mondayOf,
  parseDatum,
  periodRange,
  previousPeriodRange,
  shiftMonths,
  startOfDay,
  vObdobi,
} from "./obdobi";

const misto = (r: number, m: number, d: number, h = 0, mi = 0, s = 0, ms = 0) => new Date(r, m - 1, d, h, mi, s, ms);

describe("datum z pole Od/Do", () => {
  it("RRRR-MM-DD je místní půlnoc, ne půlnoc v UTC", () => {
    const d = parseDatum("2026-01-01");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(0);
    expect(d!.getDate()).toBe(1);
    expect(d!.getHours()).toBe(0);
  });

  it("nesmyslné datum vrátí null, ne Invalid Date", () => {
    expect(parseDatum("")).toBeNull();
    expect(parseDatum("nesmysl")).toBeNull();
  });
});

describe("vlastní období", () => {
  it("začíná místní půlnocí prvního dne a končí koncem posledního", () => {
    const r = periodRange("custom", "2026-01-01", "2026-01-31", misto(2026, 6, 15));
    expect(r).not.toBeNull();
    expect(r!.start.getTime()).toBe(misto(2026, 1, 1, 0, 0, 0, 0).getTime());
    expect(r!.end.getTime()).toBe(misto(2026, 1, 31, 23, 59, 59, 999).getTime());
  });

  it("zakázka z 1. ledna 00:30 patří do ledna, ne do prosince", () => {
    const r = periodRange("custom", "2026-01-01", "2026-01-31", misto(2026, 6, 15))!;
    expect(vObdobi(misto(2026, 1, 1, 0, 30), r)).toBe(true);
    expect(vObdobi(misto(2025, 12, 31, 23, 30), r)).toBe(false);
  });

  it("bez obou dat se neomezuje nic", () => {
    expect(periodRange("custom", "2026-01-01", "", misto(2026, 6, 15))).toBeNull();
    expect(periodRange("custom", "", "2026-01-31", misto(2026, 6, 15))).toBeNull();
  });
});

describe("předvolená období", () => {
  it("„Vše“ je bez hranic", () => {
    expect(periodRange("all", "", "", misto(2026, 6, 15))).toBeNull();
  });

  it("„Měsíc“ začíná prvním dnem měsíce v místním čase", () => {
    const r = periodRange("month", "", "", misto(2026, 3, 29, 14, 0))!;
    expect(r.start.getTime()).toBe(misto(2026, 3, 1, 0, 0, 0, 0).getTime());
    expect(r.end.getTime()).toBe(misto(2026, 3, 29, 23, 59, 59, 999).getTime());
  });

  it("první a poslední den měsíce jsou uvnitř", () => {
    const r = periodRange("custom", "2026-03-01", "2026-03-31", misto(2026, 4, 1))!;
    expect(vObdobi(misto(2026, 3, 1, 0, 0, 0, 0), r)).toBe(true);
    expect(vObdobi(misto(2026, 3, 31, 23, 59, 59, 0), r)).toBe(true);
    expect(vObdobi(misto(2026, 4, 1, 0, 0, 0, 0), r)).toBe(false);
    expect(vObdobi(misto(2026, 2, 28, 23, 59, 59, 999), r)).toBe(false);
  });

  it("den přechodu na letní čas má pořád celé období", () => {
    // 29. 3. 2026 se ve 2:00 přeskočí na 3:00; den má 23 hodin.
    const r = periodRange("custom", "2026-03-29", "2026-03-29", misto(2026, 4, 1))!;
    expect(vObdobi(misto(2026, 3, 29, 1, 30), r)).toBe(true);
    expect(vObdobi(misto(2026, 3, 29, 3, 30), r)).toBe(true);
    expect(vObdobi(misto(2026, 3, 28, 23, 59), r)).toBe(false);
    expect(vObdobi(misto(2026, 3, 30, 0, 0, 0, 1), r)).toBe(false);
  });

  it("„Týden“ začíná pondělím – i v neděli", () => {
    // 15. 3. 2026 je neděle.
    expect(mondayOf(misto(2026, 3, 15, 12, 0)).getTime()).toBe(misto(2026, 3, 9).getTime());
    // 9. 3. 2026 je pondělí.
    expect(mondayOf(misto(2026, 3, 9, 12, 0)).getTime()).toBe(misto(2026, 3, 9).getTime());
    // Přes hranici měsíce: 1. 3. 2026 je neděle.
    expect(mondayOf(misto(2026, 3, 1, 12, 0)).getTime()).toBe(misto(2026, 2, 23).getTime());
  });

  it("„Kvartál“ začíná prvním dnem kvartálu", () => {
    expect(periodRange("quarter", "", "", misto(2026, 5, 20))!.start.getTime()).toBe(misto(2026, 4, 1).getTime());
    expect(periodRange("quarter", "", "", misto(2026, 1, 2))!.start.getTime()).toBe(misto(2026, 1, 1).getTime());
  });
});

describe("předchozí období", () => {
  it("minulý měsíc jde jen do stejného dne, ne do konce měsíce", () => {
    const p = previousPeriodRange("month", misto(2026, 6, 10, 15, 0))!;
    expect(p.start.getTime()).toBe(misto(2026, 5, 1).getTime());
    expect(p.end.getTime()).toBe(misto(2026, 5, 10, 23, 59, 59, 999).getTime());
  });

  it("z 31. března se posune na 28. února, ne na 3. březen", () => {
    expect(shiftMonths(misto(2026, 3, 31, 23, 59, 59, 999), -1).getTime())
      .toBe(misto(2026, 2, 28, 23, 59, 59, 999).getTime());
  });

  it("„Vše“ a „Vlastní“ nemají s čím porovnávat", () => {
    expect(previousPeriodRange("all", misto(2026, 6, 10))).toBeNull();
    expect(previousPeriodRange("custom", misto(2026, 6, 10))).toBeNull();
  });

  it("včerejšek přes přechod letního času je pořád celý den", () => {
    const p = previousPeriodRange("today", misto(2026, 3, 30, 10, 0))!;
    expect(p.start.getTime()).toBe(misto(2026, 3, 29, 0, 0, 0, 0).getTime());
    expect(p.end.getTime()).toBe(misto(2026, 3, 29, 23, 59, 59, 999).getTime());
    expect(vObdobi(misto(2026, 3, 29, 3, 30), p)).toBe(true);
  });
});

describe("pomocníci pro dny", () => {
  it("začátek a konec dne drží stejný den", () => {
    const d = misto(2026, 3, 29, 13, 45, 12, 34);
    expect(startOfDay(d).getDate()).toBe(29);
    expect(endOfDay(d).getDate()).toBe(29);
    expect(endOfDay(d).getMilliseconds()).toBe(999);
  });
});
